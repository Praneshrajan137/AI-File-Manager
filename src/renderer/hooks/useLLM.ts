import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  AgentTerminationReason,
  AgentTokenUsage,
  AgentTraceStep,
  AgentVerificationReport,
  CopilotContextScope,
  CopilotQueryMode,
  LLMModelsSnapshot,
  OrganizePlanResult,
  RetrievalSource,
} from '@shared/contracts';

let messageIdCounter = 0;

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  retryQuery?: string;
  retryOptions?: SendQueryOptions;
  sources?: string[];
  structuredSources?: RetrievalSource[];
  agentSteps?: AgentTraceStep[];
  offlineSynthesis?: boolean;
  proposedPlan?: OrganizePlanResult;
  traceId?: string;
  terminationReason?: AgentTerminationReason;
  verification?: AgentVerificationReport;
  usage?: AgentTokenUsage;
  retrievalMs?: number;
  generationMs?: number;
  timestamp: number;
}

export interface IndexingStatus {
  indexed: number;
  total: number;
  inProgress: boolean;
  currentFile?: string;
}

export interface SendQueryOptions {
  mode?: CopilotQueryMode;
  contextScope?: CopilotContextScope;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface UseLLMOptions {
  /** Whether the Copilot surface is currently open/active. */
  isActive?: boolean;
  /** Optional delay (ms) before background model/index status warmup runs when inactive. */
  deferWarmupMs?: number;
}

export interface UseLLMReturn {
  messages: Message[];
  loading: boolean;
  indexingStatus: IndexingStatus;
  modelsSnapshot: LLMModelsSnapshot | null;

