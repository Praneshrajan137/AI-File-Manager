import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeElectronApp, getFirstWindow, launchElectronApp } from './electron-launcher';

async function analyzeElectronA11y(page: Page, tags: string[]) {
  // Electron CDP does not support Target.createTarget used by axe.runPartial/finishRun.
  return new AxeBuilder({ page }).setLegacyMode(true).withTags(tags).analyze();
}

test.describe('Frontier Frontend E2E: WCAG 2.2 AA Contrast, 800x600 Reflow, Keyboard & Overlay Stack', () => {
  test('passes Light & Dark axe-core AA contrast, 800x600 zero horizontal overflow, keyboard nav, and LIFO Escape', async () => {
    const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-frontier-a11y-'));
    const workspaceRoot = path.join(tempBase, 'a11y-vault');
    const subFolder = path.join(workspaceRoot, 'docs-folder');
    await fs.mkdir(subFolder, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'alpha.md'), '# Alpha Heading\nLine two content\n', 'utf-8');
    await fs.writeFile(path.join(workspaceRoot, 'beta.txt'), 'Beta notes for quick preview\n', 'utf-8');
    await fs.writeFile(path.join(subFolder, 'nested.md'), '# Nested Note\nSee alpha\n', 'utf-8');

    const vectorDbDir = path.join(tempBase, 'vectordb');
    await fs.mkdir(vectorDbDir, { recursive: true });

    let electronApp: Awaited<ReturnType<typeof launchElectronApp>> | null = null;
    try {
      electronApp = await launchElectronApp({
        env: {
          FILE_MANAGER_ALLOWED_ROOTS: workspaceRoot,
          FILE_MANAGER_VECTOR_DB_PATH: vectorDbDir,
        },
      });
      const page = await getFirstWindow(electronApp);
      await page.waitForLoadState('networkidle');

      const runtimeErrors: string[] = [];
      page.on('pageerror', (err) => runtimeErrors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!text.includes('ERR_FAILED')) {
            runtimeErrors.push(`console.error: ${text}`);
          }
        }
      });

      const firstItem = page.locator('[data-testid="file-list"] [role="option"]').first();
      await expect(firstItem).toBeVisible({ timeout: 15000 });

      // 1. Light Mode WCAG AA audit on main explorer view
      const lightAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
      expect(lightAudit.violations).toEqual([]);

      // 2. Dark Mode toggle + full Dark Mode WCAG AA audit across drawers & spatial lenses
      await page.locator('[data-testid="theme-toggle-button"]').click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(true);

      await page.locator('[data-testid="chat-toggle-button"]').click();
      await expect(page.locator('[data-testid="chat-panel-container"]')).toBeVisible({ timeout: 5000 });

      const darkAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
      expect(darkAudit.violations).toEqual([]);

      await page.locator('[data-testid="lens-tab-duplicates"]').click();
      await expect(page.locator('[data-testid="duplicate-reclaim-lens"]')).toBeVisible({ timeout: 5000 });
      const duplicatesAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(duplicatesAudit.violations).toEqual([]);

      await page.locator('[data-testid="lens-tab-files"]').click();
      await page.locator('[data-testid="chat-toggle-button"]').click();

      // 3. Open lazy-loaded DiagnosticsModal & inspect AA compliance
      await page.locator('[data-testid="diagnostics-button"]').click();
      await expect(page.locator('[data-testid="diagnostics-modal"]')).toBeVisible({ timeout: 10000 });
      const modalAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(modalAudit.violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="diagnostics-modal"]')).toBeHidden();

      // 4. 800x600 Minimum-Window Reflow Verification (no horizontal overflow or clipped toolbar controls)
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setSize(800, 600);
      });
      await page.waitForTimeout(200);

      const overflowCheck = await page.evaluate(() => {
        const doc = document.documentElement;
        const chatBtn = document.querySelector('[data-testid="chat-toggle-button"]')?.getBoundingClientRect();
        const themeBtn = document.querySelector('[data-testid="theme-toggle-button"]')?.getBoundingClientRect();
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          chatRight: chatBtn?.right ?? -1,
          themeRight: themeBtn?.right ?? -1,
        };
      });
      expect(overflowCheck.scrollWidth).toBeLessThanOrEqual(overflowCheck.clientWidth);
      expect(overflowCheck.chatRight).toBeGreaterThan(0);
      expect(overflowCheck.chatRight).toBeLessThanOrEqual(overflowCheck.clientWidth);
      expect(overflowCheck.themeRight).toBeLessThanOrEqual(overflowCheck.clientWidth);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setSize(1280, 800);
      });

      // 5. Explorer keyboard navigation + LIFO Escape stack (Delete dialog over Preview Drawer)
      const alphaRow = page.locator('[data-testid="file-list"] [role="option"]', { hasText: 'alpha.md' });
      await alphaRow.click();
      await page.keyboard.press('ArrowDown');

      const previewDrawer = page.locator('[data-testid="file-preview-drawer"]');
      await page.keyboard.press('Alt+p');
      await expect(previewDrawer).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Delete');
      const deleteDialog = page.locator('[data-testid="delete-confirm-dialog"]');
      await expect(deleteDialog).toBeVisible({ timeout: 5000 });

      // First Escape dismisses top modal ONLY; preview drawer remains visible
      await page.keyboard.press('Escape');
      await expect(deleteDialog).toBeHidden();
      await expect(previewDrawer).toBeVisible();

      // Second Escape dismisses Preview Drawer
      await page.keyboard.press('Escape');
      await expect(previewDrawer).toBeHidden();

      // Verify zero localStorage usage and zero unexpected runtime errors
      const localStorageLen = await page.evaluate(() => window.localStorage.length);
      expect(localStorageLen).toBe(0);
      expect(runtimeErrors).toEqual([]);
    } finally {
      if (electronApp) {
        await closeElectronApp(electronApp);
      }
      await fs.rm(tempBase, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
