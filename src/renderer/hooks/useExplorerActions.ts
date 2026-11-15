import { useState, useCallback, useRef, useMemo } from 'react';
import {
  FileDeleteMode,
  FileNode,
  SortCriteria,
  SortDirection,
} from '@shared/contracts';
import { sortFileNodes, toggleMultiSelection } from '@renderer/utils/explorerHelpers';
import {
  extractBasename,
  extractParentDirectory,
  joinChildPath,
  normalizeComparablePath,
} from '@renderer/utils/pathHelpers';

export interface UseExplorerActionsOptions {
  files: FileNode[];
  currentPath: string;
  sortBy: SortCriteria;
  sortDirection: SortDirection;
  splitPaneOpen: boolean;
  readDirectory: (path: string) => Promise<boolean>;
  deleteFile: (
    path: string,
    recursive?: boolean,
    skipRefresh?: boolean,
    mode?: FileDeleteMode
  ) => Promise<void>;
  refreshWorkspaceMetadata: () => Promise<unknown>;
  showToast: (toast: {
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

export interface UseExplorerActionsReturn {
  selectedFiles: string[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  orderedFiles: FileNode[];
  orderedFilePaths: string[];
  secondaryPath: string;
  secondaryFiles: FileNode[];
  secondaryLoading: boolean;
  secondarySelectedFiles: string[];
  handleFileClick: (file: FileNode, e?: React.MouseEvent) => void;
  handleSecondaryFileClick: (file: FileNode, e?: React.MouseEvent) => void;
  handleSelectAll: () => void;
  loadSecondaryDirectory: (targetPath: string) => Promise<void>;
  stopSecondaryWatch: () => void;
  refreshActiveDirectories: (overridePrimaryPath?: string) => Promise<void>;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  executeDeletePaths: (pathsToDelete: string[], mode: FileDeleteMode) => Promise<void>;
  handleDropMove: (sourcePaths: string[], destinationDir: string) => Promise<void>;
  handleCopyPathsToDirectory: (sourcePaths: string[], destinationDir: string) => Promise<void>;
  handleDuplicateFile: (file: FileNode) => Promise<void>;
}

export function useExplorerActions(options: UseExplorerActionsOptions): UseExplorerActionsReturn {
  const {
    files,
    currentPath,
    sortBy,
    sortDirection,
    splitPaneOpen,
    readDirectory,
    deleteFile,
    refreshWorkspaceMetadata,
    showToast,
  } = options;

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);

  const [secondaryPath, setSecondaryPath] = useState<string>('');
  const [secondaryFiles, setSecondaryFiles] = useState<FileNode[]>([]);
  const [secondaryLoading, setSecondaryLoading] = useState<boolean>(false);
  const [secondarySelectedFiles, setSecondarySelectedFiles] = useState<string[]>([]);
  const secondaryAnchorRef = useRef<string | null>(null);
  const secondaryReadSeqRef = useRef<number>(0);

  const orderedFiles = useMemo(
    () => sortFileNodes(files, sortBy, sortDirection),
    [files, sortBy, sortDirection]
  );

  const orderedFilePaths = useMemo(
    () => orderedFiles.map((node) => node.path),
    [orderedFiles]
  );

  const orderedSecondaryPaths = useMemo(
    () => sortFileNodes(secondaryFiles, sortBy, sortDirection).map((node) => node.path),
    [secondaryFiles, sortBy, sortDirection]
  );

  const loadSecondaryDirectory = useCallback(async (targetPath: string): Promise<void> => {
    const seq = ++secondaryReadSeqRef.current;
    setSecondaryLoading(true);
    try {
      const nextFiles = await window.electronAPI.fs.readDirectory(targetPath);
      if (seq !== secondaryReadSeqRef.current) {
        return;
      }
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
  }, [showToast]);

  const stopSecondaryWatch = useCallback((): void => {
    void window.electronAPI?.fs?.watchSplitDir?.(null)?.catch?.(() => undefined);
  }, []);

  const refreshActiveDirectories = useCallback(
    async (overridePrimaryPath?: string): Promise<void> => {
      const primary = overridePrimaryPath || currentPath;
      if (primary) {
        await readDirectory(primary);
      }
      if (splitPaneOpen && secondaryPath) {
        await loadSecondaryDirectory(secondaryPath);
      }
    },
    [currentPath, readDirectory, splitPaneOpen, secondaryPath, loadSecondaryDirectory]
  );

  const handleFileClick = useCallback(
    (file: FileNode, e?: React.MouseEvent): void => {
      const result = toggleMultiSelection(
        selectedFiles,
        orderedFilePaths,
        file.path,
        {
          ctrlKey: e?.ctrlKey,
          metaKey: e?.metaKey,
          shiftKey: e?.shiftKey,
        },
        selectionAnchorRef.current
      );
      setSelectedFiles(result.selected);
      selectionAnchorRef.current = result.nextAnchor;
    },
    [orderedFilePaths, selectedFiles]
  );

  const handleSecondaryFileClick = useCallback(
    (file: FileNode, e?: React.MouseEvent): void => {
      const result = toggleMultiSelection(
        secondarySelectedFiles,
        orderedSecondaryPaths,
        file.path,
        {
          ctrlKey: e?.ctrlKey,
          metaKey: e?.metaKey,
          shiftKey: e?.shiftKey,
        },
        secondaryAnchorRef.current
      );
      setSecondarySelectedFiles(result.selected);
      secondaryAnchorRef.current = result.nextAnchor;
    },
    [orderedSecondaryPaths, secondarySelectedFiles]
  );

  const handleSelectAll = useCallback((): void => {
    setSelectedFiles(files.map((f) => f.path));
    if (files.length > 0) {
      selectionAnchorRef.current = files[0].path;
    }
  }, [files]);

  const handleUndo = useCallback(async (): Promise<void> => {
    try {
      const res = await window.electronAPI.fs.undo();
      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();
      if (res.success) {
        showToast({
          type: 'info',
          message: res.operation?.description
            ? `Undid: ${res.operation.description}`
            : 'Operation undone',
        });
      }
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Nothing to undo',
      });
    }
  }, [refreshActiveDirectories, refreshWorkspaceMetadata, showToast]);

  const handleRedo = useCallback(async (): Promise<void> => {
    try {
      const res = await window.electronAPI.fs.redo();
      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();
      if (res.success) {
        showToast({
          type: 'info',
          message: res.operation?.description
            ? `Redid: ${res.operation.description}`
            : 'Operation redone',
        });
      }
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Nothing to redo',
      });
    }
  }, [refreshActiveDirectories, refreshWorkspaceMetadata, showToast]);

