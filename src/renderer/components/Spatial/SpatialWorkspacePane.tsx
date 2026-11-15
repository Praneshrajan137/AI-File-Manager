import React, { Suspense } from 'react';
import { RefreshCw } from 'lucide-react';
import { FileGrid } from '../FileExplorer/FileGrid';
import { SplitPaneExplorer } from '../FileExplorer/SplitPaneExplorer';
import { SmartCollectionsLens } from './SmartCollectionsLens';
import { DuplicateReclaimLens } from './DuplicateReclaimLens';
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

const LazyKnowledgeGraphCanvas = React.lazy(() =>
  import('./KnowledgeGraphCanvas').then((m) => ({ default: m.KnowledgeGraphCanvas }))
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
  onOpenOrganize: (targetDir: string, strategy: OrganizeStrategy) => void;
  onFocusNodeInChat: (nodePath: string) => void;
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
  onOpenOrganize,
  onFocusNodeInChat,
}) => {
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
            onClick={(): void => void spatial.refreshSpatialData()}
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
            <div className="flex-1 min-w-0 overflow-hidden p-4 dark:bg-slate-950" data-testid="file-explorer">
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
              />
            </div>

            {splitPaneOpen && (
              <SplitPaneExplorer
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
            )}
          </>
        )}

        {explorerLens === 'graph' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                  Loading workspace graph view...
                </div>
              }
            >
              <LazyKnowledgeGraphCanvas
                graphMap={spatial.graphMap}
                loading={spatial.spatialLoading}
                selectedNodePath={spatial.selectedGraphNodePath}
                scopeToFolder={spatial.graphScopeToFolder}
                onToggleScopeToFolder={spatial.setGraphScopeToFolder}
                onSelectNode={(node): void => {
                  spatial.setSelectedGraphNodePath(node.path);
                  onPreviewFilePath(node.path);
                }}
                onOpenPreview={onPreviewFilePath}
                onFocusInChat={(node): void => onFocusNodeInChat(node.path)}
              />
            </Suspense>
          </div>
        )}

        {explorerLens === 'collections' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <SmartCollectionsLens
              collections={spatial.collections}
              loading={spatial.spatialLoading}
              onSelectFile={onPreviewFilePath}
              onOpenSemanticOrganize={
                currentPath
                  ? (): void => onOpenOrganize(currentPath, 'semantic_cluster')
                  : undefined
              }
            />
          </div>
        )}

        {explorerLens === 'duplicates' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <DuplicateReclaimLens
              duplicateClusters={spatial.graphInsights?.stats.duplicateClusters ?? []}
              totalWastedBytes={spatial.graphInsights?.stats.totalWastedBytes ?? 0}
              loading={spatial.spatialLoading}
              onPreviewFile={onPreviewFilePath}
              onQuarantineDuplicates={(): void => {
                if (currentPath) onOpenOrganize(currentPath, 'deduplicate');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
