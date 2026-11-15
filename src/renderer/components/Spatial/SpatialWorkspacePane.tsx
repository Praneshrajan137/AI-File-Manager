import React from 'react';
import { FileGrid } from '../FileExplorer/FileGrid';
import { SplitPaneExplorer } from '../FileExplorer/SplitPaneExplorer';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas';
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

interface SpatialWorkspacePaneProps {
  explorerLens: ExplorerLens;
  files: FileNode[];
  currentPath: string;
  loading: boolean;
  error: FileSystemError | null;
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
          <KnowledgeGraphCanvas
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
  );
};
