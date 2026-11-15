import fs from 'fs/promises';
import path from 'path';
import { EventQueue } from '@main/dsa/EventQueue';
import { PathTrie } from '@main/dsa/PathTrie';
import { FileWatcher, WatchOptions } from './FileWatcher';
import { FileSystemService } from './FileSystemService';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { resolveAllowedRoots } from '@main/handlers/securityMiddleware';
import { EventPriority, FileEvent, FileMetadata, FileNode } from '@shared/contracts';
import { DEFAULT_EXCLUDED_DIRS } from '@shared/config';
import { FileSystemLogger } from '@shared/logging';
import { isSensitiveSecretFile } from '@shared/security/SecretGuard';

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
const MAX_INDEXED_WATCHERS = 4;

export class ReactiveWorkspaceKernel {
  private readonly allowedRoots: string[];
  private readonly eventQueue: EventQueue;
  private readonly fileWatcher: FileWatcher;
  private readonly secondaryWatcher: FileWatcher;
  private readonly indexedWatchers = new Map<string, FileWatcher>();
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
  private totalDropped = 0;
  private readonly suppressedPaths = new Map<string, number>();

  constructor(options: ReactiveWorkspaceKernelOptions = {}) {
    this.allowedRoots =
      options.allowedRoots && options.allowedRoots.length > 0
        ? options.allowedRoots
        : resolveAllowedRoots();

    this.eventQueue = new EventQueue();
    this.fileWatcher = new FileWatcher(this.eventQueue);
    this.secondaryWatcher = new FileWatcher(this.eventQueue);
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
    this.attachWatcherListeners(this.fileWatcher, true);
    this.attachWatcherListeners(this.secondaryWatcher, false);
  }

