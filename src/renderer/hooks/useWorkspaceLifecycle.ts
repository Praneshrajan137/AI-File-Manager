import { useCallback, useEffect, useRef } from 'react';
import { useFileWatcher } from '@renderer/hooks/useFileWatcher';
import type { ToastMessage } from '@renderer/hooks/useToast';
import type { UseWorkspaceVaultReturn } from '@renderer/hooks/useWorkspaceVault';
import type { UsePreviewDrawerReturn } from '@renderer/hooks/usePreviewDrawer';
import type { UseExplorerActionsReturn } from '@renderer/hooks/useExplorerActions';
import { extractBasename, isPathInsideDirectory } from '@renderer/utils/pathHelpers';
import { getErrorMessage } from '@renderer/utils/formatters';
import type { FileEvent } from '@shared/contracts';

interface UseWorkspaceLifecycleOptions {
  paths: { home?: string; documents?: string } | null;
  pathsLoading: boolean;
  currentPath: string;
  handleNavigate: (targetPath: string) => Promise<void>;
  readDirectory: (path: string) => Promise<boolean>;
  vault: UseWorkspaceVaultReturn;
  explorer: UseExplorerActionsReturn;
  preview: UsePreviewDrawerReturn;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

/** Manages initial workspace root navigation and live primary/split-pane file watcher sync. */
export function useWorkspaceLifecycle(options: UseWorkspaceLifecycleOptions): void {
  const {
    paths,
    pathsLoading,
    currentPath,
    handleNavigate,
    readDirectory,
    vault,
    explorer,
    preview,
    showToast,
  } = options;

  const initializedRef = useRef<boolean>(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPrimaryRefreshRef = useRef<boolean>(false);
  const pendingSecondaryRefreshRef = useRef<boolean>(false);

  useEffect(() => {
    return (): void => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (pathsLoading || initializedRef.current) return;
    initializedRef.current = true;

    const initApp = async (): Promise<void> => {
      try {
        const initialVault = await vault.refreshWorkspaceMetadata();
        const initialDir = initialVault?.allowedRoots?.[0] || paths?.home || paths?.documents;
        if (initialDir) {
          await handleNavigate(initialDir);
        }
      } catch (err: unknown) {
        showToast({ type: 'error', message: getErrorMessage(err, 'Failed to initialize workspace') });
      }
    };
    void initApp();
  }, [handleNavigate, paths, pathsLoading, showToast, vault]);

  const handleFileWatcherEvent = useCallback(
    (event: FileEvent): void => {
      vault.setLastWatcherEvent(event);
      preview.syncPreviewWatcherEvent(event.path, event.type);

      const primaryMatch = Boolean(currentPath && isPathInsideDirectory(event.path, currentPath));
      const secondaryMatch = Boolean(
        vault.splitPaneOpen &&
          explorer.secondaryPath &&
          isPathInsideDirectory(event.path, explorer.secondaryPath)
      );

      if (primaryMatch) {
        pendingPrimaryRefreshRef.current = true;
        showToast({
          type: 'info',
          message: `File ${event.type}: ${extractBasename(event.path)}`,
          duration: 2000,
        });
      }
      if (secondaryMatch) {
        pendingSecondaryRefreshRef.current = true;
      }

      if ((primaryMatch || secondaryMatch) && !refreshTimerRef.current) {
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          if (pendingPrimaryRefreshRef.current && currentPath) {
            pendingPrimaryRefreshRef.current = false;
            void readDirectory(currentPath);
            void vault.refreshWorkspaceMetadata();
          }
          if (
            pendingSecondaryRefreshRef.current &&
            vault.splitPaneOpen &&
            explorer.secondaryPath
          ) {
            pendingSecondaryRefreshRef.current = false;
            void explorer.loadSecondaryDirectory(explorer.secondaryPath);
          }
        }, 180);
      }
    },
    [currentPath, explorer, preview, readDirectory, showToast, vault]
  );

  useFileWatcher(handleFileWatcherEvent);
}
