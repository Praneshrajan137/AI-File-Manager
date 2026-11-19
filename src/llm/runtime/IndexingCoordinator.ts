/**
 * IndexingCoordinator.ts - Sole owner of indexing job state, bounded pre-init mutation
 * buffering, event-loop-adaptive background yielding, vector outbox replay, and clearIndex.
 */

import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { monitorEventLoopDelay } from 'perf_hooks';
import { IndexingStatus, MAX_INDEXABLE_FILE_SIZE } from '../../shared/contracts';
import { LLMLogger } from '../../shared/logging';
import { isSensitiveSecretFile } from '../../shared/security/SecretGuard';
import { awaitBounded, IntelligenceRuntime } from './IntelligenceRuntime';
import type { IndexingService } from '../services/IndexingService';
import type { VectorStore } from '../services/VectorStore';

const INDEXABLE_WATCH_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.json', '.yaml', '.yml', '.toml',
  '.xml', '.html', '.htm', '.css', '.sh', '.sql', '.log', '.csv', '.tsv',
  '.pdf', '.docx', '.ipynb',
]);

const MAX_PREINIT_MUTATIONS = 250;

export interface IndexingProgressSink {
  isDestroyed(): boolean;
  send(channel: 'LLM:INDEXING_PROGRESS' | 'LLM:INDEXING_COMPLETE', payload: unknown): void;
}

function resolveEventLoopAdaptiveYieldMs(
  p95LagMs: number,
  activeQueriesCount: number
): number {
  if (activeQueriesCount > 0) {
    return 40;
  }
  if (p95LagMs > 24) {
    return Math.min(40, Math.round(p95LagMs * 0.5));
  }
  return 0;
}

function isPathInsideAnyRoot(targetPath: string, roots: readonly string[]): boolean {
  const norm = (p: string): string =>
    process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  const targetKey = norm(targetPath);
  return roots.some((root) => {
    const rootKey = norm(root);
    return (
      targetKey === rootKey ||
      targetKey.startsWith(rootKey.endsWith(path.sep) ? rootKey : `${rootKey}${path.sep}`)
    );
  });
}

export async function replayPendingVectorOutbox(deps: {
  vectorStore: Pick<VectorStore, 'getKnowledgeGraph' | 'deleteFile' | 'flushPendingRecords'>;
  indexingService: Pick<IndexingService, 'indexFile'>;
  validatePath: (filePath: string) => Promise<boolean>;
  maxFiles?: number;
}): Promise<{ replayed: number; purged: number }> {
  const pendingPaths =
    deps.vectorStore.getKnowledgeGraph()?.getFilesWithPendingSync(deps.maxFiles ?? 200) ?? [];
  if (pendingPaths.length === 0) {
    return { replayed: 0, purged: 0 };
  }

  let replayed = 0;
  let purged = 0;
  for (const pendingPath of pendingPaths) {
    if (isSensitiveSecretFile(pendingPath).blocked || !(await deps.validatePath(pendingPath))) {
      await deps.vectorStore.deleteFile(pendingPath).catch(() => 0);
      purged += 1;
      continue;
    }
    try {
      const stat = await fs.stat(pendingPath);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INDEXABLE_FILE_SIZE) {
        await deps.vectorStore.deleteFile(pendingPath).catch(() => 0);
        purged += 1;
        continue;
      }
    } catch {
      await deps.vectorStore.deleteFile(pendingPath).catch(() => 0);
      purged += 1;
      continue;
    }

    const res = await deps.indexingService.indexFile(pendingPath, false, { forceReindex: true });
    if (res.success) {
      replayed += 1;
    }
  }

  if (replayed > 0) {
    await deps.vectorStore.flushPendingRecords().catch(() => undefined);
  }

  return { replayed, purged };
}

export class IndexingCoordinator {
  private indexingInProgress = false;
  private indexedCount = 0;
  private totalToIndex = 0;
  private currentFile = '';
  private abortIndexing = false;
  private activeIndexingPromise: Promise<void> | null = null;
  private readonly preInitMutationQueue = new Map<
    string,
    { eventType: 'create' | 'change' | 'unlink'; filePath: string }
  >();

