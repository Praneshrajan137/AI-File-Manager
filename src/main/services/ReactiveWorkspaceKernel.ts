import fs from 'fs/promises';
import path from 'path';
import { EventQueue } from '@main/dsa/EventQueue';
import { PathTrie } from '@main/dsa/PathTrie';
import { FileWatcher, WatchOptions } from './FileWatcher';
import { FileSystemService } from './FileSystemService';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { resolveAllowedRoots } from '@main/handlers/securityMiddleware';
import { EventPriority, FileEvent, FileMetadata, FileNode } from '@shared/contracts';
import { FileSystemLogger } from '@shared/logging';

export type WorkspaceBroadcastChannel =
  | 'FILE_CREATED'
  | 'FILE_CHANGED'
  | 'FILE_DELETED'
  | 'WATCHER:ERROR';

export type WorkspaceBroadcaster = (
  channel: WorkspaceBroadcastChannel,
  payload: string
) => void;

export type IndexMutationHook = (
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
) => Promise<void> | void;

export interface ReactiveWorkspaceKernelOptions {
  allowedRoots?: string[];
  coalesceMs?: number;
  watchOptions?: WatchOptions;
  broadcaster?: WorkspaceBroadcaster;
  indexMutationHook?: IndexMutationHook;
}

/**
 * ReactiveWorkspaceKernel - Single causal closed loop for filesystem state.
 *
 * Connects:
 *   FileWatcher (chokidar) -> EventQueue (priority min-heap) -> coalescing drain loop
 *     -> FileSystemService LRUCache invalidation
 *     -> PathTrie incremental upsert/remove
 *     -> Optional RAG index mutation hook
 *     -> RuntimeDiagnostics live telemetry
 *     -> Renderer IPC broadcasts
 */
export class ReactiveWorkspaceKernel {
  private readonly allowedRoots: string[];
  private readonly eventQueue: EventQueue;
  private readonly fileWatcher: FileWatcher;
  private readonly pathTrie: PathTrie;
  private readonly fileSystemService: FileSystemService;
  private readonly coalesceMs: number;
  private readonly defaultWatchOptions: WatchOptions;

  private broadcaster: WorkspaceBroadcaster | null;
  private indexMutationHook: IndexMutationHook | null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private draining: Promise<void> | null = null;
  private drainAgainRequested = false;
  private watchTransition: Promise<void> = Promise.resolve();
  private closed = false;
  private totalProcessed = 0;
  private totalCoalesced = 0;

  constructor(options: ReactiveWorkspaceKernelOptions = {}) {
    this.allowedRoots =
      options.allowedRoots && options.allowedRoots.length > 0
        ? options.allowedRoots
        : resolveAllowedRoots();

    this.eventQueue = new EventQueue();
    this.fileWatcher = new FileWatcher(this.eventQueue);
    this.pathTrie = new PathTrie();
    this.fileSystemService = new FileSystemService(this.allowedRoots);
    this.coalesceMs = options.coalesceMs ?? 40;
    this.defaultWatchOptions = options.watchOptions ?? {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 60,
        pollInterval: 25,
      },
      depth: 0,
    };
    this.broadcaster = options.broadcaster ?? null;
    this.indexMutationHook = options.indexMutationHook ?? null;

