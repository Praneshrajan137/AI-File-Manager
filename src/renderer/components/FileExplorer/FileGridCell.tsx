import React from 'react';
import type { GridChildComponentProps } from 'react-window';
import type { FileNode } from '@shared/contracts';
import type { SelectionModifiers } from '@renderer/hooks/useExplorerActions';
import { getFileIconWithColor } from '@renderer/utils/fileIcons';
import { formatFileSize } from '@renderer/utils/formatters';
import { extractDraggedPaths } from '@renderer/utils/explorerHelpers';

export interface SharedVirtualItemData {
  sortedFiles: FileNode[];
  selectedFiles: string[];
  selectedFileSet: ReadonlySet<string>;
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
 * Preserves DOM nodes, focus, and primary mousedown selection across layout reflows.
 */
export const FileGridCell: React.FC<GridChildComponentProps<SharedVirtualItemData>> = React.memo(({
  columnIndex,
  rowIndex,
  style,
  data,
}) => {
  const idx = rowIndex * data.columnCount + columnIndex;
  const file = data.sortedFiles[idx];
  if (!file) return null;

  const selected = data.selectedFileSet.has(file.path);
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
        onMouseDown={(e): void => {
          if (e.button === 0 && !selected && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            data.onFocusPath(file.path);
            data.onFileClick(file);
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
        }`}
      >
        <Icon
          className={`w-9 h-9 mb-2 ${colorClass} ${file.isHidden === true ? 'opacity-75' : ''}`}
          aria-hidden="true"
        />
        <span
          className={`text-xs font-medium w-full truncate ${
            file.isHidden === true
              ? 'italic text-slate-600 dark:text-slate-300'
              : 'text-slate-900 dark:text-slate-100'
          }`}
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

FileGridCell.displayName = 'FileGridCell';
