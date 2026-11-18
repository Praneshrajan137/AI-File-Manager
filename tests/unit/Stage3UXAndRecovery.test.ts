import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IpcMainInvokeEvent } from 'electron';

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const mockIpcMain = {
  handle: jest.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    registeredHandlers.set(channel, handler);
  }),
  removeHandler: jest.fn((channel: string) => {
    registeredHandlers.delete(channel);
  }),
};

jest.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: jest.fn(() => os.tmpdir()) },
  shell: {
    openPath: jest.fn(async () => ''),
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(async () => undefined),
  },
  clipboard: { writeText: jest.fn() },
  dialog: { showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] })) },
  BrowserWindow: {
    getFocusedWindow: jest.fn(() => null),
    getAllWindows: jest.fn(() => []),
  },
}));

import { OperationJournal, resetOperationJournal } from '@main/services/OperationJournal';
import { PathValidator } from '@main/services/PathValidator';
import { FileSystemService } from '@main/services/FileSystemService';
import { ConfigManager } from '@shared/config/ConfigManager';
import { resetPathValidator, resetRateLimiter } from '@main/handlers/securityMiddleware';
import {
  registerFileSystemHandlers,
  resetFileSystemService,
} from '@main/handlers/fileSystemHandlers';
import { registerVaultHandlers } from '@main/handlers/vaultHandlers';
import { setLlmModelConfig } from '@main/services/LlmWorkspaceService';

interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const fakeEvent = {
  sender: {
    id: 77,
    isDestroyed: (): boolean => false,
    send: jest.fn(),
  },
} as unknown as IpcMainInvokeEvent;

async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<Envelope<T>> {
  const fn = registeredHandlers.get(channel);
  if (!fn) {
    throw new Error(`Handler not registered: ${channel}`);
  }
  return (await fn(fakeEvent, payload)) as Envelope<T>;
}

