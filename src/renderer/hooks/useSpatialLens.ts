import { useState, useCallback, useEffect } from 'react';
import {
  ExplorerLens,
  GraphInsightsResponse,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '@shared/contracts';

export interface UseSpatialLensReturn {
  graphMap: WorkspaceGraphMap | null;
  collections: WorkspaceCollectionGroup[];
  graphInsights: GraphInsightsResponse | null;
  spatialLoading: boolean;
  graphScopeToFolder: boolean;
  setGraphScopeToFolder: (scoped: boolean) => void;
  selectedGraphNodePath: string | null;
  setSelectedGraphNodePath: (nodePath: string | null) => void;
  refreshSpatialData: (lensOverride?: ExplorerLens, scopeOverride?: boolean) => Promise<void>;
}

export function useSpatialLens(
  explorerLens: ExplorerLens,
  currentPath: string
): UseSpatialLensReturn {
  const [graphMap, setGraphMap] = useState<WorkspaceGraphMap | null>(null);
  const [collections, setCollections] = useState<WorkspaceCollectionGroup[]>([]);
  const [graphInsights, setGraphInsights] = useState<GraphInsightsResponse | null>(null);
  const [spatialLoading, setSpatialLoading] = useState<boolean>(false);
  const [graphScopeToFolder, setGraphScopeToFolder] = useState<boolean>(true);
  const [selectedGraphNodePath, setSelectedGraphNodePath] = useState<string | null>(null);

  const refreshSpatialData = useCallback(
    async (lensOverride = explorerLens, scopeOverride = graphScopeToFolder): Promise<void> => {
      setSpatialLoading(true);
      try {
        const rootPrefix = scopeOverride && currentPath ? currentPath : undefined;
        const [insightsRes, mapRes, colRes] = await Promise.allSettled([
          window.electronAPI?.graph?.queryInsights?.() ?? Promise.resolve(null),
          lensOverride === 'graph' && window.electronAPI?.graph?.getWorkspaceMap
            ? window.electronAPI.graph.getWorkspaceMap({ rootPrefix, maxNodes: 100 })
            : Promise.resolve(null),
          lensOverride === 'collections' && window.electronAPI?.graph?.getCollections
            ? window.electronAPI.graph.getCollections({ rootPrefix })
            : Promise.resolve(null),
        ]);

        if (insightsRes.status === 'fulfilled' && insightsRes.value) {
          setGraphInsights(insightsRes.value);
        }
        if (mapRes.status === 'fulfilled' && mapRes.value) {
          setGraphMap(mapRes.value);
        }
        if (colRes.status === 'fulfilled' && colRes.value) {
          setCollections(colRes.value);
        }
      } finally {
        setSpatialLoading(false);
      }
    },
    [currentPath, explorerLens, graphScopeToFolder]
  );

  useEffect(() => {
    void refreshSpatialData(explorerLens, graphScopeToFolder);
  }, [explorerLens, currentPath, graphScopeToFolder, refreshSpatialData]);

  return {
    graphMap,
    collections,
    graphInsights,
    spatialLoading,
    graphScopeToFolder,
    setGraphScopeToFolder,
    selectedGraphNodePath,
    setSelectedGraphNodePath,
    refreshSpatialData,
  };
}
