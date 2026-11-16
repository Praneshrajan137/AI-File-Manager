import { useCallback } from 'react';
import type { FileNode } from '@shared/contracts';
import {
  extractBasename,
  extractParentDirectory,
  joinChildPath,
  normalizeComparablePath,
} from '@renderer/utils/pathHelpers';
import { resolveDestinationPath } from './useFileClipboard';

interface UseExplorerTransferOptions {
  currentPath: string;
  files: FileNode[];
  handleUndo: () => Promise<void>;
  refreshActiveDirectories: (overridePrimaryPath?: string) => Promise<void>;
  refreshWorkspaceMetadata: () => Promise<unknown>;
  showToast: (toast: {
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

export interface UseExplorerTransferReturn {
  handleDropMove: (sourcePaths: string[], destinationDir: string) => Promise<void>;
  handleCopyPathsToDirectory: (sourcePaths: string[], destinationDir: string) => Promise<void>;
  handleDuplicatePaths: (sourcePaths: string[]) => Promise<void>;
  handleDuplicateFile: (file: FileNode) => Promise<void>;
}

/** Handles drag-and-drop moves, copy transfers with collision resolution, and file duplication. */
export function useExplorerTransfer(
  options: UseExplorerTransferOptions
): UseExplorerTransferReturn {
  const {
    currentPath,
    files,
    handleUndo,
    refreshActiveDirectories,
    refreshWorkspaceMetadata,
    showToast,
  } = options;

  const handleDropMove = useCallback(
    async (sourcePaths: string[], destinationDir: string): Promise<void> => {
      const normalizedDest = normalizeComparablePath(destinationDir);
      const uniqueSources = Array.from(new Set(sourcePaths)).filter((src) => {
        if (!src || normalizeComparablePath(src) === normalizedDest) return false;
        return normalizeComparablePath(extractParentDirectory(src)) !== normalizedDest;
      });
      if (uniqueSources.length === 0) return;

      let movedCount = 0;
      let lastError: string | null = null;
      const batchFn = window.electronAPI?.fs?.batchTransfer;

      if (typeof batchFn === 'function' && uniqueSources.length > 1) {
        try {
          const steps = uniqueSources.map((src) => ({
            type: 'move' as const,
            source: src,
            destination: joinChildPath(destinationDir, extractBasename(src)),
          }));
          const batchRes = await batchFn(steps, `Move ${uniqueSources.length} items`);
          movedCount = batchRes.count;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      } else {
        for (const src of uniqueSources) {
          const destPath = joinChildPath(destinationDir, extractBasename(src));
          try {
            await window.electronAPI.fs.move(src, destPath);
            movedCount += 1;
          } catch (err: unknown) {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }
      }
      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();
      if (movedCount > 0) {
        showToast({
          type: 'success',
          message: `Moved ${movedCount} item(s)`,
          actionLabel: 'Undo',
          onAction: (): void => {
            void handleUndo();
          },
        });
      } else if (lastError) {
        showToast({ type: 'error', message: `Move failed: ${lastError}` });
      }
    },
    [handleUndo, refreshActiveDirectories, refreshWorkspaceMetadata, showToast]
  );

  const handleCopyPathsToDirectory = useCallback(
    async (sourcePaths: string[], destinationDir: string): Promise<void> => {
      const copyFn = window.electronAPI?.fs?.copy;
      if (!destinationDir || sourcePaths.length === 0) return;
      if (typeof copyFn !== 'function') {
        showToast({ type: 'error', message: 'Copy operation is unavailable' });
        return;
      }

      const existingNamesLower = new Set<string>();
      if (normalizeComparablePath(destinationDir) === normalizeComparablePath(currentPath)) {
        files.forEach((f) => existingNamesLower.add(f.name.toLowerCase()));
      } else if (typeof window.electronAPI?.fs?.readDirectory === 'function') {
        try {
          const destEntries = await window.electronAPI.fs.readDirectory(destinationDir);
          destEntries.forEach((f) => existingNamesLower.add(f.name.toLowerCase()));
        } catch {
          // Fall back to empty set if listing unreadable
        }
      }

      let copiedCount = 0;
      let lastError: string | null = null;
      const batchFn = window.electronAPI?.fs?.batchTransfer;
      const plannedDestinations: Array<{ type: 'copy'; source: string; destination: string }> = [];
      for (const src of sourcePaths) {
        const destPath = await resolveDestinationPath(src, destinationDir, existingNamesLower);
        plannedDestinations.push({ type: 'copy', source: src, destination: destPath });
      }

      if (typeof batchFn === 'function' && plannedDestinations.length > 1) {
        try {
          const batchRes = await batchFn(
            plannedDestinations,
            `Copy ${plannedDestinations.length} items`
          );
          copiedCount = batchRes.count;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      } else {
        for (const step of plannedDestinations) {
          try {
            await copyFn(step.source, step.destination);
            copiedCount += 1;
          } catch (err: unknown) {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }
      }

      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();
      if (copiedCount > 0) {
        showToast({
          type: 'success',
          message: `Copied ${copiedCount} item(s)`,
          actionLabel: 'Undo',
          onAction: (): void => {
            void handleUndo();
          },
        });
      } else if (lastError) {
        showToast({ type: 'error', message: `Copy failed: ${lastError}` });
      }
    },
    [currentPath, files, handleUndo, refreshActiveDirectories, refreshWorkspaceMetadata, showToast]
  );

  const handleDuplicatePaths = useCallback(
    async (sourcePaths: string[]): Promise<void> => {
      const byParent = new Map<string, string[]>();
      for (const p of sourcePaths) {
        const parent = extractParentDirectory(p);
        if (!parent) continue;
        const list = byParent.get(parent) ?? [];
        list.push(p);
        byParent.set(parent, list);
      }
      for (const [parentDir, paths] of byParent.entries()) {
        await handleCopyPathsToDirectory(paths, parentDir);
      }
    },
    [handleCopyPathsToDirectory]
  );

  const handleDuplicateFile = useCallback(
    async (file: FileNode): Promise<void> => {
      await handleDuplicatePaths([file.path]);
    },
    [handleDuplicatePaths]
  );

  return {
    handleDropMove,
    handleCopyPathsToDirectory,
    handleDuplicatePaths,
    handleDuplicateFile,
  };
}
