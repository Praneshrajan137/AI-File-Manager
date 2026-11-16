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

    // Attempt literal unnormalized path traversal from allowed directory (without path.join folding ..)
    const traversalPath = `${testDir}${path.sep}..${path.sep}..${path.sep}..${path.sep}etc${path.sep}passwd`;

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
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.code).toBe('PATH_TRAVERSAL');
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
    expect(result.code).toBe('UNAUTHORIZED_ACCESS');
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

    // Check that require, real Node process, fs, and ipcRenderer are not accessible
    const nodeAPIs = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      const proc = typeof process !== 'undefined' ? (process as unknown as Record<string, unknown>) : undefined;
      return {
        hasRequire: typeof require !== 'undefined',
        hasNodeVersions: Boolean(proc && proc.versions && (proc.versions as Record<string, unknown>).node),
        hasFs: typeof fs !== 'undefined',
        hasWindowIpcRenderer: typeof win.ipcRenderer !== 'undefined',
        hasBridgeIpcRenderer: typeof (win.electronAPI as Record<string, unknown> | undefined)?.ipcRenderer !== 'undefined',
        hasElectronAPI: typeof window.electronAPI !== 'undefined',
      };
    });

    // Renderer should NOT have direct Node.js or raw IPC access
    expect(nodeAPIs.hasRequire).toBe(false);
    expect(nodeAPIs.hasNodeVersions).toBe(false);
    expect(nodeAPIs.hasFs).toBe(false);
    expect(nodeAPIs.hasWindowIpcRenderer).toBe(false);
    expect(nodeAPIs.hasBridgeIpcRenderer).toBe(false);
    
    // But should have electronAPI (via preload)
    expect(nodeAPIs.hasElectronAPI).toBe(true);
  });

  test('blocks SHELL:OPEN_PATH on dangerous executable/script extensions and vault-asset:// on .env SecretGuard files', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const exeFile = path.join(testDir, 'payload.exe');
    const ps1File = path.join(testDir, 'script.ps1');
    const envFile = path.join(testDir, '.env');
    await fs.writeFile(exeFile, 'MZ', 'utf-8');
    await fs.writeFile(ps1File, 'Write-Host 1', 'utf-8');
    await fs.writeFile(envFile, 'OPENAI_API_KEY=sk-proj-secret1234567890123456\n', 'utf-8');

    const results = await page.evaluate(
      async ({ exePath, ps1Path, envPath }) => {
        const openAttempt = async (target: string): Promise<{ blocked: boolean; code: string | null }> => {
          try {
            await window.electronAPI.shell.openPath(target);
            return { blocked: false, code: null };
          } catch (err: unknown) {
            const e = err as { code?: string };
            return {
              blocked: true,
              code: e?.code ?? null,
            };
          }
        };

        const exeRes = await openAttempt(exePath);
        const ps1Res = await openAttempt(ps1Path);
        const assetResp = await fetch(
          `vault-asset://local/file?path=${encodeURIComponent(envPath)}`
        );
        return {
          exeRes,
          ps1Res,
          vaultStatus: assetResp.status,
        };
      },
      { exePath: exeFile, ps1Path: ps1File, envPath: envFile }
    );

    expect(results.exeRes.blocked).toBe(true);
    expect(results.exeRes.code).toBe('UNAUTHORIZED_ACCESS');
    expect(results.ps1Res.blocked).toBe(true);
    expect(results.ps1Res.code).toBe('UNAUTHORIZED_ACCESS');
    expect(results.vaultStatus).toBe(403);
  });
});

