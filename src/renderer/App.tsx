import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { FilePreviewDrawer } from './components/Preview/FilePreviewDrawer';
import { ChatInterface } from './components/ChatPanel/ChatInterface';
import { WorkspaceLensBar } from './components/Spatial/WorkspaceLensBar';
import { SpatialWorkspacePane } from './components/Spatial/SpatialWorkspacePane';
import { WorkspaceDialogs, ContextMenuState } from './components/WorkspaceDialogs';
import { useFileSystem } from './hooks/useFileSystem';
import { useNavigation } from './hooks/useNavigation';
import { useToast } from './hooks/useToast';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useLLM } from './hooks/useLLM';
import { useWorkspaceVault } from './hooks/useWorkspaceVault';
import { usePreviewDrawer } from './hooks/usePreviewDrawer';
import { useExplorerActions } from './hooks/useExplorerActions';
import { useSpatialLens } from './hooks/useSpatialLens';
import { useWorkspaceShortcuts } from './hooks/useWorkspaceShortcuts';
import { UI_CONSTANTS } from './utils/constants';
import { toFileNodeStub } from './utils/explorerHelpers';
import {
  extractBasename,
  extractParentDirectory,
  isPathInsideDirectory,
  normalizeComparablePath,
} from './utils/pathHelpers';
import { getErrorMessage } from './utils/formatters';
import { FileEvent, FileNode, OrganizePlanResult, OrganizeStrategy } from '@shared/contracts';

