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
  AgentTerminationReason,
  AgentTokenUsage,
  AgentTraceStep,
  AgentVerificationReport,
  BatchTransferStep,
  CopilotContextScope,
  CopilotQueryMode,
  FileDeleteMode,
  IndexingStatus,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  RetrievalSource,
  UIPreferencesSnapshot,
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

    move: (
      source: string,
      destination: string,
      repairMarkdownLinks?: boolean
    ): ContractResult<'FS:MOVE'> =>
      invokeContract('FS:MOVE', { source, destination, repairMarkdownLinks }),

    copy: (source: string, destination: string): ContractResult<'FS:COPY'> =>
      invokeContract('FS:COPY', { source, destination }),

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

    watchSplitDir: (path: string | null): ContractResult<'FS:WATCH_SPLIT_DIR'> =>
      invokeContract('FS:WATCH_SPLIT_DIR', { path }),

    batchTransfer: (
      steps: BatchTransferStep[],
      description?: string
    ): ContractResult<'FS:BATCH_TRANSFER'> =>
      invokeContract('FS:BATCH_TRANSFER', { steps, description }),
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

    setUiPrefs: (prefs: Partial<UIPreferencesSnapshot>): ContractResult<'VAULT:SET_UI_PREFS'> =>
      invokeContract('VAULT:SET_UI_PREFS', prefs),
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

    checkImpact: (paths: string[]): ContractResult<'GRAPH:IMPACT_CHECK'> =>
      invokeContract('GRAPH:IMPACT_CHECK', { paths }),

    getWorkspaceMap: (options?: {
      rootPrefix?: string;
      maxNodes?: number;
    }): ContractResult<'GRAPH:WORKSPACE_MAP'> =>
      invokeContract('GRAPH:WORKSPACE_MAP', options),

    getCollections: (options?: { rootPrefix?: string }): ContractResult<'GRAPH:COLLECTIONS'> =>
      invokeContract('GRAPH:COLLECTIONS', options),

    getFileConnections: (filePath: string): ContractResult<'GRAPH:FILE_CONNECTIONS'> =>
      invokeContract('GRAPH:FILE_CONNECTIONS', { filePath }),
  },

  /**
   * LLM Operations
   */
  llm: {
    query: async (
      query: string,
      callback: (chunk: string) => void,
      options?: {
        mode?: CopilotQueryMode;
        contextScope?: CopilotContextScope;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        onStep?: (step: AgentTraceStep) => void;
        onChannelCreated?: (channel: string) => void;
      }
    ): Promise<IPCEnvelope<IPCResponse<'LLM:QUERY'>>> => {
      llmStreamCounter += 1;
      const channel = `LLM:QUERY:${Date.now()}:${llmStreamCounter}`;
      options?.onChannelCreated?.(channel);
      let streamEnded = false;
      let streamedSanitizedAnswer: string | undefined;
      let streamedSources: RetrievalSource[] | undefined;
      let streamedAgentSteps: AgentTraceStep[] | undefined;
      let streamedOfflineSynthesis: boolean | undefined;
      let streamedProposedPlan: OrganizePlanResult | undefined;
      let streamedTraceId: string | undefined;
      let streamedTerminationReason: AgentTerminationReason | undefined;
      let streamedVerification: AgentVerificationReport | undefined;
      let streamedUsage: AgentTokenUsage | undefined;
      let streamedRetrievalMs: number | undefined;
      let streamedGenerationMs: number | undefined;
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

      const handleStep = (_event: IpcRendererEvent, step: AgentTraceStep): void => {
        if (step && typeof step === 'object') {
          options?.onStep?.(step);
        }
      };

      const handleEnd = (
        _event: IpcRendererEvent,
        payload?: {
          ok?: boolean;
          sanitizedAnswer?: string;
          sources?: RetrievalSource[];
          agentSteps?: AgentTraceStep[];
          offlineSynthesis?: boolean;
          proposedPlan?: OrganizePlanResult;
          traceId?: string;
          terminationReason?: AgentTerminationReason;
          verification?: AgentVerificationReport;
          usage?: AgentTokenUsage;
          retrievalMs?: number;
          generationMs?: number;
        }
      ): void => {
        if (typeof payload?.sanitizedAnswer === 'string') {
          streamedSanitizedAnswer = payload.sanitizedAnswer;
        }
        if (Array.isArray(payload?.sources)) {
          streamedSources = payload.sources;
        }
        if (Array.isArray(payload?.agentSteps)) {
          streamedAgentSteps = payload.agentSteps;
        }
        if (typeof payload?.offlineSynthesis === 'boolean') {
          streamedOfflineSynthesis = payload.offlineSynthesis;
        }
        if (payload?.proposedPlan) {
          streamedProposedPlan = payload.proposedPlan;
        }
        if (typeof payload?.traceId === 'string') {
          streamedTraceId = payload.traceId;
        }
        if (payload?.terminationReason) {
          streamedTerminationReason = payload.terminationReason;
        }
        if (payload?.verification) {
          streamedVerification = payload.verification;
        }
        if (payload?.usage) {
          streamedUsage = payload.usage;
        }
        if (typeof payload?.retrievalMs === 'number') {
          streamedRetrievalMs = payload.retrievalMs;
        }
        if (typeof payload?.generationMs === 'number') {
          streamedGenerationMs = payload.generationMs;
        }
        streamEnded = true;
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        resolveEnd?.();
      };

      ipcRenderer.on(channel, handleChunk);
      ipcRenderer.on(`${channel}:step`, handleStep);
      ipcRenderer.once(`${channel}:end`, handleEnd);

      try {
        const result = await invokeContract('LLM:QUERY', {
          query,
          channel,
          mode: options?.mode,
          contextScope: options?.contextScope,
          history: options?.history,
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
          ((streamedSanitizedAnswer !== undefined && result.data.sanitizedAnswer === undefined) ||
            (streamedSources && !result.data.sources) ||
            (streamedAgentSteps && !result.data.agentSteps) ||
            (streamedOfflineSynthesis !== undefined && result.data.offlineSynthesis === undefined) ||
            (streamedProposedPlan && !result.data.proposedPlan) ||
            (streamedTraceId && !result.data.traceId) ||
            (streamedTerminationReason && !result.data.terminationReason) ||
            (streamedVerification && !result.data.verification) ||
            (streamedUsage && !result.data.usage) ||
            (streamedRetrievalMs !== undefined && result.data.retrievalMs === undefined) ||
            (streamedGenerationMs !== undefined && result.data.generationMs === undefined))
        ) {
          return wrapIPCSuccess({
            ...result.data,
            sanitizedAnswer: result.data.sanitizedAnswer ?? streamedSanitizedAnswer,
            sources: result.data.sources ?? streamedSources,
            agentSteps: result.data.agentSteps ?? streamedAgentSteps,
            offlineSynthesis: result.data.offlineSynthesis ?? streamedOfflineSynthesis,
            proposedPlan: result.data.proposedPlan ?? streamedProposedPlan,
            traceId: result.data.traceId ?? streamedTraceId,
            terminationReason: result.data.terminationReason ?? streamedTerminationReason,
            verification: result.data.verification ?? streamedVerification,
            usage: result.data.usage ?? streamedUsage,
            retrievalMs: result.data.retrievalMs ?? streamedRetrievalMs,
            generationMs: result.data.generationMs ?? streamedGenerationMs,
          });
        }
        return result;
      } finally {
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        ipcRenderer.removeListener(channel, handleChunk);
        ipcRenderer.removeListener(`${channel}:step`, handleStep);
        ipcRenderer.removeListener(`${channel}:end`, handleEnd);
      }
    },

    abortQuery: (channel: string): ContractResult<'LLM:ABORT_QUERY'> =>
      invokeContract('LLM:ABORT_QUERY', { channel }),

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

    getTraces: (limit?: number): ContractResult<'LLM:GET_TRACES'> =>
      invokeContract('LLM:GET_TRACES', limit !== undefined ? { limit } : undefined),

    clearTraces: (): ContractResult<'LLM:CLEAR_TRACES'> =>
      invokeContract('LLM:CLEAR_TRACES'),

    listModels: (): ContractResult<'LLM:LIST_MODELS'> =>
      invokeContract('LLM:LIST_MODELS'),

    setModelConfig: (config: {
      provider?: 'ollama' | 'openai_compatible';
      openAiBaseUrl?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      embeddingModel?: string;
      rerankerModel?: string;
      embeddingDevice?: 'auto' | 'cpu' | 'dml' | 'webgpu';
      enableVisionCaptioning?: boolean;
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
      useLLM?: boolean,
      recursive?: boolean
    ): Promise<IPCEnvelope<OrganizePlanResult>> =>
      invokeContract('AI:ORGANIZE_PLAN', { targetDir, strategy, useLLM, recursive }),

    applyOrganize: (input: {
      planId: string;
      targetDir: string;
      operations: OrganizePlanOperation[];
      repairMarkdownLinks?: boolean;
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
    revealInFolder: (path: string): ContractResult<'SHELL:REVEAL_IN_FOLDER'> =>
      invokeContract('SHELL:REVEAL_IN_FOLDER', { path }),
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
