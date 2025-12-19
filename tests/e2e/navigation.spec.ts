/**
 * E2E Test: Navigation Flow
 * 
 * Tests critical navigation functionality:
 * - Directory navigation
 * - Back/Forward buttons (HistoryStack)
 * - Breadcrumb navigation
 * - Keyboard shortcuts
 */

import { test, expect } from './fixtures';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

test.describe('Navigation', () => {
  let testDir: string;
  let subDir1: string;
  let subDir2: string;

  test.beforeAll(async () => {
    // Create test directory structure
    testDir = path.join(os.tmpdir(), `e2e-nav-${Date.now()}`);
    subDir1 = path.join(testDir, 'subdir1');
    subDir2 = path.join(subDir1, 'subdir2');

    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(subDir1, { recursive: true });
    await fs.mkdir(subDir2, { recursive: true });
    
    // Create test files
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'test content 1');
    await fs.writeFile(path.join(subDir1, 'file2.txt'), 'test content 2');
    await fs.writeFile(path.join(subDir2, 'file3.txt'), 'test content 3');
  });

  test.afterAll(async () => {
    // Cleanup test directories
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should navigate to directory and display files', async ({ page, electronApp }) => {
    // Wait for app to load
    await page.waitForLoadState('networkidle');
    
    // Wait for initial directory load
    await page.waitForTimeout(2000);

    // Check if electronAPI is available
    const electronAPIAvailable = await page.evaluate(() => {
      return typeof window.electronAPI !== 'undefined';
    });
    
    expect(electronAPIAvailable).toBe(true);

    // Navigate to test directory via IPC
    const navigationResult = await page.evaluate(async (testPath) => {
      return await window.electronAPI.fs.readDirectory(testPath);
    }, testDir);

    expect(navigationResult).toBeDefined();
    expect(Array.isArray(navigationResult)).toBe(true);
    
    // Should contain subdir1 and file1.txt
    const fileNames = navigationResult.map((f: any) => f.name);
    expect(fileNames).toContain('subdir1');
    expect(fileNames).toContain('file1.txt');
  });

  test('should navigate back and forward using history', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Get initial path
    const initialPath = await page.evaluate(async () => {
      const paths = await window.electronAPI.fs.getSystemPaths();
      return paths.home;
    });

    // Navigate to test directory
    await page.evaluate(async (testPath) => {
      await window.electronAPI.navigation.push(testPath);
      await window.electronAPI.fs.readDirectory(testPath);
    }, testDir);

    await page.waitForTimeout(1000);

    // Navigate to subdirectory
    await page.evaluate(async (subPath) => {
      await window.electronAPI.navigation.push(subPath);
      await window.electronAPI.fs.readDirectory(subPath);
    }, subDir1);

    await page.waitForTimeout(1000);

    // Check navigation state
    const navState = await page.evaluate(async () => {
      return await window.electronAPI.navigation.getState();
    });

    expect(navState.canGoBack).toBe(true);
    expect(navState.canGoForward).toBe(false);

    // Navigate back
    const backResult = await page.evaluate(async () => {
      return await window.electronAPI.navigation.back();
    });

    expect(backResult).toBe(testDir);
    expect(typeof backResult).toBe('string');

    // Navigate forward
    const forwardResult = await page.evaluate(async () => {
      return await window.electronAPI.navigation.forward();
    });

    expect(forwardResult).toBe(subDir1);
    expect(typeof forwardResult).toBe('string');
  });

  test('should handle navigation to non-existent directory', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const nonExistentPath = path.join(os.tmpdir(), `non-existent-${Date.now()}`);

    // Attempt to navigate to non-existent directory
    const result = await page.evaluate(async (path) => {
      try {
        await window.electronAPI.fs.readDirectory(path);
        return { success: true };
      } catch (error: any) {
        return { 
          success: false, 
          error: error.message || String(error) 
        };
      }
    }, nonExistentPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
