import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  FixedSizeGrid,
  FixedSizeList,
  GridChildComponentProps,
  ListChildComponentProps,
} from 'react-window';
import { FileNode, FileSystemError } from '@shared/contracts';
import { FileListItem } from './FileListItem';
import { EmptyState } from './EmptyState';
import { Spinner } from '@renderer/components/common/Spinner';
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
  onFileClick: (file: FileNode, e?: React.MouseEvent) => void;
  onFileDoubleClick: (file: FileNode) => void;
  onFileContextMenu: (file: FileNode, e: React.MouseEvent) => void;
  sortBy: 'name' | 'size' | 'modified' | 'type';
  sortDirection: 'asc' | 'desc';
  viewMode: 'list' | 'grid';
  loading?: boolean;
  error?: FileSystemError | null;
  currentDirectory?: string;
  onDropMove?: (sourcePaths: string[], destinationDir: string) => void;
}

interface SharedVirtualItemData {
  sortedFiles: FileNode[];
  selectedFiles: string[];
  dropTargetPath: string | null;
  columnCount: number;
  onFileClick: (file: FileNode, e?: React.MouseEvent) => void;
  onFileDoubleClick: (file: FileNode) => void;
  onFileContextMenu: (file: FileNode, e: React.MouseEvent) => void;
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
  const isDropTarget = file.isDirectory && data.dropTargetPath === file.path;
  const { icon: Icon, colorClass } = getFileIconWithColor(file);
  const dragPayload = selected && data.selectedFiles.length > 0 ? data.selectedFiles : [file.path];

  return (
    <div style={style} className="p-1.5">
      <div
        role="button"
        tabIndex={0}
        aria-selected={selected}
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
        onClick={(e): void => data.onFileClick(file, e)}
        onDoubleClick={(): void => data.onFileDoubleClick(file)}
        onContextMenu={(e): void => data.onFileContextMenu(file, e)}
        onKeyDown={(e): void => {
          if (e.key === 'Enter') {
            data.onFileDoubleClick(file);
          }
        }}
        className={`h-full flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all text-center ${
          isDropTarget
            ? 'bg-indigo-100 dark:bg-indigo-950/70 border-indigo-500 ring-2 ring-indigo-500'
            : selected
              ? 'bg-primary-100 dark:bg-indigo-950/60 border-primary-300 dark:border-indigo-500 ring-1 ring-primary-300 dark:ring-indigo-500'
              : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:bg-primary-50 dark:hover:bg-slate-800 hover:border-primary-200 dark:hover:border-slate-700'
        } ${file.isHidden === true ? 'opacity-50' : ''}`}
      >
        <Icon className={`w-9 h-9 mb-2 ${colorClass}`} />
        <span
          className="text-xs font-medium text-gray-800 dark:text-slate-100 w-full truncate"
          title={file.name}
        >
          {file.name}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-slate-400 mt-0.5 tabular-nums">
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

  return (
    <div style={style}>
      <FileListItem
        file={item}
        selected={selected}
        isDropTarget={item.isDirectory && data.dropTargetPath === item.path}
        draggablePaths={selected ? data.selectedFiles : [item.path]}
        onClick={(e): void => data.onFileClick(item, e)}
        onDoubleClick={(): void => data.onFileDoubleClick(item)}
        onContextMenu={(e): void => data.onFileContextMenu(item, e)}
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
  currentDirectory,
  onDropMove,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
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

  const itemData = useMemo<SharedVirtualItemData>(
    () => ({
      sortedFiles,
      selectedFiles,
      dropTargetPath,
      columnCount: gridGeom.columnCount,
      onFileClick,
      onFileDoubleClick,
      onFileContextMenu,
      onDropMove,
      setDropTargetPath,
    }),
    [
      sortedFiles,
      selectedFiles,
      dropTargetPath,
      gridGeom.columnCount,
      onFileClick,
      onFileDoubleClick,
      onFileContextMenu,
      onDropMove,
    ]
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    if (width > 0) setContainerWidth(Math.floor(width));
    if (height > 0) setContainerHeight(Math.floor(height));
  }, [loading, error, sortedFiles.length, viewMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      <div className="flex justify-center items-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-error-500">
        <p className="text-lg font-medium">Error loading files</p>
        <p className="text-sm mt-2">{error.message}</p>
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
        <EmptyState />
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
