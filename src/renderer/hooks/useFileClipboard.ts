import { useCallback, useMemo, useState } from 'react';
import { resolveCopyCollisionName } from '@renderer/utils/explorerHelpers';
import {
  extractBasename,
  extractParentDirectory,
  joinChildPath,
  normalizeComparablePath,
} from '@renderer/utils/pathHelpers';

export interface FileClipboardState {
  mode: 'copy' | 'cut';
  paths: string[];
}

interface UseFileClipboardOptions {
  handleCopyPathsToDirectory: (sourcePaths: string[], destinationDir: string) => Promise<void>;
  handleDropMove: (sourcePaths: string[], destinationDir: string) => Promise<void>;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) => void;
}

export interface UseFileClipboardReturn {
  clipboard: FileClipboardState | null;
  copyToClipboard: (paths: string[]) => void;
  cutToClipboard: (paths: string[]) => void;
  clearClipboard: () => void;
  pasteFromClipboard: (destinationDir: string) => Promise<void>;
}

/**
 * Resolves destination target paths cleanly against existing directory entries so
 * same-directory copies/duplicates never collide (`notes (copy).md`, `notes (copy 2).md`).
 */
export async function resolveDestinationPath(
  sourcePath: string,
  destinationDir: string,
  existingNamesLower: Set<string>
): Promise<string> {
  const baseName = extractBasename(sourcePath);
  const directTarget = joinChildPath(destinationDir, baseName);
  const sameFile = normalizeComparablePath(sourcePath) === normalizeComparablePath(directTarget);
  const resolvedName = resolveCopyCollisionName(baseName, existingNamesLower, !sameFile);
  return joinChildPath(destinationDir, resolvedName);
}

/** Manages internal file copy/cut clipboard state and transactional paste into directories. */
export function useFileClipboard({
  handleCopyPathsToDirectory,
  handleDropMove,
  showToast,
}: UseFileClipboardOptions): UseFileClipboardReturn {
  const [clipboard, setClipboard] = useState<FileClipboardState | null>(null);

  const copyToClipboard = useCallback(
    (paths: string[]): void => {
      const unique = Array.from(new Set(paths)).filter(Boolean);
      if (unique.length === 0) return;
      setClipboard({ mode: 'copy', paths: unique });
      showToast({
        type: 'info',
        message: `Copied ${unique.length} item${unique.length === 1 ? '' : 's'} — press Ctrl+V to paste`,
      });
    },
    [showToast]
  );

  const cutToClipboard = useCallback(
    (paths: string[]): void => {
      const unique = Array.from(new Set(paths)).filter(Boolean);
      if (unique.length === 0) return;
      setClipboard({ mode: 'cut', paths: unique });
      showToast({
        type: 'info',
        message: `Ready to move ${unique.length} item${unique.length === 1 ? '' : 's'} — press Ctrl+V to paste`,
      });
    },
    [showToast]
  );

  const clearClipboard = useCallback((): void => {
    setClipboard(null);
  }, []);

  const pasteFromClipboard = useCallback(
    async (destinationDir: string): Promise<void> => {
      if (!clipboard || clipboard.paths.length === 0 || !destinationDir) return;

      if (clipboard.mode === 'cut') {
        const normalizedDest = normalizeComparablePath(destinationDir);
        const movable = clipboard.paths.filter(
          (src) => normalizeComparablePath(extractParentDirectory(src)) !== normalizedDest
        );
        if (movable.length === 0) {
          showToast({ type: 'info', message: 'Items are already in this folder' });
          setClipboard(null);
          return;
        }
        await handleDropMove(movable, destinationDir);
        setClipboard(null);
        return;
      }

      await handleCopyPathsToDirectory(clipboard.paths, destinationDir);
    },
    [clipboard, handleCopyPathsToDirectory, handleDropMove, showToast]
  );

  return useMemo(
    () => ({
      clipboard,
      copyToClipboard,
      cutToClipboard,
      clearClipboard,
      pasteFromClipboard,
    }),
    [clearClipboard, clipboard, copyToClipboard, cutToClipboard, pasteFromClipboard]
  );
}
