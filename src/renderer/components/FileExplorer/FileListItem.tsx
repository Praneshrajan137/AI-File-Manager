import React, { useCallback } from 'react';
import { FileNode } from '@shared/contracts';
import { getFileIconWithColor } from '@renderer/utils/fileIcons';
import { formatFileSize, formatDate } from '@renderer/utils/formatters';

interface FileListItemProps {
  file: FileNode;
  selected?: boolean;
  isDropTarget?: boolean;
  draggablePaths?: string[];
  tabIndex?: number;
  setSize?: number;
  posInSet?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onDragOverFolder?: (e: React.DragEvent) => void;
  onDragLeaveFolder?: () => void;
  onDropOnFolder?: (e: React.DragEvent) => void;
}

export const FileListItem: React.FC<FileListItemProps> = React.memo(({
  file,
  selected = false,
  isDropTarget = false,
  draggablePaths,
  tabIndex = 0,
  setSize,
  posInSet,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}) => {
  const { icon: Icon, colorClass } = getFileIconWithColor(file);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (onKeyDown) {
        onKeyDown(e);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onDoubleClick();
      }
    },
    [onDoubleClick, onKeyDown]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent): void => {
      const payload = draggablePaths && draggablePaths.length > 0 ? draggablePaths : [file.path];
      e.dataTransfer.setData('application/x-fm-paths', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    },
    [draggablePaths, file.path]
  );

  return (
    <div
      className={`
        flex items-center gap-4 px-4 py-2.5 rounded-lg cursor-pointer transition-colors duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset
        ${isDropTarget
          ? 'bg-indigo-100 dark:bg-indigo-950/70 ring-2 ring-accent-500'
          : selected
            ? 'bg-indigo-50 dark:bg-indigo-950/60 ring-1 ring-accent-500 dark:ring-indigo-400 ring-inset'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70'
        }
        ${file.isHidden === true ? 'opacity-60' : ''}
      `}
      draggable
      onDragStart={handleDragStart}
      onDragOver={file.isDirectory ? onDragOverFolder : undefined}
      onDragLeave={file.isDirectory ? onDragLeaveFolder : undefined}
      onDrop={file.isDirectory ? onDropOnFolder : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      role="option"
      data-testid="file-item"
      data-file-path={file.path}
      tabIndex={tabIndex}
      aria-selected={selected}
      aria-setsize={setSize}
      aria-posinset={posInSet}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${colorClass}`} aria-hidden="true" />
      <span
        className={`flex-1 truncate text-sm font-medium ${
          selected
            ? 'text-slate-900 dark:text-white'
            : 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {file.name}
      </span>
      {!file.isDirectory && (
        <>
          <span className="text-xs text-slate-600 dark:text-slate-300 w-20 text-right tabular-nums">
            {formatFileSize(file.size)}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300 w-24 text-right tabular-nums">
            {formatDate(file.modified)}
          </span>
        </>
      )}
    </div>
  );
});

FileListItem.displayName = 'FileListItem';
