import React, { Suspense } from 'react';
import type { UseSpatialLensReturn } from '@renderer/hooks/useSpatialLens';
import type { ExplorerLens, OrganizeStrategy } from '@shared/contracts';

const LazyKnowledgeGraphCanvas = React.lazy(() =>
  import('./KnowledgeGraphCanvas').then((m) => ({ default: m.KnowledgeGraphCanvas }))
);
const LazySmartCollectionsLens = React.lazy(() =>
  import('./SmartCollectionsLens').then((m) => ({ default: m.SmartCollectionsLens }))
);
const LazyDuplicateReclaimLens = React.lazy(() =>
  import('./DuplicateReclaimLens').then((m) => ({ default: m.DuplicateReclaimLens }))
);

interface SpatialLensesViewProps {
  explorerLens: ExplorerLens;
  currentPath: string;
  spatial: UseSpatialLensReturn;
  onPreviewFilePath: (filePath: string) => void;
  onOpenOrganize: (targetDir: string, strategy: OrganizeStrategy) => void;
  onFocusNodeInChat: (nodePath: string) => void;
}

/** Lazy-split router rendering Graph, Collections, or Duplicates spatial workbench views. */
export const SpatialLensesView: React.FC<SpatialLensesViewProps> = ({
  explorerLens,
  currentPath,
  spatial,
  onPreviewFilePath,
  onOpenOrganize,
  onFocusNodeInChat,
}) => {
  if (explorerLens === 'graph') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <Suspense
          fallback={
            <div role="status" className="h-full flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
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
    );
  }

  if (explorerLens === 'collections') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <Suspense
          fallback={
            <div role="status" className="h-full flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
              Loading smart collections...
            </div>
          }
        >
          <LazySmartCollectionsLens
            collections={spatial.collections}
            loading={spatial.spatialLoading}
            onSelectFile={onPreviewFilePath}
            onOpenSemanticOrganize={
              currentPath ? (): void => onOpenOrganize(currentPath, 'semantic_cluster') : undefined
            }
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      <Suspense
        fallback={
          <div role="status" className="h-full flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
            Loading duplicate reclaim...
          </div>
        }
      >
        <LazyDuplicateReclaimLens
          duplicateClusters={spatial.graphInsights?.stats.duplicateClusters ?? []}
          totalWastedBytes={spatial.graphInsights?.stats.totalWastedBytes ?? 0}
          loading={spatial.spatialLoading}
          onPreviewFile={onPreviewFilePath}
          onQuarantineDuplicates={(): void => {
            if (currentPath) onOpenOrganize(currentPath, 'deduplicate');
          }}
        />
      </Suspense>
    </div>
  );
};
