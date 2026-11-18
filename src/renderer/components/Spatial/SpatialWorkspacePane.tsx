import React, { Suspense } from 'react';
import { RefreshCw } from 'lucide-react';
import { FileGrid } from '../FileExplorer/FileGrid';
import { SelectionActionBar } from '../FileExplorer/SelectionActionBar';
import { SpatialLensesView } from './SpatialLensesView';
import type { UseExplorerActionsReturn } from '@renderer/hooks/useExplorerActions';
import type { UseSpatialLensReturn } from '@renderer/hooks/useSpatialLens';
import type { ViewMode } from '@renderer/utils/constants';
import type {
  ExplorerLens,
  FileNode,
  FileSystemError,
  OrganizeStrategy,
  SortCriteria,
  SortDirection,
} from '@shared/contracts';
import type { ContextMenuState } from '../WorkspaceDialogs';

const LazySplitPaneExplorer = React.lazy(() =>
  import('../FileExplorer/SplitPaneExplorer').then((m) => ({ default: m.SplitPaneExplorer }))
);

interface SpatialWorkspacePaneProps {
  explorerLens: ExplorerLens;
  files: FileNode[];
  currentPath: string;
  loading: boolean;
  error: FileSystemError | null;
  searchQuery?: string;
  onClearSearch?: () => void;
  onRetryDirectory?: () => void;
  sortBy: SortCriteria;
  sortDirection: SortDirection;
  viewMode: ViewMode;
  splitPaneOpen: boolean;
  explorer: UseExplorerActionsReturn;
  spatial: UseSpatialLensReturn;
  onFileDoubleClick: (file: FileNode) => Promise<void>;
  onContextMenu: (state: ContextMenuState) => void;
  onToggleSplitPane: () => void;
  onPreviewFilePath: (filePath: string) => void;
  onOpenRename: (file: FileNode) => void;
  onRequestDelete: (paths: string[]) => void;
  onOpenOrganize: (targetDir: string, strategy: OrganizeStrategy) => void;
  onFocusNodeInChat: (nodePath: string) => void;
  onAskSelectionInChat: () => void;
}

