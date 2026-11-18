/**
 * llmHandlers.ts - IPC Adapter Layer for Intelligence & Agent Orchestration Operations
 *
 * Keeps IPC contract validation and kernel hook registration strictly decoupled from
 * runtime orchestration internals in `LlmWorkspaceService.ts`.
 */

import { ipcMain } from 'electron';
import path from 'path';
import { resolveCanonicalVectorDbDir } from '@shared/config';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger } from '@shared/logging';
import { configureKernelHooks } from '@main/services/ReactiveWorkspaceKernel';
import { withContract } from './securityMiddleware';

type LlmWorkspaceServiceModule = typeof import('@main/services/LlmWorkspaceService');

const MAX_PREINIT_MUTATIONS = 256;
const preInitKernelMutations = new Map<
  string,
  { eventType: 'create' | 'change' | 'unlink'; filePath: string }
>();

let loadedLlmService: LlmWorkspaceServiceModule | null = null;
let loadingLlmServicePromise: Promise<LlmWorkspaceServiceModule> | null = null;

function enqueuePreInitMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): void {
  const key =
    process.platform === 'win32'
      ? path.resolve(filePath).toLowerCase()
      : path.resolve(filePath);
  if (preInitKernelMutations.has(key)) {
    preInitKernelMutations.delete(key);
  } else if (preInitKernelMutations.size >= MAX_PREINIT_MUTATIONS) {
    const oldestKey = preInitKernelMutations.keys().next().value;
    if (oldestKey) {
      preInitKernelMutations.delete(oldestKey);
    }
  }
  preInitKernelMutations.set(key, { eventType, filePath });
}

async function loadLlmService(): Promise<LlmWorkspaceServiceModule> {
  if (loadedLlmService) {
    return loadedLlmService;
  }
  if (!loadingLlmServicePromise) {
    loadingLlmServicePromise = import('@main/services/LlmWorkspaceService')
      .then((mod) => {
        loadedLlmService = mod;
        if (preInitKernelMutations.size > 0) {
          const pending = Array.from(preInitKernelMutations.values());
          preInitKernelMutations.clear();
          void (async (): Promise<void> => {
            for (const item of pending) {
              await mod
                .handleKernelIndexMutation(item.eventType, item.filePath)
                .catch(() => undefined);
            }
          })();
        }
        return mod;
      })
      .catch((error) => {
        loadingLlmServicePromise = null;
        throw error;
      });
  }
  return loadingLlmServicePromise;
}

async function forwardKernelIndexMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): Promise<void> {
  if (loadedLlmService) {
    await loadedLlmService.handleKernelIndexMutation(eventType, filePath);
    return;
  }
  enqueuePreInitMutation(eventType, filePath);
}

export async function checkWorkspaceGraphImpact(
  ...args: Parameters<LlmWorkspaceServiceModule['checkWorkspaceGraphImpact']>
): Promise<Awaited<ReturnType<LlmWorkspaceServiceModule['checkWorkspaceGraphImpact']>>> {
  return (await loadLlmService()).checkWorkspaceGraphImpact(...args);
}

export async function getWorkspaceCollectionsData(
  ...args: Parameters<LlmWorkspaceServiceModule['getWorkspaceCollectionsData']>
): Promise<Awaited<ReturnType<LlmWorkspaceServiceModule['getWorkspaceCollectionsData']>>> {
  return (await loadLlmService()).getWorkspaceCollectionsData(...args);
}

export async function getWorkspaceFileConnectionsData(
  ...args: Parameters<LlmWorkspaceServiceModule['getWorkspaceFileConnectionsData']>
): Promise<Awaited<ReturnType<LlmWorkspaceServiceModule['getWorkspaceFileConnectionsData']>>> {
  return (await loadLlmService()).getWorkspaceFileConnectionsData(...args);
}

export async function getWorkspaceGraphMapData(
  ...args: Parameters<LlmWorkspaceServiceModule['getWorkspaceGraphMapData']>
): Promise<Awaited<ReturnType<LlmWorkspaceServiceModule['getWorkspaceGraphMapData']>>> {
  return (await loadLlmService()).getWorkspaceGraphMapData(...args);
}

export async function queryWorkspaceGraphInsights(
  ...args: Parameters<LlmWorkspaceServiceModule['queryWorkspaceGraphInsights']>
): Promise<Awaited<ReturnType<LlmWorkspaceServiceModule['queryWorkspaceGraphInsights']>>> {
  return (await loadLlmService()).queryWorkspaceGraphInsights(...args);
}

export function resolveVectorDbPath(): string {
  return loadedLlmService ? loadedLlmService.resolveVectorDbPath() : resolveCanonicalVectorDbDir();
}

