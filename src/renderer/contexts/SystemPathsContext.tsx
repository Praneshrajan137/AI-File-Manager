import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemPaths } from '@shared/contracts';
import { getErrorMessage } from '@renderer/utils/formatters';

export interface SystemPathsContextValue {
  paths: SystemPaths | null;
  loading: boolean;
  error: string | null;
  retry: () => Promise<SystemPaths | null>;
}

const SystemPathsContext = createContext<SystemPathsContextValue | null>(null);

/**
 * Fetches OS home/documents/downloads/pictures paths once per session and shares them across
 * App initialization, Sidebar QuickAccess, DirectoryTree, and Breadcrumb without duplicate IPCs.
 */
export const SystemPathsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [paths, setPaths] = useState<SystemPaths | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<SystemPaths | null> => {
    const getSystemPaths = window.electronAPI?.fs?.getSystemPaths;
    if (typeof getSystemPaths !== 'function') {
      if (mountedRef.current) {
        setLoading(false);
        setError('System path service is unavailable.');
      }
      return null;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await getSystemPaths();
      if (mountedRef.current) {
        setPaths(result);
        setError(null);
      }
      return result;
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(getErrorMessage(err, 'Failed to resolve system folders'));
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<SystemPathsContextValue>(
    () => ({
      paths,
      loading,
      error,
      retry: load,
    }),
    [error, load, loading, paths]
  );

  return <SystemPathsContext.Provider value={value}>{children}</SystemPathsContext.Provider>;
};

/**
 * Reads shared system paths with a safe standalone fallback for isolated unit tests.
 */
export function useSystemPaths(): SystemPathsContextValue {
  const ctx = useContext(SystemPathsContext);
  const [fallbackPaths, setFallbackPaths] = useState<SystemPaths | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState<boolean>(!ctx);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  const loadStandalone = useCallback(async (): Promise<SystemPaths | null> => {
    const getSystemPaths = window.electronAPI?.fs?.getSystemPaths;
    if (typeof getSystemPaths !== 'function') {
      setFallbackLoading(false);
      setFallbackError('System path service is unavailable.');
      return null;
    }

    setFallbackLoading(true);
    setFallbackError(null);
    try {
      const res = await getSystemPaths();
      setFallbackPaths(res);
      return res;
    } catch (err: unknown) {
      setFallbackError(getErrorMessage(err, 'Failed to resolve system folders'));
      return null;
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ctx) {
      void loadStandalone();
    }
  }, [ctx, loadStandalone]);

  if (ctx) {
    return ctx;
  }

  return {
    paths: fallbackPaths,
    loading: fallbackLoading,
    error: fallbackError,
    retry: loadStandalone,
  };
}