    RuntimeDiagnostics.getInstance().setAllowedRoots(this.allowedRoots);
    this.attachWatcherListeners();
  }

  private attachWatcherListeners(): void {
    const diagnostics = RuntimeDiagnostics.getInstance();

    this.fileWatcher.on('fileCreated', () => {
      diagnostics.recordWatcherEvent();
      this.scheduleDrain();
    });

    this.fileWatcher.on('fileChanged', () => {
      diagnostics.recordWatcherEvent();
      this.scheduleDrain();
    });

    this.fileWatcher.on('fileDeleted', () => {
      diagnostics.recordWatcherEvent();
      this.scheduleDrain();
    });

    this.fileWatcher.on('error', (error: Error) => {
      diagnostics.setWatcherState({
        status: 'error',
        watchedPath: this.fileWatcher.getWatchedPath(),
        lastError: error.message,
      });
      this.emitBroadcast('WATCHER:ERROR', error.message);
    });

    this.fileWatcher.on('stopped', () => {
      diagnostics.setWatcherState({
        status: 'idle',
        watchedPath: null,
      });
    });
  }

  setBroadcaster(broadcaster: WorkspaceBroadcaster | null): void {
    this.broadcaster = broadcaster;
  }

  setIndexMutationHook(hook: IndexMutationHook | null): void {
    this.indexMutationHook = hook;
  }

  getFileSystemService(): FileSystemService {
    return this.fileSystemService;
  }

  getPathTrie(): PathTrie {
    return this.pathTrie;
  }

  getEventQueue(): EventQueue {
    return this.eventQueue;
  }

  getFileWatcher(): FileWatcher {
    return this.fileWatcher;
  }

  /**
   * Populate PathTrie from an already-listed directory's entries and sync diagnostics.
   */
  warmDirectory(entries: FileNode[]): void {
    const start = Date.now();
    for (const entry of entries) {
      const metadata: FileMetadata = {
        filePath: entry.path,
        totalChunks: 0,
        indexedAt: Date.now(),
        fileSize: entry.size,
        language: entry.extension || undefined,
      };
      try {
        this.pathTrie.insert(entry.path, metadata);
      } catch {
        // Ignore malformed/inconsistent entries cleanly
      }
    }

    RuntimeDiagnostics.getInstance().setPathTrieStats({
      entryCount: this.pathTrie.size(),
      indexedRoots: this.allowedRoots,
      lastIndexDurationMs: Date.now() - start,
    });
  }

  /**
   * Switch active non-recursive directory watch safely inside a serialized queue.
   */
  async activateDirectory(dirPath: string): Promise<void> {
    if (this.closed) {
      return;
    }

    const validation = this.fileSystemService.validatePath(dirPath);
    if (!validation.valid) {
      FileSystemLogger.warn('Skipping watch on unvalidated directory', {
        path: dirPath,
        error: validation.error,
      });
      return;
    }

    const normalized = path.normalize(dirPath);

    this.watchTransition = this.watchTransition.then(async () => {
      if (this.closed) {
        return;
      }

      const currentWatched = this.fileWatcher.getWatchedPath();
      if (
        this.fileWatcher.isWatching() &&
        currentWatched &&
        this.canonicalKey(currentWatched) === this.canonicalKey(normalized)
      ) {
        RuntimeDiagnostics.getInstance().setWatcherState({
          status: 'watching',
          watchedPath: currentWatched,
          lastError: null,
        });
        return;
      }

      try {
        if (this.fileWatcher.isWatching()) {
          await this.fileWatcher.stop();
        }

        await this.fileWatcher.start(normalized, this.defaultWatchOptions);
        RuntimeDiagnostics.getInstance().setWatcherState({
          status: 'watching',
          watchedPath: normalized,
          lastError: null,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        RuntimeDiagnostics.getInstance().setWatcherState({
          status: 'error',
          watchedPath: null,
          lastError: msg,
        });
        FileSystemLogger.warn('Failed to switch watcher directory', {
          path: normalized,
          error: msg,
        });
      }
    });

    await this.watchTransition;
  }

  /**
   * Record an application-initiated mutation immediately in cache + enqueue user-priority event.
   */
  notifyMutation(type: 'create' | 'change' | 'unlink', filePath: string): void {
    if (this.closed) {
      return;
    }

    const normalized = path.normalize(filePath);
    this.fileSystemService.invalidatePath(normalized);

    const event: FileEvent = {
      type,
      path: normalized,
      priority: EventPriority.USER_ACTION,
      timestamp: Date.now(),
    };

    this.eventQueue.enqueue(event);
    RuntimeDiagnostics.getInstance().recordEventQueueStats({
      pending: this.eventQueue.size(),
    });
    this.scheduleDrain();
  }

  /**
   * Immediately drain and coalesce all queued events (deterministic helper for tests and flush points).
   */
  async drainNow(): Promise<number> {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    if (this.draining) {
      this.drainAgainRequested = true;
      await this.draining;
      return 0;
    }

    let processedTotal = 0;
    this.draining = (async (): Promise<void> => {
      do {
        this.drainAgainRequested = false;
        processedTotal += await this.executeDrainPass();
      } while (this.drainAgainRequested || !this.eventQueue.isEmpty());
    })();

    try {
      await this.draining;
    } finally {
      this.draining = null;
    }

    return processedTotal;
  }

  private scheduleDrain(): void {
    if (this.closed) {
      return;
    }

    if (this.drainTimer) {
      return;
    }

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drainNow().catch((error: unknown) => {
        FileSystemLogger.error('ReactiveWorkspaceKernel drain failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.coalesceMs);

    if (typeof this.drainTimer.unref === 'function') {
      this.drainTimer.unref();
    }
  }

  private async executeDrainPass(): Promise<number> {
    const startMs = Date.now();
    const rawEvents: FileEvent[] = [];
    while (!this.eventQueue.isEmpty()) {
      const event = this.eventQueue.dequeue();
      if (event) {
        rawEvents.push(event);
      }
    }

    if (rawEvents.length === 0) {
      RuntimeDiagnostics.getInstance().recordEventQueueStats({
        pending: 0,
      });
      return 0;
    }

    const netByPath = new Map<string, FileEvent>();
    for (const ev of rawEvents) {
      const key = this.canonicalKey(ev.path);
      const prev = netByPath.get(key);
      if (!prev) {
        netByPath.set(key, ev);
        continue;
      }

      if (ev.type === 'unlink') {
        netByPath.set(key, {
          ...ev,
          priority: Math.min(prev.priority, ev.priority),
        });
      } else if (prev.type === 'create' && ev.type === 'change') {
        netByPath.set(key, {
          ...prev,
          priority: Math.min(prev.priority, ev.priority),
          timestamp: ev.timestamp,
        });
      } else {
        netByPath.set(key, {
          ...ev,
          priority: Math.min(prev.priority, ev.priority),
        });
      }
    }

    const coalescedCount = Math.max(0, rawEvents.length - netByPath.size);
    const diagnostics = RuntimeDiagnostics.getInstance();

    for (const event of netByPath.values()) {
      this.fileSystemService.invalidatePath(event.path);
      const hookType: 'create' | 'change' | 'unlink' =
        event.type === 'rename' ? 'change' : event.type;

      if (hookType === 'unlink') {
        this.pathTrie.remove(event.path);
        this.emitBroadcast('FILE_DELETED', event.path);
      } else {
        try {
          const stats = await fs.stat(event.path);
          const ext = path.extname(event.path).replace(/^\./, '').toLowerCase();
          const metadata: FileMetadata = {
            filePath: event.path,
            totalChunks: 0,
            indexedAt: Date.now(),
            fileSize: stats.size,
            language: ext || undefined,
          };
          this.pathTrie.insert(event.path, metadata);
        } catch {
          this.pathTrie.remove(event.path);
        }

        this.emitBroadcast(
          hookType === 'create' ? 'FILE_CREATED' : 'FILE_CHANGED',
          event.path
        );
      }

      if (this.indexMutationHook) {
        try {
          await this.indexMutationHook(hookType, event.path);
        } catch (error: unknown) {
          FileSystemLogger.warn('Index mutation hook failed', {
            path: event.path,
            type: hookType,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    this.totalProcessed += rawEvents.length;
    this.totalCoalesced += coalescedCount;

    diagnostics.setPathTrieStats({
      entryCount: this.pathTrie.size(),
      indexedRoots: this.allowedRoots,
      lastIndexDurationMs: Date.now() - startMs,
    });
    diagnostics.recordEventQueueStats({
      pending: this.eventQueue.size(),
      processed: this.totalProcessed,
      coalesced: this.totalCoalesced,
      lastFlushAt: Date.now(),
      lastFlushDurationMs: Date.now() - startMs,
    });

    return rawEvents.length;
  }

  private emitBroadcast(channel: WorkspaceBroadcastChannel, payload: string): void {
    if (this.broadcaster) {
      try {
        this.broadcaster(channel, payload);
      } catch {
        // Ignore renderer closed races
      }
    }
  }

  private canonicalKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    await this.watchTransition.catch(() => undefined);

    if (this.draining) {
      await this.draining.catch(() => undefined);
    }

    if (this.fileWatcher.isWatching()) {
      await this.fileWatcher.stop().catch(() => undefined);
    }

    this.fileWatcher.removeAllListeners();
    this.eventQueue.clear();
    this.pathTrie.clear();
    this.fileSystemService.clearCache();
    RuntimeDiagnostics.getInstance().setWatcherState({
      status: 'idle',
      watchedPath: null,
    });
    RuntimeDiagnostics.getInstance().setPathTrieStats({
      entryCount: 0,
    });
  }
}

let kernelInstance: ReactiveWorkspaceKernel | null = null;
let sharedBroadcaster: WorkspaceBroadcaster | null = null;
let sharedIndexHook: IndexMutationHook | null = null;

export function configureKernelHooks(hooks: {
  broadcaster?: WorkspaceBroadcaster | null;
  indexMutationHook?: IndexMutationHook | null;
}): void {
  if (hooks.broadcaster !== undefined) {
    sharedBroadcaster = hooks.broadcaster;
    kernelInstance?.setBroadcaster(sharedBroadcaster);
  }
  if (hooks.indexMutationHook !== undefined) {
    sharedIndexHook = hooks.indexMutationHook;
    kernelInstance?.setIndexMutationHook(sharedIndexHook);
  }
}

export function getReactiveWorkspaceKernel(): ReactiveWorkspaceKernel {
  if (!kernelInstance) {
    kernelInstance = new ReactiveWorkspaceKernel({
      allowedRoots: resolveAllowedRoots(),
      broadcaster: sharedBroadcaster ?? undefined,
      indexMutationHook: sharedIndexHook ?? undefined,
    });
  }
  return kernelInstance;
}

export async function resetReactiveWorkspaceKernel(): Promise<void> {
  if (kernelInstance) {
    await kernelInstance.shutdown();
    kernelInstance = null;
  }
}

export function resetReactiveWorkspaceKernelSync(): void {
  if (kernelInstance) {
    void kernelInstance.shutdown();
    kernelInstance = null;
  }
}
