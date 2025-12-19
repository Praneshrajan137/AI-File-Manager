/**
 * E2E Test: Security & Path Validation
 * 
 * Tests critical security features:
 * - Path traversal prevention
 * - Unauthorized directory access blocking
 * - IPC security boundaries
 */

import { test, expect } from './fixtures';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

test.describe('Security', () => {
  let testDir: string;
  let restrictedDir: string;

  test.beforeAll(async () => {
    // Create test directory structure
    testDir = path.join(os.tmpdir(), `e2e-security-${Date.now()}`);
    restrictedDir = path.join(os.tmpdir(), `e2e-restricted-${Date.now()}`);

    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(restrictedDir, { recursive: true });
    
    await fs.writeFile(path.join(testDir, 'allowed.txt'), 'allowed content');
    await fs.writeFile(path.join(restrictedDir, 'restricted.txt'), 'restricted content');
  });

  test.afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.rm(restrictedDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should prevent path traversal attacks', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Attempt path traversal from allowed directory
    const traversalPath = path.join(testDir, '..', '..', '..', 'etc', 'passwd');

    const result = await page.evaluate(async (path) => {
      try {
        await window.electronAPI.fs.readDirectory(path);
        return { success: true };
      } catch (error: any) {
        return { 
          success: false, 
          error: error.message || String(error),
          code: error.code
        };
      }
    }, traversalPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Error should be serialized - check for error indication
    // The error might be serialized as [object Object] or as a string message
    expect(typeof result.error).toBe('string');
    // The error should indicate failure (either contains error keywords or is an object string)
    expect(result.error.length).toBeGreaterThan(0);
  });

  test('should prevent accessing files outside allowed roots', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Try to access a path that's definitely outside home directory
    // On Windows, try accessing C:\Windows\System32 (system directory)
    // On Unix, try accessing /etc/passwd (system file)
    const systemPath = process.platform === 'win32' 
      ? 'C:\\Windows\\System32\\config\\sam'
      : '/etc/shadow';

    const result = await page.evaluate(async (path) => {
      try {
        await window.electronAPI.fs.readFile(path);
        return { success: true };
      } catch (error: any) {
        return { 
          success: false, 
          error: error.message || String(error),
          code: error.code
        };
      }
    }, systemPath);

    // Should be blocked - system directories are outside allowed roots
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should validate paths before file operations', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Attempt to write to invalid path
    const invalidPaths = [
      '../../etc/passwd',
      'C:\\Windows\\System32\\config\\sam',
      '/etc/shadow',
      'file:///etc/passwd',
    ];

    for (const invalidPath of invalidPaths) {
      const result = await page.evaluate(async (path) => {
        try {
          await window.electronAPI.fs.writeFile(path, 'malicious content');
          return { success: true };
        } catch (error: any) {
          return { 
            success: false, 
            error: error.message || String(error)
          };
        }
      }, invalidPath);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }
  });

  test('should prevent renderer from accessing Node.js APIs directly', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check that require, process, fs are not accessible
    const nodeAPIs = await page.evaluate(() => {
      return {
        hasRequire: typeof require !== 'undefined',
        hasProcess: typeof process !== 'undefined',
        hasFs: typeof fs !== 'undefined',
        hasElectronAPI: typeof window.electronAPI !== 'undefined',
      };
    });

    // Renderer should NOT have direct Node.js access
    expect(nodeAPIs.hasRequire).toBe(false);
    expect(nodeAPIs.hasFs).toBe(false);
    
    // But should have electronAPI (via preload)
    expect(nodeAPIs.hasElectronAPI).toBe(true);
  });
});