export async function searchWorkspaceContent(
  ...args: Parameters<LlmWorkspaceServiceModule['searchWorkspaceContent']>
): Promise<Awaited<ReturnType<LlmWorkspaceServiceModule['searchWorkspaceContent']>>> {
  return (await loadLlmService()).searchWorkspaceContent(...args);
}

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
  'LLM:DOWNLOAD_MODELS',
  'AI:ORGANIZE_PLAN',
  'AI:ORGANIZE_APPLY',
];

export function registerLLMHandlers(): IPCChannel[] {
  IPCLogger.info('Registering LLM IPC handlers');

  ipcMain.handle(
    'LLM:QUERY',
    withContract('LLM:QUERY', async (...args) =>
      (await loadLlmService()).executeCopilotQuery(...args)
    )
  );
  ipcMain.handle(
    'LLM:ABORT_QUERY',
    withContract('LLM:ABORT_QUERY', async (...args) =>
      (await loadLlmService()).abortCopilotQuery(...args)
    )
  );
  ipcMain.handle(
    'LLM:INDEX_STATUS',
    withContract('LLM:INDEX_STATUS', async (...args) =>
      (await loadLlmService()).getIndexingStatus(...args)
    )
  );
  ipcMain.handle(
    'LLM:START_INDEXING',
    withContract('LLM:START_INDEXING', async (...args) =>
      (await loadLlmService()).startDirectoryIndexing(...args)
    )
  );
  ipcMain.handle(
    'LLM:STOP_INDEXING',
    withContract('LLM:STOP_INDEXING', async (...args) =>
      (await loadLlmService()).stopDirectoryIndexing(...args)
    )
  );
  ipcMain.handle(
    'LLM:INDEX_FILE',
    withContract('LLM:INDEX_FILE', async (...args) =>
      (await loadLlmService()).indexSingleFile(...args)
    )
  );
  ipcMain.handle(
    'LLM:CHECK_OLLAMA',
    withContract('LLM:CHECK_OLLAMA', async (...args) =>
      (await loadLlmService()).checkOllamaStatus(...args)
    )
  );
  ipcMain.handle(
    'LLM:CLEAR_INDEX',
    withContract('LLM:CLEAR_INDEX', async (...args) =>
      (await loadLlmService()).clearVectorIndex(...args)
    )
  );
  ipcMain.handle(
    'LLM:GET_TRACES',
    withContract('LLM:GET_TRACES', async (...args) =>
      (await loadLlmService()).getRecentAgentTraces(...args)
    )
  );
  ipcMain.handle(
    'LLM:CLEAR_TRACES',
    withContract('LLM:CLEAR_TRACES', async (...args) =>
      (await loadLlmService()).clearAgentTracesHistory(...args)
    )
  );
  ipcMain.handle(
    'LLM:LIST_MODELS',
    withContract('LLM:LIST_MODELS', async (...args) =>
      (await loadLlmService()).listLlmModels(...args)
    )
  );
  ipcMain.handle(
    'LLM:SET_MODEL_CONFIG',
    withContract('LLM:SET_MODEL_CONFIG', async (...args) =>
      (await loadLlmService()).setLlmModelConfig(...args)
    )
  );
  ipcMain.handle(
    'LLM:DOWNLOAD_MODELS',
    withContract('LLM:DOWNLOAD_MODELS', async (...args) =>
      (await loadLlmService()).downloadLlmModels(...args)
    )
  );
  ipcMain.handle(
    'AI:ORGANIZE_PLAN',
    withContract('AI:ORGANIZE_PLAN', async (...args) =>
      (await loadLlmService()).planWorkspaceOrganize(...args)
    )
  );
  ipcMain.handle(
    'AI:ORGANIZE_APPLY',
    withContract('AI:ORGANIZE_APPLY', async (...args) =>
      (await loadLlmService()).applyWorkspaceOrganize(...args)
    )
  );

  configureKernelHooks({ indexMutationHook: forwardKernelIndexMutation });

  IPCLogger.info(`LLM IPC handlers registered (${LLM_CHANNELS.length} handlers)`);
  return [...LLM_CHANNELS];
}

export async function cleanupLLMServices(): Promise<void> {
  configureKernelHooks({ indexMutationHook: null });
  preInitKernelMutations.clear();
  if (loadedLlmService) {
    await loadedLlmService.cleanupLLMServices();
    return;
  }
  if (loadingLlmServicePromise) {
    const mod = await loadingLlmServicePromise.catch(() => null);
    if (mod) {
      await mod.cleanupLLMServices();
    }
  }
}

export async function resetLLMHandlersForTesting(): Promise<void> {
  await cleanupLLMServices();
}
