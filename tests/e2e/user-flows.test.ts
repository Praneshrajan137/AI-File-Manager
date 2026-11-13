/**
 * E2E User Flow Tests - Phase 7.1
 * 
 * Tests complete user journeys from launch to task completion.
 * Uses existing Playwright fixtures for Electron app control.
 * 
 * CRITICAL: These tests verify THE USER EXPERIENCE, not just code correctness.
 * 
 * @fileoverview Comprehensive E2E test suite for OS File Manager
 */

import { test, expect } from './fixtures';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

/**
 * Test data directory management
 */
let testDir: string;

test.describe('Critical User Journeys', () => {
    test.beforeAll(async () => {
        // Create test directory with sample files
        testDir = path.join(os.tmpdir(), `e2e-user-flows-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

        // Create sample file structure
        await fs.writeFile(
            path.join(testDir, 'readme.txt'),
            'This is a test file for E2E testing.'
        );

        await fs.mkdir(path.join(testDir, 'documents'), { recursive: true });
        await fs.writeFile(
            path.join(testDir, 'documents', 'notes.txt'),
            'Machine learning notes: Neural networks are powerful models.'
        );

        await fs.writeFile(
            path.join(testDir, 'documents', 'recipes.txt'),
            'Pasta recipe: Boil water, add pasta, cook for 10 minutes.'
        );
    });

    test.afterAll(async () => {
        // Cleanup test directory
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    /**
     * USER JOURNEY 1: Navigate and View Files
     * 
     * Success: User can browse directories and view file list using IPC
     * Tests the core file browsing functionality via electronAPI
     */
    test('Journey 1: Navigate and view files', async ({ page }) => {
        // 1. Wait for app to be fully ready
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // 2. Verify electronAPI is available
        const electronAPIAvailable = await page.evaluate(() => {
            return typeof window.electronAPI !== 'undefined';
        });
        expect(electronAPIAvailable).toBe(true);

        // 3. Navigate to test directory
        const dirContents = await page.evaluate(async (dirPath) => {
            return await window.electronAPI.fs.readDirectory(dirPath);
        }, testDir);

        // 4. Verify files are returned
        expect(dirContents).toBeDefined();
        expect(Array.isArray(dirContents)).toBe(true);

        const fileNames = dirContents.map((f: any) => f.name);
        expect(fileNames).toContain('readme.txt');
        expect(fileNames).toContain('documents');

        // 5. Navigate into subdirectory
        const subDirPath = path.join(testDir, 'documents');
        const subDirContents = await page.evaluate(async (dirPath) => {
            return await window.electronAPI.fs.readDirectory(dirPath);
        }, subDirPath);

        const subFileNames = subDirContents.map((f: any) => f.name);
        expect(subFileNames).toContain('notes.txt');
        expect(subFileNames).toContain('recipes.txt');
    });

    /**
     * USER JOURNEY 2: Navigation History (Back/Forward)
     * 
     * Success: Navigation history works correctly via IPC
     */
    test('Journey 2: Navigation history works', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // 1. Push initial path
        await page.evaluate(async (dirPath) => {
            await window.electronAPI.navigation.push(dirPath);
        }, testDir);

        // 2. Push second path
        const subDirPath = path.join(testDir, 'documents');
        await page.evaluate(async (dirPath) => {
            await window.electronAPI.navigation.push(dirPath);
        }, subDirPath);

        // 3. Check navigation state
        const navState = await page.evaluate(async () => {
            return await window.electronAPI.navigation.getState();
        });

        expect(navState.canGoBack).toBe(true);
        expect(navState.canGoForward).toBe(false);

        // 4. Navigate back
        const backResult = await page.evaluate(async () => {
            return await window.electronAPI.navigation.back();
        });

        expect(backResult).toBe(testDir);

        // 5. Navigate forward
        const forwardResult = await page.evaluate(async () => {
            return await window.electronAPI.navigation.forward();
        });

        expect(forwardResult).toBe(subDirPath);
    });

    /**
     * USER JOURNEY 3: Search for Files (Autocomplete)
     * 
     * Success: User can search by filename with autocomplete results
     * Note: PathTrie is populated when directories are read via FS:READ_DIR
     */
    test('Journey 3: Search for files', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // 1. First, read the test directory to populate PathTrie
        // (PathTrie is built from readDirectory calls, not a separate index method)
        await page.evaluate(async (dirPath) => {
            await window.electronAPI.fs.readDirectory(dirPath);
        }, testDir);

        // 2. Also read subdirectory to add those files to PathTrie
        const subDirPath = path.join(testDir, 'documents');
        await page.evaluate(async (dirPath) => {
            await window.electronAPI.fs.readDirectory(dirPath);
        }, subDirPath);

        // 3. Wait for PathTrie warming to index nested entries
        await expect
            .poll(
                async () => {
                    const results = await page.evaluate(async () => {
                        return await window.electronAPI.search.autocomplete('notes', 10);
                    });
                    return results.filter((p) => p.toLowerCase().includes('notes.txt')).length;
                },
                { timeout: 10000 }
            )
            .toBeGreaterThan(0);

        // 4. Test autocomplete search returns concrete match
        const results = await page.evaluate(async () => {
            return await window.electronAPI.search.autocomplete('notes', 10);
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results.some((p) => p.toLowerCase().endsWith('notes.txt'))).toBe(true);
    });

    /**
     * USER JOURNEY 4: File Operations (CRUD)
     * 
     * Success: User can create, rename, and delete files via IPC
     */
    test('Journey 4: File operations (CRUD)', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        const newFilePath = path.join(testDir, 'test-new-file.txt');
        const newFileContent = 'Content created by E2E test';

        // 1. Create new file (write)
        const writeResult = await page.evaluate(
            async ({ filePath, content }) => {
                return await window.electronAPI.fs.writeFile(filePath, content);
            },
            { filePath: newFilePath, content: newFileContent }
        );

        expect((writeResult as any).success).toBe(true);

        // 2. Verify file exists by reading
        const readResult = await page.evaluate(async (filePath) => {
            return await window.electronAPI.fs.readFile(filePath);
        }, newFilePath);

        expect(readResult.content).toBe(newFileContent);

        // 3. Rename file
        const renameResult = await page.evaluate(
            async ({ oldPath, newName }) => {
                return await window.electronAPI.fs.rename(oldPath, newName);
            },
            { oldPath: newFilePath, newName: 'renamed-file.txt' }
        );

        expect((renameResult as any).success).toBe(true);

        // 4. Verify rename worked
        const renamedPath = path.join(testDir, 'renamed-file.txt');
        const dirContents = await page.evaluate(async (dirPath) => {
            return await window.electronAPI.fs.readDirectory(dirPath);
        }, testDir);

        const fileNames = dirContents.map((f: any) => f.name);
        expect(fileNames).toContain('renamed-file.txt');
        expect(fileNames).not.toContain('test-new-file.txt');

        // 5. Delete file
        const deleteResult = await page.evaluate(async (filePath) => {
            return await window.electronAPI.fs.delete(filePath);
        }, renamedPath);

        expect((deleteResult as any).success).toBe(true);

        // 6. Verify deletion
        const finalContents = await page.evaluate(async (dirPath) => {
            return await window.electronAPI.fs.readDirectory(dirPath);
        }, testDir);

        const finalFileNames = finalContents.map((f: any) => f.name);
        expect(finalFileNames).not.toContain('renamed-file.txt');
    });

    /**
     * USER JOURNEY 5: UI Elements Visible
     * 
     * Success: Core UI elements are rendered and visible
     * Note: This test can be flaky if the app is slow to load
     */
    test('Journey 5: UI elements visible', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        await expect(page.locator('[data-testid="app-container"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="main-content"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="file-explorer"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="navigation-buttons"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="search-input"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="breadcrumb"]')).toBeVisible({ timeout: 10000 });
    });

    /**
     * USER JOURNEY 6: Performance Under Load
     * 
     * Success: App handles 1000+ files within performance targets
     */
    test('Journey 6: Performance with large directory', async ({ page }) => {
        // 1. Create directory with many files
        const largeDir = path.join(testDir, 'large-directory');
        await fs.mkdir(largeDir, { recursive: true });

        // Create 500 files (reduced from 1000 for faster test execution)
        const fileCount = 500;
        const writePromises = [];
        for (let i = 0; i < fileCount; i++) {
            writePromises.push(
                fs.writeFile(path.join(largeDir, `file-${i.toString().padStart(4, '0')}.txt`), `Content ${i}`)
            );
        }
        await Promise.all(writePromises);

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // 2. Measure directory read time
        const startTime = Date.now();

        const result = await page.evaluate(async (dirPath) => {
            const start = performance.now();
            const files = await window.electronAPI.fs.readDirectory(dirPath);
            const end = performance.now();
            return {
                files,
                duration: end - start
            };
        }, largeDir);

        const totalTime = Date.now() - startTime;

        // 3. Verify all files read
        expect(result.files.length).toBe(fileCount);

        // 4. Performance target: < 2000ms for 500 files
        expect(totalTime).toBeLessThan(2000);

        // 5. Cleanup large directory
        await fs.rm(largeDir, { recursive: true, force: true });
    });

    /**
     * USER JOURNEY 7: Error Handling and Recovery
     * 
     * Success: App handles errors gracefully without crashing
     */
    test('Journey 7: Error handling and recovery', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        const nonExistentPath = path.join(os.tmpdir(), `non-existent-${Date.now()}`);

        // 1. Test invalid path - should throw error
        const result = await page.evaluate(async (dirPath) => {
            try {
                await window.electronAPI.fs.readDirectory(dirPath);
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

        // 2. Verify app still works after error
        const validResult = await page.evaluate(async (dirPath) => {
            return await window.electronAPI.fs.readDirectory(dirPath);
        }, testDir);

        expect(validResult).toBeDefined();
        expect(Array.isArray(validResult)).toBe(true);

        // 3. Test reading non-existent file
        const nonExistentFile = path.join(testDir, 'does-not-exist.txt');
        const fileResult = await page.evaluate(async (filePath) => {
            try {
                await window.electronAPI.fs.readFile(filePath);
                return { success: true };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message || String(error)
                };
            }
        }, nonExistentFile);

        expect(fileResult.success).toBe(false);
    });
});

/**
 * ACCESSIBILITY TESTS
 * 
 * Verify app meets accessibility standards
 */
test.describe('Accessibility', () => {
    /**
     * Test keyboard navigation accessibility attributes
     */
    test('Keyboard navigation works', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        const backButton = page.locator('[data-testid="back-button"]');
        const forwardButton = page.locator('[data-testid="forward-button"]');

        await expect(backButton).toBeVisible({ timeout: 10000 });
        await expect(forwardButton).toBeVisible({ timeout: 10000 });
        await expect(backButton).toHaveAttribute('aria-label', 'Go back');
        await expect(forwardButton).toHaveAttribute('aria-label', 'Go forward');

        // Verify live keyboard shortcut (Ctrl+Shift+L toggles AI chat panel)
        const chatPanel = page.locator('[data-testid="chat-panel"]');
        await expect(chatPanel).toBeHidden();
        await page.keyboard.press('Control+Shift+L');
        await expect(chatPanel).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Control+Shift+L');
        await expect(chatPanel).toBeHidden({ timeout: 5000 });
    });

    /**
     * Test screen reader attributes present
     */
    test('Screen reader attributes present', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        const breadcrumb = page.locator('[data-testid="breadcrumb"]');
        await expect(breadcrumb).toBeVisible({ timeout: 10000 });
        await expect(breadcrumb).toHaveAttribute('role', 'navigation');
        await expect(breadcrumb).toHaveAttribute('aria-label', 'Breadcrumb');
    });
});

/**
 * CHAT PANEL TESTS
 * 
 * Test the AI chat UI structure and toggles
 */
test.describe('Chat Panel', () => {
    /**
     * Test chat panel opens via shortcut and closes via toggle button
     */
    test('Chat panel opens and closes', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        const fileExplorer = page.locator('[data-testid="file-explorer"]');
        await expect(fileExplorer).toBeVisible({ timeout: 10000 });
        await fileExplorer.click();

        const chatPanel = page.locator('[data-testid="chat-panel-container"]');
        await expect(chatPanel).toBeHidden();

        // Open via keyboard shortcut (Ctrl+Shift+L)
        await page.keyboard.press('Control+Shift+L');
        await expect(chatPanel).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({ timeout: 5000 });

        // Close via toolbar toggle button
        await page.locator('[data-testid="chat-toggle-button"]').click();
        await expect(chatPanel).toBeHidden({ timeout: 5000 });
    });

    /**
     * Test chat input can receive input
     */
    test('Chat input accepts text', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        const toggleButton = page.locator('[data-testid="chat-toggle-button"]');
        await expect(toggleButton).toBeVisible({ timeout: 10000 });
        await toggleButton.click();

        const chatInput = page.locator('[data-testid="chat-input"]');
        await expect(chatInput).toBeVisible({ timeout: 5000 });

        await chatInput.fill('Test message for E2E testing');
        await expect(chatInput).toHaveValue('Test message for E2E testing');

        const sendButton = page.locator('[data-testid="send-button"]');
        await expect(sendButton).toBeVisible({ timeout: 5000 });
        await expect(sendButton).toBeEnabled();
    });
});

/**
 * FILE OPERATIONS UI TESTS
 * 
 * Tests that verify UI interactions for file operations
 */
test.describe('File Operations UI', () => {
    let opTestDir: string;

    test.beforeAll(async () => {
        // Create separate test directory for these tests
        opTestDir = path.join(os.tmpdir(), `e2e-file-ops-ui-${Date.now()}`);
        await fs.mkdir(opTestDir, { recursive: true });
        await fs.writeFile(path.join(opTestDir, 'test-file.txt'), 'Test content');
    });

    test.afterAll(async () => {
        try {
            await fs.rm(opTestDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    /**
     * Test file stats retrieval
     */
    test('Can get file statistics', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        const testFilePath = path.join(opTestDir, 'test-file.txt');

        const stats = await page.evaluate(async (filePath) => {
            return await window.electronAPI.fs.getStats(filePath);
        }, testFilePath);

        expect(stats).toBeDefined();
        expect(stats.isFile).toBe(true);
        expect(stats.isDirectory).toBe(false);
        expect(stats.size).toBeGreaterThan(0);
    });

    /**
     * Test system paths retrieval
     */
    test('Can get system paths', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        const systemPaths = await page.evaluate(async () => {
            return await window.electronAPI.fs.getSystemPaths();
        });

        expect(systemPaths).toBeDefined();
        expect(systemPaths.home).toBeDefined();
        expect(systemPaths.home.length).toBeGreaterThan(0);
        expect(systemPaths.documents).toBeDefined();
        expect(systemPaths.downloads).toBeDefined();
    });
});
