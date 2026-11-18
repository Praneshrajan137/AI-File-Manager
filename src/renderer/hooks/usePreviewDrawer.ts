import { useState, useCallback, useRef } from 'react';
import {
  FileConnectionsSummary,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
  RING_BUFFER_CAPACITY,
} from '@shared/contracts';
import { extractBasename, normalizeComparablePath } from '@renderer/utils/pathHelpers';

/** Pure decision helper for Spacebar / Preview button QuickLook toggle. */
export type QuickLookAction =
  | { kind: 'load'; file: FileNode }
  | { kind: 'close' }
  | { kind: 'noop' };

export function resolveQuickLookAction(
  previewFileNode: FileNode | null,
  selectedFiles: string[],
  files: FileNode[]
): QuickLookAction {
  const target =
    selectedFiles.length === 1
      ? (files.find((f) => f.path === selectedFiles[0] && !f.isDirectory) ?? null)
      : null;

  if (previewFileNode) {
    if (
      target &&
      normalizeComparablePath(target.path) !== normalizeComparablePath(previewFileNode.path)
    ) {
      return { kind: 'load', file: target };
    }
    return { kind: 'close' };
  }

  return target ? { kind: 'load', file: target } : { kind: 'noop' };
}

/** Maximum lines requested per FS:PREVIEW_FILE IPC call (matches IPC schema maxLines <= 100). */
export const PREVIEW_LINE_LIMIT = RING_BUFFER_CAPACITY;

export interface UsePreviewDrawerReturn {
  previewFileNode: FileNode | null;
  previewResult: FilePreviewResult | null;
  previewLineRange: FileLineRangeResult | null;
  previewHighlightRange: { startLine: number; endLine: number } | undefined;
  previewLoading: boolean;
  previewError: string | null;
  fileConnections: FileConnectionsSummary | null;
  connectionsLoading: boolean;
  isEditing: boolean;
  editContent: string;
  editDirty: boolean;
  editSaving: boolean;
  editError: string | null;
  loadFilePreview: (file: FileNode) => Promise<void>;
  openCitation: (filePath: string, startLine: number, endLine?: number) => Promise<void>;
  closePreview: () => void;
  refreshPreview: () => void;
  clearRangeFocus: () => void;
  toggleQuickLook: (selectedFiles: string[], files: FileNode[]) => void;
  syncPreviewWatcherEvent: (eventPath: string, eventType: string) => void;
  startEditing: () => Promise<void>;
  cancelEditing: () => void;
  updateEditContent: (next: string) => void;
  saveEdit: () => Promise<boolean>;
}