export const SpatialWorkspacePane: React.FC<SpatialWorkspacePaneProps> = ({
  explorerLens,
  files,
  currentPath,
  loading,
  error,
  searchQuery,
  onClearSearch,
  onRetryDirectory,
  sortBy,
  sortDirection,
  viewMode,
  splitPaneOpen,
  explorer,
  spatial,
  onFileDoubleClick,
  onContextMenu,
  onToggleSplitPane,
  onPreviewFilePath,
  onOpenRename,
  onRequestDelete,
  onOpenOrganize,
  onFocusNodeInChat,
  onAskSelectionInChat,
}) => {
  const selectedNodes = explorer.selectedFiles
    .map((p) => files.find((f) => f.path === p))
    .filter((f): f is FileNode => Boolean(f));
  const selectedTotalBytes = selectedNodes.reduce(
    (sum, item) => sum + (item.isDirectory ? 0 : item.size),
    0
  );
  const canPreviewSingle = selectedNodes.length === 1 && !selectedNodes[0].isDirectory;
  const canRenameSingle = selectedNodes.length === 1;
  const canCopyToSplitPane =
    splitPaneOpen && Boolean(explorer.secondaryPath) && explorer.selectedFiles.length > 0;

  return (
    <div
      id="workspace-lens-tabpanel"
      role="tabpanel"
      aria-labelledby={`lens-tab-${explorerLens}`}
      className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
    >
      {explorerLens !== 'files' && spatial.spatialError && (
        <div
          role="alert"
          data-testid="spatial-error-banner"
          className="px-4 py-2 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900 flex items-center justify-between gap-2 text-xs text-error-700 dark:text-red-200"
        >
          <span className="truncate">{spatial.spatialError}</span>
          <button
            type="button"
            onClick={(): void => {
              void spatial.refreshSpatialData();
            }}
            data-testid="spatial-retry-button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 font-medium text-error-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 flex-shrink-0"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      <div className="flex-1 min-w-0 min-h-0 flex overflow-hidden">
        {explorerLens === 'files' && (
          <>
            <div
              className={`flex-1 min-w-0 relative overflow-hidden p-4 dark:bg-slate-950 ${
                explorer.selectedFiles.length > 0 ? 'pb-14' : ''
              }`}
              data-testid="file-explorer"
            >
              <FileGrid
                files={files}
                selectedFiles={explorer.selectedFiles}
                onFileClick={explorer.handleFileClick}
                onFileDoubleClick={(f): void => {
                  void onFileDoubleClick(f);
                }}
                onFileContextMenu={(f, e): void => {
                  e.preventDefault();
                  onContextMenu({ file: f, position: { x: e.clientX, y: e.clientY } });
                }}
                sortBy={sortBy}
                sortDirection={sortDirection}
                viewMode={viewMode}
                loading={loading}
                error={error}
                searchQuery={searchQuery}
                onClearSearch={onClearSearch}
                onRetry={onRetryDirectory}
                currentDirectory={currentPath}
                onDropMove={(sources, dest): void => {
                  void explorer.handleDropMove(sources, dest);
                }}
                onDropExternalFiles={(sources, dest): void => {
                  void explorer.handleCopyPathsToDirectory(sources, dest);
                }}
              />

              {explorer.selectedFiles.length > 0 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex justify-center w-full px-3">
                  <SelectionActionBar
                    selectedCount={explorer.selectedFiles.length}
                    totalBytes={selectedTotalBytes}
                    canPreviewSingle={canPreviewSingle}
                    canRenameSingle={canRenameSingle}
                    canCopyToSplitPane={canCopyToSplitPane}
                    onPreview={(): void => {
                      if (selectedNodes[0]) onPreviewFilePath(selectedNodes[0].path);
                    }}
                    onRename={(): void => {
                      if (selectedNodes[0]) onOpenRename(selectedNodes[0]);
                    }}
                    onCopy={(): void => explorer.copyToClipboard(explorer.selectedFiles)}
                    onCut={(): void => explorer.cutToClipboard(explorer.selectedFiles)}
                    onDuplicate={(): void => {
                      void explorer.handleDuplicatePaths(explorer.selectedFiles);
                    }}
                    onCopyToSplitPane={(): void => {
                      if (explorer.secondaryPath) {
                        void explorer.handleCopyPathsToDirectory(
                          explorer.selectedFiles,
                          explorer.secondaryPath
                        );
                      }
                    }}
                    onAskAi={onAskSelectionInChat}
                    onDelete={(): void => onRequestDelete([...explorer.selectedFiles])}
                    onClearSelection={(): void => explorer.setSelectedFiles([])}
                  />
                </div>
              )}
            </div>

            {splitPaneOpen && (
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="w-1/2 min-w-[220px] flex items-center justify-center border-l border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300"
                  >
                    Loading split explorer...
                  </div>
                }
              >
                <LazySplitPaneExplorer
                  secondaryPath={explorer.secondaryPath}
                  files={explorer.secondaryFiles}
                  selectedFiles={explorer.secondarySelectedFiles}
                  loading={explorer.secondaryLoading}
                  sortBy={sortBy}
                  sortDirection={sortDirection}
                  viewMode={viewMode}
                  primarySelectedCount={explorer.selectedFiles.length}
                  onNavigate={(p): void => {
                    void explorer.loadSecondaryDirectory(p);
                  }}
                  onRefresh={(): void => {
                    if (explorer.secondaryPath) {
                      void explorer.loadSecondaryDirectory(explorer.secondaryPath);
                    }
                  }}
                  onClose={onToggleSplitPane}
                  onCopyFromPrimary={(): void => {
                    if (explorer.secondaryPath) {
                      void explorer.handleCopyPathsToDirectory(
                        explorer.selectedFiles,
                        explorer.secondaryPath
                      );
                    }
                  }}
                  onFileClick={explorer.handleSecondaryFileClick}
                  onFileDoubleClick={(f): void => {
                    if (f.isDirectory) {
                      void explorer.loadSecondaryDirectory(f.path);
                    } else {
                      void onFileDoubleClick(f);
                    }
                  }}
                  onFileContextMenu={(f, e): void => {
                    e.preventDefault();
                    onContextMenu({
                      file: f,
                      position: { x: e.clientX, y: e.clientY },
                      fromSecondary: true,
                    });
                  }}
                  onDropMove={(sources, dest): void => {
                    void explorer.handleDropMove(sources, dest);
                  }}
                />
              </Suspense>
            )}
          </>
        )}

        {explorerLens !== 'files' && (
          <SpatialLensesView
            explorerLens={explorerLens}
            currentPath={currentPath}
            spatial={spatial}
            onPreviewFilePath={onPreviewFilePath}
            onOpenOrganize={onOpenOrganize}
            onFocusNodeInChat={onFocusNodeInChat}
          />
        )}
      </div>
    </div>
  );
};
