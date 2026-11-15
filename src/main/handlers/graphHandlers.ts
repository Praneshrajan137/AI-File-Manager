import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { withContract } from './securityMiddleware';
import { queryWorkspaceGraphInsights } from './llmHandlers';
import { GraphInsightsResponse } from '@shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger } from '@shared/logging';

async function handleQueryInsights(
  _event: IpcMainInvokeEvent,
  input: { symbolQuery?: string; backlinkTarget?: string }
): Promise<GraphInsightsResponse> {
  return queryWorkspaceGraphInsights(input);
}

const GRAPH_CHANNELS: IPCChannel[] = ['GRAPH:QUERY_INSIGHTS'];

export function registerGraphHandlers(): IPCChannel[] {
  IPCLogger.info('Registering knowledge-graph IPC handlers');
  ipcMain.handle(
    'GRAPH:QUERY_INSIGHTS',
    withContract('GRAPH:QUERY_INSIGHTS', handleQueryInsights)
  );
  return [...GRAPH_CHANNELS];
}
