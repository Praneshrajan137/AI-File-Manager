import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeGrid, FixedSizeList } from 'react-window';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { FileNode, FileSystemError } from '@shared/contracts';
import { EmptyState } from './EmptyState';
import { FileGridCell, SharedVirtualItemData } from './FileGridCell';
import { FileListRow } from './FileListView';
import { Button } from '@renderer/components/common/Button';
import { Spinner } from '@renderer/components/common/Spinner';
import { useExplorerKeyboard } from '@renderer/hooks/useExplorerKeyboard';
import type { SelectionModifiers } from '@renderer/hooks/useExplorerActions';
import {
  computeGridGeometry,
  extractDraggedPaths,
  sortFileNodes,
} from '@renderer/utils/explorerHelpers';

interface FileGridProps {
  files: FileNode[];
  selectedFiles: string[];
  onFileClick: (file: FileNode, e?: SelectionModifiers) => void;
  onFileDoubleClick: (file: FileNode) => void;
  onFileContextMenu: (file: FileNode, e: React.MouseEvent) => void;
  sortBy: 'name' | 'size' | 'modified' | 'type';
  sortDirection: 'asc' | 'desc';
  viewMode: 'list' | 'grid';
  loading?: boolean;
  error?: FileSystemError | null;
  searchQuery?: string;
  onClearSearch?: () => void;
  onRetry?: () => void;
  currentDirectory?: string;
  onDropMove?: (sourcePaths: string[], destinationDir: string) => void;
}

export const FileGrid: React.FC<FileGridProps> = ({
  files,
  selectedFiles,
  onFileClick,
  onFileDoubleClick,
  onFileContextMenu,
  sortBy,
  sortDirection,
  viewMode,
  loading,
  error,
  searchQuery,
  onClearSearch,
  onRetry,
  currentDirectory,
  onDropMove,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList<SharedVirtualItemData>>(null);
  const gridRef = useRef<FixedSizeGrid<SharedVirtualItemData>>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [containerWidth, setContainerWidth] = useState(800);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const sortedFiles = useMemo(
    () => sortFileNodes(files, sortBy, sortDirection),
    [files, sortBy, sortDirection]
  );

  const gridGeom = useMemo(
    () => computeGridGeometry(containerWidth, containerHeight, sortedFiles.length, 156, 148),
    [containerWidth, containerHeight, sortedFiles.length]
  );

  const handleScrollToIndex = useCallback(
    (index: number): void => {
      if (viewMode === 'grid') {
        const cols = Math.max(1, gridGeom.columnCount);
        gridRef.current?.scrollToItem({
          rowIndex: Math.floor(index / cols),
          columnIndex: index % cols,
          align: 'smart',
        });
      } else {
        listRef.current?.scrollToItem(index, 'smart');
      }
    },
    [gridGeom.columnCount, viewMode]
  );

  const { activePath, setFocusedPath, handleItemKeyDown } = useExplorerKeyboard({
    sortedFiles,
    selectedFiles,
    viewMode,
    columnCount: gridGeom.columnCount,
    containerRef,
    onScrollToIndex: handleScrollToIndex,
    onFileClick,
    onFileDoubleClick,
  });

  const itemData = useMemo<SharedVirtualItemData>(
    () => ({
      sortedFiles,
      selectedFiles,
      activePath,
      dropTargetPath,
      columnCount: gridGeom.columnCount,
      onFileClick,
      onFileDoubleClick,
      onFileContextMenu,
      onItemKeyDown: handleItemKeyDown,
      onFocusPath: setFocusedPath,
      onDropMove,
      setDropTargetPath,
    }),
    [
      activePath,
      dropTargetPath,
      gridGeom.columnCount,
      handleItemKeyDown,
      onDropMove,
      onFileClick,
      onFileContextMenu,
      onFileDoubleClick,
      selectedFiles,
      setFocusedPath,
      sortedFiles,
    ]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = (): void => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0) setContainerWidth(Math.floor(width));
      if (height > 0) setContainerHeight(Math.floor(height));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height, width } = entry.contentRect;
        if (height > 0) setContainerHeight(Math.floor(height));
        if (width > 0) setContainerWidth(Math.floor(width));
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [loading, error, sortedFiles.length, viewMode]);

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col justify-center items-center h-full gap-2 text-slate-600 dark:text-slate-300"
      >
        <Spinner size="lg" />
        <span className="text-sm font-medium">Loading files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        data-testid="file-grid-error"
        className="flex flex-col items-center justify-center h-full px-6 text-center"
      >
        <div className="max-w-md w-full rounded-xl border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 p-6 space-y-3">
          <div className="flex justify-center">
            <AlertCircle className="w-8 h-8 text-error-700 dark:text-red-300" aria-hidden="true" />
          </div>
          <p className="text-base font-semibold text-error-700 dark:text-red-200">Error loading files</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{error.message}</p>
          {onRetry && (
            <div className="pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetry}
                icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
                data-testid="file-grid-retry"
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const handlePaneDragOver = (e: React.DragEvent): void => {
    if (!onDropMove || !currentDirectory) return;
    if (e.dataTransfer.types.includes('application/x-fm-paths')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handlePaneDrop = (e: React.DragEvent): void => {
    if (!onDropMove || !currentDirectory) return;
    const dragged = extractDraggedPaths(e.dataTransfer);
    setDropTargetPath(null);
    if (dragged.length > 0) {
      e.preventDefault();
      onDropMove(dragged, currentDirectory);
    }
  };

  if (sortedFiles.length === 0) {
    return (
      <div className="h-full" onDragOver={handlePaneDragOver} onDrop={handlePaneDrop}>
        <EmptyState searchQuery={searchQuery} onClearSearch={onClearSearch} />
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div
        ref={containerRef}
        className="h-full overflow-hidden"
        role="listbox"
        aria-label="File grid"
        aria-multiselectable="true"
        data-testid="file-grid"
        onDragOver={handlePaneDragOver}
        onDrop={handlePaneDrop}
      >
        <FixedSizeGrid
          ref={gridRef}
          columnCount={gridGeom.columnCount}
          columnWidth={gridGeom.columnWidth}
          height={gridGeom.height}
          rowCount={gridGeom.rowCount}
          rowHeight={gridGeom.rowHeight}
          width={gridGeom.width}
          itemData={itemData}
          itemKey={({ columnIndex, rowIndex, data }): string => {
            const idx = rowIndex * data.columnCount + columnIndex;
            return data.sortedFiles[idx]?.path ?? `empty-${rowIndex}-${columnIndex}`;
          }}
          className="scrollbar-thin"
        >
          {FileGridCell}
        </FixedSizeGrid>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full"
      role="listbox"
      aria-label="File list"
      aria-multiselectable="true"
      data-testid="file-list"
      onDragOver={handlePaneDragOver}
      onDrop={handlePaneDrop}
    >
      <FixedSizeList
        ref={listRef}
        height={containerHeight}
        itemCount={sortedFiles.length}
        itemSize={50}
        width="100%"
        itemData={itemData}
        itemKey={(index, data): string => data.sortedFiles[index]?.path ?? `row-${index}`}
        className="scrollbar-thin"
      >
        {FileListRow}
      </FixedSizeList>
    </div>
  );
};
