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
 * Standard invoke channels are generated mechanically from `@shared/ipc/apiManifest`.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron';
import {
  IPCEnvelope,
  isIPCEnvelope,
  wrapIPCError,
  wrapIPCSuccess,
} from '@shared/ipc/envelope';
import { buildPreloadInvokeTree, IPC_INVOKE_MANIFEST } from '@shared/ipc/apiManifest';
import type {
  AgentTerminationReason,
  AgentTokenUsage,
  AgentTraceStep,
  AgentVerificationReport,
  CopilotContextScope,
  CopilotQueryMode,
  IndexingStatus,
  OrganizePlanResult,
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

const invokeTree = buildPreloadInvokeTree(IPC_INVOKE_MANIFEST, invokeContract);

const electronAPI = {
  ...invokeTree,

  /**
   * File System Operations (extends manifest channels with sandbox-safe drop helper)
   */
  fs: {
    ...invokeTree.fs,

    getPathsForDroppedFiles: (files: File[]): string[] => {
      if (typeof webUtils?.getPathForFile !== 'function') {
        return [];
      }
      const paths: string[] = [];
      for (const file of files) {
        try {
          const resolved = webUtils.getPathForFile(file);
          if (typeof resolved === 'string' && resolved.trim().length > 0) {
            paths.push(resolved);
          }
        } catch {
          // Ignore non-filesystem blobs
        }
      }
      return paths;
    },
  },

  /**
   * LLM Operations (extends manifest channels with push-stream query & indexing listener)
   */
  llm: {
    ...invokeTree.llm,

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
    ): ContractResult<'LLM:QUERY'> => {
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
};

contextBridge.exposeInMainWorld('__electronIPCBridge', electronAPI);

export type ElectronIPCBridge = typeof electronAPI;
