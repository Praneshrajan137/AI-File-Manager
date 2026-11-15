/**
 * llmHandlers.ts - IPC Adapter Layer for Intelligence & Agent Orchestration Operations
 *
 * Keeps IPC contract validation and kernel hook registration strictly decoupled from
 * runtime orchestration internals in `LlmWorkspaceService.ts`.
 */

import { ipcMain } from 'electron';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger } from '@shared/logging';
import { configureKernelHooks } from '@main/services/ReactiveWorkspaceKernel';
import {
  abortCopilotQuery,
  applyWorkspaceOrganize,
  checkOllamaStatus,
  checkWorkspaceGraphImpact,
  cleanupLLMServices as cleanupRuntimeServices,
  clearAgentTracesHistory,
  clearVectorIndex,
  executeCopilotQuery,
  getIndexingStatus,
  getRecentAgentTraces,
  getWorkspaceCollectionsData,
  getWorkspaceFileConnectionsData,
  getWorkspaceGraphMapData,
  handleKernelIndexMutation,
  indexSingleFile,
  listLlmModels,
  planWorkspaceOrganize,
  queryWorkspaceGraphInsights,
  resolveVectorDbPath,
  searchWorkspaceContent,
  setLlmModelConfig,
  startDirectoryIndexing,
  stopDirectoryIndexing,
} from '@main/services/LlmWorkspaceService';
import { withContract } from './securityMiddleware';

export {
  checkWorkspaceGraphImpact,
  getWorkspaceCollectionsData,
  getWorkspaceFileConnectionsData,
  getWorkspaceGraphMapData,
  queryWorkspaceGraphInsights,
  resolveVectorDbPath,
  searchWorkspaceContent,
};

const LLM_CHANNELS: IPCChannel[] = [
  'LLM:QUERY',
  'LLM:ABORT_QUERY',
  'LLM:INDEX_STATUS',
  'LLM:START_INDEXING',
  'LLM:STOP_INDEXING',
  'LLM:INDEX_FILE',
  'LLM:CHECK_OLLAMA',
  'LLM:CLEAR_INDEX',
  'LLM:GET_TRACES',
  'LLM:CLEAR_TRACES',
  'LLM:LIST_MODELS',
  'LLM:SET_MODEL_CONFIG',
  'AI:ORGANIZE_PLAN',
  'AI:ORGANIZE_APPLY',
];

export function registerLLMHandlers(): IPCChannel[] {
  IPCLogger.info('Registering LLM IPC handlers');

  ipcMain.handle('LLM:QUERY', withContract('LLM:QUERY', executeCopilotQuery));
  ipcMain.handle('LLM:ABORT_QUERY', withContract('LLM:ABORT_QUERY', abortCopilotQuery));
  ipcMain.handle('LLM:INDEX_STATUS', withContract('LLM:INDEX_STATUS', getIndexingStatus));
  ipcMain.handle('LLM:START_INDEXING', withContract('LLM:START_INDEXING', startDirectoryIndexing));
  ipcMain.handle('LLM:STOP_INDEXING', withContract('LLM:STOP_INDEXING', stopDirectoryIndexing));
  ipcMain.handle('LLM:INDEX_FILE', withContract('LLM:INDEX_FILE', indexSingleFile));
  ipcMain.handle('LLM:CHECK_OLLAMA', withContract('LLM:CHECK_OLLAMA', checkOllamaStatus));
  ipcMain.handle('LLM:CLEAR_INDEX', withContract('LLM:CLEAR_INDEX', clearVectorIndex));
  ipcMain.handle('LLM:GET_TRACES', withContract('LLM:GET_TRACES', getRecentAgentTraces));
  ipcMain.handle('LLM:CLEAR_TRACES', withContract('LLM:CLEAR_TRACES', clearAgentTracesHistory));
  ipcMain.handle('LLM:LIST_MODELS', withContract('LLM:LIST_MODELS', listLlmModels));
  ipcMain.handle('LLM:SET_MODEL_CONFIG', withContract('LLM:SET_MODEL_CONFIG', setLlmModelConfig));
  ipcMain.handle('AI:ORGANIZE_PLAN', withContract('AI:ORGANIZE_PLAN', planWorkspaceOrganize));
  ipcMain.handle('AI:ORGANIZE_APPLY', withContract('AI:ORGANIZE_APPLY', applyWorkspaceOrganize));

  configureKernelHooks({ indexMutationHook: handleKernelIndexMutation });

  IPCLogger.info(`LLM IPC handlers registered (${LLM_CHANNELS.length} handlers)`);
  return [...LLM_CHANNELS];
}

export async function cleanupLLMServices(): Promise<void> {
  configureKernelHooks({ indexMutationHook: null });
  await cleanupRuntimeServices();
}

export async function resetLLMHandlersForTesting(): Promise<void> {
  await cleanupLLMServices();
}
