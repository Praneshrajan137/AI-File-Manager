import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemPaths } from '@renderer/contexts/SystemPathsContext';
import { useFileSystem } from '@renderer/hooks/useFileSystem';
import { useNavigation } from '@renderer/hooks/useNavigation';
import { useToast } from '@renderer/hooks/useToast';
import { useFileWatcher } from '@renderer/hooks/useFileWatcher';
import { useLLM } from '@renderer/hooks/useLLM';
import { useWorkspaceVault } from '@renderer/hooks/useWorkspaceVault';
import { usePreviewDrawer } from '@renderer/hooks/usePreviewDrawer';
import { useExplorerActions } from '@renderer/hooks/useExplorerActions';
import { useSpatialLens } from '@renderer/hooks/useSpatialLens';
import { useWorkspaceShortcuts } from '@renderer/hooks/useWorkspaceShortcuts';
import { UI_CONSTANTS } from '@renderer/utils/constants';
import { toFileNodeStub } from '@renderer/utils/explorerHelpers';
import {
  extractBasename,
  extractParentDirectory,
  isPathInsideDirectory,
  normalizeComparablePath,
} from '@renderer/utils/pathHelpers';
import { getErrorMessage } from '@renderer/utils/formatters';
import type { ContextMenuState } from '@renderer/components/WorkspaceDialogs';
import type { FileEvent, FileNode, OrganizePlanResult, OrganizeStrategy } from '@shared/contracts';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useWorkspaceController() {
  const { paths, loading: pathsLoading } = useSystemPaths();
  const { toasts, showToast, removeToast } = useToast();
  const {
    files,
    currentPath,
    loading,
    error,
    searchQuery,
    readDirectory,
    deleteFile,
    setSearchResults,
    clearSearch,
    getLatestFiles,
  } = useFileSystem({
    onError: (msg): void => showToast({ type: 'error', message: msg }),
  });

  const { canGoBack, canGoForward, goBack, goForward, navigateTo } = useNavigation();
  const [sidebarWidth, setSidebarWidth] = useState<number>(UI_CONSTANTS.SIDEBAR_DEFAULT_WIDTH);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState<boolean>(false);
  const [omnibarOpen, setOmnibarOpen] = useState<boolean>(false);
  const [organizeTargetDir, setOrganizeTargetDir] = useState<string | null>(null);
  const [organizeInitialStrategy, setOrganizeInitialStrategy] = useState<OrganizeStrategy>('auto');
  const [organizeInitialPlan, setOrganizeInitialPlan] = useState<OrganizePlanResult | null>(null);
  const [renameFile, setRenameFile] = useState<FileNode | null>(null);
  const [createEntryMode, setCreateEntryMode] = useState<'file' | 'directory' | null>(null);
  const [pendingDeletePaths, setPendingDeletePaths] = useState<string[] | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const llmState = useLLM({ isActive: chatOpen, deferWarmupMs: 350 });
  const preview = usePreviewDrawer();

  const handleNavigate = useCallback(
    async (targetPath: string): Promise<void> => {
      const ok = await readDirectory(targetPath);
      if (ok) {
        await navigateTo(targetPath);
      }
    },
    [navigateTo, readDirectory]
  );

  const vault = useWorkspaceVault({
    currentPath,
    onNavigate: handleNavigate,
    onIndexRootEnabled: async (rootPath): Promise<void> => {
      await llmState.startIndexing(rootPath);
    },
    showToast,
  });

  const explorer = useExplorerActions({
    files,
    currentPath,
    sortBy: vault.sortBy,
    sortDirection: vault.sortDirection,
    splitPaneOpen: vault.splitPaneOpen,
    readDirectory,
    deleteFile,
    refreshWorkspaceMetadata: vault.refreshWorkspaceMetadata,
    showToast,
  });

  const spatial = useSpatialLens(vault.explorerLens, currentPath);
  const initializedRef = useRef<boolean>(false);

  useEffect(() => {
    if (pathsLoading || initializedRef.current) return;
    initializedRef.current = true;

    const initApp = async (): Promise<void> => {
      try {
        const initialVault = await vault.refreshWorkspaceMetadata();
        const initialDir = initialVault?.allowedRoots?.[0] || paths?.home || paths?.documents;
        if (initialDir) {
          await handleNavigate(initialDir);
        }
      } catch (err: unknown) {
        showToast({ type: 'error', message: getErrorMessage(err, 'Failed to initialize workspace') });
      }
    };
    void initApp();
  }, [handleNavigate, paths, pathsLoading, showToast, vault]);

  const handleFileWatcherEvent = useCallback(
    (event: FileEvent): void => {
      vault.setLastWatcherEvent(event);
      preview.syncPreviewWatcherEvent(event.path, event.type);

      if (currentPath && isPathInsideDirectory(event.path, currentPath)) {
        void readDirectory(currentPath);
        void vault.refreshWorkspaceMetadata();
        showToast({
          type: 'info',
          message: `File ${event.type}: ${extractBasename(event.path)}`,
          duration: 2000,
        });
      }
      if (
        vault.splitPaneOpen &&
        explorer.secondaryPath &&
        isPathInsideDirectory(event.path, explorer.secondaryPath)
      ) {
        void explorer.loadSecondaryDirectory(explorer.secondaryPath);
      }
    },
    [currentPath, explorer, preview, readDirectory, showToast, vault]
  );

  useFileWatcher(handleFileWatcherEvent);

  const handleToggleSplitPane = useCallback((): void => {
    const next = !vault.splitPaneOpen;
    vault.setSplitPaneOpen(next);
    if (next) {
      const initialSecondary = currentPath || vault.vaultConfig?.allowedRoots?.[0] || '';
      if (initialSecondary) {
        void explorer.loadSecondaryDirectory(initialSecondary);
      }
    } else {
      explorer.stopSecondaryWatch();
    }
  }, [currentPath, explorer, vault]);

  const handleBack = useCallback(async (): Promise<void> => {
    const prevPath = await goBack();
    if (prevPath) await readDirectory(prevPath);
  }, [goBack, readDirectory]);

  const handleForward = useCallback(async (): Promise<void> => {
    const nextPath = await goForward();
    if (nextPath) await readDirectory(nextPath);
  }, [goForward, readDirectory]);

  const handleSearch = useCallback(
    async (query: string): Promise<void> => {
      if (!query.trim()) {
        if (currentPath) await readDirectory(currentPath);
        return;
      }
      const results = await window.electronAPI.search.query(query, currentPath);
      setSearchResults(results, query);
    },
    [currentPath, readDirectory, setSearchResults]
  );

  const handleSearchSelect = useCallback(
    async (selectedPath: string): Promise<void> => {
      try {
        const stats = await window.electronAPI.fs.getStats(selectedPath);
        if (stats.isDirectory) {
          await handleNavigate(selectedPath);
          return;
        }
        const parentDir = extractParentDirectory(selectedPath);
        if (parentDir && normalizeComparablePath(parentDir) !== normalizeComparablePath(currentPath)) {
          await handleNavigate(parentDir);
        }
        explorer.setSelectedFiles([selectedPath]);
        const latestFiles = getLatestFiles();
        await preview.loadFilePreview(toFileNodeStub(selectedPath, latestFiles));
      } catch {
        await handleNavigate(selectedPath);
      }
    },
    [currentPath, explorer, getLatestFiles, handleNavigate, preview]
  );

  const handleFileDoubleClick = useCallback(
    async (file: FileNode): Promise<void> => {
      if (file.isDirectory) {
        await handleNavigate(file.path);
        return;
      }
      try {
        const res = await window.electronAPI.shell.openPath(file.path);
        if (!res.success && res.error) {
          showToast({ type: 'error', message: res.error });
        }
      } catch (err: unknown) {
        showToast({ type: 'error', message: getErrorMessage(err, 'Failed to open file') });
      }
    },
    [handleNavigate, showToast]
  );

  const handleOpenOrganizeModal = useCallback(
    (
      targetDir: string,
      strategy: OrganizeStrategy = 'auto',
      initialPlan: OrganizePlanResult | null = null
    ): void => {
      setOrganizeInitialStrategy(strategy);
      setOrganizeInitialPlan(initialPlan);
      setOrganizeTargetDir(targetDir);
    },
    []
  );

  useWorkspaceShortcuts({
    hasModalOpen:
      omnibarOpen ||
      organizeTargetDir !== null ||
      diagnosticsOpen ||
      renameFile !== null ||
      createEntryMode !== null ||
      pendingDeletePaths !== null,
    currentPath,
    files,
    selectedFiles: explorer.selectedFiles,
    onToggleOmnibar: (): void => setOmnibarOpen((prev) => !prev),
    onToggleChat: (): void => setChatOpen((prev) => !prev),
    onBack: handleBack,
    onForward: handleForward,
    onToggleQuickLook: (): void => preview.toggleQuickLook(explorer.selectedFiles, files),
    onToggleSplitPane: handleToggleSplitPane,
    onRefresh: (): void => {
      if (currentPath) void explorer.refreshActiveDirectories(currentPath);
    },
    onRequestRename: setRenameFile,
    onRequestDelete: setPendingDeletePaths,
    onSelectAll: explorer.handleSelectAll,
    onCreateFile: (): void => setCreateEntryMode('file'),
    onCreateDirectory: (): void => setCreateEntryMode('directory'),
    onUndo: explorer.handleUndo,
    onRedo: explorer.handleRedo,
  });

  const handleOpenCitation = useCallback(
    async (filePath: string, startLine?: number, endLine?: number): Promise<void> => {
      await preview.openCitation(filePath, startLine ?? 1, endLine ?? startLine ?? 1);
    },
    [preview]
  );

  const canPreviewSelected =
    explorer.selectedFiles.length === 1 &&
    Boolean(files.find((f) => f.path === explorer.selectedFiles[0] && !f.isDirectory));

  const favoriteSet = useMemo(
    () => new Set((vault.vaultConfig?.favorites ?? []).map(normalizeComparablePath)),
    [vault.vaultConfig?.favorites]
  );

  return {
    files,
    currentPath,
    loading,
    error,
    searchQuery,
    clearSearch,
    readDirectory,
    canGoBack,
    canGoForward,
    handleBack,
    handleForward,
    handleNavigate,
    handleSearch,
    handleSearchSelect,
    handleFileDoubleClick,
    handleOpenCitation,
    handleToggleSplitPane,
    handleOpenOrganizeModal,
    canPreviewSelected,
    favoriteSet,
    sidebarWidth,
    setSidebarWidth,
    chatOpen,
    setChatOpen,
    diagnosticsOpen,
    setDiagnosticsOpen,
    omnibarOpen,
    setOmnibarOpen,
    organizeTargetDir,
    setOrganizeTargetDir,
    organizeInitialStrategy,
    organizeInitialPlan,
    setOrganizeInitialPlan,
    renameFile,
    setRenameFile,
    createEntryMode,
    setCreateEntryMode,
    pendingDeletePaths,
    setPendingDeletePaths,
    contextMenu,
    setContextMenu,
    vault,
    explorer,
    spatial,
    preview,
    llmState,
    toasts,
    showToast,
    removeToast,
  };
}
