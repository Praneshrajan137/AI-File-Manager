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
    readDirectory: (path: string) => invokeContract('FS:READ_DIR', { path }),

    readFile: (path: string) => invokeContract('FS:READ_FILE', { path }),

    previewFile: (path: string, maxLines?: number) =>
      invokeContract('FS:PREVIEW_FILE', { path, maxLines }),

    readFileRange: (path: string, startLine: number, endLine?: number, contextLines?: number) =>
      invokeContract('FS:READ_FILE_RANGE', { path, startLine, endLine, contextLines }),

    writeFile: (path: string, content: string) =>
      invokeContract('FS:WRITE_FILE', { path, content }),

    createFile: (path: string, name: string, content?: string) =>
      invokeContract('FS:CREATE_FILE', { path, name, content }),

    createDirectory: (path: string, name: string) =>
      invokeContract('FS:CREATE_DIR', { path, name }),

    delete: (path: string, recursive?: boolean, mode?: FileDeleteMode) =>
      invokeContract('FS:DELETE', { path, recursive, mode }),

    move: (source: string, destination: string) =>
      invokeContract('FS:MOVE', { source, destination }),

    getStats: (path: string) => invokeContract('FS:GET_STATS', { path }),

    getSystemPaths: () => invokeContract('FS:GET_SYSTEM_PATHS'),

    rename: (oldPath: string, newName: string) =>
      invokeContract('FS:RENAME', { oldPath, newName }),

    undo: () => invokeContract('FS:UNDO'),

    redo: () => invokeContract('FS:REDO'),

    getJournalState: () => invokeContract('FS:GET_JOURNAL_STATE'),

    emptyTrashVault: () => invokeContract('FS:EMPTY_TRASH_VAULT'),
  },

  /**
   * Scoped Workspace (Vault) Configuration & Opt-In Indexing
   */
  vault: {
    getConfig: () => invokeContract('VAULT:GET_CONFIG'),

    addRoot: (options?: { path?: string; pickDialog?: boolean }) =>
      invokeContract('VAULT:ADD_ROOT', options ?? { pickDialog: true }),

    removeRoot: (path: string) => invokeContract('VAULT:REMOVE_ROOT', { path }),

    setIndexed: (path: string, enabled: boolean) =>
      invokeContract('VAULT:SET_INDEXED', { path, enabled }),

    toggleFavorite: (path: string) => invokeContract('VAULT:TOGGLE_FAVORITE', { path }),
  },

  /**
   * Navigation Operations
   */
  navigation: {
    back: () => invokeContract('NAV:BACK'),

    forward: () => invokeContract('NAV:FORWARD'),

    push: (path: string) => invokeContract('NAV:PUSH', { path }),

    getState: () => invokeContract('NAV:GET_STATE'),
  },

  /**
   * Search Operations
   */
  search: {
    autocomplete: (prefix: string, maxResults?: number) =>
      invokeContract('SEARCH:AUTOCOMPLETE', { prefix, maxResults }),

    query: (query: string, searchRoot: string) =>
      invokeContract('SEARCH:QUERY', { query, searchRoot }),

    content: (query: string, topK?: number, searchRoot?: string) =>
      invokeContract('SEARCH:CONTENT', { query, topK, searchRoot }),
  },

  /**
   * Workspace Knowledge Graph Insights
   */
  graph: {
    queryInsights: (options?: { symbolQuery?: string; backlinkTarget?: string }) =>
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

    getIndexingStatus: () => invokeContract('LLM:INDEX_STATUS'),

    onIndexingProgress: (callback: (status: IndexingStatus) => void) => {
      const handleProgress = (
        _event: IpcRendererEvent,
        payload: { indexed?: number; total?: number; currentFile?: string }
      ) => {
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
      ) => {
        callback({
          indexed: payload?.indexed ?? 0,
          total: payload?.total ?? 0,
          inProgress: false,
          currentFile: undefined,
        });
      };

      ipcRenderer.on('LLM:INDEXING_PROGRESS', handleProgress);
      ipcRenderer.on('LLM:INDEXING_COMPLETE', handleComplete);

      return () => {
        ipcRenderer.removeListener('LLM:INDEXING_PROGRESS', handleProgress);
        ipcRenderer.removeListener('LLM:INDEXING_COMPLETE', handleComplete);
      };
    },

    startIndexing: (path: string) => invokeContract('LLM:START_INDEXING', { path }),

    stopIndexing: () => invokeContract('LLM:STOP_INDEXING'),

    indexFile: (filePath: string) => invokeContract('LLM:INDEX_FILE', { filePath }),

    checkOllama: () => invokeContract('LLM:CHECK_OLLAMA'),

    clearIndex: () => invokeContract('LLM:CLEAR_INDEX'),

    listModels: () => invokeContract('LLM:LIST_MODELS'),

    setModelConfig: (config: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      embeddingModel?: string;
      rerankerModel?: string;
    }) => invokeContract('LLM:SET_MODEL_CONFIG', config),
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
    subscribe: (callback: (event: { type: string; path: string }) => void) => {
      const handleFileCreated = (_event: IpcRendererEvent, filePath: string) => {
        callback({ type: 'create', path: filePath });
      };

      const handleFileChanged = (_event: IpcRendererEvent, filePath: string) => {
        callback({ type: 'change', path: filePath });
      };

      const handleFileDeleted = (_event: IpcRendererEvent, filePath: string) => {
        callback({ type: 'unlink', path: filePath });
      };

      ipcRenderer.on('FILE_CREATED', handleFileCreated);
      ipcRenderer.on('FILE_CHANGED', handleFileChanged);
      ipcRenderer.on('FILE_DELETED', handleFileDeleted);

      return () => {
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
    writeText: (text: string) => invokeContract('CLIPBOARD:WRITE_TEXT', { text }),
  },

  /**
   * Shell Operations
   */
  shell: {
    openPath: (path: string) => invokeContract('SHELL:OPEN_PATH', { path }),
  },

  /**
   * Runtime Telemetry & Self-Diagnostics
   */
  diagnostics: {
    getSnapshot: () => invokeContract('RUNTIME:GET_DIAGNOSTICS'),
  },

  ping: () => invokeContract('ping'),
};

contextBridge.exposeInMainWorld('__electronIPCBridge', electronAPI);

export type ElectronIPCBridge = typeof electronAPI;
