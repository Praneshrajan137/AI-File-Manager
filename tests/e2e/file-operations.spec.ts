/**
 * E2E Test: File Operations
 * 
 * Tests critical file system operations:
 * - Read directory
 * - Read file
 * - Write file
 * - Delete file
 * - Move/rename file
 */

import { test, expect } from './fixtures';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

test.describe('File Operations', () => {
  let testDir: string;
  let testFile: string;

  test.beforeAll(async () => {
    // Create test directory
    testDir = path.join(os.tmpdir(), `e2e-fileops-${Date.now()}`);
    testFile = path.join(testDir, 'test-file.txt');

    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(testFile, 'initial content');
  });

  test.afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should read directory contents', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const result = await page.evaluate(async (dirPath) => {
      return await window.electronAPI.fs.readDirectory(dirPath);
    }, testDir);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    const fileNames = result.map((f: any) => f.name);
    expect(fileNames).toContain('test-file.txt');
  });

  test('should read file content', async ({ page, electronApp }) => {
    // Ensure page is still open
    if (page.isClosed()) {
      throw new Error('Page was closed unexpectedly');
    }

    await page.waitForLoadState('networkidle');
    
    // Wait for electronAPI to be available
    await page.waitForFunction(() => typeof window.electronAPI !== 'undefined', { timeout: 5000 });
    await page.waitForTimeout(1000);

    const result = await page.evaluate(async (filePath) => {
      return await window.electronAPI.fs.readFile(filePath);
    }, testFile);

    expect(result).toBeDefined();
    expect(result.content).toBe('initial content');
    expect(result.encoding).toBe('utf-8');
  });

  test('should write file content', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const newContent = 'updated content from E2E test';
    
    const result = await page.evaluate(async ({ filePath, content }: { filePath: string; content: string }) => {
      return await window.electronAPI.fs.writeFile(filePath, content);
    }, { filePath: testFile, content: newContent });

    expect(result).toBeDefined();
    expect((result as any).success).toBe(true);

    // Verify content was written
    const actualContent = await fs.readFile(testFile, 'utf-8');
    expect(actualContent).toBe(newContent);
  });

  test('should get file statistics', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const stats = await page.evaluate(async (filePath) => {
      return await window.electronAPI.fs.getStats(filePath);
    }, testFile);

    expect(stats).toBeDefined();
    expect(stats.isFile).toBe(true);
    expect(stats.isDirectory).toBe(false);
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.path).toBeDefined();
    // Extract filename from path
    const fileName = path.basename(stats.path);
    expect(fileName).toBe('test-file.txt');
  });

  test('should rename file', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const newName = 'renamed-file.txt';
    
    const result = await page.evaluate(async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      return await window.electronAPI.fs.rename(oldPath, newName);
    }, { oldPath: testFile, newName });

    expect(result).toBeDefined();
    expect((result as any).success).toBe(true);
    expect((result as any).newPath).toBeDefined();

    // Verify file was renamed
    const renamedPath = path.join(testDir, newName);
    const exists = await fs.access(renamedPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Update testFile for cleanup
    testFile = renamedPath;
  });

  test('should delete file', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const result = await page.evaluate(async (filePath: string) => {
      return await window.electronAPI.fs.delete(filePath);
    }, testFile);

    expect(result).toBeDefined();
    expect((result as any).success).toBe(true);

    // Verify file was deleted
    const exists = await fs.access(testFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});
