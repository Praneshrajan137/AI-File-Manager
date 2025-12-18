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
  const updateNavigationState = useCallback(async () => {
    try {
      const state = await window.electronAPI.navigation.getState();
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    } catch (error) {
      console.error('Failed to get navigation state:', error);
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
    } catch (error) {
      console.error('Failed to go back:', error);
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
    } catch (error) {
      console.error('Failed to go forward:', error);
      return null;
    }
  }, [updateNavigationState]);

  const navigateTo = useCallback(async (path: string): Promise<void> => {
    try {
      await window.electronAPI.navigation.push(path);
      setCurrentPath(path);
      await updateNavigationState();
    } catch (error) {
      console.error('Failed to navigate:', error);
      throw error;
    }
  }, [updateNavigationState]);

  // Initialize navigation state on mount
  useEffect(() => {
    updateNavigationState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    canGoBack,
    canGoForward,
    currentPath,
    goBack,
    goForward,
    navigateTo,
  };
}
