import { ipcMain, dialog, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { UIPreferencesSnapshot, VaultConfigSnapshot } from '@shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';
import { ConfigManager, DEFAULT_EXCLUDED_DIRS } from '@shared/config';
import { IPCLogger } from '@shared/logging';
import { ErrorFactory } from '@shared/errors';
import {
  dedupeNormalizedPaths,
  normalizeCanonicalKeySync,
} from '@main/platform/pathNormalize';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import {
  withContract,
  resolveAllowedRoots,
  validateCanonicalPathOrThrow,
} from './securityMiddleware';
import { getReactiveWorkspaceKernel } from '../services/ReactiveWorkspaceKernel';

function normalizeCompare(targetPath: string): string {
  return normalizeCanonicalKeySync(targetPath);
}

function dedupePaths(pathsList: string[]): string[] {
  return dedupeNormalizedPaths(pathsList);
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
    ui: config.ui
      ? {
          ...config.ui,
          onboardingCompleted:
            process.env.E2E_TEST === 'true' && process.env.PV_E2E_ONBOARDING !== 'true'
              ? true
              : config.ui.onboardingCompleted,
        }
      : {
          theme: 'light',
          explorerLens: 'files',
          viewMode: 'list',
          splitPaneOpen: false,
          onboardingCompleted: process.env.E2E_TEST === 'true',
          developerBadges: false,
        },
  };
}

function syncKernelAllowedRoots(roots: string[]): void {
  // Ensure kernel/search/journal subscribers are attached before broadcasting root change
  getReactiveWorkspaceKernel();
  VaultRootAuthority.getInstance().applyAllowedRoots(roots);
}

async function handleGetVaultConfig(_event: IpcMainInvokeEvent): Promise<VaultConfigSnapshot> {
  return buildVaultSnapshot();
}

async function handleAddVaultRoot(
  _event: IpcMainInvokeEvent,
  input: { pickDialog?: boolean; path?: string }
): Promise<{ cancelled: boolean; addedPath?: string; config: VaultConfigSnapshot }> {
  const allowProgrammaticRootAdd =
    process.env.E2E_TEST === 'true' || process.env.NODE_ENV === 'test';
  let targetPath = input.path?.trim();

  if (!allowProgrammaticRootAdd && (input.pickDialog === false || targetPath)) {
    throw ErrorFactory.createFileSystemError(
      'UNAUTHORIZED_ACCESS',
      targetPath || '',
      'addVaultRoot',
      {
        details: 'Adding workspace vault roots requires native OS folder picker confirmation',
      }
    );
  }

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

  const current = buildVaultSnapshot();
  const rootValidation = await VaultRootAuthority.getInstance().validateNewRoot(
    targetPath,
    current.allowedRoots
  );
  if (!rootValidation.valid || !rootValidation.canonicalPath) {
    const code =
      rootValidation.error === 'PATH_TRAVERSAL'
        ? 'PATH_TRAVERSAL'
        : rootValidation.error === 'UNAUTHORIZED_ACCESS'
          ? 'UNAUTHORIZED_ACCESS'
          : 'INVALID_PATH';
    throw ErrorFactory.createFileSystemError(code, targetPath, 'addVaultRoot', {
      details: rootValidation.details || 'Invalid workspace root path',
    });
  }

  const canonicalRoot = rootValidation.canonicalPath;
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
  if (!input.enabled) {
    void getReactiveWorkspaceKernel().unwatchIndexedRoot(canonicalTarget).catch(() => undefined);
  }
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

async function handleSetUiPrefs(
  _event: IpcMainInvokeEvent,
  input: Partial<UIPreferencesSnapshot>
): Promise<UIPreferencesSnapshot> {
  const cm = ConfigManager.getInstance();
  const currentUi = cm.getAll().ui ?? {
    theme: 'light',
    explorerLens: 'files',
    viewMode: 'list',
    splitPaneOpen: false,
    onboardingCompleted: false,
    developerBadges: false,
  };
  const nextUi: UIPreferencesSnapshot = {
    theme: input.theme ?? currentUi.theme,
    explorerLens: input.explorerLens ?? currentUi.explorerLens,
    viewMode: input.viewMode ?? currentUi.viewMode,
    splitPaneOpen: input.splitPaneOpen ?? currentUi.splitPaneOpen,
    onboardingCompleted: input.onboardingCompleted ?? currentUi.onboardingCompleted ?? false,
    developerBadges: input.developerBadges ?? currentUi.developerBadges ?? false,
  };
  cm.set('ui', nextUi, true);
  return nextUi;
}

async function handleSetDefaultDeleteMode(
  _event: IpcMainInvokeEvent,
  input: { mode: 'vault' | 'trash' }
): Promise<VaultConfigSnapshot> {
  ConfigManager.getInstance().set('fileSystem.defaultDeleteMode', input.mode, true);
  return buildVaultSnapshot();
}

const VAULT_CHANNELS: IPCChannel[] = [
  'VAULT:GET_CONFIG',
  'VAULT:ADD_ROOT',
  'VAULT:REMOVE_ROOT',
  'VAULT:SET_INDEXED',
  'VAULT:TOGGLE_FAVORITE',
  'VAULT:SET_UI_PREFS',
  'VAULT:SET_DEFAULT_DELETE_MODE',
];

export function registerVaultHandlers(): IPCChannel[] {
  IPCLogger.info('Registering vault IPC handlers');
  ipcMain.handle('VAULT:GET_CONFIG', withContract('VAULT:GET_CONFIG', handleGetVaultConfig));
  ipcMain.handle('VAULT:ADD_ROOT', withContract('VAULT:ADD_ROOT', handleAddVaultRoot));
  ipcMain.handle('VAULT:REMOVE_ROOT', withContract('VAULT:REMOVE_ROOT', handleRemoveVaultRoot));
  ipcMain.handle('VAULT:SET_INDEXED', withContract('VAULT:SET_INDEXED', handleSetVaultIndexed));
  ipcMain.handle('VAULT:TOGGLE_FAVORITE', withContract('VAULT:TOGGLE_FAVORITE', handleToggleFavorite));
  ipcMain.handle('VAULT:SET_UI_PREFS', withContract('VAULT:SET_UI_PREFS', handleSetUiPrefs));
  ipcMain.handle(
    'VAULT:SET_DEFAULT_DELETE_MODE',
    withContract('VAULT:SET_DEFAULT_DELETE_MODE', handleSetDefaultDeleteMode)
  );
  return [...VAULT_CHANNELS];
}