  sendQuery: (query: string, options?: SendQueryOptions) => Promise<void>;
  cancelQuery: () => Promise<void>;
  startIndexing: (path: string) => Promise<void>;
  stopIndexing: () => Promise<void>;
  clearIndex: () => Promise<void>;
  refreshModels: () => Promise<void>;
  setActiveModel: (modelName: string) => Promise<void>;
}

export function useLLM(hookOptions?: UseLLMOptions): UseLLMReturn {
  const isActive = hookOptions?.isActive ?? true;
  const deferWarmupMs = hookOptions?.deferWarmupMs ?? 0;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({
    indexed: 0,
    total: 0,
    inProgress: false,
  });
  const [modelsSnapshot, setModelsSnapshot] = useState<LLMModelsSnapshot | null>(null);
  const [warmupReady, setWarmupReady] = useState<boolean>(isActive || deferWarmupMs <= 0);

  const loadingRef = useRef<boolean>(false);
  const messagesRef = useRef<Message[]>([]);
  const activeChannelRef = useRef<string | null>(null);
  const querySeqRef = useRef<number>(0);
  const activeQueryIdRef = useRef<number | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (warmupReady) {
      return;
    }
    if (isActive || deferWarmupMs <= 0) {
      setWarmupReady(true);
      return;
    }
    const timer = setTimeout(() => {
      setWarmupReady(true);
    }, deferWarmupMs);
    return (): void => clearTimeout(timer);
  }, [deferWarmupMs, isActive, warmupReady]);

  const refreshModels = useCallback(async (): Promise<void> => {
    try {
      if (typeof window.electronAPI?.llm?.listModels === 'function') {
        const snapshot = await window.electronAPI.llm.listModels();
        setModelsSnapshot(snapshot);
      }
    } catch {
      // Optional in partial mocks
    }
  }, []);

  const setActiveModel = useCallback(async (modelName: string): Promise<void> => {
    const trimmed = modelName.trim();
    if (!trimmed) return;
    if (typeof window.electronAPI?.llm?.setModelConfig === 'function') {
      const updated = await window.electronAPI.llm.setModelConfig({ model: trimmed });
      setModelsSnapshot(updated.config);
    }
  }, []);

  const cancelQuery = useCallback(async (): Promise<void> => {
    const channel = activeChannelRef.current;
    activeQueryIdRef.current = null;
    activeChannelRef.current = null;
    loadingRef.current = false;
    setLoading(false);
    if (channel && typeof window.electronAPI?.llm?.abortQuery === 'function') {
      try {
        await window.electronAPI.llm.abortQuery(channel);
      } catch {
        // Ignore cancellation race if stream already finished
      }
    }
  }, []);

  const sendQuery = useCallback(async (query: string, options?: SendQueryOptions): Promise<void> => {
    if (!query.trim() || loadingRef.current) return;

    const myQueryId = ++querySeqRef.current;
    activeQueryIdRef.current = myQueryId;
    loadingRef.current = true;
    setLoading(true);

    const historyTurns =
      options?.history ??
      messagesRef.current
        .slice(-6)
        .filter((m) => !m.isError && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

    const userMessage: Message = {
      id: messageIdCounter++,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    const assistantMessageId = messageIdCounter++;
    const assistantTimestamp = Date.now();
    const upsertAssistant = (
      patch: Partial<Message> | ((existing: Message | undefined) => Partial<Message>)
    ): void => {
      if (activeQueryIdRef.current !== myQueryId) {
        return;
      }
      setMessages((prev) => {
        const idx = prev.findIndex((msg) => msg.id === assistantMessageId);
        const existing = idx >= 0 ? prev[idx] : undefined;
        const resolvedPatch = typeof patch === 'function' ? patch(existing) : patch;
        if (existing) {
          return prev.map((msg, i) => (i === idx ? { ...msg, ...resolvedPatch } : msg));
        }
        return [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: assistantTimestamp,
            ...resolvedPatch,
          },
        ];
      });
    };

    try {
      let responseContent = '';

      const result = await window.electronAPI.llm.query(
        query,
        (chunk: string) => {
          if (activeQueryIdRef.current !== myQueryId) {
            return;
          }
          responseContent += chunk;
          const latestContent = responseContent;
          upsertAssistant({ content: latestContent });
        },
        {
          mode: options?.mode,
          contextScope: options?.contextScope,
          history: historyTurns.length > 0 ? historyTurns : undefined,
          onChannelCreated: (channel: string): void => {
            if (activeQueryIdRef.current === myQueryId) {
              activeChannelRef.current = channel;
            }
          },
          onStep: (step: AgentTraceStep): void => {
            if (activeQueryIdRef.current !== myQueryId) {
              return;
            }
            upsertAssistant((existing) => ({
              agentSteps: [...(existing?.agentSteps ?? []), step],
            }));
          },
        }
      );

      if (activeQueryIdRef.current !== myQueryId) {
        return;
      }

      activeChannelRef.current = null;

      if (
        (result?.sources && result.sources.length > 0) ||
        (result?.agentSteps && result.agentSteps.length > 0) ||
        result?.offlineSynthesis !== undefined ||
        result?.proposedPlan ||
        result?.verification ||
        result?.traceId ||
        result?.terminationReason ||
        result?.usage ||
        result?.retrievalMs !== undefined ||
        result?.generationMs !== undefined
      ) {
        const structuredSources = result.sources ?? [];
        const uniquePaths = Array.from(new Set(structuredSources.map((s) => s.filePath)));
        upsertAssistant((existing) => ({
          sources: uniquePaths.length > 0 ? uniquePaths : existing?.sources,
          structuredSources:
            structuredSources.length > 0 ? structuredSources : existing?.structuredSources,
          agentSteps: result.agentSteps ?? existing?.agentSteps,
          offlineSynthesis: result.offlineSynthesis ?? existing?.offlineSynthesis,
          proposedPlan: result.proposedPlan ?? existing?.proposedPlan,
          traceId: result.traceId ?? existing?.traceId,
          terminationReason: result.terminationReason ?? existing?.terminationReason,
          verification: result.verification ?? existing?.verification,
          usage: result.usage ?? existing?.usage,
          retrievalMs: result.retrievalMs ?? existing?.retrievalMs,
          generationMs: result.generationMs ?? existing?.generationMs,
        }));
      }

      if (!result?.success && result?.error) {
        const errorText = result.error;
        if (!responseContent.includes(errorText)) {
          const finalContent =
            responseContent.trim().length > 0
              ? `${responseContent}\n\nError: ${errorText}`
              : `Error: ${errorText}`;
          upsertAssistant({
            content: finalContent,
            isError: true,
            retryQuery: query,
            retryOptions: options,
          });
        }
      }

      if (activeQueryIdRef.current === myQueryId) {
        activeQueryIdRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    } catch (err: unknown) {
      if (activeQueryIdRef.current !== myQueryId) {
        return;
      }
      activeChannelRef.current = null;
      activeQueryIdRef.current = null;
      const errMessage =
        err instanceof Error && err.message
          ? `Request failed: ${err.message}`
          : 'Sorry, I encountered an error processing your request. Please try again.';
      setMessages((prev) => {
        const idx = prev.findIndex((msg) => msg.id === assistantMessageId);
        if (idx >= 0) {
          return prev.map((msg, i) =>
            i === idx
              ? {
                  ...msg,
                  content: msg.content ? `${msg.content}\n\n${errMessage}` : errMessage,
                  isError: true,
                  retryQuery: query,
                  retryOptions: options,
                }
              : msg
          );
        }
        return [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: errMessage,
            isError: true,
            retryQuery: query,
            retryOptions: options,
            timestamp: Date.now(),
          },
        ];
      });

      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const startIndexing = useCallback(async (path: string) => {
    const response = await window.electronAPI.llm.startIndexing(path);
    if (!response?.success) {
      throw new Error(response?.error || response?.message || 'Failed to start indexing');
    }
    setIndexingStatus((prev) => ({
      ...prev,
      total: response.total ?? prev.total,
      inProgress: true,
    }));
  }, []);

  const stopIndexing = useCallback(async () => {
    await window.electronAPI.llm.stopIndexing();
    setIndexingStatus((prev) => ({ ...prev, inProgress: false }));
  }, []);

  const clearIndex = useCallback(async () => {
    await window.electronAPI.llm.clearIndex();
    setIndexingStatus({ indexed: 0, total: 0, inProgress: false });
  }, []);

  useEffect(() => {
    if (!warmupReady) {
      return;
    }
    void refreshModels();
    if (typeof window.electronAPI?.llm?.onIndexingProgress !== 'function') {
      return;
    }
    const unsubscribe = window.electronAPI.llm.onIndexingProgress((status) => {
      setIndexingStatus(status);
    });
    return unsubscribe;
  }, [refreshModels, warmupReady]);

  useEffect(() => {
    if (!warmupReady) {
      return;
    }
    let cancelled = false;
    let intervalId: NodeJS.Timeout | undefined;

    const pollIndexingStatus = async (): Promise<void> => {
      try {
        const status = await window.electronAPI.llm.getIndexingStatus();
        if (!cancelled) {
          setIndexingStatus(status);
        }
      } catch {
        // Ignore transient indexing status polling failures
      }
    };

    void pollIndexingStatus();

    if (indexingStatus.inProgress) {
      intervalId = setInterval(pollIndexingStatus, 2000);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [indexingStatus.inProgress, warmupReady]);

  return {
    messages,
    loading,
    indexingStatus,
    modelsSnapshot,
    sendQuery,
    cancelQuery,
    startIndexing,
    stopIndexing,
    clearIndex,
    refreshModels,
    setActiveModel,
  };
}
