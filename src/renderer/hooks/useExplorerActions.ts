import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  FileDeleteMode,
  FileNode,
  SortCriteria,
  SortDirection,
} from '@shared/contracts';
import { sortFileNodes, toggleMultiSelection } from '@renderer/utils/explorerHelpers';
import { useSplitPaneState } from './useSplitPaneState';
import { FileClipboardState, useFileClipboard } from './useFileClipboard';
import { useExplorerTransfer } from './useExplorerTransfer';

export interface SelectionModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

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
  clipboard: FileClipboardState | null;
  copyToClipboard: (paths: string[]) => void;
  cutToClipboard: (paths: string[]) => void;
  clearClipboard: () => void;
  pasteFromClipboard: (destinationDir: string) => Promise<void>;
  handleFileClick: (file: FileNode, e?: SelectionModifiers) => void;
  handleSecondaryFileClick: (file: FileNode, e?: SelectionModifiers) => void;
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
  handleDuplicatePaths: (sourcePaths: string[]) => Promise<void>;
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

  const orderedFiles = useMemo(
    () => sortFileNodes(files, sortBy, sortDirection),
    [files, sortBy, sortDirection]
  );

  const orderedFilePaths = useMemo(
    () => orderedFiles.map((node) => node.path),
    [orderedFiles]
  );

  useEffect(() => {
    const validPaths = new Set(orderedFilePaths);
    setSelectedFiles((prev) => {
      const next = prev.filter((p) => validPaths.has(p));
      return next.length === prev.length ? prev : next;
    });
    if (selectionAnchorRef.current && !validPaths.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = null;
    }
  }, [orderedFilePaths]);

  const splitPane = useSplitPaneState({ sortBy, sortDirection, showToast });

  const refreshActiveDirectories = useCallback(
    async (overridePrimaryPath?: string): Promise<void> => {
      const primary = overridePrimaryPath || currentPath;
      if (primary) await readDirectory(primary);
      if (splitPaneOpen && splitPane.secondaryPath) {
        await splitPane.loadSecondaryDirectory(splitPane.secondaryPath);
      }
    },
    [currentPath, readDirectory, splitPane, splitPaneOpen]
  );

  const handleFileClick = useCallback(
    (file: FileNode, e?: SelectionModifiers): void => {
      const result = toggleMultiSelection(
        selectedFiles,
        orderedFilePaths,
        file.path,
        { ctrlKey: e?.ctrlKey, metaKey: e?.metaKey, shiftKey: e?.shiftKey },
        selectionAnchorRef.current
      );
      setSelectedFiles(result.selected);
      selectionAnchorRef.current = result.nextAnchor;
    },
    [orderedFilePaths, selectedFiles]
  );

  const handleSelectAll = useCallback((): void => {
    setSelectedFiles(orderedFilePaths);
    if (orderedFilePaths.length > 0) selectionAnchorRef.current = orderedFilePaths[0];
  }, [orderedFilePaths]);

  const handleUndo = useCallback(async (): Promise<void> => {
    try {
      const res = await window.electronAPI.fs.undo();
      await refreshActiveDirectories();
      await refreshWorkspaceMetadata();
      if (res.success) {
        showToast({
          type: 'info',
          message: res.operation?.description ? `Undid: ${res.operation.description}` : 'Operation undone',
        });
      }
    } catch (err: unknown) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Nothing to undo' });
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
          message: res.operation?.description ? `Redid: ${res.operation.description}` : 'Operation redone',
        });
      }
    } catch (err: unknown) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Nothing to redo' });
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
          ...(mode === 'vault' ? { actionLabel: 'Undo', onAction: (): void => { void handleUndo(); } } : {}),
        });
      } catch (err: unknown) {
        showToast({ type: 'error', message: err instanceof Error ? err.message : 'Delete failed' });
      }
    },
    [deleteFile, handleUndo, refreshActiveDirectories, refreshWorkspaceMetadata, showToast]
  );

  const {
    handleDropMove,
    handleCopyPathsToDirectory,
    handleDuplicatePaths,
    handleDuplicateFile,
  } = useExplorerTransfer({
    currentPath,
    files,
    handleUndo,
    refreshActiveDirectories,
    refreshWorkspaceMetadata,
    showToast,
  });

  const clipboardApi = useFileClipboard({
    handleCopyPathsToDirectory,
    handleDropMove,
    showToast,
  });

  return {
    selectedFiles,
    setSelectedFiles,
    orderedFiles,
    orderedFilePaths,
    secondaryPath: splitPane.secondaryPath,
    secondaryFiles: splitPane.secondaryFiles,
    secondaryLoading: splitPane.secondaryLoading,
    secondarySelectedFiles: splitPane.secondarySelectedFiles,
    clipboard: clipboardApi.clipboard,
    copyToClipboard: clipboardApi.copyToClipboard,
    cutToClipboard: clipboardApi.cutToClipboard,
    clearClipboard: clipboardApi.clearClipboard,
    pasteFromClipboard: clipboardApi.pasteFromClipboard,
    handleFileClick,
    handleSecondaryFileClick: splitPane.handleSecondaryFileClick,
    handleSelectAll,
    loadSecondaryDirectory: splitPane.loadSecondaryDirectory,
    stopSecondaryWatch: splitPane.stopSecondaryWatch,
    refreshActiveDirectories,
    handleUndo,
    handleRedo,
    executeDeletePaths,
    handleDropMove,
    handleCopyPathsToDirectory,
    handleDuplicateFile,
    handleDuplicatePaths,
  };
}