  private attachWatcherListeners(watcher: FileWatcher, isPrimary: boolean): void {
    const diagnostics = RuntimeDiagnostics.getInstance();

    watcher.on('fileCreated', () => {
      diagnostics.recordWatcherEvent();
      this.scheduleDrain();
    });

    watcher.on('fileChanged', () => {
      diagnostics.recordWatcherEvent();
      this.scheduleDrain();
    });

    watcher.on('fileDeleted', () => {
      diagnostics.recordWatcherEvent();
      this.scheduleDrain();
    });

    watcher.on('error', (error: Error) => {
      if (isPrimary) {
        diagnostics.setWatcherState({
          status: 'error',
          watchedPath: watcher.getWatchedPath(),
          lastError: error.message,
        });
      }
      this.emitBroadcast('WATCHER:ERROR', error.message);
    });

    watcher.on('stopped', () => {
      if (isPrimary) {
        diagnostics.setWatcherState({
          status: 'idle',
          watchedPath: null,
        });
      }
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
      if (isSensitiveSecretFile(entry.path).blocked) {
        continue;
      }
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

    const validation = await this.fileSystemService.validateCanonicalPath(dirPath);
    if (!validation.valid || !validation.canonicalPath) {
      FileSystemLogger.warn('Skipping watch on unvalidated directory', {
        path: dirPath,
        error: validation.error,
      });
      return;
    }

    const normalized = path.normalize(validation.canonicalPath);

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
   * Watch or stop watching the split-pane secondary directory at shallow depth (depth: 0).
   */
  async activateSecondaryDirectory(dirPath: string | null): Promise<void> {
    if (this.closed) {
      return;
    }

    if (dirPath !== null) {
      const validation = this.fileSystemService.validatePath(dirPath);
      if (!validation.valid) {
        FileSystemLogger.warn('Skipping secondary watch on unvalidated directory', {
          path: dirPath,
          error: validation.error,
        });
        return;
      }
    }

    const normalized = dirPath ? path.normalize(dirPath) : null;

    this.watchTransition = this.watchTransition.then(async () => {
      if (this.closed) {
        return;
      }

      if (!normalized) {
        if (this.secondaryWatcher.isWatching()) {
          await this.secondaryWatcher.stop().catch(() => undefined);
        }
        return;
      }

      const currentSecondary = this.secondaryWatcher.getWatchedPath();
      if (
        this.secondaryWatcher.isWatching() &&
        currentSecondary &&
        this.canonicalKey(currentSecondary) === this.canonicalKey(normalized)
      ) {
        return;
      }

      try {
        if (this.secondaryWatcher.isWatching()) {
          await this.secondaryWatcher.stop();
        }
        await this.secondaryWatcher.start(normalized, this.defaultWatchOptions);
      } catch (error: unknown) {
        FileSystemLogger.warn('Failed to switch secondary split watcher', {
          path: normalized,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await this.watchTransition;
  }

  /**
   * Register an opt-in indexed workspace root watcher bounded to shallow subtree depth (<= 4),
   * skipping build/VCS noise and SecretGuard artifacts while capping total active roots.
   */
  async watchIndexedRoot(rootPath: string, maxDepth = 4): Promise<boolean> {
    if (this.closed) {
      return false;
    }

    const validation = this.fileSystemService.validatePath(rootPath);
    if (!validation.valid) {
      return false;
    }

    const normalized = path.normalize(rootPath);
    const key = this.canonicalKey(normalized);
    const boundedDepth = Math.max(0, Math.min(4, maxDepth));
    let started = false;

    this.watchTransition = this.watchTransition.then(async () => {
      if (this.closed) {
        return;
      }

      const existing = this.indexedWatchers.get(key);
      if (existing && existing.isWatching()) {
        // Refresh insertion order (LRU)
        this.indexedWatchers.delete(key);
        this.indexedWatchers.set(key, existing);
        started = true;
        return;
      }

      // Evict oldest indexed root watcher if cap reached
      while (this.indexedWatchers.size >= MAX_INDEXED_WATCHERS) {
        const oldestKey = this.indexedWatchers.keys().next().value;
        if (!oldestKey) {
          break;
        }
        const oldestWatcher = this.indexedWatchers.get(oldestKey);
        this.indexedWatchers.delete(oldestKey);
        if (oldestWatcher) {
          if (oldestWatcher.isWatching()) {
            await oldestWatcher.stop().catch(() => undefined);
          }
          oldestWatcher.removeAllListeners();
        }
      }

      const excludedNames = new Set(DEFAULT_EXCLUDED_DIRS.map((name) => name.toLowerCase()));
      const watcher = new FileWatcher(this.eventQueue);
      this.attachWatcherListeners(watcher, false);

      try {
        await watcher.start(normalized, {
          ...this.defaultWatchOptions,
          depth: boundedDepth,
          ignored: (candidatePath: string): boolean => this.shouldIgnoreIndexedWatchPath(normalized, candidatePath, excludedNames),
        });
        this.indexedWatchers.set(key, watcher);
        started = true;
      } catch (error: unknown) {
        watcher.removeAllListeners();
        FileSystemLogger.warn('Failed to start indexed root watcher', {
          path: normalized,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await this.watchTransition;
    return started;
  }

  /**
   * Stop watching an indexed workspace root cleanly.
   */
  async unwatchIndexedRoot(rootPath: string): Promise<void> {
    const key = this.canonicalKey(path.normalize(rootPath));
    this.watchTransition = this.watchTransition.then(async () => {
      const watcher = this.indexedWatchers.get(key);
      if (!watcher) {
        return;
      }
      this.indexedWatchers.delete(key);
      if (watcher.isWatching()) {
        await watcher.stop().catch(() => undefined);
      }
      watcher.removeAllListeners();
    });

    await this.watchTransition;
  }

  /**
   * Return all actively watched root directories (primary, secondary split, indexed roots).
   */
  getActiveWatchedPaths(): string[] {
    const seen = new Map<string, string>();
    const pushIfPresent = (candidate: string | null): void => {
      if (!candidate) {
        return;
      }
      const key = this.canonicalKey(candidate);
      if (!seen.has(key)) {
        seen.set(key, candidate);
      }
    };

    if (this.fileWatcher.isWatching()) {
      pushIfPresent(this.fileWatcher.getWatchedPath());
    }
    if (this.secondaryWatcher.isWatching()) {
      pushIfPresent(this.secondaryWatcher.getWatchedPath());
    }
    for (const watcher of this.indexedWatchers.values()) {
      if (watcher.isWatching()) {
        pushIfPresent(watcher.getWatchedPath());
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Reconcile persisted index paths against current disk state + SecretGuard policy,
   * removing offline-deleted or newly blocked secret paths from PathTrie and vector/graph stores.
   */
  async reconcileIndexedFiles(
    indexedPaths: readonly string[],
    onMissingOrBlocked: (stalePath: string) => Promise<void> | void
  ): Promise<number> {
    let purged = 0;
    for (const rawPath of indexedPaths) {
      if (this.closed) {
        break;
      }
      const normalized = path.normalize(rawPath);
      const blockedBySecretGuard = isSensitiveSecretFile(normalized).blocked;
      let missing = false;
      if (!blockedBySecretGuard) {
        try {
          const stat = await fs.stat(normalized);
          if (!stat.isFile()) {
            missing = true;
          }
        } catch {
          missing = true;
        }
      }

      if (blockedBySecretGuard || missing) {
        this.pathTrie.remove(normalized);
        this.fileSystemService.invalidatePath(normalized);
        await Promise.resolve(onMissingOrBlocked(normalized));
        purged += 1;
      }
    }

    if (purged > 0) {
      RuntimeDiagnostics.getInstance().setPathTrieStats({
        entryCount: this.pathTrie.size(),
      });
    }
    return purged;
  }

  private shouldIgnoreIndexedWatchPath(
    watchRoot: string,
    candidatePath: string,
    excludedDirs: ReadonlySet<string>
  ): boolean {
    const normalizedCandidate = path.normalize(candidatePath);
    const rootLower = watchRoot.toLowerCase().replace(/[\\/]+$/, '');
    const candLower = normalizedCandidate.toLowerCase().replace(/[\\/]+$/, '');
    if (candLower === rootLower) {
      return false;
    }

    const base = path.basename(normalizedCandidate);
    const baseLower = base.toLowerCase();
    if (base.startsWith('.') && baseLower !== '.env.example' && baseLower !== '.env.sample') {
      return true;
    }

    if (isSensitiveSecretFile(normalizedCandidate).blocked) {
      return true;
    }

    const rel = candLower.startsWith(rootLower + path.sep)
      ? candLower.slice(rootLower.length + 1)
      : candLower;
    const segments = rel.split(/[\\/]+/).filter(Boolean);
    if (segments.some((seg) => excludedDirs.has(seg))) {
      return true;
    }

    const ext = path.extname(baseLower);
    return ext === '.tmp' || ext === '.swp' || ext === '.ldb' || base.startsWith('~$');
  }

  /**
   * Temporarily suppress redundant OS file-watcher events caused by app-initiated journal mutations.
   */
  suppressPaths(paths: string[], ttlMs: number = 1500): void {
    if (this.closed || !Array.isArray(paths) || paths.length === 0) {
      return;
    }
    const now = Date.now();
    const expiresAt = now + Math.max(50, ttlMs);
    if (this.suppressedPaths.size > 512) {
      for (const [entryKey, expiry] of this.suppressedPaths.entries()) {
        if (expiry <= now) {
          this.suppressedPaths.delete(entryKey);
        }
      }
    }
    for (const rawPath of paths) {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        continue;
      }
      const key = this.canonicalKey(path.normalize(rawPath));
      this.suppressedPaths.set(key, expiresAt);
    }
  }

  private isPathSuppressed(filePath: string): boolean {
    if (this.suppressedPaths.size === 0) {
      return false;
    }
    const key = this.canonicalKey(path.normalize(filePath));
    const expiresAt = this.suppressedPaths.get(key);
    if (expiresAt === undefined) {
      return false;
    }
    if (Date.now() > expiresAt) {
      this.suppressedPaths.delete(key);
      return false;
    }
    return true;
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

    try {
      this.eventQueue.enqueue(event);
    } catch {
      this.totalDropped += 1;
    }
    RuntimeDiagnostics.getInstance().recordEventQueueStats({
      pending: this.eventQueue.size(),
      dropped: this.totalDropped,
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

    const activeEvents = rawEvents.filter(
      (ev) => ev.priority === EventPriority.USER_ACTION || !this.isPathSuppressed(ev.path)
    );

    // Coalesce chronologically so equal-timestamp higher-urgency events (smaller numeric priority, e.g. USER_ACTION=1)
    // land last in `netByPath` without being overwritten by stale FILE_WATCHER/BACKGROUND_INDEX events.
    activeEvents.sort((a, b) => a.timestamp - b.timestamp || b.priority - a.priority);

    const netByPath = new Map<string, FileEvent>();
    for (const ev of activeEvents) {
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

    const coalescedCount = Math.max(0, activeEvents.length - netByPath.size);
    const diagnostics = RuntimeDiagnostics.getInstance();

    // Dispatch highest-urgency distinct paths first (smaller EventPriority enum = higher urgency)
    const orderedEvents = Array.from(netByPath.values()).sort(
      (a, b) => a.priority - b.priority || a.timestamp - b.timestamp
    );

    for (const event of orderedEvents) {
      this.fileSystemService.invalidatePath(event.path);
      let hookType: 'create' | 'change' | 'unlink' =
        event.type === 'rename' ? 'change' : event.type;

      if (hookType === 'unlink') {
        this.pathTrie.removePrefix(event.path);
        this.emitBroadcast('FILE_DELETED', event.path);
      } else {
        let existsOnDisk = false;
        try {
          const stats = await fs.stat(event.path);
          existsOnDisk = true;
          if (isSensitiveSecretFile(event.path).blocked) {
            this.pathTrie.removePrefix(event.path);
          } else {
            const ext = path.extname(event.path).replace(/^\./, '').toLowerCase();
            const metadata: FileMetadata = {
              filePath: event.path,
              totalChunks: 0,
              indexedAt: Date.now(),
              fileSize: stats.size,
              language: ext || undefined,
            };
            this.pathTrie.insert(event.path, metadata);
          }
        } catch {
          this.pathTrie.removePrefix(event.path);
          hookType = 'unlink';
        }

        if (existsOnDisk) {
          this.emitBroadcast(
            hookType === 'create' ? 'FILE_CREATED' : 'FILE_CHANGED',
            event.path
          );
        } else {
          this.emitBroadcast('FILE_DELETED', event.path);
        }
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
      dropped: this.totalDropped,
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
    if (this.secondaryWatcher.isWatching()) {
      await this.secondaryWatcher.stop().catch(() => undefined);
    }
    for (const watcher of this.indexedWatchers.values()) {
      if (watcher.isWatching()) {
        await watcher.stop().catch(() => undefined);
      }
      watcher.removeAllListeners();
    }
    this.indexedWatchers.clear();

    this.fileWatcher.removeAllListeners();
    this.secondaryWatcher.removeAllListeners();
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

export function hasActiveReactiveWorkspaceKernel(): boolean {
  return kernelInstance !== null;
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
