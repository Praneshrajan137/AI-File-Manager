/**
 * llmHandlers.ts - IPC Adapter Layer for Intelligence & Agent Orchestration Operations
 *
 * Delegates lazily to the explicit `WorkspaceRuntime` Composition Root without
 * loading Tier B LanceDB/ONNX dependencies during Electron startup or duplicating
 * `IndexingCoordinator`'s pre-init mutation buffer.
 */

import { ipcMain } from 'electron';
import { resolveCanonicalVectorDbDir } from '@shared/config';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger } from '@shared/logging';
import { configureKernelHooks } from '@main/services/ReactiveWorkspaceKernel';
import { withContract } from './securityMiddleware';

type WorkspaceRuntimeModule = typeof import('@main/entry/WorkspaceRuntime');
type WorkspaceRuntimeInstance = ReturnType<WorkspaceRuntimeModule['getWorkspaceRuntime']>;

interface LoadedRuntimeHandle {
  runtime: WorkspaceRuntimeInstance;
  cleanup: WorkspaceRuntimeModule['cleanupWorkspaceRuntime'];
}

let loadedHandle: LoadedRuntimeHandle | null = null;
let loadingHandlePromise: Promise<LoadedRuntimeHandle> | null = null;

async function loadRuntimeHandle(): Promise<LoadedRuntimeHandle> {
  if (loadedHandle) {
    return loadedHandle;
  }
  if (!loadingHandlePromise) {
    loadingHandlePromise = import('@main/entry/WorkspaceRuntime')
      .then((mod) => {
        loadedHandle = {
          runtime: mod.getWorkspaceRuntime(),
          cleanup: mod.cleanupWorkspaceRuntime,
        };
        return loadedHandle;
      })
      .catch((error) => {
        loadingHandlePromise = null;
        throw error;
      });
  }
  return loadingHandlePromise;
}

async function getRuntime(): Promise<WorkspaceRuntimeInstance> {
  return (await loadRuntimeHandle()).runtime;
}

async function forwardKernelIndexMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): Promise<void> {
  const runtime = await getRuntime();
  await runtime.handleKernelIndexMutation(eventType, filePath);
}

export async function checkWorkspaceGraphImpact(
  ...args: Parameters<WorkspaceRuntimeInstance['checkWorkspaceGraphImpact']>
): Promise<Awaited<ReturnType<WorkspaceRuntimeInstance['checkWorkspaceGraphImpact']>>> {
  return (await getRuntime()).checkWorkspaceGraphImpact(...args);
}

export async function getWorkspaceCollectionsData(
  ...args: Parameters<WorkspaceRuntimeInstance['getWorkspaceCollectionsData']>
): Promise<Awaited<ReturnType<WorkspaceRuntimeInstance['getWorkspaceCollectionsData']>>> {
  return (await getRuntime()).getWorkspaceCollectionsData(...args);
}

export async function getWorkspaceFileConnectionsData(
  ...args: Parameters<WorkspaceRuntimeInstance['getWorkspaceFileConnectionsData']>
): Promise<Awaited<ReturnType<WorkspaceRuntimeInstance['getWorkspaceFileConnectionsData']>>> {
  return (await getRuntime()).getWorkspaceFileConnectionsData(...args);
}

export async function getWorkspaceGraphMapData(
  ...args: Parameters<WorkspaceRuntimeInstance['getWorkspaceGraphMapData']>
): Promise<Awaited<ReturnType<WorkspaceRuntimeInstance['getWorkspaceGraphMapData']>>> {
  return (await getRuntime()).getWorkspaceGraphMapData(...args);
}

export async function queryWorkspaceGraphInsights(
  ...args: Parameters<WorkspaceRuntimeInstance['queryWorkspaceGraphInsights']>
): Promise<Awaited<ReturnType<WorkspaceRuntimeInstance['queryWorkspaceGraphInsights']>>> {
  return (await getRuntime()).queryWorkspaceGraphInsights(...args);
}

export function resolveVectorDbPath(): string {
  return loadedHandle
    ? loadedHandle.runtime.resolveVectorDbPath()
    : resolveCanonicalVectorDbDir();
}

