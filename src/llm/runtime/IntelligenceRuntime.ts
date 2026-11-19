/**
 * IntelligenceRuntime.ts - Tiered local intelligence container separating:
 *   - Tier A (always-on, zero-ONNX): SQLite FTS5, Knowledge Graph, OfflineSynthesis, Agent Traces
 *   - Tier B (lazy / fault-isolated): LanceDB VectorStore + ONNX EmbeddingWorkerPool + RAG Retrieval
 *
 * Failure in Tier B (missing ONNX runtime, GPU error, offline cache gap) marks `tierBStatus: 'unavailable'`
 * in diagnostics without taking down Tier A lexical search, Knowledge Graph insights, or Offline Copilot.
 */

import fsSync from 'fs';
import path from 'path';
import {
  ContentSearchMatch,
  FileConnectionsSummary,
  FileLineRangeResult,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '../../shared/contracts';
import { LLMLogger } from '../../shared/logging';
import { isSensitiveSecretFile, redactFileRangeLines } from '../../shared/security/SecretGuard';
import {
  IDiagnosticsSink,
  IGraphIndexPort,
  ILlmConfigPort,
  IPathValidationPort,
  IWorkspaceKernelPort,
  TierHealthStatus,
} from '../ports/IntelligencePorts';
import { ContextManager } from '../services/ContextManager';
import type { IndexingService } from '../services/IndexingService';
import type { LLMInterface } from '../services/LLMInterface';
import { OfflineSynthesisService } from '../services/OfflineSynthesisService';
import type { RetrievalService } from '../services/RetrievalService';
import { clusterDocumentsByVector } from '../services/SemanticClustering';
import type { DocumentVectorCentroid, VectorStore } from '../services/VectorStore';
import type { EmbeddingWorkerPool } from '../workers/EmbeddingWorkerPool';
import { ModelLifecycleManager } from './ModelLifecycleManager';

export interface IntelligenceRuntimeDeps {
  configPort: ILlmConfigPort;
  pathPort: IPathValidationPort;
  kernelPort: IWorkspaceKernelPort;
  diagnostics: IDiagnosticsSink;
  modelManager: ModelLifecycleManager;
  resolveVectorDbDir: () => string;
  createKnowledgeGraph: (sqliteDbPath: string) => IGraphIndexPort;
  sanitizeError: (raw: string) => string;
  embeddingPoolFactory?: (options: {
    modelName?: string;
    allowRemoteModels?: boolean;
    diagnosticsSink: IDiagnosticsSink;
  }) => EmbeddingWorkerPool;
  onTierBReady?: () => Promise<void>;
}

function normalizePathKeyLocal(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function stripContextualHeader(text: string): string {
  return text.replace(/^\[File:[^\]]+\]\s*\n?/i, '').trim();
}

export async function awaitBounded(
  promise: Promise<unknown> | null,
  timeoutMs: number
): Promise<void> {
  if (!promise) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
  try {
    await Promise.race([promise.catch(() => undefined), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class IntelligenceRuntime {
  vectorStore: VectorStore | null = null;
  embeddingModel: EmbeddingWorkerPool | null = null;
  indexingService: IndexingService | null = null;
  retrievalService: RetrievalService | null = null;
  llmInterface: LLMInterface | null = null;
  readonly offlineSynthesis = new OfflineSynthesisService();

  private initPromise: Promise<void> | null = null;
  private sessionKg: IGraphIndexPort | null = null;
  private sessionKgPath: string | null = null;
  private sessionDepth = 0;

  private tierAStatus: TierHealthStatus = 'uninitialized';
  private tierBStatus: TierHealthStatus = 'uninitialized';
  private tierBError: string | undefined;

  constructor(readonly deps: IntelligenceRuntimeDeps) {}

  getTierStatus(): { tierA: TierHealthStatus; tierB: TierHealthStatus; tierBError?: string } {
    return {
      tierA: this.tierAStatus,
      tierB: this.tierBStatus,
      ...(this.tierBError ? { tierBError: this.tierBError } : {}),
    };
  }

  closeSessionKnowledgeGraph(): void {
    if (this.sessionKg) {
      try {
        this.sessionKg.close();
      } finally {
        this.sessionKg = null;
        this.sessionKgPath = null;
      }
    }
  }

  async withKnowledgeGraphSession<T>(fn: () => Promise<T>): Promise<T> {
    this.sessionDepth += 1;
    try {
      return await fn();
    } finally {
      this.sessionDepth = Math.max(0, this.sessionDepth - 1);
      if (this.sessionDepth === 0) {
        this.closeSessionKnowledgeGraph();
      }
    }
  }

  withKnowledgeGraph<T>(fn: (kg: IGraphIndexPort) => T): T {
    const existingKg = this.vectorStore?.getKnowledgeGraph();
    if (existingKg) {
      this.closeSessionKnowledgeGraph();
      this.tierAStatus = 'ready';
      this.deps.diagnostics.setVectorStoreStats({ tierAStatus: 'ready' });
      return fn(existingKg);
    }

    const kgFile = path.join(this.deps.resolveVectorDbDir(), 'knowledge-graph.sqlite');
    if (this.sessionDepth > 0) {
      if (this.sessionKg && this.sessionKgPath !== kgFile) {
        this.closeSessionKnowledgeGraph();
      }
      if (!this.sessionKg) {
        this.sessionKg = this.deps.createKnowledgeGraph(kgFile);
        this.sessionKgPath = kgFile;
      }
      this.tierAStatus = 'ready';
      this.deps.diagnostics.setVectorStoreStats({ tierAStatus: 'ready' });
      return fn(this.sessionKg);
    }

    const ephemeralKg = this.deps.createKnowledgeGraph(kgFile);
    try {
      this.tierAStatus = 'ready';
      this.deps.diagnostics.setVectorStoreStats({ tierAStatus: 'ready' });
      return fn(ephemeralKg);
    } finally {
      ephemeralKg.close();
    }
  }

  async ensureTierBInitialized(): Promise<void> {
    if (this.vectorStore && this.embeddingModel) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async (): Promise<void> => {
      LLMLogger.info('Initializing LLM Tier B services...');
      let localVectorStore: VectorStore | null = null;
      let localEmbeddingModel: EmbeddingWorkerPool | null = null;

      try {
        this.closeSessionKnowledgeGraph();

        const [
          { VectorStore: VectorStoreCtor },
          { EmbeddingWorkerPool: EmbeddingWorkerPoolCtor },
          { IndexingService: IndexingServiceCtor },
          { RetrievalService: RetrievalServiceCtor },
        ] = await Promise.all([
          import('../services/VectorStore'),
          import('../workers/EmbeddingWorkerPool'),
          import('../services/IndexingService'),
          import('../services/RetrievalService'),
        ]);

        const llmConfig = this.deps.configPort.readLlmConfig();
        const configuredEmbeddingModel = llmConfig?.embeddingModel?.trim() || undefined;
        localVectorStore = new VectorStoreCtor({
          modelId: configuredEmbeddingModel,
          knowledgeGraphFactory: this.deps.createKnowledgeGraph,
          diagnosticsSink: this.deps.diagnostics,
        });
        const dbPath = this.deps.resolveVectorDbDir();
        await localVectorStore.initialize(dbPath);
        LLMLogger.info('VectorStore initialized', { dbPath });

        localEmbeddingModel = this.deps.embeddingPoolFactory
          ? this.deps.embeddingPoolFactory({
              modelName: configuredEmbeddingModel,
              allowRemoteModels: llmConfig?.allowRemoteModels,
              diagnosticsSink: this.deps.diagnostics,
            })
          : new EmbeddingWorkerPoolCtor({
              modelName: configuredEmbeddingModel,
              allowRemoteModels: llmConfig?.allowRemoteModels,
              diagnosticsSink: this.deps.diagnostics,
            });
        await localEmbeddingModel.initialize();
        LLMLogger.info('EmbeddingWorkerPool initialized (worker thread)');

        const storeRef = localVectorStore;
        const indexedPaths = storeRef.getKnowledgeGraph()?.getIndexedFiles() ?? [];
        if (indexedPaths.length > 0) {
          const purged = await this.deps.kernelPort.reconcileIndexedFiles(
            indexedPaths,
            async (stalePath) => {
              await storeRef.deleteFile(stalePath);
            }
          );
          if (purged > 0) {
            LLMLogger.info('Purged stale or SecretGuard-blocked index entries', { purged });
          }
        }

        if (!process.env.JEST_WORKER_ID) {
          for (const root of this.deps.configPort.readIndexedRoots().slice(0, 4)) {
            void this.deps.kernelPort.watchIndexedRoot(root).catch(() => undefined);
          }
        }

        const transportCfg = this.deps.modelManager.resolveActiveTransportSettings();
        const localLlm = this.deps.modelManager.createTransientClient(transportCfg);
        const contextManager = new ContextManager(localLlm);

        this.vectorStore = localVectorStore;
        this.embeddingModel = localEmbeddingModel;
        this.llmInterface = localLlm;
        this.indexingService = new IndexingServiceCtor(localEmbeddingModel, localVectorStore);
        this.retrievalService = new RetrievalServiceCtor(
          localVectorStore,
          localEmbeddingModel,
          contextManager
        );
        await localVectorStore.getStats();

        this.tierAStatus = 'ready';
        this.tierBStatus = 'ready';
        this.tierBError = undefined;
        this.deps.diagnostics.setVectorStoreStats({
          tierAStatus: 'ready',
          tierBStatus: 'ready',
          tierBError: undefined,
        });

        await this.deps.onTierBReady?.();
        LLMLogger.info('All LLM services initialized');
      } catch (error: unknown) {
        if (localEmbeddingModel) {
          await localEmbeddingModel.terminate().catch(() => undefined);
        }
        if (localVectorStore) {
          await localVectorStore.close().catch(() => undefined);
        }
        this.vectorStore = null;
        this.embeddingModel = null;
        this.indexingService = null;
        this.retrievalService = null;
        this.llmInterface = null;

        const rawMsg = error instanceof Error ? error.message : String(error);
        const sanitized = this.deps.sanitizeError(rawMsg);
        this.tierBStatus = 'unavailable';
        this.tierBError = sanitized;
        // Preserve Tier A readiness even if Tier B (ONNX / LanceDB) failed
        if (this.tierAStatus === 'uninitialized') {
          this.tierAStatus = 'ready';
        }
        this.deps.diagnostics.setVectorStoreStats({
          tierAStatus: this.tierAStatus,
          tierBStatus: 'unavailable',
          tierBError: sanitized,
        });
        LLMLogger.error('Failed to initialize LLM Tier B services', { error: rawMsg });
        throw error;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Attempts Tier B initialization while containing ONNX / LanceDB faults so
   * callers can gracefully degrade to Tier A SQLite FTS5 + Knowledge Graph synthesis.
   */
  async tryEnsureTierBInitialized(): Promise<boolean> {
    if (this.vectorStore && this.embeddingModel && this.retrievalService) {
      return true;
    }
    try {
      await this.ensureTierBInitialized();
      return true;
    } catch {
      return false;
    }
  }

  async clearEmbeddingPipeline(): Promise<void> {
    if (this.embeddingModel) {
      await this.embeddingModel.terminate().catch(() => undefined);
      this.embeddingModel = null;
    }
    if (this.vectorStore) {
      await this.vectorStore.close().catch(() => undefined);
      this.vectorStore = null;
    }
    this.indexingService = null;
    this.retrievalService = null;
    this.tierBStatus = 'uninitialized';
    this.tierBError = undefined;
    this.deps.diagnostics.setVectorStoreStats({
      initialized: false,
      tierBStatus: 'uninitialized',
      tierBError: undefined,
    });
  }

  async readSecretGuardedRange(
    filePath: string,
    startLine: number,
    endLine?: number
  ): Promise<FileLineRangeResult> {
    const secretCheck = isSensitiveSecretFile(filePath);
    if (secretCheck.blocked) {
      this.deps.diagnostics.recordSecretGuardBlock?.();
      const err = new Error(
        `[SECURITY_BLOCKED] SecretGuard blocked "${path.basename(filePath)}": ${secretCheck.reason || 'sensitive credential file'}`
      ) as Error & { code?: string };
      err.code = 'UNAUTHORIZED_ACCESS';
      throw err;
    }
    const result = await this.deps.kernelPort.getFileReader().readFileRange(
      filePath,
      startLine,
      endLine
    );
    const { lines: sanitizedLines, redactionsCount } = redactFileRangeLines(result.lines);
    if (redactionsCount > 0) {
      this.deps.diagnostics.recordSecretGuardBlock?.();
    }
    return {
      ...result,
      lines: sanitizedLines,
    };
  }

  searchWorkspaceContent(
    query: string,
    topK: number = 20,
    searchRoot?: string
  ): ContentSearchMatch[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const normalizedRoot = searchRoot ? normalizePathKeyLocal(searchRoot) : null;
    const rootPrefix = normalizedRoot
      ? normalizedRoot.endsWith(path.sep)
        ? normalizedRoot
        : `${normalizedRoot}${path.sep}`
      : null;
    const fetchLimit = normalizedRoot ? Math.min(200, Math.max(topK * 4, 40)) : topK;

    return this.withKnowledgeGraph((kg) => {
      const scopeFilter = searchRoot ? { folderPath: searchRoot } : undefined;
      const hits = kg.searchLexical(trimmed, fetchLimit, scopeFilter);
      const results: ContentSearchMatch[] = [];
      for (const hit of hits) {
        if (normalizedRoot && rootPrefix) {
          const hitNorm = normalizePathKeyLocal(hit.filePath);
          if (hitNorm !== normalizedRoot && !hitNorm.startsWith(rootPrefix)) {
            continue;
          }
        }
        const cleanText = stripContextualHeader(hit.chunkText);
        const snippet = cleanText.length > 220 ? `${cleanText.slice(0, 217)}...` : cleanText;
        results.push({
          chunkId: hit.id,
          filePath: hit.filePath,
          fileName: path.basename(hit.filePath),
          chunkIndex: hit.chunkIndex,
          startLine: hit.startLine,
          endLine: hit.endLine,
          heading: hit.heading,
          snippet,
          score: hit.bm25Score,
        });
        if (results.length >= topK) {
          break;
        }
      }
      return results;
    });
  }

  queryWorkspaceGraphInsights(input: {
    symbolQuery?: string;
    backlinkTarget?: string;
  }): GraphInsightsResponse {
    const allowedRoots = this.deps.pathPort.resolveAllowedRoots();
    return this.withKnowledgeGraph((kg) => {
      const stats = kg.getInsights(allowedRoots);
      const symbolMatches =
        input.symbolQuery && input.symbolQuery.trim().length > 0
          ? kg
              .findBySymbol(input.symbolQuery.trim(), 25)
              .filter((m) => !isSensitiveSecretFile(m.filePath).blocked)
          : undefined;
      const backlinks =
        input.backlinkTarget && input.backlinkTarget.trim().length > 0
          ? kg
              .findBacklinks(input.backlinkTarget.trim(), 50)
              .filter((b) => !isSensitiveSecretFile(b.sourcePath).blocked)
          : undefined;

      return {
        stats,
        symbolMatches,
        backlinks,
      };
    });
  }

  checkWorkspaceGraphImpact(targetPaths: string[]): GraphImpactCheckResult {
    return this.withKnowledgeGraph((kg) => {
      const references = kg.findImpactForPaths(targetPaths);
      const uniqueSourceFiles = new Set(references.map((r) => r.sourcePath));
      const markdownRepairableCount = references.filter((r) => r.isMarkdownLink).length;
      return {
        totalAffectedFiles: uniqueSourceFiles.size,
        markdownRepairableCount,
        references,
      };
    });
  }

  getWorkspaceGraphMapData(input?: {
    rootPrefix?: string;
    maxNodes?: number;
  }): WorkspaceGraphMap {
    return this.withKnowledgeGraph((kg) =>
      kg.getWorkspaceGraphMap(input?.rootPrefix, input?.maxNodes ?? 240)
    );
  }

  async getVectorStoreCentroids(
    filePaths?: string[]
  ): Promise<Map<string, DocumentVectorCentroid>> {
    if (this.vectorStore) {
      try {
        return await this.vectorStore.getDocumentCentroids(filePaths);
      } catch {
        return new Map();
      }
    }

    const dbDir = this.deps.resolveVectorDbDir();
    if (!fsSync.existsSync(path.join(dbDir, 'file_chunks.lance'))) {
      return new Map();
    }

    const { VectorStore: VectorStoreCtor } = await import('../services/VectorStore');
    const ephemeralStore = new VectorStoreCtor({ enableKnowledgeGraph: false });
    try {
      await ephemeralStore.initialize(dbDir);
      return await ephemeralStore.getDocumentCentroids(filePaths);
    } catch {
      return new Map();
    } finally {
      await ephemeralStore.close().catch(() => undefined);
    }
  }

  async getWorkspaceCollectionsData(input?: {
    rootPrefix?: string;
  }): Promise<WorkspaceCollectionGroup[]> {
    const map = this.withKnowledgeGraph((kg) => kg.getWorkspaceGraphMap(input?.rootPrefix, 500));

    if (map.nodes.length >= 2) {
      const centroids = await this.getVectorStoreCentroids(map.nodes.map((n) => n.path));
      if (centroids.size >= 2) {
        const centroidByNorm = new Map<string, DocumentVectorCentroid>();
        for (const [k, c] of centroids.entries()) {
          centroidByNorm.set(normalizePathKeyLocal(k), c);
        }
        const docs = map.nodes
          .map((node) => {
            const centroid = centroidByNorm.get(normalizePathKeyLocal(node.path));
            if (!centroid || centroid.vector.length === 0) {
              return null;
            }
            return {
              filePath: node.path,
              name: node.name,
              fileType: node.fileType,
              chunkCount: node.chunkCount,
              vector: centroid.vector,
              topSymbols: node.topSymbols,
              textSample: centroid.sampleText,
            };
          })
          .filter((d): d is NonNullable<typeof d> => d !== null);

        if (docs.length >= 2) {
          const { groups } = clusterDocumentsByVector(docs);
          if (groups.length > 0) {
            return groups.map(({ clusteringMode, id, label, reason, files, dominantSymbols }) => ({
              id,
              label,
              clusteringMode,
              reason,
              files,
              dominantSymbols,
            }));
          }
        }
      }
    }

    return this.withKnowledgeGraph((kg) => kg.getSemanticCollections(input?.rootPrefix));
  }

  getWorkspaceFileConnectionsData(filePath: string): FileConnectionsSummary {
    return this.withKnowledgeGraph((kg) => kg.getFileConnections(filePath));
  }

  async embedBatchWithFallback(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const llmCfg = this.deps.configPort.readLlmConfig();
    const configuredEmbModel = llmCfg?.embeddingModel?.trim() || undefined;
    const pool =
      this.embeddingModel ??
      new (await import('../workers/EmbeddingWorkerPool')).EmbeddingWorkerPool({
        modelName: configuredEmbModel,
        device: llmCfg?.embeddingDevice ?? 'auto',
        allowRemoteModels: false,
        diagnosticsSink: this.deps.diagnostics,
      });
    const ownsPool = !this.embeddingModel;
    try {
      await pool.initialize();
      return await pool.embedBatch(texts);
    } catch {
      return [];
    } finally {
      if (ownsPool) {
        await pool.terminate().catch(() => undefined);
      }
    }
  }

  async cleanup(): Promise<void> {
    await awaitBounded(this.initPromise, 1000);

    if (this.embeddingModel) {
      try {
        await this.embeddingModel.terminate();
        LLMLogger.info('EmbeddingWorkerPool terminated');
      } catch (error) {
        LLMLogger.warn('Error terminating embedding worker', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.embeddingModel = null;
    }

    this.closeSessionKnowledgeGraph();
    this.sessionDepth = 0;

    if (this.vectorStore) {
      await this.vectorStore.close().catch(() => undefined);
      this.vectorStore = null;
      LLMLogger.info('VectorStore closed');
    }

    this.indexingService = null;
    this.retrievalService = null;
    this.llmInterface = null;
    this.tierAStatus = 'uninitialized';
    this.tierBStatus = 'uninitialized';
    this.tierBError = undefined;

    this.deps.diagnostics.setVectorStoreStats({
      initialized: false,
      totalChunks: 0,
      indexedFiles: 0,
      lexicalDocs: 0,
      pendingBuffer: 0,
      tierAStatus: 'uninitialized',
      tierBStatus: 'uninitialized',
      tierBError: undefined,
    });
  }
}
