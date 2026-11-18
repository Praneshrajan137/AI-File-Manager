import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  AgentTraceStep,
  IndexingStatus,
  LLMModelsSnapshot,
} from '@shared/contracts';
import { useLlmIndexing } from './useLlmIndexing';
import { applyQueryErrorToMessages, buildLlmMetadataPatch } from './llmMessageHelpers';
import type { Message, SendQueryOptions } from './llmTypes';

export type { IndexingStatus, Message, SendQueryOptions };

let messageIdCounter = 0;

export interface UseLLMOptions {
  isActive?: boolean;
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
  applyModelsSnapshot: (snapshot: LLMModelsSnapshot) => void;
}

export function useLLM(hookOptions?: UseLLMOptions): UseLLMReturn {
  const isActive = hookOptions?.isActive ?? true;
  const deferWarmupMs = hookOptions?.deferWarmupMs ?? 0;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [modelsSnapshot, setModelsSnapshot] = useState<LLMModelsSnapshot | null>(null);
  const [warmupReady, setWarmupReady] = useState<boolean>(isActive);

  const loadingRef = useRef<boolean>(false);
  const messagesRef = useRef<Message[]>([]);
  const activeChannelRef = useRef<string | null>(null);
  const querySeqRef = useRef<number>(0);
  const activeQueryIdRef = useRef<number | null>(null);

  const { indexingStatus, startIndexing, stopIndexing, clearIndex } = useLlmIndexing({ warmupReady });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (warmupReady) return;
    if (isActive) {
      setWarmupReady(true);
      return;
    }
    if (deferWarmupMs && deferWarmupMs > 0) {
      const timer = setTimeout(() => setWarmupReady(true), deferWarmupMs);
      return (): void => clearTimeout(timer);
    }
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

  useEffect(() => {
    if (warmupReady) {
      void refreshModels();
    }
  }, [refreshModels, warmupReady]);

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
      if (activeQueryIdRef.current !== myQueryId) return;
      setMessages((prev) => {
        const idx = prev.findIndex((msg) => msg.id === assistantMessageId);
        const existing = idx >= 0 ? prev[idx] : undefined;
        const resolvedPatch = typeof patch === 'function' ? patch(existing) : patch;
        if (existing) {
          return prev.map((msg, i) => (i === idx ? { ...msg, ...resolvedPatch } : msg));
        }
        return [
          ...prev,
          { id: assistantMessageId, role: 'assistant', content: '', timestamp: assistantTimestamp, ...resolvedPatch },
        ];
      });
    };

    try {
      let responseContent = '';
      const result = await window.electronAPI.llm.query(
        query,
        (chunk: string) => {
          if (activeQueryIdRef.current !== myQueryId) return;
          responseContent += chunk;
          const latestContent = responseContent;
          upsertAssistant({ content: latestContent });
        },
        {
          mode: options?.mode,
          contextScope: options?.contextScope,
          history: historyTurns.length > 0 ? historyTurns : undefined,
          onChannelCreated: (channel: string): void => {
            if (activeQueryIdRef.current === myQueryId) activeChannelRef.current = channel;
          },
          onStep: (step: AgentTraceStep): void => {
            if (activeQueryIdRef.current !== myQueryId) return;
            upsertAssistant((existing) => ({
              agentSteps: [...(existing?.agentSteps ?? []), step],
            }));
          },
        }
      );

      if (activeQueryIdRef.current !== myQueryId) return;
      activeChannelRef.current = null;

      if (buildLlmMetadataPatch(result)) {
        upsertAssistant((existing) => buildLlmMetadataPatch(result, existing) ?? {});
      }

      if (!result?.success && result?.error && !responseContent.includes(result.error)) {
        const finalContent =
          responseContent.trim().length > 0
            ? `${responseContent}\n\nError: ${result.error}`
            : `Error: ${result.error}`;
        upsertAssistant({
          content: finalContent,
          isError: true,
          retryQuery: query,
          retryOptions: options,
        });
      }

      if (activeQueryIdRef.current === myQueryId) {
        activeQueryIdRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    } catch (err: unknown) {
      if (activeQueryIdRef.current !== myQueryId) return;
      activeChannelRef.current = null;
      activeQueryIdRef.current = null;
      setMessages((prev) => applyQueryErrorToMessages(prev, assistantMessageId, err, query, options));
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const applyModelsSnapshot = useCallback((snapshot: LLMModelsSnapshot): void => {
    setModelsSnapshot(snapshot);
  }, []);

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
    applyModelsSnapshot,
  };
}
