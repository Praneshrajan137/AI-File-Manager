import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ExplorerLens,
  FileEvent,
  OperationJournalState,
  SortCriteria,
  SortDirection,
  VaultConfigSnapshot,
} from '@shared/contracts';
import type { ViewMode } from '@renderer/utils/constants';

export interface UseWorkspaceVaultOptions {
  currentPath: string;
  onNavigate?: (targetPath: string) => void | Promise<void>;
  onIndexRootEnabled?: (rootPath: string) => Promise<void>;
  showToast: (toast: {
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

export interface UseWorkspaceVaultReturn {
  vaultConfig: VaultConfigSnapshot | null;
  journalState: OperationJournalState | null;
  lastWatcherEvent: FileEvent | null;
  setLastWatcherEvent: React.Dispatch<React.SetStateAction<FileEvent | null>>;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  explorerLens: ExplorerLens;
  setExplorerLens: (lens: ExplorerLens) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  splitPaneOpen: boolean;
  setSplitPaneOpen: (open: boolean) => void;
  sortBy: SortCriteria;
  setSortBy: (criteria: SortCriteria) => void;
  sortDirection: SortDirection;
  toggleSortDirection: () => void;
  refreshWorkspaceMetadata: () => Promise<VaultConfigSnapshot | null>;
  handleAddVaultRoot: () => Promise<void>;
  handleRemoveVaultRoot: (rootPath: string) => Promise<void>;
  handleToggleIndexedRoot: (rootPath: string, enabled: boolean) => Promise<void>;
  handleToggleFavorite: (targetPath: string) => Promise<void>;
  handleEmptyTrashVault: () => Promise<void>;
}

export function useWorkspaceVault(options: UseWorkspaceVaultOptions): UseWorkspaceVaultReturn {
  const { currentPath, onNavigate, onIndexRootEnabled, showToast } = options;

  const [vaultConfig, setVaultConfig] = useState<VaultConfigSnapshot | null>(null);
  const [journalState, setJournalState] = useState<OperationJournalState | null>(null);
  const [lastWatcherEvent, setLastWatcherEvent] = useState<FileEvent | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [explorerLens, setExplorerLensState] = useState<ExplorerLens>('files');
  const [viewMode, setViewModeState] = useState<ViewMode>('list');
  const [splitPaneOpen, setSplitPaneOpenState] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<SortCriteria>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const uiHydratedRef = useRef<boolean>(false);
  const dirtyUiKeysRef = useRef<{
    theme?: boolean;
    explorerLens?: boolean;
    viewMode?: boolean;
    splitPaneOpen?: boolean;
  }>({});

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', isDarkMode);
    }
  }, [isDarkMode]);

  const refreshWorkspaceMetadata = useCallback(async (): Promise<VaultConfigSnapshot | null> => {
    const [configRes, journalRes] = await Promise.allSettled([
      window.electronAPI?.vault?.getConfig?.() ?? Promise.resolve(null),
      window.electronAPI?.fs?.getJournalState?.() ?? Promise.resolve(null),
    ]);

    let nextConfig: VaultConfigSnapshot | null = null;
    if (configRes.status === 'fulfilled' && configRes.value) {
      nextConfig = configRes.value;
      setVaultConfig(configRes.value);
      const ui = configRes.value.ui;
      if (!uiHydratedRef.current && ui) {
        uiHydratedRef.current = true;
        if (ui.theme && !dirtyUiKeysRef.current.theme) {
          setIsDarkMode(ui.theme === 'dark');
        }
        if (ui.explorerLens && !dirtyUiKeysRef.current.explorerLens) {
          setExplorerLensState(ui.explorerLens);
        }
        if (ui.viewMode && !dirtyUiKeysRef.current.viewMode) {
          setViewModeState(ui.viewMode);
        }
        if (typeof ui.splitPaneOpen === 'boolean' && !dirtyUiKeysRef.current.splitPaneOpen) {
          setSplitPaneOpenState(ui.splitPaneOpen);
        }
      }
    }

    if (journalRes.status === 'fulfilled' && journalRes.value) {
      setJournalState(journalRes.value);
    }

    return nextConfig;
  }, []);

