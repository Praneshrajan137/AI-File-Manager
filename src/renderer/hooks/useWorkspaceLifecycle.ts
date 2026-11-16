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

      if (currentPath && isPathInsideDirectory(event.path, currentPath)) {
        void readDirectory(currentPath);
        void vault.refreshWorkspaceMetadata();
        showToast({
          type: 'info',
          message: `File ${event.type}: ${extractBasename(event.path)}`,
          duration: 2000,
        });
      }
      if (
        vault.splitPaneOpen &&
        explorer.secondaryPath &&
        isPathInsideDirectory(event.path, explorer.secondaryPath)
      ) {
        void explorer.loadSecondaryDirectory(explorer.secondaryPath);
      }
    },
    [currentPath, explorer, preview, readDirectory, showToast, vault]
  );

  useFileWatcher(handleFileWatcherEvent);
}
