import React, { Suspense } from 'react';
import { X } from 'lucide-react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { WorkspaceStatusBar } from './components/Toolbar/WorkspaceStatusBar';
import { WorkspaceLensBar } from './components/Spatial/WorkspaceLensBar';
import { SpatialWorkspacePane } from './components/Spatial/SpatialWorkspacePane';
import { WorkspaceDialogs } from './components/WorkspaceDialogs';
import { PreviewDrawerSlot } from './components/PreviewDrawerSlot';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useWorkspaceController } from './hooks/useWorkspaceController';
import { toFileNodeStub } from './utils/explorerHelpers';
import { normalizeComparablePath } from './utils/pathHelpers';

const LazyChatInterface = React.lazy(() =>
  import('./components/ChatPanel/ChatInterface').then((m) => ({ default: m.ChatInterface }))
);

export const WorkspaceShell: React.FC = () => {
  const c = useWorkspaceController();

  return (
    <div
      className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden"
      data-testid="app-container"
    >
      <Sidebar
        width={c.sidebarWidth}
        onResize={c.setSidebarWidth}
        onNavigate={(target): void => {
          void c.handleNavigate(target);
        }}
        vaultConfig={c.vault.vaultConfig}
        journalState={c.vault.journalState}
        lastWatcherEvent={c.vault.lastWatcherEvent}
        onAddVaultRoot={c.vault.handleAddVaultRoot}
        onRemoveVaultRoot={c.vault.handleRemoveVaultRoot}
        onToggleIndexedRoot={c.vault.handleToggleIndexedRoot}
        onToggleFavorite={c.vault.handleToggleFavorite}
        onEmptyTrashVault={c.vault.handleEmptyTrashVault}
      />

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="main-content">
        <Toolbar
          canGoBack={c.canGoBack}
          canGoForward={c.canGoForward}
          onBack={(): void => {
            void c.handleBack();
          }}
          onForward={(): void => {
            void c.handleForward();
          }}
          currentPath={c.currentPath}
          onNavigate={(p): void => {
            void c.handleNavigate(p);
          }}
          onSearchSelect={(selected): void => {
            void c.handleSearchSelect(selected);
          }}
          onSearch={(query): void => {
            void c.handleSearch(query);
          }}
          viewMode={c.vault.viewMode}
          onViewModeChange={c.vault.setViewMode}
          sortBy={c.vault.sortBy}
          onSortChange={c.vault.setSortBy}
          sortDirection={c.vault.sortDirection}
          onSortDirectionToggle={c.vault.toggleSortDirection}
          onNewFile={(): void => c.setCreateEntryMode('file')}
          onNewFolder={(): void => c.setCreateEntryMode('directory')}
          canPreviewSelected={c.canPreviewSelected}
          onPreviewSelected={(): void => c.preview.toggleQuickLook(c.explorer.selectedFiles, c.files)}
          canUndo={c.vault.journalState?.canUndo ?? false}
          canRedo={c.vault.journalState?.canRedo ?? false}
          undoDescription={c.vault.journalState?.lastUndoDescription}
          redoDescription={c.vault.journalState?.lastRedoDescription}
          onUndo={(): void => {
            void c.explorer.handleUndo();
          }}
          onRedo={(): void => {
            void c.explorer.handleRedo();
          }}
          isDarkMode={c.vault.isDarkMode}
          onToggleTheme={c.vault.toggleDarkMode}
          splitPaneOpen={c.vault.splitPaneOpen}
          onToggleSplitPane={c.handleToggleSplitPane}
          onOpenDiagnostics={(): void => c.setDiagnosticsOpen(true)}
          onOpenOmnibar={(): void => c.setOmnibarOpen(true)}
          onOpenOrganize={(): void => {
            if (c.currentPath) c.handleOpenOrganizeModal(c.currentPath, 'auto');
          }}
          chatOpen={c.chatOpen}
          onToggleChat={(): void => c.setChatOpen((prev) => !prev)}
        />

        <WorkspaceLensBar
          activeLens={c.vault.explorerLens}
          onChangeLens={c.vault.setExplorerLens}
          totalFiles={c.files.length}
          duplicateClustersCount={c.spatial.graphInsights?.stats.duplicateClusters.length}
          onRefresh={(): void => {
            void c.spatial.refreshSpatialData();
          }}
        />

        {c.searchQuery && (
          <div
            data-testid="active-search-banner"
            className="px-4 py-1.5 bg-indigo-50 dark:bg-indigo-950/60 border-b border-indigo-200 dark:border-indigo-900 flex items-center justify-between gap-2 text-xs text-accent-700 dark:text-indigo-200"
          >
            <span className="truncate">
              Showing {c.files.length} search match{c.files.length === 1 ? '' : 'es'} for &ldquo;{c.searchQuery}&rdquo;
            </span>
            <button
              type="button"
              onClick={(): void => {
                void c.clearSearch();
              }}
              data-testid="clear-search-banner-button"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-accent-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 flex-shrink-0"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              <span>Clear search</span>
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          <ErrorBoundary title="Workspace View">
            <SpatialWorkspacePane
              explorerLens={c.vault.explorerLens}
              files={c.files}
              currentPath={c.currentPath}
              loading={c.loading}
              error={c.error}
              searchQuery={c.searchQuery ?? undefined}
              onClearSearch={(): void => {
                void c.clearSearch();
              }}
              onRetryDirectory={(): void => {
                if (c.currentPath) void c.readDirectory(c.currentPath);
              }}
              sortBy={c.vault.sortBy}
              sortDirection={c.vault.sortDirection}
              viewMode={c.vault.viewMode}
              splitPaneOpen={c.vault.splitPaneOpen}
              explorer={c.explorer}
              spatial={c.spatial}
              onFileDoubleClick={c.handleFileDoubleClick}
              onContextMenu={c.setContextMenu}
              onToggleSplitPane={c.handleToggleSplitPane}
              onPreviewFilePath={(filePath): void => {
                void c.preview.loadFilePreview(toFileNodeStub(filePath, c.files));
              }}
              onOpenRename={c.setRenameFile}
              onRequestDelete={c.setPendingDeletePaths}
              onOpenOrganize={(targetDir, strategy): void => c.handleOpenOrganizeModal(targetDir, strategy)}
              onFocusNodeInChat={(nodePath): void => {
                c.explorer.setSelectedFiles([nodePath]);
                c.setChatOpen(true);
              }}
              onAskSelectionInChat={(): void => c.setChatOpen(true)}
            />
          </ErrorBoundary>

          <PreviewDrawerSlot
            preview={c.preview}
            orderedFiles={c.explorer.orderedFiles}
            setSelectedFiles={c.explorer.setSelectedFiles}
            onOpenExternal={c.handleFileDoubleClick}
            onOpenCitation={c.handleOpenCitation}
            showToast={c.showToast}
          />

          {c.chatOpen && (
            <div
              className="max-[899px]:absolute max-[899px]:inset-y-0 max-[899px]:right-0 max-[899px]:z-30 w-72 xl:w-[384px] max-w-[92vw] border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0 overflow-hidden max-[899px]:shadow-2xl"
              data-testid="chat-panel-container"
            >
              <ErrorBoundary title="AI Copilot">
                <Suspense
                  fallback={
                    <div role="status" className="h-full flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                      Loading AI Copilot...
                    </div>
                  }
                >
                  <LazyChatInterface
                    currentPath={c.currentPath}
                    selectedPaths={c.explorer.selectedFiles}
                    llm={c.llmState}
                    onOpenCitation={c.handleOpenCitation}
                    onOpenOrganize={(dir): void => c.handleOpenOrganizeModal(dir, 'auto')}
                    onPreviewOrganizePlan={(plan): void =>
                      c.handleOpenOrganizeModal(plan.targetDir, plan.strategy, plan)
                    }
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </div>

        <WorkspaceStatusBar
          files={c.files}
          currentPath={c.currentPath}
          searchQuery={c.searchQuery}
          clipboard={c.explorer.clipboard}
          indexingStatus={c.llmState.indexingStatus}
          onPaste={(): void => {
            if (c.currentPath) void c.explorer.pasteFromClipboard(c.currentPath);
          }}
          onClearClipboard={c.explorer.clearClipboard}
          onOpenChat={(): void => c.setChatOpen(true)}
          onOpenOmnibar={(): void => c.setOmnibarOpen(true)}
        />
      </main>

      <WorkspaceDialogs
        currentPath={c.currentPath}
        vault={c.vault}
        explorer={c.explorer}
        favoritesSet={c.favoriteSet}
        normalizePathKey={normalizeComparablePath}
        contextMenu={c.contextMenu}
        onCloseContextMenu={(): void => c.setContextMenu(null)}
        renameFile={c.renameFile}
        onCloseRename={(): void => c.setRenameFile(null)}
        createEntryMode={c.createEntryMode}
        onCloseCreateEntry={(): void => c.setCreateEntryMode(null)}
        pendingDeletePaths={c.pendingDeletePaths}
        onClosePendingDelete={(): void => c.setPendingDeletePaths(null)}
        diagnosticsOpen={c.diagnosticsOpen}
        onCloseDiagnostics={(): void => c.setDiagnosticsOpen(false)}
        omnibarOpen={c.omnibarOpen}
        onCloseOmnibar={(): void => c.setOmnibarOpen(false)}
        organizeTargetDir={c.organizeTargetDir}
        organizeInitialStrategy={c.organizeInitialStrategy}
        organizeInitialPlan={c.organizeInitialPlan}
        onCloseOrganize={(): void => {
          c.setOrganizeTargetDir(null);
          c.setOrganizeInitialPlan(null);
        }}
        toasts={c.toasts}
        onRemoveToast={c.removeToast}
        showToast={c.showToast}
        onFileDoubleClick={c.handleFileDoubleClick}
        onPreviewFile={c.preview.loadFilePreview}
        onOpenRename={c.setRenameFile}
        onRequestDelete={c.setPendingDeletePaths}
        onSearchSelect={c.handleSearchSelect}
        onOpenCitation={c.handleOpenCitation}
        onToggleSplitPane={c.handleToggleSplitPane}
        onToggleChat={(): void => c.setChatOpen((prev) => !prev)}
        onStartIndexing={c.llmState.startIndexing}
        onOpenOrganize={(dir): void => c.handleOpenOrganizeModal(dir, 'auto')}
        onRefreshSpatialData={c.spatial.refreshSpatialData}
      />
    </div>
  );
};
