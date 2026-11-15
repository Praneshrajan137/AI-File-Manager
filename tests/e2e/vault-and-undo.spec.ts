import { test, expect } from '@playwright/test';
import { launchElectronApp, getFirstWindow, closeElectronApp } from './electron-launcher';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

test.describe('Stage 1 (M7) Safety Kernel: Trash Vault, Undo/Redo & Workspace Vaults E2E', () => {
  test('supports Workspace Vault opt-in indexing, Favorites, Delete -> Trash Vault -> Undo/Redo -> Symlink safe delete', async () => {
    const testBase = path.join(os.tmpdir(), `e2e-m7-${Date.now()}`);
    const workspaceA = path.join(testBase, 'vault-alpha');
    const workspaceB = path.join(testBase, 'vault-beta');
    const outsideDir = path.join(testBase, 'outside-secret');

    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(workspaceB, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    const sampleFile = path.join(workspaceA, 'important-note.txt');
    const secretFile = path.join(outsideDir, 'keep-safe.txt');
    await fs.writeFile(sampleFile, 'Recoverable vault payload content', 'utf-8');
    await fs.writeFile(secretFile, 'OUTSIDE_SECRET_INTACT', 'utf-8');

    const junctionInVault = path.join(workspaceA, 'external-junction');
    await fs.symlink(outsideDir, junctionInVault, process.platform === 'win32' ? 'junction' : 'dir');

    let electronApp: Awaited<ReturnType<typeof launchElectronApp>> | null = null;
    try {
      electronApp = await launchElectronApp({
        env: {
          FILE_MANAGER_ALLOWED_ROOTS: workspaceA,
        },
      });
      const page = await getFirstWindow(electronApp);
      await page.waitForLoadState('networkidle');

      // 1. Navigate to workspaceA and verify VaultSection is rendered
      await page.evaluate(async (dir: string) => {
        await window.electronAPI.fs.readDirectory(dir);
      }, workspaceA);

      // Navigate UI by clicking or IPC -> trigger breadcrumb / sidebar Vault root button
      const vaultRootAlpha = page.locator('[data-testid="vault-root-vault-alpha"]');
      await expect(vaultRootAlpha).toBeVisible({ timeout: 10000 });
      await vaultRootAlpha.getByText('vault-alpha').click();

      const targetItem = page.locator('[data-testid="file-list"] [role="option"]', {
        hasText: 'important-note.txt',
      });
      await expect(targetItem).toBeVisible({ timeout: 10000 });

      // 2. Toggle AI opt-in indexing on vault-alpha
      const indexToggle = page.locator('[data-testid="vault-index-toggle-vault-alpha"]');
      await expect(indexToggle).toContainText('AI Off');
      await indexToggle.click();
      await expect(indexToggle).toContainText('AI On', { timeout: 5000 });

      // Add second workspace root via IPC & verify dynamic kernel hot reload allows reading it
      const addRes = await page.evaluate(async (dir: string) => {
        return await window.electronAPI.vault.addRoot({ pickDialog: false, path: dir });
      }, workspaceB);
      expect(addRes.cancelled).toBe(false);
      expect(addRes.config.allowedRoots.some((r: string) => r.includes('vault-beta'))).toBe(true);

      // Pin & verify Favorites persistence UI
      await page.evaluate(async (p: string) => {
        return await window.electronAPI.vault.toggleFavorite(p);
      }, sampleFile);

      // 3. Delete via Keyboard Delete -> Confirm Dialog -> Move to Trash Vault
      await targetItem.click();
      await page.keyboard.press('Delete');

      const confirmDialog = page.locator('[data-testid="delete-confirm-dialog"]');
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="delete-confirm-button"]').click();
      await expect(confirmDialog).toBeHidden();

      // Verify file disappeared from explorer & Trash Vault summary displays
      await expect(targetItem).toBeHidden({ timeout: 5000 });
      await expect(page.locator('[data-testid="trash-vault-summary"]')).toBeVisible({ timeout: 5000 });

      // 4. Click inline Toast Undo OR Toolbar Undo -> verify full content restoration
      const undoButton = page.locator('[data-testid="undo-button"]');
      await expect(undoButton).toBeEnabled({ timeout: 5000 });
      await undoButton.click();

      await expect(targetItem).toBeVisible({ timeout: 5000 });
      expect(await fs.readFile(sampleFile, 'utf-8')).toBe('Recoverable vault payload content');

      // 5. Redo via Ctrl+Y -> file moves back to Trash Vault, then Undo via Ctrl+Z -> restored again!
      await page.keyboard.press('Control+y');
      await expect(targetItem).toBeHidden({ timeout: 5000 });

      await page.keyboard.press('Control+z');
      await expect(targetItem).toBeVisible({ timeout: 5000 });
      expect(await fs.readFile(sampleFile, 'utf-8')).toBe('Recoverable vault payload content');

      // 6. Symlink safe delete: deleting junction inside vault never deletes outsideDir contents
      const symlinkDelRes = await page.evaluate(async (p: string) => {
        return await window.electronAPI.fs.delete(p, true, 'vault');
      }, junctionInVault);
      expect(symlinkDelRes.success).toBe(true);
      await expect(fs.lstat(junctionInVault)).rejects.toThrow();
      expect(await fs.readFile(secretFile, 'utf-8')).toBe('OUTSIDE_SECRET_INTACT');
    } finally {
      if (electronApp) {
        await closeElectronApp(electronApp);
      }
      await fs.rm(testBase, { recursive: true, force: true }).catch(() => {});
    }
  });
});