  constructor(
    private readonly runtime: IntelligenceRuntime,
    private readonly getActiveQueriesCount: () => number
  ) {}

  getPreInitBufferSize(): number {
    return this.preInitMutationQueue.size;
  }

  getIndexingStatus(): IndexingStatus {
    try {
      if (this.indexingInProgress) {
        return {
          indexed: this.indexedCount,
          total: this.totalToIndex,
          inProgress: true,
          currentFile: this.currentFile || undefined,
        };
      }

      const activeKg = this.runtime.vectorStore?.getKnowledgeGraph();
      if (activeKg) {
        const stats = activeKg.getStats();
        return {
          indexed: stats.totalFiles > 0 ? stats.totalFiles : this.indexedCount,
          total: Math.max(this.totalToIndex, stats.totalFiles),
          inProgress: false,
          currentFile: undefined,
        };
      }

      const kgPath = path.join(this.runtime.deps.resolveVectorDbDir(), 'knowledge-graph.sqlite');
      if (fsSync.existsSync(kgPath)) {
        const persistedFiles = this.runtime.withKnowledgeGraph((kg) => kg.getStats().totalFiles);
        return {
          indexed: persistedFiles,
          total: Math.max(this.totalToIndex, persistedFiles),
          inProgress: false,
          currentFile: undefined,
        };
      }

      return {
        indexed: this.indexedCount,
        total: this.totalToIndex,
        inProgress: false,
        currentFile: this.currentFile || undefined,
      };
    } catch {
      return {
        indexed: 0,
        total: 0,
        inProgress: false,
        currentFile: undefined,
      };
    }
  }

