/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

/**
 * preload.ts - Electron Preload Script (Security Bridge)
 *
 * Exposes a contract-enforced, frozen API via contextBridge while preserving
 * strict Electron sandboxing (no Node.js primitives exposed to renderer).
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  IPCEnvelope,
  isIPCEnvelope,
  wrapIPCError,
  wrapIPCSuccess,
} from '@shared/ipc/envelope';
import type {
  AgentTraceStep,
  CopilotContextScope,
  CopilotQueryMode,
  FileDeleteMode,
  IndexingStatus,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  RetrievalSource,
} from '@shared/contracts';
import type { IPCChannel, IPCResponse } from '@shared/ipc/contracts';

type ContractResult<C extends IPCChannel> = Promise<IPCEnvelope<IPCResponse<C>>>;

let llmStreamCounter = 0;

/**
 * Invoke a Main-process contract channel and preserve the structured
 * IPCEnvelope across Electron's contextBridge so the renderer's main JS world
 * can rehydrate Error instances with `.code` and `.details` intact.
 */
async function invokeContract<C extends IPCChannel>(
  channel: C,
  payload?: unknown
): Promise<IPCEnvelope<IPCResponse<C>>> {
  try {
    const raw = await ipcRenderer.invoke(channel, payload);

    if (isIPCEnvelope<IPCResponse<C>>(raw)) {
      return raw;
    }

    return wrapIPCSuccess(raw as IPCResponse<C>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return wrapIPCError({
      name: error instanceof Error ? error.name : 'IPCError',
      code: 'IPC_INVOKE_FAILED',
      message,
      userMessage: message,
      isOperational: true,
    });
  }
}

const electronAPI = {
  /**
   * File System Operations
   */
  fs: {
    readDirectory: (path: string): ContractResult<'FS:READ_DIR'> =>
      invokeContract('FS:READ_DIR', { path }),

    readFile: (path: string): ContractResult<'FS:READ_FILE'> =>
      invokeContract('FS:READ_FILE', { path }),

    previewFile: (path: string, maxLines?: number): ContractResult<'FS:PREVIEW_FILE'> =>
      invokeContract('FS:PREVIEW_FILE', { path, maxLines }),

    readFileRange: (
      path: string,
      startLine: number,
      endLine?: number,
      contextLines?: number
    ): ContractResult<'FS:READ_FILE_RANGE'> =>
      invokeContract('FS:READ_FILE_RANGE', { path, startLine, endLine, contextLines }),

    writeFile: (path: string, content: string): ContractResult<'FS:WRITE_FILE'> =>
      invokeContract('FS:WRITE_FILE', { path, content }),

    createFile: (path: string, name: string, content?: string): ContractResult<'FS:CREATE_FILE'> =>
      invokeContract('FS:CREATE_FILE', { path, name, content }),

    createDirectory: (path: string, name: string): ContractResult<'FS:CREATE_DIR'> =>
      invokeContract('FS:CREATE_DIR', { path, name }),

    delete: (path: string, recursive?: boolean, mode?: FileDeleteMode): ContractResult<'FS:DELETE'> =>
      invokeContract('FS:DELETE', { path, recursive, mode }),

    move: (source: string, destination: string): ContractResult<'FS:MOVE'> =>
      invokeContract('FS:MOVE', { source, destination }),

    getStats: (path: string): ContractResult<'FS:GET_STATS'> =>
      invokeContract('FS:GET_STATS', { path }),

    getSystemPaths: (): ContractResult<'FS:GET_SYSTEM_PATHS'> =>
      invokeContract('FS:GET_SYSTEM_PATHS'),

    rename: (oldPath: string, newName: string): ContractResult<'FS:RENAME'> =>
      invokeContract('FS:RENAME', { oldPath, newName }),

    undo: (): ContractResult<'FS:UNDO'> => invokeContract('FS:UNDO'),

    redo: (): ContractResult<'FS:REDO'> => invokeContract('FS:REDO'),

    getJournalState: (): ContractResult<'FS:GET_JOURNAL_STATE'> =>
      invokeContract('FS:GET_JOURNAL_STATE'),

    emptyTrashVault: (): ContractResult<'FS:EMPTY_TRASH_VAULT'> =>
      invokeContract('FS:EMPTY_TRASH_VAULT'),
  },

  /**
   * Scoped Workspace (Vault) Configuration & Opt-In Indexing
   */
  vault: {
    getConfig: (): ContractResult<'VAULT:GET_CONFIG'> => invokeContract('VAULT:GET_CONFIG'),

    addRoot: (options?: { path?: string; pickDialog?: boolean }): ContractResult<'VAULT:ADD_ROOT'> =>
      invokeContract('VAULT:ADD_ROOT', options ?? { pickDialog: true }),

    removeRoot: (path: string): ContractResult<'VAULT:REMOVE_ROOT'> =>
      invokeContract('VAULT:REMOVE_ROOT', { path }),

    setIndexed: (path: string, enabled: boolean): ContractResult<'VAULT:SET_INDEXED'> =>
      invokeContract('VAULT:SET_INDEXED', { path, enabled }),

    toggleFavorite: (path: string): ContractResult<'VAULT:TOGGLE_FAVORITE'> =>
      invokeContract('VAULT:TOGGLE_FAVORITE', { path }),
  },

  /**
   * Navigation Operations
   */
  navigation: {
    back: (): ContractResult<'NAV:BACK'> => invokeContract('NAV:BACK'),

    forward: (): ContractResult<'NAV:FORWARD'> => invokeContract('NAV:FORWARD'),

    push: (path: string): ContractResult<'NAV:PUSH'> => invokeContract('NAV:PUSH', { path }),

    getState: (): ContractResult<'NAV:GET_STATE'> => invokeContract('NAV:GET_STATE'),
  },

  /**
   * Search Operations
   */
  search: {
    autocomplete: (prefix: string, maxResults?: number): ContractResult<'SEARCH:AUTOCOMPLETE'> =>
      invokeContract('SEARCH:AUTOCOMPLETE', { prefix, maxResults }),

    query: (query: string, searchRoot: string): ContractResult<'SEARCH:QUERY'> =>
      invokeContract('SEARCH:QUERY', { query, searchRoot }),

    content: (query: string, topK?: number, searchRoot?: string): ContractResult<'SEARCH:CONTENT'> =>
      invokeContract('SEARCH:CONTENT', { query, topK, searchRoot }),
  },

  /**
   * Workspace Knowledge Graph Insights
   */
  graph: {
    queryInsights: (options?: {
      symbolQuery?: string;
      backlinkTarget?: string;
    }): ContractResult<'GRAPH:QUERY_INSIGHTS'> =>
      invokeContract('GRAPH:QUERY_INSIGHTS', options),
  },

  /**
   * LLM Operations
   */
  llm: {
    query: async (
      query: string,
      callback: (chunk: string) => void,
      options?: { mode?: CopilotQueryMode; contextScope?: CopilotContextScope }
    ): Promise<IPCEnvelope<IPCResponse<'LLM:QUERY'>>> => {
      llmStreamCounter += 1;
      const channel = `LLM:QUERY:${Date.now()}:${llmStreamCounter}`;
      let streamEnded = false;
      let streamedSources: RetrievalSource[] | undefined;
      let streamedAgentSteps: AgentTraceStep[] | undefined;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;
      let resolveEnd: (() => void) | null = null;
      const endPromise = new Promise<void>((resolve) => {
        resolveEnd = resolve;
      });

      const handleChunk = (_event: IpcRendererEvent, chunk: unknown): void => {
        if (typeof chunk === 'string' && chunk !== '[DONE]') {
          callback(chunk);
        }
      };

      const handleEnd = (
        _event: IpcRendererEvent,
        payload?: {
          ok?: boolean;
          sources?: RetrievalSource[];
          agentSteps?: AgentTraceStep[];
        }
      ): void => {
        if (Array.isArray(payload?.sources)) {
          streamedSources = payload.sources;
        }
        if (Array.isArray(payload?.agentSteps)) {
          streamedAgentSteps = payload.agentSteps;
        }
        streamEnded = true;
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        resolveEnd?.();
      };

      ipcRenderer.on(channel, handleChunk);
      ipcRenderer.once(`${channel}:end`, handleEnd);

      try {
        const result = await invokeContract('LLM:QUERY', {
          query,
          channel,
          mode: options?.mode,
          contextScope: options?.contextScope,
        });
        if (result.ok && !streamEnded) {
          await Promise.race([
            endPromise,
            new Promise<void>((resolve) => {
              safetyTimer = setTimeout(() => {
                safetyTimer = null;
                resolve();
              }, 5000);
            }),
          ]);
        }
        if (
          result.ok &&
          ((streamedSources && !result.data.sources) ||
            (streamedAgentSteps && !result.data.agentSteps))
        ) {
          return wrapIPCSuccess({
            ...result.data,
            sources: result.data.sources ?? streamedSources,
            agentSteps: result.data.agentSteps ?? streamedAgentSteps,
          });
        }
        return result;
      } finally {
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        ipcRenderer.removeListener(channel, handleChunk);
        ipcRenderer.removeListener(`${channel}:end`, handleEnd);
      }
    },

    getIndexingStatus: (): ContractResult<'LLM:INDEX_STATUS'> =>
      invokeContract('LLM:INDEX_STATUS'),

    onIndexingProgress: (callback: (status: IndexingStatus) => void): (() => void) => {
      const handleProgress = (
        _event: IpcRendererEvent,
        payload: { indexed?: number; total?: number; currentFile?: string }
      ): void => {
        callback({
          indexed: payload?.indexed ?? 0,
          total: payload?.total ?? 0,
          inProgress: true,
          currentFile: payload?.currentFile || undefined,
        });
      };

      const handleComplete = (
        _event: IpcRendererEvent,
        payload: { indexed?: number; total?: number }
      ): void => {
        callback({
          indexed: payload?.indexed ?? 0,
          total: payload?.total ?? 0,
          inProgress: false,
          currentFile: undefined,
        });
      };

      ipcRenderer.on('LLM:INDEXING_PROGRESS', handleProgress);
      ipcRenderer.on('LLM:INDEXING_COMPLETE', handleComplete);

      return (): void => {
        ipcRenderer.removeListener('LLM:INDEXING_PROGRESS', handleProgress);
        ipcRenderer.removeListener('LLM:INDEXING_COMPLETE', handleComplete);
      };
    },

    startIndexing: (path: string): ContractResult<'LLM:START_INDEXING'> =>
      invokeContract('LLM:START_INDEXING', { path }),

    stopIndexing: (): ContractResult<'LLM:STOP_INDEXING'> =>
      invokeContract('LLM:STOP_INDEXING'),

    indexFile: (filePath: string): ContractResult<'LLM:INDEX_FILE'> =>
      invokeContract('LLM:INDEX_FILE', { filePath }),

    checkOllama: (): ContractResult<'LLM:CHECK_OLLAMA'> =>
      invokeContract('LLM:CHECK_OLLAMA'),

    clearIndex: (): ContractResult<'LLM:CLEAR_INDEX'> =>
      invokeContract('LLM:CLEAR_INDEX'),

    listModels: (): ContractResult<'LLM:LIST_MODELS'> =>
      invokeContract('LLM:LIST_MODELS'),

    setModelConfig: (config: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      embeddingModel?: string;
      rerankerModel?: string;
    }): ContractResult<'LLM:SET_MODEL_CONFIG'> =>
      invokeContract('LLM:SET_MODEL_CONFIG', config),
  },

  /**
   * Bounded AI Workspace Organizer Operations
   */
  ai: {
    planOrganize: (
      targetDir: string,
      strategy?: OrganizeStrategy,
      useLLM?: boolean
    ): Promise<IPCEnvelope<OrganizePlanResult>> =>
      invokeContract('AI:ORGANIZE_PLAN', { targetDir, strategy, useLLM }),

    applyOrganize: (input: {
      planId: string;
      targetDir: string;
      operations: OrganizePlanOperation[];
    }): Promise<IPCEnvelope<OrganizeApplyResult>> =>
      invokeContract('AI:ORGANIZE_APPLY', input),
  },

  /**
   * File Watcher Operations
   */
  fileWatcher: {
    subscribe: (callback: (event: { type: string; path: string }) => void): (() => void) => {
      const handleFileCreated = (_event: IpcRendererEvent, filePath: string): void => {
        callback({ type: 'create', path: filePath });
      };

      const handleFileChanged = (_event: IpcRendererEvent, filePath: string): void => {
        callback({ type: 'change', path: filePath });
      };

      const handleFileDeleted = (_event: IpcRendererEvent, filePath: string): void => {
        callback({ type: 'unlink', path: filePath });
      };

      ipcRenderer.on('FILE_CREATED', handleFileCreated);
      ipcRenderer.on('FILE_CHANGED', handleFileChanged);
      ipcRenderer.on('FILE_DELETED', handleFileDeleted);

      return (): void => {
        ipcRenderer.removeListener('FILE_CREATED', handleFileCreated);
        ipcRenderer.removeListener('FILE_CHANGED', handleFileChanged);
        ipcRenderer.removeListener('FILE_DELETED', handleFileDeleted);
      };
    },
  },

  /**
   * Clipboard Operations
   */
  clipboard: {
    writeText: (text: string): ContractResult<'CLIPBOARD:WRITE_TEXT'> =>
      invokeContract('CLIPBOARD:WRITE_TEXT', { text }),
  },

  /**
   * Shell Operations
   */
  shell: {
    openPath: (path: string): ContractResult<'SHELL:OPEN_PATH'> =>
      invokeContract('SHELL:OPEN_PATH', { path }),
  },

  /**
   * Runtime Telemetry & Self-Diagnostics
   */
  diagnostics: {
    getSnapshot: (): ContractResult<'RUNTIME:GET_DIAGNOSTICS'> =>
      invokeContract('RUNTIME:GET_DIAGNOSTICS'),
  },

  ping: (): ContractResult<'ping'> => invokeContract('ping'),
};

contextBridge.exposeInMainWorld('__electronIPCBridge', electronAPI);

export type ElectronIPCBridge = typeof electronAPI;