export const App: React.FC = () => {
  const { toasts, showToast, removeToast } = useToast();
  const {
    files,
    currentPath,
    loading,
    error,
    readDirectory,
    deleteFile,
    setSearchResults,
  } = useFileSystem({
    onError: (msg): void => showToast({ type: 'error', message: msg }),
  });

  const { canGoBack, canGoForward, goBack, goForward, navigateTo } = useNavigation();
  const llmState = useLLM();

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
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initApp = async (): Promise<void> => {
      try {
        const [systemPaths, initialVault] = await Promise.all([
          window.electronAPI.fs.getSystemPaths(),
          vault.refreshWorkspaceMetadata(),
        ]);
        const initialDir =
          initialVault?.allowedRoots?.[0] || systemPaths.home || systemPaths.documents;
        if (initialDir) {
          await handleNavigate(initialDir);
        }
      } catch (err: unknown) {
        showToast({ type: 'error', message: getErrorMessage(err, 'Failed to initialize workspace') });
      }
    };
    void initApp();
  }, [handleNavigate, showToast, vault]);

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
        await preview.loadFilePreview(toFileNodeStub(selectedPath, files));
      } catch {
        await handleNavigate(selectedPath);
      }
    },
    [currentPath, explorer, files, handleNavigate, preview]
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
    (targetDir: string, strategy: OrganizeStrategy = 'auto', initialPlan: OrganizePlanResult | null = null): void => {
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

  return (
    <div
      className="flex h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 select-none overflow-hidden"
      data-testid="app-container"
    >
      <Sidebar
        width={sidebarWidth}
        onResize={setSidebarWidth}
        onNavigate={(target): void => { void handleNavigate(target); }}
        vaultConfig={vault.vaultConfig}
        journalState={vault.journalState}
        lastWatcherEvent={vault.lastWatcherEvent}
        onAddVaultRoot={vault.handleAddVaultRoot}
        onRemoveVaultRoot={vault.handleRemoveVaultRoot}
        onToggleIndexedRoot={vault.handleToggleIndexedRoot}
        onToggleFavorite={vault.handleToggleFavorite}
        onEmptyTrashVault={vault.handleEmptyTrashVault}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="main-content">
        <Toolbar
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={(): void => { void handleBack(); }}
          onForward={(): void => { void handleForward(); }}
          currentPath={currentPath}
          onNavigate={(p): void => { void handleNavigate(p); }}
          onSearchSelect={(selected): void => { void handleSearchSelect(selected); }}
          onSearch={async (query): Promise<void> => {
            if (!query.trim()) {
              if (currentPath) await readDirectory(currentPath);
              return;
            }
            setSearchResults(await window.electronAPI.search.query(query, currentPath));
          }}
          viewMode={vault.viewMode}
          onViewModeChange={vault.setViewMode}
          sortBy={vault.sortBy}
          onSortChange={vault.setSortBy}
          sortDirection={vault.sortDirection}
          onSortDirectionToggle={vault.toggleSortDirection}
          onNewFile={(): void => setCreateEntryMode('file')}
          onNewFolder={(): void => setCreateEntryMode('directory')}
          canPreviewSelected={canPreviewSelected}
          onPreviewSelected={(): void => preview.toggleQuickLook(explorer.selectedFiles, files)}
          canUndo={vault.journalState?.canUndo ?? false}
          canRedo={vault.journalState?.canRedo ?? false}
          undoDescription={vault.journalState?.lastUndoDescription}
          redoDescription={vault.journalState?.lastRedoDescription}
          onUndo={(): void => { void explorer.handleUndo(); }}
          onRedo={(): void => { void explorer.handleRedo(); }}
          isDarkMode={vault.isDarkMode}
          onToggleTheme={vault.toggleDarkMode}
          splitPaneOpen={vault.splitPaneOpen}
          onToggleSplitPane={handleToggleSplitPane}
          onOpenDiagnostics={(): void => setDiagnosticsOpen(true)}
          onOpenOmnibar={(): void => setOmnibarOpen(true)}
          onOpenOrganize={(): void => {
            if (currentPath) handleOpenOrganizeModal(currentPath, 'auto');
          }}
          chatOpen={chatOpen}
          onToggleChat={(): void => setChatOpen((prev) => !prev)}
        />

        <WorkspaceLensBar
          activeLens={vault.explorerLens}
          onChangeLens={vault.setExplorerLens}
          totalFiles={files.length}
          duplicateClustersCount={spatial.graphInsights?.stats.duplicateClusters.length}
          onRefresh={(): void => { void spatial.refreshSpatialData(); }}
        />

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <SpatialWorkspacePane
            explorerLens={vault.explorerLens}
            files={files}
            currentPath={currentPath}
            loading={loading}
            error={error}
            sortBy={vault.sortBy}
            sortDirection={vault.sortDirection}
            viewMode={vault.viewMode}
            splitPaneOpen={vault.splitPaneOpen}
            explorer={explorer}
            spatial={spatial}
            onFileDoubleClick={handleFileDoubleClick}
            onContextMenu={setContextMenu}
            onToggleSplitPane={handleToggleSplitPane}
            onPreviewFilePath={(filePath): void => {
              void preview.loadFilePreview(toFileNodeStub(filePath, files));
            }}
            onOpenOrganize={(targetDir, strategy): void => handleOpenOrganizeModal(targetDir, strategy)}
            onFocusNodeInChat={(nodePath): void => {
              explorer.setSelectedFiles([nodePath]);
              setChatOpen(true);
            }}
          />

          {preview.previewFileNode && (
            <FilePreviewDrawer
              isOpen={true}
              file={preview.previewFileNode}
              preview={preview.previewResult}
              lineRange={preview.previewLineRange}
              highlightRange={preview.previewHighlightRange}
              fileConnections={preview.fileConnections}
              connectionsLoading={preview.connectionsLoading}
              loading={preview.previewLoading}
              error={preview.previewError}
              onClose={preview.closePreview}
              onRefresh={preview.refreshPreview}
              onOpenExternal={(): void => {
                if (preview.previewFileNode) void handleFileDoubleClick(preview.previewFileNode);
              }}
              onCopyPath={(): void => {
                if (preview.previewFileNode) {
                  void window.electronAPI.clipboard.writeText(preview.previewFileNode.path);
                  showToast({ type: 'success', message: 'Path copied to clipboard' });
                }
              }}
              onClearRangeFocus={preview.clearRangeFocus}
              onOpenCitation={handleOpenCitation}
            />
          )}

          {chatOpen && (
            <div
              className="w-[384px] border-l border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0 overflow-hidden"
              data-testid="chat-panel-container"
            >
              <ChatInterface
                currentPath={currentPath}
                selectedPaths={explorer.selectedFiles}
                llm={llmState}
                onOpenCitation={handleOpenCitation}
                onOpenOrganize={(dir): void => handleOpenOrganizeModal(dir, 'auto')}
                onPreviewOrganizePlan={(plan): void =>
                  handleOpenOrganizeModal(plan.targetDir, plan.strategy, plan)
                }
              />
            </div>
          )}
        </div>
      </div>

      <WorkspaceDialogs
        currentPath={currentPath}
        vault={vault}
        explorer={explorer}
        favoritesSet={favoriteSet}
        normalizePathKey={normalizeComparablePath}
        contextMenu={contextMenu}
        onCloseContextMenu={(): void => setContextMenu(null)}
        renameFile={renameFile}
        onCloseRename={(): void => setRenameFile(null)}
        createEntryMode={createEntryMode}
        onCloseCreateEntry={(): void => setCreateEntryMode(null)}
        pendingDeletePaths={pendingDeletePaths}
        onClosePendingDelete={(): void => setPendingDeletePaths(null)}
        diagnosticsOpen={diagnosticsOpen}
        onCloseDiagnostics={(): void => setDiagnosticsOpen(false)}
        omnibarOpen={omnibarOpen}
        onCloseOmnibar={(): void => setOmnibarOpen(false)}
        organizeTargetDir={organizeTargetDir}
        organizeInitialStrategy={organizeInitialStrategy}
        organizeInitialPlan={organizeInitialPlan}
        onCloseOrganize={(): void => {
          setOrganizeTargetDir(null);
          setOrganizeInitialPlan(null);
        }}
        toasts={toasts}
        onRemoveToast={removeToast}
        showToast={showToast}
        onFileDoubleClick={handleFileDoubleClick}
        onPreviewFile={preview.loadFilePreview}
        onOpenRename={setRenameFile}
        onRequestDelete={setPendingDeletePaths}
        onSearchSelect={handleSearchSelect}
        onOpenCitation={handleOpenCitation}
        onToggleSplitPane={handleToggleSplitPane}
        onToggleChat={(): void => setChatOpen((prev) => !prev)}
        onStartIndexing={llmState.startIndexing}
        onOpenOrganize={(dir): void => handleOpenOrganizeModal(dir, 'auto')}
        onRefreshSpatialData={spatial.refreshSpatialData}
      />
    </div>
  );
};

export default App;
