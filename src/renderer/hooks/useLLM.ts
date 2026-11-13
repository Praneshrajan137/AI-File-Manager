import { useState, useCallback, useEffect, useRef } from 'react';

// Message ID counter to ensure unique keys even with same timestamps
let messageIdCounter = 0;

export interface Message {
  id: number;  // Unique ID for React keys
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: number;
}

export interface IndexingStatus {
  indexed: number;
  total: number;
  inProgress: boolean;
  currentFile?: string;
}

export interface UseLLMReturn {
  messages: Message[];
  loading: boolean;
  indexingStatus: IndexingStatus;

  sendQuery: (query: string) => Promise<void>;
  startIndexing: (path: string) => Promise<void>;
  stopIndexing: () => Promise<void>;
  clearIndex: () => Promise<void>;
}

export function useLLM(): UseLLMReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({
    indexed: 0,
    total: 0,
    inProgress: false,
  });

  // Use ref to track loading state to prevent stale closures
  const loadingRef = useRef<boolean>(false);

  const sendQuery = useCallback(async (query: string) => {
    // Check loading using ref to avoid stale closure
    if (!query.trim() || loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);

    // Add user message with unique ID
    const userMessage: Message = {
      id: messageIdCounter++,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      let responseContent = '';
      const assistantMessageId = messageIdCounter++;
      const assistantTimestamp = Date.now();

      // Use streaming response from LLM
      const result = await window.electronAPI.llm.query(query, (chunk: string) => {
        responseContent += chunk;
        const latestContent = responseContent;

        setMessages(prev => {
          const existingIndex = prev.findIndex(msg => msg.id === assistantMessageId);
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
      });

      if (!result?.success && result?.error) {
        const errorText = result.error;
        if (!responseContent.includes(errorText)) {
          const finalContent =
            responseContent.trim().length > 0
              ? `${responseContent}\n\nError: ${errorText}`
              : `Error: ${errorText}`;
          setMessages(prev => {
            const existingIndex = prev.findIndex(msg => msg.id === assistantMessageId);
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
    } catch (error) {
      console.error('LLM query error:', error);

      // Add error message with unique ID
      setMessages(prev => [
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
  }, []); // Empty deps - ref and functional updates prevent stale closures

  const startIndexing = useCallback(async (path: string) => {
    try {
      const response = await window.electronAPI.llm.startIndexing(path);
      if (!response?.success) {
        throw new Error(response?.error || response?.message || 'Failed to start indexing');
      }
      setIndexingStatus(prev => ({
        ...prev,
        total: response.total ?? prev.total,
        inProgress: true,
      }));
    } catch (error) {
      console.error('Failed to start indexing:', error);
      throw error;
    }
  }, []);

  const stopIndexing = useCallback(async () => {
    try {
      await window.electronAPI.llm.stopIndexing();
      setIndexingStatus(prev => ({ ...prev, inProgress: false }));
    } catch (error) {
      console.error('Failed to stop indexing:', error);
      throw error;
    }
  }, []);

  const clearIndex = useCallback(async () => {
    try {
      await window.electronAPI.llm.clearIndex();
      setIndexingStatus({ indexed: 0, total: 0, inProgress: false });
    } catch (error) {
      console.error('Failed to clear index:', error);
      throw error;
    }
  }, []);

  // Poll indexing status (hydrates once on mount and polls while active)
  useEffect(() => {
    let cancelled = false;
    let intervalId: NodeJS.Timeout | undefined;

    const pollIndexingStatus = async () => {
      try {
        const status = await window.electronAPI.llm.getIndexingStatus();
        if (!cancelled) {
          setIndexingStatus(status);
        }
      } catch (error) {
        console.error('Failed to get indexing status:', error);
      }
    };

    void pollIndexingStatus();

    // Poll every 2 seconds if indexing is in progress
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
    sendQuery,
    startIndexing,
    stopIndexing,
    clearIndex,
  };
}