export async function searchWorkspaceContent(
  ...args: Parameters<WorkspaceRuntimeInstance['searchWorkspaceContent']>
): Promise<Awaited<ReturnType<WorkspaceRuntimeInstance['searchWorkspaceContent']>>> {
  return (await getRuntime()).searchWorkspaceContent(...args);
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
      (await getRuntime()).executeCopilotQuery(...args)
    )
  );
  ipcMain.handle(
    'LLM:ABORT_QUERY',
    withContract('LLM:ABORT_QUERY', async (...args) =>
      (await getRuntime()).abortCopilotQuery(...args)
    )
  );
  ipcMain.handle(
    'LLM:INDEX_STATUS',
    withContract('LLM:INDEX_STATUS', async (...args) =>
      (await getRuntime()).getIndexingStatus(...args)
    )
  );
  ipcMain.handle(
    'LLM:START_INDEXING',
    withContract('LLM:START_INDEXING', async (...args) =>
      (await getRuntime()).startDirectoryIndexing(...args)
    )
  );
  ipcMain.handle(
    'LLM:STOP_INDEXING',
    withContract('LLM:STOP_INDEXING', async (...args) =>
      (await getRuntime()).stopDirectoryIndexing(...args)
    )
  );
  ipcMain.handle(
    'LLM:INDEX_FILE',
    withContract('LLM:INDEX_FILE', async (...args) =>
      (await getRuntime()).indexSingleFile(...args)
    )
  );
  ipcMain.handle(
    'LLM:CHECK_OLLAMA',
    withContract('LLM:CHECK_OLLAMA', async (...args) =>
      (await getRuntime()).checkOllamaStatus(...args)
    )
  );
  ipcMain.handle(
    'LLM:CLEAR_INDEX',
    withContract('LLM:CLEAR_INDEX', async (...args) =>
      (await getRuntime()).clearVectorIndex(...args)
    )
  );
  ipcMain.handle(
    'LLM:GET_TRACES',
    withContract('LLM:GET_TRACES', async (...args) =>
      (await getRuntime()).getRecentAgentTraces(...args)
    )
  );
  ipcMain.handle(
    'LLM:CLEAR_TRACES',
    withContract('LLM:CLEAR_TRACES', async (...args) =>
      (await getRuntime()).clearAgentTracesHistory(...args)
    )
  );
  ipcMain.handle(
    'LLM:LIST_MODELS',
    withContract('LLM:LIST_MODELS', async (...args) =>
      (await getRuntime()).listLlmModels(...args)
    )
  );
  ipcMain.handle(
    'LLM:SET_MODEL_CONFIG',
    withContract('LLM:SET_MODEL_CONFIG', async (...args) =>
      (await getRuntime()).setLlmModelConfig(...args)
    )
  );
  ipcMain.handle(
    'LLM:DOWNLOAD_MODELS',
    withContract('LLM:DOWNLOAD_MODELS', async (...args) =>
      (await getRuntime()).downloadLlmModels(...args)
    )
  );
  ipcMain.handle(
    'AI:ORGANIZE_PLAN',
    withContract('AI:ORGANIZE_PLAN', async (...args) =>
      (await getRuntime()).planWorkspaceOrganize(...args)
    )
  );
  ipcMain.handle(
    'AI:ORGANIZE_APPLY',
    withContract('AI:ORGANIZE_APPLY', async (...args) =>
      (await getRuntime()).applyWorkspaceOrganize(...args)
    )
  );

  configureKernelHooks({ indexMutationHook: forwardKernelIndexMutation });

  IPCLogger.info(`LLM IPC handlers registered (${LLM_CHANNELS.length} handlers)`);
  return [...LLM_CHANNELS];
}

export async function cleanupLLMServices(): Promise<void> {
  configureKernelHooks({ indexMutationHook: null });
  const handle =
    loadedHandle ?? (loadingHandlePromise ? await loadingHandlePromise.catch(() => null) : null);
  loadedHandle = null;
  loadingHandlePromise = null;
  if (handle) {
    await handle.cleanup();
  }
}

export async function resetLLMHandlersForTesting(): Promise<void> {
  await cleanupLLMServices();
}
