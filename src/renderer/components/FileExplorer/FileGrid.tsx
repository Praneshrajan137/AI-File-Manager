import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FixedSizeGrid,
  FixedSizeList,
  GridChildComponentProps,
  ListChildComponentProps,
} from 'react-window';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { FileNode, FileSystemError } from '@shared/contracts';
import { FileListItem } from './FileListItem';
import { EmptyState } from './EmptyState';
import { Button } from '@renderer/components/common/Button';
import { Spinner } from '@renderer/components/common/Spinner';
import { useExplorerKeyboard } from '@renderer/hooks/useExplorerKeyboard';
import type { SelectionModifiers } from '@renderer/hooks/useExplorerActions';
import { getFileIconWithColor } from '@renderer/utils/fileIcons';
import { formatFileSize } from '@renderer/utils/formatters';
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

interface SharedVirtualItemData {
  sortedFiles: FileNode[];
  selectedFiles: string[];
  activePath: string | null;
  dropTargetPath: string | null;
  columnCount: number;
  onFileClick: (file: FileNode, e?: SelectionModifiers) => void;
  onFileDoubleClick: (file: FileNode) => void;
  onFileContextMenu: (file: FileNode, e: React.MouseEvent) => void;
  onItemKeyDown: (file: FileNode, index: number, e: React.KeyboardEvent) => void;
  onFocusPath: (path: string) => void;
  onDropMove?: (sourcePaths: string[], destinationDir: string) => void;
  setDropTargetPath: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Stable module-level Grid cell renderer for react-window (`FixedSizeGrid` uses `createElement(children)`).
 * Keeping component identity stable preserves DOM nodes, focus, and double-click synthesis across selection changes.
 */
const GridCell: React.FC<GridChildComponentProps<SharedVirtualItemData>> = React.memo(({
  columnIndex,
  rowIndex,
  style,
  data,
}) => {
  const idx = rowIndex * data.columnCount + columnIndex;
  const file = data.sortedFiles[idx];
  if (!file) return null;

  const selected = data.selectedFiles.includes(file.path);
  const isActive = data.activePath === file.path;
  const isDropTarget = file.isDirectory && data.dropTargetPath === file.path;
  const { icon: Icon, colorClass } = getFileIconWithColor(file);
  const dragPayload = selected && data.selectedFiles.length > 0 ? data.selectedFiles : [file.path];

  return (
    <div style={style} className="p-1.5">
      <div
        role="option"
        data-testid="file-item"
        data-file-path={file.path}
        tabIndex={isActive ? 0 : -1}
        aria-selected={selected}
        aria-setsize={data.sortedFiles.length}
        aria-posinset={idx + 1}
        draggable
        onDragStart={(e): void => {
          e.dataTransfer.setData('application/x-fm-paths', JSON.stringify(dragPayload));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e): void => {
          if (!file.isDirectory || !data.onDropMove) return;
          if (e.dataTransfer.types.includes('application/x-fm-paths')) {
            e.preventDefault();
            e.stopPropagation();
            data.setDropTargetPath(file.path);
          }
        }}
        onDragLeave={(): void => {
          if (data.dropTargetPath === file.path) data.setDropTargetPath(null);
        }}
        onDrop={(e): void => {
          if (!file.isDirectory || !data.onDropMove) return;
          e.preventDefault();
          e.stopPropagation();
          const dragged = extractDraggedPaths(e.dataTransfer);
          data.setDropTargetPath(null);
          if (dragged.length > 0) {
            data.onDropMove(dragged, file.path);
          }
        }}
        onClick={(e): void => {
          data.onFocusPath(file.path);
          data.onFileClick(file, e);
        }}
        onDoubleClick={(): void => data.onFileDoubleClick(file)}
        onContextMenu={(e): void => data.onFileContextMenu(file, e)}
        onKeyDown={(e): void => data.onItemKeyDown(file, idx, e)}
        className={`h-full flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
          isDropTarget
            ? 'bg-indigo-100 dark:bg-indigo-950/70 border-accent-500 ring-2 ring-accent-500'
            : selected
              ? 'bg-indigo-50 dark:bg-indigo-950/60 border-accent-600 dark:border-indigo-400 ring-1 ring-accent-600 dark:ring-indigo-400'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
        } ${file.isHidden === true ? 'opacity-60' : ''}`}
      >
        <Icon className={`w-9 h-9 mb-2 ${colorClass}`} aria-hidden="true" />
        <span
          className="text-xs font-medium text-slate-900 dark:text-slate-100 w-full truncate"
          title={file.name}
        >
          {file.name}
        </span>
        <span className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
          {file.isDirectory ? 'Folder' : formatFileSize(file.size)}
        </span>
      </div>
    </div>
  );
});

GridCell.displayName = 'FileGridCell';

const ListRow: React.FC<ListChildComponentProps<SharedVirtualItemData>> = React.memo(({
  index,
  style,
  data,
}) => {
  const item = data.sortedFiles[index];
  if (!item) return null;
  const selected = data.selectedFiles.includes(item.path);
  const isActive = data.activePath === item.path;

  return (
    <div style={style}>
      <FileListItem
        file={item}
        selected={selected}
        isDropTarget={item.isDirectory && data.dropTargetPath === item.path}
        draggablePaths={selected ? data.selectedFiles : [item.path]}
        tabIndex={isActive ? 0 : -1}
        setSize={data.sortedFiles.length}
        posInSet={index + 1}
        onClick={(e): void => {
          data.onFocusPath(item.path);
          data.onFileClick(item, e);
        }}
        onDoubleClick={(): void => data.onFileDoubleClick(item)}
        onContextMenu={(e): void => data.onFileContextMenu(item, e)}
        onKeyDown={(e): void => data.onItemKeyDown(item, index, e)}
        onDragOverFolder={(e): void => {
          if (!item.isDirectory || !data.onDropMove) return;
          if (e.dataTransfer.types.includes('application/x-fm-paths')) {
            e.preventDefault();
            e.stopPropagation();
            data.setDropTargetPath(item.path);
          }
        }}
        onDragLeaveFolder={(): void => {
          if (data.dropTargetPath === item.path) data.setDropTargetPath(null);
        }}
        onDropOnFolder={(e): void => {
          if (!item.isDirectory || !data.onDropMove) return;
          e.preventDefault();
          e.stopPropagation();
          const dragged = extractDraggedPaths(e.dataTransfer);
          data.setDropTargetPath(null);
          if (dragged.length > 0) {
            data.onDropMove(dragged, item.path);
          }
        }}
      />
    </div>
  );
});

ListRow.displayName = 'FileListRow';

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
          className="scrollbar-thin"
        >
          {GridCell}
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
        className="scrollbar-thin"
      >
        {ListRow}
      </FixedSizeList>
    </div>
  );
};
