/**
 * E2E Test: IPC Communication
 * 
 * Tests IPC bridge between Renderer and Main processes:
 * - IPC channel registration
 * - Request/response flow
 * - Error handling across IPC
 * - File watcher events
 */

import { test, expect } from './fixtures';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

test.describe('IPC Communication', () => {
  let testDir: string;

  test.beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `e2e-ipc-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  test.afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should have all IPC channels available', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const apiStructure = await page.evaluate(() => {
      const api = window.electronAPI;
      return {
        hasFs: typeof api.fs !== 'undefined',
        hasPreviewFile: typeof api.fs?.previewFile === 'function',
        hasNavigation: typeof api.navigation !== 'undefined',
        hasSearch: typeof api.search !== 'undefined',
        hasFileWatcher: typeof api.fileWatcher !== 'undefined',
        hasClipboard: typeof api.clipboard !== 'undefined',
        hasShell: typeof api.shell !== 'undefined',
        hasLLM: typeof api.llm !== 'undefined',
        hasDiagnostics: typeof api.diagnostics?.getSnapshot === 'function',
        hasPing: typeof api.ping === 'function',
      };
    });

    expect(apiStructure.hasFs).toBe(true);
    expect(apiStructure.hasPreviewFile).toBe(true);
    expect(apiStructure.hasNavigation).toBe(true);
    expect(apiStructure.hasSearch).toBe(true);
    expect(apiStructure.hasFileWatcher).toBe(true);
    expect(apiStructure.hasClipboard).toBe(true);
    expect(apiStructure.hasShell).toBe(true);
    expect(apiStructure.hasLLM).toBe(true);
    expect(apiStructure.hasDiagnostics).toBe(true);
    expect(apiStructure.hasPing).toBe(true);
  });

  test('should handle IPC errors gracefully', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Attempt invalid operation
    const result = await page.evaluate(async () => {
      try {
        await window.electronAPI.fs.readDirectory('/nonexistent/path/that/does/not/exist');
        return { success: true };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
          code: error.code,
        };
      }
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.code).toBe('UNAUTHORIZED_ACCESS');
  });

  test('should get system paths via IPC', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const systemPaths = await page.evaluate(async () => {
      return await window.electronAPI.fs.getSystemPaths();
    });

    expect(systemPaths).toBeDefined();
    expect(systemPaths.home).toBeDefined();
    expect(typeof systemPaths.home).toBe('string');
    expect(systemPaths.home.length).toBeGreaterThan(0);
  });

  test('should receive file watcher events', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.evaluate(async (dirPath: string) => {
      (window as any).__testEvents = [];
      (window as any).__testWatcherUnsubscribe = window.electronAPI.fileWatcher.subscribe((event: any) => {
        (window as any).__testEvents.push(event);
      });
      await window.electronAPI.fs.readDirectory(dirPath);
    }, testDir);

    await expect
      .poll(
        async () => {
          const snapshot = await page.evaluate(() => window.electronAPI.diagnostics.getSnapshot());
          const watched = snapshot.watcher.watchedPath ?? '';
          const matchesRoot =
            watched.toLowerCase() === path.resolve(testDir).toLowerCase();
          return snapshot.watcher.status === 'watching' && matchesRoot;
        },
        { timeout: 10000, intervals: [100, 200, 300] }
      )
      .toBe(true);

    // Give chokidar a moment after ready state before writing
    await page.waitForTimeout(250);

    // Create a file to trigger event
    const testFile = path.join(testDir, 'watcher-test.txt');
    await fs.writeFile(testFile, 'test content');

    await expect
      .poll(
        async () => {
          const events = await page.evaluate(() => (window as any).__testEvents || []);
          return events.some(
            (event: { type?: string; path?: string }) =>
              event.type === 'create' &&
              typeof event.path === 'string' &&
              event.path.toLowerCase().endsWith('watcher-test.txt')
          );
        },
        { timeout: 10000, intervals: [150, 250, 500] }
      )
      .toBe(true);

    const receivedEvents = await page.evaluate(() => {
      const events = (window as any).__testEvents || [];
      if (typeof (window as any).__testWatcherUnsubscribe === 'function') {
        (window as any).__testWatcherUnsubscribe();
      }
      return events;
    });

    expect(
      receivedEvents.some(
        (event: { type?: string; path?: string }) =>
          event.type === 'create' &&
          typeof event.path === 'string' &&
          event.path.toLowerCase().endsWith('watcher-test.txt')
      )
    ).toBe(true);
  });
});


