import { useState, useCallback, useEffect, useRef } from 'react';

export interface Message {
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

interface UseLLMReturn {
  messages: Message[];
  loading: boolean;
  indexingStatus: IndexingStatus;

  sendQuery: (query: string) => Promise<void>;
  startIndexing: (path: string) => Promise<void>;
  stopIndexing: () => Promise<void>;
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

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      let responseContent = '';

      // Use streaming response from LLM
      await window.electronAPI.llm.query(query, (chunk: string) => {
        responseContent += chunk;

        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];

          if (lastMsg?.role === 'assistant') {
            // Update existing assistant message
            lastMsg.content = responseContent;
          } else {
            // Add new assistant message
            newMessages.push({
              role: 'assistant',
              content: responseContent,
              timestamp: Date.now(),
            });
          }

          return newMessages;
        });
      });

      loadingRef.current = false;
      setLoading(false);
    } catch (error) {
      console.error('LLM query error:', error);

      // Add error message
      setMessages(prev => [
        ...prev,
        {
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
      await window.electronAPI.llm.startIndexing(path);
      setIndexingStatus(prev => ({ ...prev, inProgress: true }));
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

  // Poll indexing status
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const pollIndexingStatus = async () => {
      try {
        const status = await window.electronAPI.llm.getIndexingStatus();
        setIndexingStatus(status);
      } catch (error) {
        console.error('Failed to get indexing status:', error);
      }
    };

    // Poll every 2 seconds if indexing is in progress
    if (indexingStatus.inProgress) {
      intervalId = setInterval(pollIndexingStatus, 2000);
    }

    return () => {
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
  };
}
