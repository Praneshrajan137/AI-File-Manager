import { useCallback, useEffect, useState } from 'react';
import type { IndexingStatus } from '@shared/contracts';

interface UseLlmIndexingOptions {
  warmupReady: boolean;
}

export interface UseLlmIndexingReturn {
  indexingStatus: IndexingStatus;
  startIndexing: (path: string) => Promise<void>;
  stopIndexing: () => Promise<void>;
  clearIndex: () => Promise<void>;
}

/** Manages background vector/graph indexing status subscriptions, polling, and lifecycle commands. */
export function useLlmIndexing({ warmupReady }: UseLlmIndexingOptions): UseLlmIndexingReturn {
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({
    indexed: 0,
    total: 0,
    inProgress: false,
  });

  const startIndexing = useCallback(async (path: string): Promise<void> => {
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

  const stopIndexing = useCallback(async (): Promise<void> => {
    await window.electronAPI.llm.stopIndexing();
    setIndexingStatus((prev) => ({ ...prev, inProgress: false }));
  }, []);

  const clearIndex = useCallback(async (): Promise<void> => {
    await window.electronAPI.llm.clearIndex();
    setIndexingStatus({ indexed: 0, total: 0, inProgress: false });
  }, []);

  useEffect(() => {
    if (!warmupReady) return;
    if (typeof window.electronAPI?.llm?.onIndexingProgress !== 'function') return;
    const unsubscribe = window.electronAPI.llm.onIndexingProgress((status) => {
      setIndexingStatus(status);
    });
    return unsubscribe;
  }, [warmupReady]);

  useEffect(() => {
    if (!warmupReady) return;
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

    return (): void => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [indexingStatus.inProgress, warmupReady]);

  return {
    indexingStatus,
    startIndexing,
    stopIndexing,
    clearIndex,
  };
}
