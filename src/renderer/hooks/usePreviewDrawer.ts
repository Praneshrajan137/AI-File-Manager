import { useState, useCallback, useRef } from 'react';
import {
  FileConnectionsSummary,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
} from '@shared/contracts';
import { extractBasename, normalizeComparablePath } from '@renderer/utils/pathHelpers';

export interface UsePreviewDrawerReturn {
  previewFileNode: FileNode | null;
  previewResult: FilePreviewResult | null;
  previewLineRange: FileLineRangeResult | null;
  previewHighlightRange: { startLine: number; endLine: number } | undefined;
  previewLoading: boolean;
  previewError: string | null;
  fileConnections: FileConnectionsSummary | null;
  connectionsLoading: boolean;
  loadFilePreview: (file: FileNode) => Promise<void>;
  openCitation: (filePath: string, startLine: number, endLine?: number) => Promise<void>;
  closePreview: () => void;
  refreshPreview: () => void;
  clearRangeFocus: () => void;
  toggleQuickLook: (selectedFiles: string[], files: FileNode[]) => void;
  syncPreviewWatcherEvent: (eventPath: string, eventType: string) => void;
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

  const previewSeqRef = useRef<number>(0);

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
      setPreviewFileNode(file);
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewLineRange(null);
      setPreviewHighlightRange(undefined);
      setFileConnections(null);

      void fetchConnections(file.path, seq);

      try {
        const result = await window.electronAPI.fs.previewFile(file.path, 500);
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
    [fetchConnections]
  );

  const openCitation = useCallback(
    async (filePath: string, startLine: number, endLine?: number): Promise<void> => {
      const seq = ++previewSeqRef.current;
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
    [fetchConnections]
  );

  const closePreview = useCallback((): void => {
    previewSeqRef.current += 1;
    setPreviewFileNode(null);
    setPreviewResult(null);
    setPreviewLineRange(null);
    setPreviewHighlightRange(undefined);
    setPreviewError(null);
    setFileConnections(null);
    setConnectionsLoading(false);
  }, []);

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
      if (previewFileNode) {
        closePreview();
        return;
      }
      if (selectedFiles.length === 1) {
        const target = files.find((f) => f.path === selectedFiles[0]);
        if (target && !target.isDirectory) {
          void loadFilePreview(target);
        }
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
      } else if (eventType === 'change') {
        void loadFilePreview(previewFileNode);
      }
    },
    [closePreview, loadFilePreview, previewFileNode]
  );

  return {
    previewFileNode,
    previewResult,
    previewLineRange,
    previewHighlightRange,
    previewLoading,
    previewError,
    fileConnections,
    connectionsLoading,
    loadFilePreview,
    openCitation,
    closePreview,
    refreshPreview,
    clearRangeFocus,
    toggleQuickLook,
    syncPreviewWatcherEvent,
  };
}