export function usePreviewDrawer(): UsePreviewDrawerReturn {
  const [previewFileNode, setPreviewFileNode] = useState<FileNode | null>(null);
  const [previewResult, setPreviewResult] = useState<FilePreviewResult | null>(null);
  const [previewLineRange, setPreviewLineRange] = useState<FileLineRangeResult | null>(null);
  const [previewHighlightRange, setPreviewHighlightRange] = useState<
    { startLine: number; endLine: number } | undefined
  >(undefined);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fileConnections, setFileConnections] = useState<FileConnectionsSummary | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editContent, setEditContent] = useState<string>('');
  const [originalEditContent, setOriginalEditContent] = useState<string>('');
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const previewSeqRef = useRef<number>(0);
  const isEditingRef = useRef<boolean>(false);
  isEditingRef.current = isEditing;

  const resetEditState = useCallback((): void => {
    setIsEditing(false);
    setEditContent('');
    setOriginalEditContent('');
    setEditSaving(false);
    setEditError(null);
  }, []);

  const fetchConnections = useCallback(async (filePath: string, seq: number): Promise<void> => {
    const getFileConnections = window.electronAPI?.graph?.getFileConnections;
    if (typeof getFileConnections !== 'function') {
      setFileConnections(null);
      setConnectionsLoading(false);
      return;
    }

    setConnectionsLoading(true);
    try {
      const summary = await getFileConnections(filePath);
      if (seq === previewSeqRef.current) {
        setFileConnections(summary);
      }
    } catch {
      if (seq === previewSeqRef.current) {
        setFileConnections(null);
      }
    } finally {
      if (seq === previewSeqRef.current) {
        setConnectionsLoading(false);
      }
    }
  }, []);

  const loadFilePreview = useCallback(
    async (file: FileNode): Promise<void> => {
      if (file.isDirectory) {
        return;
      }

      const seq = ++previewSeqRef.current;
      resetEditState();
      setPreviewFileNode(file);
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewLineRange(null);
      setPreviewHighlightRange(undefined);
      setFileConnections(null);

      void fetchConnections(file.path, seq);

      try {
        const result = await window.electronAPI.fs.previewFile(file.path, PREVIEW_LINE_LIMIT);
        if (seq !== previewSeqRef.current) {
          return;
        }
        setPreviewResult(result);
      } catch (err: unknown) {
        if (seq !== previewSeqRef.current) {
          return;
        }
        setPreviewResult(null);
        setPreviewError(err instanceof Error ? err.message : 'Failed to preview file');
      } finally {
        if (seq === previewSeqRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [fetchConnections, resetEditState]
  );

  const openCitation = useCallback(
    async (filePath: string, startLine: number, endLine?: number): Promise<void> => {
      const seq = ++previewSeqRef.current;
      resetEditState();
      const baseName = extractBasename(filePath);
      const extDot = baseName.lastIndexOf('.');
      const extension = extDot > 0 ? baseName.slice(extDot + 1).toLowerCase() : '';
      const syntheticNode: FileNode = {
        path: filePath,
        name: baseName,
        isDirectory: false,
        size: 0,
        modified: Date.now(),
        extension,
        mimeType: extension === 'md' ? 'text/markdown' : 'text/plain',
      };

      setPreviewFileNode(syntheticNode);
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewResult(null);
      setPreviewLineRange(null);
      setPreviewHighlightRange({ startLine, endLine: endLine ?? startLine });
      setFileConnections(null);

      void fetchConnections(filePath, seq);

      try {
        const rangeRes = await window.electronAPI.fs.readFileRange(
          filePath,
          startLine,
          endLine ?? startLine,
          8
        );
        if (seq !== previewSeqRef.current) {
          return;
        }
        setPreviewLineRange(rangeRes);
        setPreviewHighlightRange({ startLine, endLine: endLine ?? startLine });
      } catch (err: unknown) {
        if (seq !== previewSeqRef.current) {
          return;
        }
        setPreviewLineRange(null);
        setPreviewError(err instanceof Error ? err.message : 'Failed to read cited line range');
      } finally {
        if (seq === previewSeqRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [fetchConnections, resetEditState]
  );

  const closePreview = useCallback((): void => {
    previewSeqRef.current += 1;
    resetEditState();
    setPreviewFileNode(null);
    setPreviewResult(null);
    setPreviewLineRange(null);
    setPreviewHighlightRange(undefined);
    setPreviewError(null);
    setFileConnections(null);
    setConnectionsLoading(false);
  }, [resetEditState]);

  const refreshPreview = useCallback((): void => {
    if (previewFileNode) {
      void loadFilePreview(previewFileNode);
    }
  }, [loadFilePreview, previewFileNode]);

  const clearRangeFocus = useCallback((): void => {
    if (previewFileNode) {
      void loadFilePreview(previewFileNode);
    } else {
      setPreviewLineRange(null);
      setPreviewHighlightRange(undefined);
    }
  }, [loadFilePreview, previewFileNode]);

  const toggleQuickLook = useCallback(
    (selectedFiles: string[], files: FileNode[]): void => {
      const action = resolveQuickLookAction(previewFileNode, selectedFiles, files);
      if (action.kind === 'load') {
        void loadFilePreview(action.file);
      } else if (action.kind === 'close') {
        closePreview();
      }
    },
    [closePreview, loadFilePreview, previewFileNode]
  );

  const syncPreviewWatcherEvent = useCallback(
    (eventPath: string, eventType: string): void => {
      if (!previewFileNode) {
        return;
      }
      if (normalizeComparablePath(eventPath) !== normalizeComparablePath(previewFileNode.path)) {
        return;
      }
      if (eventType === 'unlink') {
        closePreview();
      } else if (eventType === 'change' && !isEditingRef.current) {
        void loadFilePreview(previewFileNode);
      }
    },
    [closePreview, loadFilePreview, previewFileNode]
  );

  const startEditing = useCallback(async (): Promise<void> => {
    if (!previewFileNode || previewFileNode.isDirectory || previewResult?.binary) {
      return;
    }
    if ((previewResult?.size ?? previewFileNode.size) > 512 * 1024) {
      setEditError('File exceeds 512 KB in-app editor cap; open externally instead.');
      return;
    }
    if (typeof window.electronAPI?.fs?.readFile !== 'function') {
      setEditError('File read API is unavailable for editing.');
      return;
    }
    setEditError(null);
    try {
      const full = await window.electronAPI.fs.readFile(previewFileNode.path);
      setOriginalEditContent(full.content);
      setEditContent(full.content);
      setIsEditing(true);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Unable to open file for editing');
    }
  }, [previewFileNode, previewResult]);

  const cancelEditing = useCallback((): void => {
    resetEditState();
  }, [resetEditState]);

  const updateEditContent = useCallback((next: string): void => {
    setEditContent(next);
  }, []);

  const saveEdit = useCallback(async (): Promise<boolean> => {
    if (!previewFileNode || typeof window.electronAPI?.fs?.writeFile !== 'function') {
      return false;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await window.electronAPI.fs.writeFile(previewFileNode.path, editContent);
      resetEditState();
      await loadFilePreview(previewFileNode);
      return true;
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to save file');
      return false;
    } finally {
      setEditSaving(false);
    }
  }, [editContent, loadFilePreview, previewFileNode, resetEditState]);

  return {
    previewFileNode,
    previewResult,
    previewLineRange,
    previewHighlightRange,
    previewLoading,
    previewError,
    fileConnections,
    connectionsLoading,
    isEditing,
    editContent,
    editDirty: isEditing && editContent !== originalEditContent,
    editSaving,
    editError,
    loadFilePreview,
    openCitation,
    closePreview,
    refreshPreview,
    clearRangeFocus,
    toggleQuickLook,
    syncPreviewWatcherEvent,
    startEditing,
    cancelEditing,
    updateEditContent,
    saveEdit,
  };
}
