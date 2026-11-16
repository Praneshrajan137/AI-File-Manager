import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { FileNode, SortCriteria, SortDirection } from '@shared/contracts';
import { sortFileNodes, toggleMultiSelection } from '@renderer/utils/explorerHelpers';
import type { SelectionModifiers } from './useExplorerActions';

export interface UseSplitPaneStateOptions {
  sortBy: SortCriteria;
  sortDirection: SortDirection;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) => void;
}

export interface UseSplitPaneStateReturn {
  secondaryPath: string;
  secondaryFiles: FileNode[];
  secondaryLoading: boolean;
  secondarySelectedFiles: string[];
  handleSecondaryFileClick: (file: FileNode, e?: SelectionModifiers) => void;
  loadSecondaryDirectory: (targetPath: string) => Promise<void>;
  stopSecondaryWatch: () => void;
}

/** Manages state, selection, and watcher sync for the secondary Split-Pane explorer. */
export function useSplitPaneState({
  sortBy,
  sortDirection,
  showToast,
}: UseSplitPaneStateOptions): UseSplitPaneStateReturn {
  const [secondaryPath, setSecondaryPath] = useState<string>('');
  const [secondaryFiles, setSecondaryFiles] = useState<FileNode[]>([]);
  const [secondaryLoading, setSecondaryLoading] = useState<boolean>(false);
  const [secondarySelectedFiles, setSecondarySelectedFiles] = useState<string[]>([]);
  const secondaryAnchorRef = useRef<string | null>(null);
  const secondaryReadSeqRef = useRef<number>(0);

  const orderedSecondaryPaths = useMemo(
    () => sortFileNodes(secondaryFiles, sortBy, sortDirection).map((node) => node.path),
    [secondaryFiles, sortBy, sortDirection]
  );

  useEffect(() => {
    const validSecondaryPaths = new Set(orderedSecondaryPaths);
    setSecondarySelectedFiles((prev) => {
      const next = prev.filter((p) => validSecondaryPaths.has(p));
      return next.length === prev.length ? prev : next;
    });
    if (secondaryAnchorRef.current && !validSecondaryPaths.has(secondaryAnchorRef.current)) {
      secondaryAnchorRef.current = null;
    }
  }, [orderedSecondaryPaths]);

  const loadSecondaryDirectory = useCallback(
    async (targetPath: string): Promise<void> => {
      const seq = ++secondaryReadSeqRef.current;
      setSecondaryLoading(true);
      try {
        const nextFiles = await window.electronAPI.fs.readDirectory(targetPath);
        if (seq !== secondaryReadSeqRef.current) return;
        setSecondaryPath(targetPath);
        setSecondaryFiles(nextFiles);
        setSecondarySelectedFiles([]);
        secondaryAnchorRef.current = null;
        void window.electronAPI?.fs?.watchSplitDir?.(targetPath)?.catch?.(() => undefined);
      } catch (err: unknown) {
        if (seq === secondaryReadSeqRef.current) {
          showToast({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to load split pane directory',
          });
        }
      } finally {
        if (seq === secondaryReadSeqRef.current) {
          setSecondaryLoading(false);
        }
      }
    },
    [showToast]
  );

  const stopSecondaryWatch = useCallback((): void => {
    void window.electronAPI?.fs?.watchSplitDir?.(null)?.catch?.(() => undefined);
  }, []);

  const handleSecondaryFileClick = useCallback(
    (file: FileNode, e?: SelectionModifiers): void => {
      const result = toggleMultiSelection(
        secondarySelectedFiles,
        orderedSecondaryPaths,
        file.path,
        { ctrlKey: e?.ctrlKey, metaKey: e?.metaKey, shiftKey: e?.shiftKey },
        secondaryAnchorRef.current
      );
      setSecondarySelectedFiles(result.selected);
      secondaryAnchorRef.current = result.nextAnchor;
    },
    [orderedSecondaryPaths, secondarySelectedFiles]
  );

  return useMemo(
    () => ({
      secondaryPath,
      secondaryFiles,
      secondaryLoading,
      secondarySelectedFiles,
      handleSecondaryFileClick,
      loadSecondaryDirectory,
      stopSecondaryWatch,
    }),
    [
      handleSecondaryFileClick,
      loadSecondaryDirectory,
      secondaryFiles,
      secondaryLoading,
      secondaryPath,
      secondarySelectedFiles,
      stopSecondaryWatch,
    ]
  );
}