  private async indexFilesBackground(
    filePaths: string[],
    sink: IndexingProgressSink
  ): Promise<void> {
    const BATCH_PROGRESS_INTERVAL = 5;
    const eld = monitorEventLoopDelay({ resolution: 20 });
    eld.enable();

    try {
      for (let idx = 0; idx < filePaths.length; idx++) {
        const filePath = filePaths[idx];
        if (this.abortIndexing) {
          LLMLogger.info('Indexing aborted by user');
          break;
        }

        try {
          this.currentFile = filePath;
          const canonicalPath = await this.runtime.deps.pathPort.validateCanonicalPathOrThrow(
            filePath
          );
          if (isSensitiveSecretFile(canonicalPath).blocked) {
            continue;
          }

          const indexResult = await this.runtime.indexingService!.indexFile(canonicalPath, false, {
            skipMetadataStubs: true,
          });
          const didEmbedWork = indexResult.success && indexResult.chunksCreated > 0;
          if (didEmbedWork) {
            this.indexedCount++;
          }

          if (
            !sink.isDestroyed() &&
            (didEmbedWork || idx === filePaths.length - 1 || idx % BATCH_PROGRESS_INTERVAL === 0)
          ) {
            sink.send('LLM:INDEXING_PROGRESS', {
              indexed: this.indexedCount,
              total: this.totalToIndex,
              currentFile: filePath,
            });
          }

          if (didEmbedWork) {
            const p95LagMs = eld.percentile(95) / 1e6;
            eld.reset();
            const yieldMs = resolveEventLoopAdaptiveYieldMs(
              Number.isFinite(p95LagMs) ? p95LagMs : 0,
              this.getActiveQueriesCount()
            );
            if (yieldMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, yieldMs));
            } else {
              await new Promise((resolve) => setImmediate(resolve));
            }
          } else if ((idx & 3) === 3) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          LLMLogger.warn('Failed to index file', { filePath, error: msg });
        }
      }
    } finally {
      eld.disable();
    }

    try {
      await this.runtime.vectorStore?.flushPendingRecords();
    } catch (flushError) {
      LLMLogger.warn('Failed to flush pending records', {
        error: flushError instanceof Error ? flushError.message : String(flushError),
      });
    }

    this.indexingInProgress = false;
    this.currentFile = '';

    if (!sink.isDestroyed()) {
      sink.send('LLM:INDEXING_COMPLETE', {
        indexed: this.indexedCount,
        total: this.totalToIndex,
      });
    }

    LLMLogger.info('Indexing complete', {
      indexed: this.indexedCount,
      total: this.totalToIndex,
    });
  }

  async startDirectoryIndexing(
    sink: IndexingProgressSink,
    input: { path: string }
  ): Promise<{ success: boolean; message?: string; total?: number; error?: string }> {
    const dirPath = input.path;

    if (this.indexingInProgress) {
      return { success: false, message: 'Indexing already in progress' };
    }

    LLMLogger.info('Starting indexing', { path: dirPath });

    try {
      await this.runtime.ensureTierBInitialized();

      this.indexingInProgress = true;
      this.indexedCount = 0;
      this.abortIndexing = false;

      const canonicalDir = await this.runtime.deps.pathPort.validateCanonicalPathOrThrow(dirPath);
      const scannedPaths = await this.runtime.deps.kernelPort.scanIndexableFiles(canonicalDir);

      try {
        this.runtime.deps.configPort.addIndexedRootIfMissing(canonicalDir);
        void this.runtime.deps.kernelPort.watchIndexedRoot(canonicalDir).catch(() => undefined);
      } catch {
        // Non-fatal in minimal test environments
      }

      this.totalToIndex = scannedPaths.length;
      LLMLogger.info('Files to index', { count: this.totalToIndex });

      if (!sink.isDestroyed()) {
        sink.send('LLM:INDEXING_PROGRESS', {
          indexed: 0,
          total: this.totalToIndex,
          currentFile: '',
        });
      }

      this.activeIndexingPromise = this.indexFilesBackground(scannedPaths, sink).finally(() => {
        this.activeIndexingPromise = null;
      });

      return { success: true, total: this.totalToIndex };
    } catch (error: unknown) {
      this.indexingInProgress = false;
      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = this.runtime.deps.sanitizeError(rawMsg);
      LLMLogger.error('Failed to start indexing', { error: rawMsg });
      return { success: false, message: msg, error: msg };
    }
  }

  stopDirectoryIndexing(): { success: boolean } {
    if (!this.indexingInProgress) {
      return { success: true };
    }
    LLMLogger.info('Stopping indexing');
    this.abortIndexing = true;
    return { success: true };
  }

  async indexSingleFile(input: {
    filePath: string;
  }): Promise<{ success: boolean; chunksCreated?: number; error?: string }> {
    try {
      await this.runtime.ensureTierBInitialized();
      const canonicalPath = await this.runtime.deps.pathPort.validateCanonicalPathOrThrow(
        input.filePath
      );
      const secretCheck = isSensitiveSecretFile(canonicalPath);
      if (secretCheck.blocked) {
        return { success: false, chunksCreated: 0, error: secretCheck.reason };
      }
      const result = await this.runtime.indexingService!.indexFile(canonicalPath, true);
      return {
        success: result.success,
        chunksCreated: result.chunksCreated,
        error: result.error,
      };
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : String(error);
      return { success: false, error: this.runtime.deps.sanitizeError(raw) };
    }
  }

  private queuePreInitMutation(eventType: 'create' | 'change' | 'unlink', filePath: string): void {
    const key =
      process.platform === 'win32'
        ? path.resolve(filePath).toLowerCase()
        : path.resolve(filePath);
    if (this.preInitMutationQueue.has(key)) {
      this.preInitMutationQueue.delete(key);
    } else if (this.preInitMutationQueue.size >= MAX_PREINIT_MUTATIONS) {
      const oldestKey = this.preInitMutationQueue.keys().next().value;
      if (oldestKey) {
        this.preInitMutationQueue.delete(oldestKey);
      }
    }
    this.preInitMutationQueue.set(key, { eventType, filePath });
  }

  async drainPreInitMutations(): Promise<void> {
    if (
      !this.runtime.vectorStore ||
      !this.runtime.indexingService ||
      this.preInitMutationQueue.size === 0
    ) {
      return;
    }
    const pending = Array.from(this.preInitMutationQueue.values());
    this.preInitMutationQueue.clear();
    for (const item of pending) {
      if (!this.runtime.vectorStore || !this.runtime.indexingService) {
        break;
      }
      await this.handleKernelIndexMutation(item.eventType, item.filePath);
    }
  }

  triggerOutboxReplay(): void {
    const storeRef = this.runtime.vectorStore;
    const idxRef = this.runtime.indexingService;
    if (!storeRef || !idxRef) {
      return;
    }
    void replayPendingVectorOutbox({
      vectorStore: storeRef,
      indexingService: idxRef,
      validatePath: async (p) => {
        try {
          await this.runtime.deps.pathPort.validateCanonicalPathOrThrow(p);
          return true;
        } catch {
          return false;
        }
      },
    }).catch((outboxErr: unknown) => {
      LLMLogger.warn('Failed to replay pending vector outbox entries', {
        error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr),
      });
    });
  }

  async handleKernelIndexMutation(
    eventType: 'create' | 'change' | 'unlink',
    filePath: string
  ): Promise<void> {
    if (!this.runtime.vectorStore || !this.runtime.indexingService) {
      this.queuePreInitMutation(eventType, filePath);
      return;
    }

    try {
      if (eventType === 'unlink') {
        await this.runtime.indexingService.removeFile(filePath);
        return;
      }

      const canonicalPath = await this.runtime.deps.pathPort.validateCanonicalPathOrThrow(filePath);
      if (isSensitiveSecretFile(canonicalPath).blocked) {
        await this.runtime.indexingService.removeFile(canonicalPath).catch(() => undefined);
        return;
      }

      const indexedRoots = this.runtime.deps.configPort.readIndexedRoots();
      if (indexedRoots.length === 0 || !isPathInsideAnyRoot(canonicalPath, indexedRoots)) {
        return;
      }

      const ext = path.extname(canonicalPath).toLowerCase();
      if (!INDEXABLE_WATCH_EXTENSIONS.has(ext)) {
        return;
      }

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(canonicalPath);
      } catch {
        await this.runtime.indexingService.removeFile(canonicalPath).catch(() => undefined);
        return;
      }
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INDEXABLE_FILE_SIZE) {
        await this.runtime.indexingService.removeFile(canonicalPath).catch(() => undefined);
        return;
      }

      await this.runtime.indexingService.indexFile(canonicalPath, true);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      LLMLogger.warn('Incremental kernel index sync skipped file', {
        eventType,
        filePath,
        error: msg,
      });
    }
  }

  async clearVectorIndex(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.indexingInProgress || this.activeIndexingPromise) {
        this.abortIndexing = true;
        await this.activeIndexingPromise?.catch(() => undefined);
      }

      let success = true;
      if (this.runtime.vectorStore) {
        const result = await this.runtime.vectorStore.clear();
        success = result.success;
      } else {
        const dbDir = this.runtime.deps.resolveVectorDbDir();
        const kgPath = path.join(dbDir, 'knowledge-graph.sqlite');
        if (fsSync.existsSync(kgPath)) {
          this.runtime.withKnowledgeGraph((kg) => kg.clear());
        }
        const lanceTableDir = path.join(dbDir, 'file_chunks.lance');
        if (fsSync.existsSync(lanceTableDir)) {
          await fs.rm(lanceTableDir, { recursive: true, force: true });
        }
      }

      this.indexedCount = 0;
      this.totalToIndex = 0;
      this.currentFile = '';
      LLMLogger.info('Vector index cleared');

      return { success };
    } catch (error: unknown) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      LLMLogger.error('Failed to clear index', { error: rawMsg });
      return { success: false, error: this.runtime.deps.sanitizeError(rawMsg) };
    }
  }

  async cleanup(): Promise<void> {
    this.abortIndexing = true;
    this.preInitMutationQueue.clear();
    await awaitBounded(this.activeIndexingPromise, 1000);
    this.indexingInProgress = false;
    this.indexedCount = 0;
    this.totalToIndex = 0;
    this.currentFile = '';
    this.abortIndexing = false;
  }
}