  const executeDeletePaths = useCallback(
    async (pathsToDelete: string[], mode: FileDeleteMode): Promise<void> => {
      try {
        for (const targetPath of pathsToDelete) {
          await deleteFile(targetPath, true, true, mode);
        }
        setSelectedFiles((prev) => prev.filter((p) => !pathsToDelete.includes(p)));
        await refreshActiveDirectories();
        await refreshWorkspaceMetadata();

        showToast({
          type: 'success',
          message:
            mode === 'vault'
              ? `Moved ${pathsToDelete.length} item(s) to Trash Vault`
              : mode === 'trash'
                ? `Moved ${pathsToDelete.length} item(s) to OS Trash`
                : `Permanently deleted ${pathsToDelete.length} item(s)`,
          ...(mode === 'vault'
            ? {
                actionLabel: 'Undo',
                onAction: (): void => {
                  void handleUndo();
                },
              }
            : {}),
        });
      } catch (err: unknown) {
        showToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'Delete failed',
        });
      }
    },
    [deleteFile, handleUndo, refreshActiveDirectories, refreshWorkspaceMetadata, showToast]
  );

  const handleDropMove = useCallback(
    async (sourcePaths: string[], destinationDir: string): Promise<void> => {
      const normalizedDest = normalizeComparablePath(destinationDir);
      const uniqueSources = Array.from(new Set(sourcePaths)).filter((src) => {
        if (!src) return false;
        const normSrc = normalizeComparablePath(src);
        if (normSrc === normalizedDest) return false;
        const parentDir = normalizeComparablePath(extractParentDirectory(src));
        return parentDir !== normalizedDest;
      });

      if (uniqueSources.length === 0) {
        return;
      }

      let movedCount = 0;
      let lastError: string | null = null;
      for (const src of uniqueSources) {
        const destPath = joinChildPath(destinationDir, extractBasename(src));
        try {
          await window.electronAPI.fs.move(src, destPath);
          movedCount += 1;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();

      if (movedCount > 0) {
        showToast({
          type: 'success',
          message: `Moved ${movedCount} item(s)`,
          actionLabel: 'Undo',
          onAction: () => {
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
      if (!destinationDir || sourcePaths.length === 0) {
        return;
      }
      const copyFn = window.electronAPI?.fs?.copy;
      if (typeof copyFn !== 'function') {
        showToast({ type: 'error', message: 'Copy operation is unavailable' });
        return;
      }

      let copiedCount = 0;
      let lastError: string | null = null;
      for (const src of sourcePaths) {
        const baseName = extractBasename(src);
        let destPath = joinChildPath(destinationDir, baseName);
        if (normalizeComparablePath(src) === normalizeComparablePath(destPath)) {
          const dotIdx = baseName.lastIndexOf('.');
          const copyName =
            dotIdx > 0
              ? `${baseName.slice(0, dotIdx)} (copy)${baseName.slice(dotIdx)}`
              : `${baseName} (copy)`;
          destPath = joinChildPath(destinationDir, copyName);
        }
        try {
          await copyFn(src, destPath);
          copiedCount += 1;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();

      if (copiedCount > 0) {
        showToast({
          type: 'success',
          message: `Copied ${copiedCount} item(s)`,
          actionLabel: 'Undo',
          onAction: () => {
            void handleUndo();
          },
        });
      } else if (lastError) {
        showToast({ type: 'error', message: `Copy failed: ${lastError}` });
      }
    },
    [handleUndo, refreshActiveDirectories, refreshWorkspaceMetadata, showToast]
  );

  const handleDuplicateFile = useCallback(
    async (file: FileNode): Promise<void> => {
      const parentDir = extractParentDirectory(file.path);
      if (!parentDir) {
        return;
      }
      await handleCopyPathsToDirectory([file.path], parentDir);
    },
    [handleCopyPathsToDirectory]
  );

  return {
    selectedFiles,
    setSelectedFiles,
    orderedFiles,
    orderedFilePaths,
    secondaryPath,
    secondaryFiles,
    secondaryLoading,
    secondarySelectedFiles,
    handleFileClick,
    handleSecondaryFileClick,
    handleSelectAll,
    loadSecondaryDirectory,
    stopSecondaryWatch,
    refreshActiveDirectories,
    handleUndo,
    handleRedo,
    executeDeletePaths,
    handleDropMove,
    handleCopyPathsToDirectory,
    handleDuplicateFile,
  };
}
