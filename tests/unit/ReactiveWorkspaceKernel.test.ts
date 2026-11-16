import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PathTrie } from '@main/dsa/PathTrie';
import { EventQueue } from '@main/dsa/EventQueue';
import { LRUCache } from '@main/dsa/LRUCache';
import { FileSystemService } from '@main/services/FileSystemService';
import { ReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { EventPriority, FileMetadata } from '@shared/contracts';
import { ConfigManager } from '@shared/config';
import { resetPathValidator } from '@main/handlers/securityMiddleware';

describe('M3 Closed-Loop ReactiveWorkspaceKernel & DSA Integration', () => {
  let sandboxDir: string;
  let workspaceDir: string;
  let configPath: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    RuntimeDiagnostics.resetForTesting();
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-m3-kernel-'));
    workspaceDir = path.join(sandboxDir, 'workspace');
    configPath = path.join(sandboxDir, 'config.json');
    await fs.mkdir(workspaceDir, { recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
    };
    delete process.env.FILE_MANAGER_ALLOWED_ROOTS;
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [workspaceDir]);
    resetPathValidator();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    ConfigManager.resetForTesting();
    resetPathValidator();
    RuntimeDiagnostics.resetForTesting();
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it('supports O(L) dual-index PathTrie basename + partial-segment autocomplete and cleanup', () => {
    const trie = new PathTrie();
    const docPath = '/workspace/docs/quarterly-report.md';
    const imgPath = '/workspace/assets/diagram.png';

    trie.insert(docPath, {
      filePath: docPath,
      totalChunks: 0,
      indexedAt: Date.now(),
      fileSize: 256,
    } as FileMetadata);
    trie.insert(imgPath, {
      filePath: imgPath,
      totalChunks: 0,
      indexedAt: Date.now(),
      fileSize: 512,
    } as FileMetadata);

    expect(trie.size()).toBe(2);
    expect(trie.autocomplete('quarter')).toEqual([docPath]);
    expect(trie.autocomplete('diag')).toEqual([imgPath]);
    expect(trie.autocomplete('/workspace/doc')).toEqual([docPath]);

    expect(trie.remove(docPath)).toBe(true);
    expect(trie.size()).toBe(1);
    expect(trie.autocomplete('quarter')).toEqual([]);
    expect(trie.autocomplete('diag')).toEqual([imgPath]);
  });

  it('enforces byte-budget eviction, hit/miss metrics, and prefix invalidation in LRUCache', () => {
    const cache = new LRUCache<string>(10, {
      maxBytes: 250,
      sizeOf: (v): number => v.length,
    });

    cache.put('a', 'x'.repeat(100));
    cache.put('b', 'y'.repeat(100));
    expect(cache.get('a')).toBe('x'.repeat(100));
    expect(cache.get('missing')).toBeNull();

    // Inserting 100 more bytes exceeds 250 maxBytes -> evicts least-recent ('b')
    cache.put('c', 'z'.repeat(100));
    expect(cache.getBytes()).toBeLessThanOrEqual(250);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);

    const removed = cache.invalidatePrefix('a');
    expect(removed).toBe(1);
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.evictions).toBeGreaterThanOrEqual(1);
    expect(stats.invalidations).toBe(1);
  });

  it('uses RingBuffer(100) + LRUCache in FileSystemService.previewFile and invalidates on edits', async () => {
    const service = new FileSystemService([workspaceDir]);

    const logPath = path.join(workspaceDir, 'app.log');
    const logLines = Array.from({ length: 150 }, (_, i) => `Log Line ${i + 1}`);
    await fs.writeFile(logPath, logLines.join('\n'), 'utf-8');

    const logPreview1 = await service.previewFile(logPath);
    expect(logPreview1.truncated).toBe(true);
    expect(logPreview1.totalLinesBuffered).toBe(100);
    expect(logPreview1.lines[0]).toBe('Log Line 51');
    expect(logPreview1.lines[99]).toBe('Log Line 150');
    expect(logPreview1.fromCache).toBe(false);

    // Second preview should be served from LRUCache
    const logPreview2 = await service.previewFile(logPath);
    expect(logPreview2.fromCache).toBe(true);
    expect(logPreview2.lines).toEqual(logPreview1.lines);

    // Writing file invalidates cached preview and updated content is returned
    await service.writeFile(logPath, 'Fresh Line 1\nFresh Line 2\n');
    const logPreview3 = await service.previewFile(logPath);
    expect(logPreview3.fromCache).toBe(false);
    expect(logPreview3.truncated).toBe(false);
    expect(logPreview3.lines).toEqual(['Fresh Line 1', 'Fresh Line 2']);

    // Binary file preview safely reports binary without text lines
    const binPath = path.join(workspaceDir, 'sample.bin');
    await fs.writeFile(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x0d, 0x0a]));
    const binPreview = await service.previewFile(binPath);
    expect(binPreview.binary).toBe(true);
    expect(binPreview.lines).toEqual([]);

    const snap = RuntimeDiagnostics.getInstance().getSnapshot();
    expect(snap.preview.previewsServed).toBe(4);
    expect(snap.preview.cacheHits).toBe(1);
    expect(snap.cache.currentBytes).toBeGreaterThanOrEqual(0);
    expect(snap.cache.invalidations).toBeGreaterThanOrEqual(1);
  });

  it('drains & coalesces EventQueue bursts and invalidates directory LRUCache', async () => {
    const broadcasts: Array<{ channel: string; payload: string }> = [];
    const indexEvents: Array<{ type: string; path: string }> = [];

    const kernel = new ReactiveWorkspaceKernel({
      allowedRoots: [workspaceDir],
      coalesceMs: 25,
      broadcaster: (channel, payload): void => {
        broadcasts.push({ channel, payload });
      },
      indexMutationHook: (type, filePath): void => {
        indexEvents.push({ type, path: filePath });
      },
    });

    try {
      const targetFile = path.join(workspaceDir, 'burst.txt');
      await fs.writeFile(targetFile, 'initial', 'utf-8');

      // Populate directory LRU cache before burst
      const firstRead = await kernel.getFileSystemService().readDirectory(workspaceDir);
      expect(firstRead).toHaveLength(1);
      const secondRead = await kernel.getFileSystemService().readDirectory(workspaceDir);
      expect(secondRead).toHaveLength(1);
      expect(kernel.getFileSystemService().getCacheStats().hits).toBe(1);

      // Push redundant rapid events into EventQueue for the same path
      const q = kernel.getEventQueue();
      q.enqueue({
        type: 'create',
        path: targetFile,
        priority: EventPriority.FILE_WATCHER,
        timestamp: 100,
      });
      q.enqueue({
        type: 'change',
        path: targetFile,
        priority: EventPriority.FILE_WATCHER,
        timestamp: 110,
      });
      q.enqueue({
        type: 'change',
        path: targetFile,
        priority: EventPriority.USER_ACTION,
        timestamp: 120,
      });

      const processed = await kernel.drainNow();
      expect(processed).toBe(3);

      const snap = RuntimeDiagnostics.getInstance().getSnapshot();
      expect(snap.eventQueue.processed).toBe(3);
      expect(snap.eventQueue.coalesced).toBe(2);
      expect(snap.eventQueue.pending).toBe(0);
      expect(snap.pathTrie.entryCount).toBe(1);
      expect(kernel.getPathTrie().autocomplete('burst')).toEqual([targetFile]);
      expect(broadcasts).toEqual([{ channel: 'FILE_CREATED', payload: targetFile }]);
      expect(indexEvents).toEqual([{ type: 'create', path: targetFile }]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('observes real OS file creation and deletion inside os.tmpdir() on all platforms including Windows AppData Temp', async () => {
    const broadcasts: Array<{ channel: string; payload: string }> = [];
    const kernel = new ReactiveWorkspaceKernel({
      allowedRoots: [workspaceDir],
      coalesceMs: 25,
      watchOptions: {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
        depth: 0,
      },
      broadcaster: (channel, payload): void => {
        broadcasts.push({ channel, payload });
      },
    });

    try {
      await kernel.activateDirectory(workspaceDir);
      const startSnap = RuntimeDiagnostics.getInstance().getSnapshot();
      expect(startSnap.watcher.status).toBe('watching');
      expect(startSnap.watcher.watchedPath).toBe(path.normalize(workspaceDir));

      // Prime dirCache so we prove OS watcher event invalidates cache automatically
      expect(await kernel.getFileSystemService().readDirectory(workspaceDir)).toHaveLength(0);

      // Ignored internal DB file must not emit noisy watcher broadcasts
      const internalDbDir = path.join(workspaceDir, '.file-manager', 'vectordb');
      await fs.mkdir(internalDbDir, { recursive: true });
      await fs.writeFile(path.join(internalDbDir, 'test.ldb'), 'db', 'utf-8');

      // Real watched file creation
      const liveFile = path.join(workspaceDir, 'live-watcher-report.md');
      await fs.writeFile(liveFile, '# Hello Kernel\n', 'utf-8');

      // Wait for chokidar + coalescing drain loop
      await waitForCondition(
        () => broadcasts.some((b) => b.channel === 'FILE_CREATED' && b.payload.endsWith('live-watcher-report.md')),
        5000
      );

      expect(broadcasts.some((b) => b.payload.includes('.file-manager') || b.payload.endsWith('test.ldb'))).toBe(false);
      expect(kernel.getPathTrie().autocomplete('live-watcher')).toContain(liveFile);
      const afterCreateEntries = await kernel.getFileSystemService().readDirectory(workspaceDir);
      expect(afterCreateEntries.some((entry) => entry.name === 'live-watcher-report.md')).toBe(true);

      // Real watched file deletion
      await fs.rm(liveFile, { force: true });
      await waitForCondition(
        () => broadcasts.some((b) => b.channel === 'FILE_DELETED' && b.payload.endsWith('live-watcher-report.md')),
        5000
      );

      expect(kernel.getPathTrie().autocomplete('live-watcher')).toEqual([]);
      const snap = RuntimeDiagnostics.getInstance().getSnapshot();
      expect(snap.watcher.eventsReceived).toBeGreaterThanOrEqual(2);
      expect(snap.eventQueue.pending).toBe(0);
    } finally {
      await kernel.shutdown();
    }
  });

  it('coalesces older create + newer USER_ACTION unlink in chronological order and prunes PathTrie subtrees via removePrefix()', async () => {
    const broadcasts: Array<{ channel: string; payload: string }> = [];
    const indexEvents: Array<{ type: string; path: string }> = [];
    const kernel = new ReactiveWorkspaceKernel({
      allowedRoots: [workspaceDir],
      coalesceMs: 25,
      broadcaster: (channel, payload): void => {
        broadcasts.push({ channel, payload });
      },
      indexMutationHook: (type, filePath): void => {
        indexEvents.push({ type, path: filePath });
      },
    });

    try {
      const subDir = path.join(workspaceDir, 'nested-folder');
      const nestedA = path.join(subDir, 'inner-alpha.txt');
      const nestedB = path.join(subDir, 'sub', 'inner-beta.txt');

      kernel.getPathTrie().insert(nestedA, {
        filePath: nestedA,
        totalChunks: 0,
        indexedAt: 100,
        fileSize: 10,
      });
      kernel.getPathTrie().insert(nestedB, {
        filePath: nestedB,
        totalChunks: 0,
        indexedAt: 100,
        fileSize: 10,
      });
      expect(kernel.getPathTrie().searchSubstring('er-alp', 10)).toEqual([nestedA]);

      const q = kernel.getEventQueue();
      // Deliberately enqueue in reverse order of priority/timestamp
      q.enqueue({
        type: 'create',
        path: nestedA,
        priority: EventPriority.FILE_WATCHER,
        timestamp: 100,
      });
      q.enqueue({
        type: 'unlink',
        path: nestedA,
        priority: EventPriority.USER_ACTION,
        timestamp: 120,
      });

      const processed = await kernel.drainNow();
      expect(processed).toBe(2);
      expect(broadcasts).toEqual([{ channel: 'FILE_DELETED', payload: nestedA }]);
      expect(indexEvents).toEqual([{ type: 'unlink', path: nestedA }]);
      expect(kernel.getPathTrie().autocomplete('inner-alpha')).toEqual([]);

      // Pruning the parent folder removes remaining nested subtree entries
      const removed = kernel.getPathTrie().removePrefix(subDir);
      expect(removed).toBe(1);
      expect(kernel.getPathTrie().size()).toBe(0);
    } finally {
      await kernel.shutdown();
    }
  });

  it('suppresses self-generated FILE_WATCHER noise while ordering same-timestamp ties with USER_ACTION urgency winning', async () => {
    const broadcasts: Array<{ channel: string; payload: string }> = [];
    const kernel = new ReactiveWorkspaceKernel({
      allowedRoots: [workspaceDir],
      coalesceMs: 1000,
      broadcaster: (channel, payload) => {
        broadcasts.push({ channel, payload });
      },
    });

    try {
      const suppressedFile = path.join(workspaceDir, 'self-moved.md');
      const unsuppressedUrgent = path.join(workspaceDir, 'urgent.md');
      const unsuppressedBg = path.join(workspaceDir, 'background.md');
      const sameTsConflict = path.join(workspaceDir, 'conflict.md');
      await fs.writeFile(suppressedFile, 'ignored echo', 'utf-8');
      await fs.writeFile(unsuppressedUrgent, 'urgent body', 'utf-8');
      await fs.writeFile(unsuppressedBg, 'bg body', 'utf-8');

      kernel.suppressPaths([suppressedFile], 1500);

      const q = kernel.getEventQueue();
      // Suppressed FILE_WATCHER noise must be filtered out
      q.enqueue({
        type: 'change',
        path: suppressedFile,
        priority: EventPriority.FILE_WATCHER,
        timestamp: 400,
      });
      // Equal timestamps across distinct paths: USER_ACTION (1) must dispatch before BACKGROUND_INDEX (10)
      q.enqueue({
        type: 'create',
        path: unsuppressedBg,
        priority: EventPriority.BACKGROUND_INDEX,
        timestamp: 500,
      });
      q.enqueue({
        type: 'create',
        path: unsuppressedUrgent,
        priority: EventPriority.USER_ACTION,
        timestamp: 500,
      });
      // Equal timestamps on same path: USER_ACTION unlink must win over FILE_WATCHER create even when enqueued first
      q.enqueue({
        type: 'unlink',
        path: sameTsConflict,
        priority: EventPriority.USER_ACTION,
        timestamp: 600,
      });
      q.enqueue({
        type: 'create',
        path: sameTsConflict,
        priority: EventPriority.FILE_WATCHER,
        timestamp: 600,
      });

      await kernel.drainNow();
      expect(broadcasts).toEqual([
        { channel: 'FILE_CREATED', payload: unsuppressedUrgent },
        { channel: 'FILE_DELETED', payload: sameTsConflict },
        { channel: 'FILE_CREATED', payload: unsuppressedBg },
      ]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('prunes out-of-root PathTrie entries on updateAllowedRoots() and enforces bounded EventQueue capacity', async () => {
    const keepRoot = path.join(workspaceDir, 'keep-root');
    const dropRoot = path.join(workspaceDir, 'drop-root');
    const kernel = new ReactiveWorkspaceKernel({
      allowedRoots: [keepRoot, dropRoot],
      coalesceMs: 25,
    });

    try {
      const keepFile = path.join(keepRoot, 'kept.ts');
      const dropFile = path.join(dropRoot, 'dropped.ts');
      kernel.getPathTrie().insert(keepFile, { filePath: keepFile, totalChunks: 0, indexedAt: 1, fileSize: 10 });
      kernel.getPathTrie().insert(dropFile, { filePath: dropFile, totalChunks: 0, indexedAt: 1, fileSize: 10 });
      expect(kernel.getPathTrie().size()).toBe(2);

      kernel.updateAllowedRoots([keepRoot]);
      expect(kernel.getPathTrie().size()).toBe(1);
      expect(kernel.getPathTrie().search(keepFile)).not.toBeNull();
      expect(kernel.getPathTrie().search(dropFile)).toBeNull();

      const smallQueue = new EventQueue({ maxSize: 2 });
      smallQueue.enqueue({ type: 'create', path: keepFile, priority: EventPriority.FILE_WATCHER, timestamp: 1 });
      smallQueue.enqueue({ type: 'change', path: keepFile, priority: EventPriority.FILE_WATCHER, timestamp: 2 });
      expect(() =>
        smallQueue.enqueue({ type: 'unlink', path: keepFile, priority: EventPriority.FILE_WATCHER, timestamp: 3 })
      ).toThrow(/capacity exceeded/i);
    } finally {
      await kernel.shutdown();
    }
  });
});

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}
