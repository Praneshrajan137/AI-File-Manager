import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  AgentTraceStep,
  CopilotContextScope,
  CopilotQueryMode,
  LLMModelsSnapshot,
  RetrievalSource,
} from '@shared/contracts';

let messageIdCounter = 0;

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  structuredSources?: RetrievalSource[];
  agentSteps?: AgentTraceStep[];
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
}

export interface UseLLMReturn {
  messages: Message[];
  loading: boolean;
  indexingStatus: IndexingStatus;
  modelsSnapshot: LLMModelsSnapshot | null;

  sendQuery: (query: string, options?: SendQueryOptions) => Promise<void>;
  startIndexing: (path: string) => Promise<void>;
  stopIndexing: () => Promise<void>;
  clearIndex: () => Promise<void>;
  refreshModels: () => Promise<void>;
  setActiveModel: (modelName: string) => Promise<void>;
}

export function useLLM(): UseLLMReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({
    indexed: 0,
    total: 0,
    inProgress: false,
  });
  const [modelsSnapshot, setModelsSnapshot] = useState<LLMModelsSnapshot | null>(null);

  const loadingRef = useRef<boolean>(false);

  const refreshModels = useCallback(async () => {
    try {
      if (typeof window.electronAPI?.llm?.listModels === 'function') {
        const snapshot = await window.electronAPI.llm.listModels();
        setModelsSnapshot(snapshot);
      }
    } catch {
      // Optional in partial mocks
    }
  }, []);

  const setActiveModel = useCallback(async (modelName: string) => {
    const trimmed = modelName.trim();
    if (!trimmed) return;
    if (typeof window.electronAPI?.llm?.setModelConfig === 'function') {
      const updated = await window.electronAPI.llm.setModelConfig({ model: trimmed });
      setModelsSnapshot(updated.config);
    }
  }, []);

  const sendQuery = useCallback(async (query: string, options?: SendQueryOptions) => {
    if (!query.trim() || loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);

    const userMessage: Message = {
      id: messageIdCounter++,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      let responseContent = '';
      const assistantMessageId = messageIdCounter++;
      const assistantTimestamp = Date.now();

      const result = await window.electronAPI.llm.query(
        query,
        (chunk: string) => {
          responseContent += chunk;
          const latestContent = responseContent;

          setMessages((prev) => {
            const existingIndex = prev.findIndex((msg) => msg.id === assistantMessageId);
            if (existingIndex >= 0) {
              return prev.map((msg, idx) =>
                idx === existingIndex ? { ...msg, content: latestContent } : msg
              );
            }
            return [
              ...prev,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: latestContent,
                timestamp: assistantTimestamp,
              },
            ];
          });
        },
        options
      );

      if (
        (result?.sources && result.sources.length > 0) ||
        (result?.agentSteps && result.agentSteps.length > 0)
      ) {
        const structuredSources = result.sources ?? [];
        const uniquePaths = Array.from(new Set(structuredSources.map((s) => s.filePath)));
        const agentSteps = result.agentSteps;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  sources: uniquePaths.length > 0 ? uniquePaths : msg.sources,
                  structuredSources:
                    structuredSources.length > 0 ? structuredSources : msg.structuredSources,
                  agentSteps: agentSteps ?? msg.agentSteps,
                }
              : msg
          )
        );
      }

      if (!result?.success && result?.error) {
        const errorText = result.error;
        if (!responseContent.includes(errorText)) {
          const finalContent =
            responseContent.trim().length > 0
              ? `${responseContent}\n\nError: ${errorText}`
              : `Error: ${errorText}`;
          setMessages((prev) => {
            const existingIndex = prev.findIndex((msg) => msg.id === assistantMessageId);
            if (existingIndex >= 0) {
              return prev.map((msg, idx) =>
                idx === existingIndex ? { ...msg, content: finalContent } : msg
              );
            }
            return [
              ...prev,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: finalContent,
                timestamp: assistantTimestamp,
              },
            ];
          });
        }
      }

      loadingRef.current = false;
      setLoading(false);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: messageIdCounter++,
          role: 'assistant',
          content: 'Sorry, I encountered an error processing your request. Please try again.',
          timestamp: Date.now(),
        },
      ]);

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
    void refreshModels();
    if (typeof window.electronAPI?.llm?.onIndexingProgress !== 'function') {
      return;
    }
    const unsubscribe = window.electronAPI.llm.onIndexingProgress((status) => {
      setIndexingStatus(status);
    });
    return unsubscribe;
  }, [refreshModels]);

  useEffect(() => {
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
  }, [indexingStatus.inProgress]);

  return {
    messages,
    loading,
    indexingStatus,
    modelsSnapshot,
    sendQuery,
    startIndexing,
    stopIndexing,
    clearIndex,
    refreshModels,
    setActiveModel,
  };
}
