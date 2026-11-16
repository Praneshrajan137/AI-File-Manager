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
    test.setTimeout(120_000);
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

      await page.locator('[data-testid="lens-tab-collections"]').click();
      await expect(page.locator('[data-testid="smart-collections-lens"]')).toBeVisible({ timeout: 5000 });
      const collectionsAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(collectionsAudit.violations).toEqual([]);

      await page.locator('[data-testid="lens-tab-graph"]').click();
      await expect(page.locator('[data-testid="knowledge-graph-canvas"]')).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="graph-node-search"]').fill('alpha');
      await expect(page.locator('[data-testid="graph-node-search"]')).toHaveValue('alpha');
      await page.locator('[data-testid="graph-view-toggle"]').click();
      await expect(page.locator('[data-testid="knowledge-graph-table"]')).toBeVisible({ timeout: 5000 });
      const graphDarkAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(graphDarkAudit.violations).toEqual([]);

      await page.locator('[data-testid="lens-tab-files"]').click();
      await page.locator('[data-testid="chat-toggle-button"]').click();

      // 3. Open lazy-loaded CommandOmnibar, DryRunPlanModal, and DiagnosticsModal over async chunks
      await page.keyboard.press('Control+k');
      await expect(page.locator('[data-testid="command-omnibar"]')).toBeVisible({ timeout: 10000 });
      const omnibarAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(omnibarAudit.violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="command-omnibar"]')).toBeHidden();

      await page.locator('[data-testid="toolbar-organize-button"]').click();
      await expect(page.locator('[data-testid="dry-run-plan-modal"]')).toBeVisible({ timeout: 10000 });
      const dryRunAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(dryRunAudit.violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="dry-run-plan-modal"]')).toBeHidden();

      await page.locator('[data-testid="diagnostics-button"]').click();
      await expect(page.locator('[data-testid="diagnostics-modal"]')).toBeVisible({ timeout: 10000 });
      const modalAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(modalAudit.violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="diagnostics-modal"]')).toBeHidden();

      // 4. Switch back to Light Mode and verify SelectionActionBar + WorkspaceStatusBar + Ctrl+C / Ctrl+V copy
      await page.locator('[data-testid="theme-toggle-button"]').click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(false);

      const betaRow = page.locator('[data-testid="file-list"] [role="option"]', { hasText: 'beta.txt' });
      await expect(betaRow).toBeVisible({ timeout: 10000 });
      await betaRow.click();
      await expect(page.locator('[data-testid="selection-action-bar"]')).toBeVisible({ timeout: 5000 });
      const selectionLightAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(selectionLightAudit.violations).toEqual([]);

      await page.keyboard.press('Control+c');
      await expect(page.locator('[data-testid="status-clipboard-badge"]')).toContainText('Copied 1 item');
      await page.keyboard.press('Control+v');
      const copiedBetaRow = page.locator('[data-testid="file-list"] [role="option"]', { hasText: 'beta (copy).txt' });
      await expect(copiedBetaRow).toBeVisible({ timeout: 10000 });
      await expect.poll(async () => fs.stat(path.join(workspaceRoot, 'beta (copy).txt')).then(() => true).catch(() => false)).toBe(true);

      // 5. Preview Drawer Sibling Cycling + Connections + 800x600 Overlay Drawer Reflow & Audit
      const alphaForPreview = page.locator('[data-testid="file-list"] [role="option"]', { hasText: 'alpha.md' });
      await alphaForPreview.click();
      const previewDrawer = page.locator('[data-testid="file-preview-drawer"]');
      await page.keyboard.press('Alt+p');
      await expect(previewDrawer).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="preview-next-button"]').click();
      await expect(previewDrawer).toContainText('beta');
      await page.locator('[data-testid="preview-tab-connections"]').click();
      const previewAudit = await analyzeElectronA11y(page, ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
      expect(previewAudit.violations).toEqual([]);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setSize(800, 600);
      });
      await page.waitForTimeout(200);

      const overflowCheck = await page.evaluate(() => {
        const doc = document.documentElement;
        const chatBtn = document.querySelector('[data-testid="chat-toggle-button"]')?.getBoundingClientRect();
        const themeBtn = document.querySelector('[data-testid="theme-toggle-button"]')?.getBoundingClientRect();
        const drawerBox = document.querySelector('[data-testid="file-preview-drawer"]')?.getBoundingClientRect();
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          chatRight: chatBtn?.right ?? -1,
          themeRight: themeBtn?.right ?? -1,
          drawerLeft: drawerBox?.left ?? -1,
          drawerRight: drawerBox?.right ?? -1,
          drawerWidth: drawerBox?.width ?? -1,
        };
      });
      expect(overflowCheck.scrollWidth).toBeLessThanOrEqual(overflowCheck.clientWidth);
      expect(overflowCheck.chatRight).toBeGreaterThan(0);
      expect(overflowCheck.chatRight).toBeLessThanOrEqual(overflowCheck.clientWidth);
      expect(overflowCheck.themeRight).toBeLessThanOrEqual(overflowCheck.clientWidth);
      expect(overflowCheck.drawerWidth).toBeGreaterThan(200);
      expect(overflowCheck.drawerLeft).toBeGreaterThanOrEqual(0);
      expect(overflowCheck.drawerRight).toBeLessThanOrEqual(overflowCheck.clientWidth);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setSize(1280, 800);
      });

      // Dismiss Preview Drawer via Escape, test Grid View 2D keyboard navigation, then LIFO Delete over Preview
      await page.keyboard.press('Escape');
      await expect(previewDrawer).toBeHidden();

      await page.locator('[data-testid="view-grid-button"]').click();
      const firstGridItem = page.locator('[data-testid="file-grid"] [role="option"]').first();
      await expect(firstGridItem).toBeVisible({ timeout: 5000 });
      await firstGridItem.click();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('End');
      await page.keyboard.press('Home');
      await page.locator('[data-testid="view-list-button"]').click();

      // 6. Explorer keyboard navigation + LIFO Escape stack (Delete dialog over Preview Drawer)
      await page.getByRole('button', { name: 'a11y-vault', exact: true }).click();
      const alphaRow = page.locator('[data-testid="file-list"] [role="option"]', { hasText: 'alpha.md' });
      await expect(alphaRow).toBeVisible({ timeout: 10000 });
      await alphaRow.click();
      await page.keyboard.press('ArrowDown');

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
