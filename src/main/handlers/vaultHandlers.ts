import { ipcMain, dialog, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { VaultConfigSnapshot } from '@shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';
import { ConfigManager, DEFAULT_EXCLUDED_DIRS } from '@shared/config';
import { IPCLogger } from '@shared/logging';
import { ErrorFactory } from '@shared/errors';
import {
  withContract,
  resolveAllowedRoots,
  resetPathValidator,
  validateCanonicalPathOrThrow,
} from './securityMiddleware';
import { getReactiveWorkspaceKernel } from '../services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '../services/RuntimeDiagnostics';
import { resetSearchService } from './searchHandlers';
import { resetOperationJournal } from '../services/OperationJournal';

function normalizeCompare(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function dedupePaths(pathsList: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of pathsList) {
    const cleaned = entry?.trim();
    if (!cleaned) continue;
    const resolved = path.resolve(cleaned);
    const key = normalizeCompare(resolved);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }
  return result;
}

export function buildVaultSnapshot(): VaultConfigSnapshot {
  const config = ConfigManager.getInstance().getAll();
  const fsConfig = config.fileSystem;
  const allowedRoots =
    Array.isArray(fsConfig.allowedRoots) && fsConfig.allowedRoots.length > 0
      ? dedupePaths(fsConfig.allowedRoots)
      : dedupePaths(resolveAllowedRoots());

  const indexedRoots = Array.isArray(fsConfig.indexedRoots)
    ? dedupePaths(fsConfig.indexedRoots)
    : [];
  const excludedDirs =
    Array.isArray(fsConfig.excludedDirs) && fsConfig.excludedDirs.length > 0
      ? [...fsConfig.excludedDirs]
      : [...DEFAULT_EXCLUDED_DIRS];
  const favorites = Array.isArray(fsConfig.favorites)
    ? dedupePaths(fsConfig.favorites)
    : [];

  return {
    allowedRoots,
    indexedRoots,
    excludedDirs,
    favorites,
    defaultDeleteMode: fsConfig.defaultDeleteMode === 'trash' ? 'trash' : 'vault',
  };
}

function syncKernelAllowedRoots(roots: string[]): void {
  resetPathValidator();
  const kernel = getReactiveWorkspaceKernel();
  kernel.getFileSystemService().updateAllowedRoots(roots);
  RuntimeDiagnostics.getInstance().setAllowedRoots(roots);
  resetSearchService();
  resetOperationJournal();
}

async function handleGetVaultConfig(_event: IpcMainInvokeEvent): Promise<VaultConfigSnapshot> {
  return buildVaultSnapshot();
}

async function handleAddVaultRoot(
  _event: IpcMainInvokeEvent,
  input: { pickDialog?: boolean; path?: string }
): Promise<{ cancelled: boolean; addedPath?: string; config: VaultConfigSnapshot }> {
  let targetPath = input.path?.trim();

  if (!targetPath && input.pickDialog !== false) {
    const parentWin =
      typeof BrowserWindow?.getFocusedWindow === 'function'
        ? BrowserWindow.getFocusedWindow()
        : null;
    const dialogOpts = {
      properties: ['openDirectory'] as ('openDirectory')[],
      title: 'Select Workspace Vault Folder',
    };
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true, config: buildVaultSnapshot() };
    }
    targetPath = result.filePaths[0];
  }

  if (!targetPath) {
    throw ErrorFactory.createValidationError(
      'INVALID_INPUT',
      'path',
      input.path,
      'Folder path is required when pickDialog is false'
    );
  }

  const resolvedPath = path.resolve(targetPath);
  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (err) {
    throw ErrorFactory.fromFsError(err, resolvedPath);
  }
  if (!stats.isDirectory()) {
    throw ErrorFactory.createValidationError(
      'INVALID_INPUT',
      'path',
      resolvedPath,
      'Vault root must be an existing directory'
    );
  }

  const canonicalRoot = await fs.realpath(resolvedPath);
  const current = buildVaultSnapshot();
  const nextRoots = dedupePaths([...current.allowedRoots, canonicalRoot]);

  ConfigManager.getInstance().set('fileSystem.allowedRoots', nextRoots, true);
  syncKernelAllowedRoots(nextRoots);

  IPCLogger.info('Added workspace vault root', { addedPath: canonicalRoot, rootCount: nextRoots.length });
  return {
    cancelled: false,
    addedPath: canonicalRoot,
    config: buildVaultSnapshot(),
  };
}

