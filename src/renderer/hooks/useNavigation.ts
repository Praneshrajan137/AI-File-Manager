import { useState, useCallback, useEffect } from 'react';

interface UseNavigationReturn {
  canGoBack: boolean;
  canGoForward: boolean;
  currentPath: string;

  goBack: () => Promise<string | null>;
  goForward: () => Promise<string | null>;
  navigateTo: (path: string) => Promise<void>;
}

export function useNavigation(): UseNavigationReturn {
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [canGoForward, setCanGoForward] = useState<boolean>(false);
  const [currentPath, setCurrentPath] = useState<string>('');

  // Update navigation state
  const updateNavigationState = useCallback(async (): Promise<void> => {
    try {
      const state = await window.electronAPI.navigation.getState();
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    } catch {
      // Safe no-op if navigation bridge is unavailable
    }
  }, []);

  const goBack = useCallback(async (): Promise<string | null> => {
    try {
      const result = await window.electronAPI.navigation.back();
      if (result && typeof result === 'string') {
        setCurrentPath(result);
        await updateNavigationState();
        return result;
      }
      return null;
    } catch {
      return null;
    }
  }, [updateNavigationState]);

  const goForward = useCallback(async (): Promise<string | null> => {
    try {
      const result = await window.electronAPI.navigation.forward();
      if (result && typeof result === 'string') {
        setCurrentPath(result);
        await updateNavigationState();
        return result;
      }
      return null;
    } catch {
      return null;
    }
  }, [updateNavigationState]);

  const navigateTo = useCallback(async (path: string): Promise<void> => {
    await window.electronAPI.navigation.push(path);
    setCurrentPath(path);
    await updateNavigationState();
  }, [updateNavigationState]);

  // Initialize navigation state on mount
  useEffect(() => {
    void updateNavigationState();
  }, [updateNavigationState]);

  return {
    canGoBack,
    canGoForward,
    currentPath,
    goBack,
    goForward,
    navigateTo,
  };
}
