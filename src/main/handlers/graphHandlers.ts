import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { validateCanonicalPathOrThrow, withContract } from './securityMiddleware';
import {
  checkWorkspaceGraphImpact,
  getWorkspaceCollectionsData,
  getWorkspaceFileConnectionsData,
  getWorkspaceGraphMapData,
  queryWorkspaceGraphInsights,
} from './llmHandlers';
import {
  FileConnectionsSummary,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '@shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger } from '@shared/logging';

async function handleQueryInsights(
  _event: IpcMainInvokeEvent,
  input: { symbolQuery?: string; backlinkTarget?: string }
): Promise<GraphInsightsResponse> {
  return queryWorkspaceGraphInsights(input);
}

async function handleImpactCheck(
  _event: IpcMainInvokeEvent,
  input: { paths: string[] }
): Promise<GraphImpactCheckResult> {
  const canonicalPaths: string[] = [];
  for (const p of input.paths) {
    canonicalPaths.push(await validateCanonicalPathOrThrow(p));
  }
  return checkWorkspaceGraphImpact(canonicalPaths);
}

async function handleWorkspaceMap(
  _event: IpcMainInvokeEvent,
  input: { rootPrefix?: string; maxNodes?: number }
): Promise<WorkspaceGraphMap> {
  const rootPrefix = input.rootPrefix
    ? await validateCanonicalPathOrThrow(input.rootPrefix)
    : undefined;
  return getWorkspaceGraphMapData({ rootPrefix, maxNodes: input.maxNodes });
}

async function handleCollections(
  _event: IpcMainInvokeEvent,
  input: { rootPrefix?: string }
): Promise<WorkspaceCollectionGroup[]> {
  const rootPrefix = input.rootPrefix
    ? await validateCanonicalPathOrThrow(input.rootPrefix)
    : undefined;
  return getWorkspaceCollectionsData({ rootPrefix });
}

async function handleFileConnections(
  _event: IpcMainInvokeEvent,
  input: { filePath: string }
): Promise<FileConnectionsSummary> {
  return getWorkspaceFileConnectionsData(input.filePath);
}

const GRAPH_CHANNELS: IPCChannel[] = [
  'GRAPH:QUERY_INSIGHTS',
  'GRAPH:IMPACT_CHECK',
  'GRAPH:WORKSPACE_MAP',
  'GRAPH:COLLECTIONS',
  'GRAPH:FILE_CONNECTIONS',
];

export function registerGraphHandlers(): IPCChannel[] {
  IPCLogger.info('Registering knowledge-graph IPC handlers');
  ipcMain.handle(
    'GRAPH:QUERY_INSIGHTS',
    withContract('GRAPH:QUERY_INSIGHTS', handleQueryInsights)
  );
  ipcMain.handle(
    'GRAPH:IMPACT_CHECK',
    withContract('GRAPH:IMPACT_CHECK', handleImpactCheck)
  );
  ipcMain.handle(
    'GRAPH:WORKSPACE_MAP',
    withContract('GRAPH:WORKSPACE_MAP', handleWorkspaceMap)
  );
  ipcMain.handle(
    'GRAPH:COLLECTIONS',
    withContract('GRAPH:COLLECTIONS', handleCollections)
  );
  ipcMain.handle(
    'GRAPH:FILE_CONNECTIONS',
    withContract('GRAPH:FILE_CONNECTIONS', handleFileConnections)
  );
  return [...GRAPH_CHANNELS];
}