describe('Stage 3 UX, Trash Vault Recovery, & Security Policy Verification', () => {
  let sandboxDir: string;
  let workspaceRoot: string;
  let vaultDir: string;
  let configPath: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    registeredHandlers.clear();
    mockIpcMain.handle.mockClear();
    resetRateLimiter();

    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage3-ux-test-'));
    workspaceRoot = path.join(sandboxDir, 'workspace');
    vaultDir = path.join(sandboxDir, 'trash-vault');
    configPath = path.join(sandboxDir, 'config.json');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(vaultDir, { recursive: true });

    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.E2E_TEST;

    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [workspaceRoot], true);
    resetPathValidator();
    resetFileSystemService();
  });

  afterEach(async () => {
    resetOperationJournal();
    resetFileSystemService();
    ConfigManager.resetForTesting();
    process.env = { ...originalEnv };
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  });

  it('lists, individually restores, detects collisions, and purges standalone + batch-deleted Trash Vault items', async () => {
    const validator = new PathValidator([workspaceRoot]);
    const fsService = new FileSystemService([workspaceRoot]);
    const journal = new OperationJournal({
      vaultDir,
      validator,
      fileSystemService: fsService,
    });

    const soloFile = path.join(workspaceRoot, 'solo.md');
    const batchA = path.join(workspaceRoot, 'batch-a.txt');
    const batchB = path.join(workspaceRoot, 'batch-b.txt');
    await fs.writeFile(soloFile, '# Solo content', 'utf-8');
    await fs.writeFile(batchA, 'Batch A payload', 'utf-8');
    await fs.writeFile(batchB, 'Batch B payload', 'utf-8');

    await journal.delete(soloFile, false, 'vault');
    await journal.executeBatch('Batch delete pair', [
      { type: 'delete', path: batchA, recursive: false, mode: 'vault' },
      { type: 'delete', path: batchB, recursive: false, mode: 'vault' },
    ]);

    const items = await journal.listVaultItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.name).sort()).toEqual(['batch-a.txt', 'batch-b.txt', 'solo.md']);

    const soloEntry = items.find((i) => i.name === 'solo.md')!;
    const batchAEntry = items.find((i) => i.name === 'batch-a.txt')!;
    const batchBEntry = items.find((i) => i.name === 'batch-b.txt')!;

    // Collision guard must prevent silently overwriting a recreated file
    await fs.writeFile(soloFile, 'newer file', 'utf-8');
    await expect(journal.restoreVaultItem(soloEntry.id)).rejects.toThrow(/already exists/i);
    await fs.rm(soloFile);

    // Individual restore of solo item and batch child B
    const restoredSolo = await journal.restoreVaultItem(soloEntry.id);
    expect(restoredSolo.success).toBe(true);
    expect(await fs.readFile(soloFile, 'utf-8')).toBe('# Solo content');

    const restoredB = await journal.restoreVaultItem(batchBEntry.id);
    expect(restoredB.success).toBe(true);
    expect(await fs.readFile(batchB, 'utf-8')).toBe('Batch B payload');

    // Individual purge of remaining batch child A
    const purgedState = await journal.purgeVaultItem(batchAEntry.id);
    expect(purgedState.vaultItemCount).toBe(0);
    await expect(fs.stat(batchA)).rejects.toThrow();

    const remaining = await journal.listVaultItems();
    expect(remaining).toHaveLength(0);
    expect((await journal.getState()).vaultItemCount).toBe(0);
  });

  it('registers Trash Vault Recovery and UI/Delete preference IPC handlers and enforces loopback-only Ollama URLs', async () => {
    const fsChannels = registerFileSystemHandlers();
    const vaultChannels = registerVaultHandlers();

    expect(fsChannels).toEqual(
      expect.arrayContaining(['FS:LIST_TRASH_VAULT', 'FS:RESTORE_TRASH_ITEM', 'FS:PURGE_TRASH_ITEM'])
    );
    expect(vaultChannels).toContain('VAULT:SET_DEFAULT_DELETE_MODE');

    // Non-loopback URL must be rejected before persisting config
    await expect(
      setLlmModelConfig(fakeEvent, { ollamaUrl: 'https://remote-llm.example.com:11434' })
    ).rejects.toThrow(/Non-local LLM URL rejected for privacy/i);

    // Default delete mode IPC persists and reads back in snapshot
    const delModeRes = await invoke<{ defaultDeleteMode: string }>('VAULT:SET_DEFAULT_DELETE_MODE', {
      mode: 'trash',
    });
    expect(delModeRes).toMatchObject({ ok: true, data: { defaultDeleteMode: 'trash' } });

    const uiRes = await invoke<{
      onboardingCompleted?: boolean;
      developerBadges?: boolean;
    }>('VAULT:SET_UI_PREFS', {
      onboardingCompleted: true,
      developerBadges: true,
    });
    expect(uiRes).toMatchObject({
      ok: true,
      data: { onboardingCompleted: true, developerBadges: true },
    });

    // Empty initial Trash Vault IPC check & file soft-delete + IPC restore flow
    const tempFile = path.join(workspaceRoot, 'recoverable.txt');
    await fs.writeFile(tempFile, 'ipc recovery body', 'utf-8');
    const delRes = await invoke<{ success: boolean }>('FS:DELETE', {
      path: tempFile,
      recursive: false,
      mode: 'vault',
    });
    expect(delRes.ok).toBe(true);

    const listed = await invoke<Array<{ id: string; name: string }>>('FS:LIST_TRASH_VAULT');
    expect(listed.ok).toBe(true);
    const target = listed.data?.find((e) => e.name === 'recoverable.txt');
    expect(target).toBeDefined();

    const restored = await invoke<{ success: boolean; state: { vaultItemCount: number } }>(
      'FS:RESTORE_TRASH_ITEM',
      { id: target!.id }
    );
    expect(restored).toMatchObject({
      ok: true,
      data: { success: true, state: { vaultItemCount: 0 } },
    });
    expect(await fs.readFile(tempFile, 'utf-8')).toBe('ipc recovery body');

    const emptyAfterRestore = await invoke<unknown[]>('FS:LIST_TRASH_VAULT');
    expect(emptyAfterRestore).toMatchObject({ ok: true, data: [] });
  });
});