async function handleRemoveVaultRoot(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<VaultConfigSnapshot> {
  const current = buildVaultSnapshot();
  const targetKey = normalizeCompare(input.path);
  const nextRoots = current.allowedRoots.filter((root) => normalizeCompare(root) !== targetKey);

  if (nextRoots.length === 0) {
    throw ErrorFactory.createValidationError(
      'INVALID_INPUT',
      'path',
      input.path,
      'At least one workspace root folder must remain'
    );
  }

  if (nextRoots.length === current.allowedRoots.length) {
    return current;
  }

  const targetPrefix = targetKey.endsWith(path.sep) ? targetKey : `${targetKey}${path.sep}`;
  const isInsideRemoved = (candidate: string): boolean => {
    const key = normalizeCompare(candidate);
    return key === targetKey || key.startsWith(targetPrefix);
  };

  const nextIndexed = current.indexedRoots.filter((entry) => !isInsideRemoved(entry));
  const nextFavorites = current.favorites.filter((entry) => !isInsideRemoved(entry));

  const cm = ConfigManager.getInstance();
  cm.set('fileSystem.allowedRoots', nextRoots, false);
  cm.set('fileSystem.indexedRoots', nextIndexed, false);
  cm.set('fileSystem.favorites', nextFavorites, true);
  syncKernelAllowedRoots(nextRoots);

  IPCLogger.info('Removed workspace vault root', { removedPath: input.path, rootCount: nextRoots.length });
  return buildVaultSnapshot();
}

async function handleSetVaultIndexed(
  _event: IpcMainInvokeEvent,
  input: { path: string; enabled: boolean }
): Promise<VaultConfigSnapshot> {
  const canonicalTarget = await validateCanonicalPathOrThrow(input.path);
  const current = buildVaultSnapshot();
  const targetKey = normalizeCompare(canonicalTarget);

  const filtered = current.indexedRoots.filter((entry) => normalizeCompare(entry) !== targetKey);
  const nextIndexed = input.enabled ? dedupePaths([...filtered, canonicalTarget]) : filtered;

  ConfigManager.getInstance().set('fileSystem.indexedRoots', nextIndexed, true);
  IPCLogger.info('Updated AI opt-in indexed root', {
    path: canonicalTarget,
    enabled: input.enabled,
    indexedCount: nextIndexed.length,
  });

  return buildVaultSnapshot();
}

async function handleToggleFavorite(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<VaultConfigSnapshot> {
  const canonicalTarget = await validateCanonicalPathOrThrow(input.path);
  const current = buildVaultSnapshot();
  const targetKey = normalizeCompare(canonicalTarget);

  const exists = current.favorites.some((entry) => normalizeCompare(entry) === targetKey);
  const nextFavorites = exists
    ? current.favorites.filter((entry) => normalizeCompare(entry) !== targetKey)
    : dedupePaths([...current.favorites, canonicalTarget]);

  ConfigManager.getInstance().set('fileSystem.favorites', nextFavorites, true);
  return buildVaultSnapshot();
}

const VAULT_CHANNELS: IPCChannel[] = [
  'VAULT:GET_CONFIG',
  'VAULT:ADD_ROOT',
  'VAULT:REMOVE_ROOT',
  'VAULT:SET_INDEXED',
  'VAULT:TOGGLE_FAVORITE',
];

export function registerVaultHandlers(): IPCChannel[] {
  IPCLogger.info('Registering vault IPC handlers');
  ipcMain.handle('VAULT:GET_CONFIG', withContract('VAULT:GET_CONFIG', handleGetVaultConfig));
  ipcMain.handle('VAULT:ADD_ROOT', withContract('VAULT:ADD_ROOT', handleAddVaultRoot));
  ipcMain.handle('VAULT:REMOVE_ROOT', withContract('VAULT:REMOVE_ROOT', handleRemoveVaultRoot));
  ipcMain.handle('VAULT:SET_INDEXED', withContract('VAULT:SET_INDEXED', handleSetVaultIndexed));
  ipcMain.handle('VAULT:TOGGLE_FAVORITE', withContract('VAULT:TOGGLE_FAVORITE', handleToggleFavorite));
  return [...VAULT_CHANNELS];
}
