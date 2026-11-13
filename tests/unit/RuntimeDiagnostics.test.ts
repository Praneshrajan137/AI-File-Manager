import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigManager } from '@shared/config/ConfigManager';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';

describe('RuntimeDiagnostics & ConfigManager M1 invariants', () => {
  const originalEnv = { ...process.env };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-m1-test-'));
  const isolatedConfigPath = path.join(tmpDir, 'config.json');

  afterEach(() => {
    process.env = { ...originalEnv };
    ConfigManager.resetForTesting();
    RuntimeDiagnostics.resetForTesting();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks live IPC, cache, preview, watcher, and LLM telemetry accurately', () => {
    const diag = RuntimeDiagnostics.getInstance();
    diag.setAllowedRoots([os.homedir()]);
    diag.setRegisteredChannels(18);
    diag.setWatcherState({ status: 'watching', watchedPath: os.homedir() });
    diag.recordWatcherEvent();
    diag.recordEventQueueStats({ pending: 2, processed: 5, coalesced: 1, dropped: 0 });
    diag.setCacheStats({ hits: 3, misses: 1, entries: 4 });
    diag.recordPreviewServed(false);
    diag.recordPreviewServed(true);
    diag.recordLlmQuery({ success: true, retrievalMs: 20, generationMs: 80 });
    diag.recordLlmQuery({ success: false, retrievalMs: 10, generationMs: 0, error: 'timeout' });
    diag.recordIpcCall('FS:READ_DIR', 12, true);
    diag.recordIpcCall('FS:READ_DIR', 4, false);

    const snapshot = diag.getSnapshot();
    expect(snapshot.allowedRoots).toEqual([os.homedir()]);
    expect(snapshot.watcher.status).toBe('watching');
    expect(snapshot.watcher.eventsReceived).toBe(1);
    expect(snapshot.cache.hitRate).toBe(0.75);
    expect(snapshot.preview.previewsServed).toBe(2);
    expect(snapshot.preview.cacheHits).toBe(1);
    expect(snapshot.llm.queriesExecuted).toBe(2);
    expect(snapshot.llm.failedQueries).toBe(1);
    expect(snapshot.llm.avgRetrievalMs).toBe(15);
    expect(snapshot.ipc.registeredChannels).toBe(18);
    expect(snapshot.ipc.totalCalls).toBe(2);
    expect(snapshot.ipc.totalErrors).toBe(1);
    expect(snapshot.ipc.channels[0].avgDurationMs).toBe(8);
  });

  it('honors FILE_MANAGER_ALLOWED_ROOTS strictly in test/E2E environments', () => {
    const tempExtra = path.join(os.tmpdir(), 'fm-e2e-extra-root');

    process.env.NODE_ENV = 'test';
    delete process.env.E2E_TEST;
    process.env.FILE_MANAGER_ALLOWED_ROOTS = tempExtra;
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath: isolatedConfigPath });
    const testRoots = ConfigManager.getInstance().get('fileSystem').allowedRoots;
    expect(testRoots).toContain(tempExtra);
    expect(testRoots).toContain(os.homedir());

    process.env.NODE_ENV = 'production';
    delete process.env.E2E_TEST;
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath: isolatedConfigPath });
    const prodRoots = ConfigManager.getInstance().get('fileSystem').allowedRoots;
    expect(prodRoots).not.toContain(tempExtra);
    expect(prodRoots).toContain(os.homedir());
  });
});