  const persistUiPrefs = useCallback(
    (patch: {
      theme?: 'light' | 'dark';
      explorerLens?: ExplorerLens;
      viewMode?: ViewMode;
      splitPaneOpen?: boolean;
    }): void => {
      void window.electronAPI?.vault?.setUiPrefs?.(patch)?.catch?.(() => undefined);
    },
    []
  );

  const toggleDarkMode = useCallback((): void => {
    dirtyUiKeysRef.current.theme = true;
    setIsDarkMode((prev) => {
      const next = !prev;
      persistUiPrefs({ theme: next ? 'dark' : 'light' });
      return next;
    });
  }, [persistUiPrefs]);

  const setExplorerLens = useCallback(
    (lens: ExplorerLens): void => {
      dirtyUiKeysRef.current.explorerLens = true;
      setExplorerLensState(lens);
      persistUiPrefs({ explorerLens: lens });
    },
    [persistUiPrefs]
  );

  const setViewMode = useCallback(
    (mode: ViewMode): void => {
      dirtyUiKeysRef.current.viewMode = true;
      setViewModeState(mode);
      persistUiPrefs({ viewMode: mode });
    },
    [persistUiPrefs]
  );

  const setSplitPaneOpen = useCallback(
    (open: boolean): void => {
      dirtyUiKeysRef.current.splitPaneOpen = true;
      setSplitPaneOpenState(open);
      persistUiPrefs({ splitPaneOpen: open });
    },
    [persistUiPrefs]
  );

  const toggleSortDirection = useCallback((): void => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  const handleAddVaultRoot = useCallback(async (): Promise<void> => {
    try {
      const res = await window.electronAPI.vault.addRoot({ pickDialog: true });
      if (!res.cancelled) {
        setVaultConfig(res.config);
        showToast({ type: 'success', message: 'Workspace Vault folder added' });
      }
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to add workspace vault folder',
      });
    }
  }, [showToast]);

  const handleRemoveVaultRoot = useCallback(
    async (rootPath: string): Promise<void> => {
      try {
        const res = await window.electronAPI.vault.removeRoot(rootPath);
        setVaultConfig(res);
        showToast({ type: 'info', message: 'Workspace Vault removed' });
        if (currentPath === rootPath && res.allowedRoots.length > 0 && onNavigate) {
          await onNavigate(res.allowedRoots[0]);
        }
      } catch (err: unknown) {
        showToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to remove workspace vault',
        });
      }
    },
    [currentPath, onNavigate, showToast]
  );

  const handleToggleIndexedRoot = useCallback(
    async (rootPath: string, enabled: boolean): Promise<void> => {
      try {
        const res = await window.electronAPI.vault.setIndexed(rootPath, enabled);
        setVaultConfig(res);
        showToast({
          type: 'info',
          message: enabled
            ? 'AI indexing enabled for workspace folder'
            : 'AI indexing paused for workspace folder',
        });
        if (enabled && onIndexRootEnabled) {
          await onIndexRootEnabled(rootPath);
        }
      } catch (err: unknown) {
        showToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to update AI indexing toggle',
        });
      }
    },
    [onIndexRootEnabled, showToast]
  );

  const handleToggleFavorite = useCallback(
    async (targetPath: string): Promise<void> => {
      try {
        const res = await window.electronAPI.vault.toggleFavorite(targetPath);
        setVaultConfig(res);
      } catch (err: unknown) {
        showToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to update favorites',
        });
      }
    },
    [showToast]
  );

  const handleEmptyTrashVault = useCallback(async (): Promise<void> => {
    try {
      const nextState = await window.electronAPI.fs.emptyTrashVault();
      setJournalState(nextState);
      showToast({
        type: 'info',
        message: 'Trash Vault emptied',
      });
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to purge Trash Vault',
      });
    }
  }, [showToast]);

  return {
    vaultConfig,
    journalState,
    lastWatcherEvent,
    setLastWatcherEvent,
    isDarkMode,
    toggleDarkMode,
    explorerLens,
    setExplorerLens,
    viewMode,
    setViewMode,
    splitPaneOpen,
    setSplitPaneOpen,
    sortBy,
    setSortBy,
    sortDirection,
    toggleSortDirection,
    refreshWorkspaceMetadata,
    handleAddVaultRoot,
    handleRemoveVaultRoot,
    handleToggleIndexedRoot,
    handleToggleFavorite,
    handleEmptyTrashVault,
  };
}
