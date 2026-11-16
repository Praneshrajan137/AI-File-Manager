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
  spatialError: string | null;
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
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [graphScopeToFolder, setGraphScopeToFolder] = useState<boolean>(true);
  const [selectedGraphNodePath, setSelectedGraphNodePath] = useState<string | null>(null);

  const refreshSpatialData = useCallback(
    async (lensOverride = explorerLens, scopeOverride = graphScopeToFolder): Promise<void> => {
      if (lensOverride === 'files') {
        setSpatialError(null);
        setSpatialLoading(false);
        return;
      }
      setSpatialLoading(true);
      setSpatialError(null);
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

        const failures: string[] = [];
        if (insightsRes.status === 'fulfilled' && insightsRes.value) {
          setGraphInsights(insightsRes.value);
        } else if (insightsRes.status === 'rejected') {
          failures.push(
            insightsRes.reason instanceof Error
              ? insightsRes.reason.message
              : 'Failed to load workspace graph insights'
          );
        }

        if (mapRes.status === 'fulfilled' && mapRes.value) {
          setGraphMap(mapRes.value);
        } else if (mapRes.status === 'rejected') {
          failures.push(
            mapRes.reason instanceof Error
              ? mapRes.reason.message
              : 'Failed to load link topology'
          );
        }

        if (colRes.status === 'fulfilled' && colRes.value) {
          setCollections(colRes.value);
        } else if (colRes.status === 'rejected') {
          failures.push(
            colRes.reason instanceof Error
              ? colRes.reason.message
              : 'Failed to load smart collections'
          );
        }

        if (failures.length > 0) {
          setSpatialError(failures[0]);
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
    spatialError,
    graphScopeToFolder,
    setGraphScopeToFolder,
    selectedGraphNodePath,
    setSelectedGraphNodePath,
    refreshSpatialData,
  };
}
