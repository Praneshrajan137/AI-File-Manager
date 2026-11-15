import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { validateCanonicalPathOrThrow, withContract } from './securityMiddleware';
import { checkWorkspaceGraphImpact, queryWorkspaceGraphInsights } from './llmHandlers';
import { GraphImpactCheckResult, GraphInsightsResponse } from '@shared/contracts';
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

const GRAPH_CHANNELS: IPCChannel[] = ['GRAPH:QUERY_INSIGHTS', 'GRAPH:IMPACT_CHECK'];

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
  return [...GRAPH_CHANNELS];
}
