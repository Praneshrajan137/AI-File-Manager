import React, { useCallback } from 'react';
import { FileNode } from '@shared/contracts';
import { getFileIconWithColor } from '@renderer/utils/fileIcons';
import { formatFileSize, formatDate } from '@renderer/utils/formatters';

interface FileListItemProps {
  file: FileNode;
  selected?: boolean;
  isDropTarget?: boolean;
  draggablePaths?: string[];
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragOverFolder?: (e: React.DragEvent) => void;
  onDragLeaveFolder?: () => void;
  onDropOnFolder?: (e: React.DragEvent) => void;
}

export const FileListItem: React.FC<FileListItemProps> = React.memo(({
  file,
  selected = false,
  isDropTarget = false,
  draggablePaths,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}) => {
  const { icon: Icon, colorClass } = getFileIconWithColor(file);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onDoubleClick();
    }
  }, [onDoubleClick]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const payload = draggablePaths && draggablePaths.length > 0 ? draggablePaths : [file.path];
      e.dataTransfer.setData('application/x-fm-paths', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    },
    [draggablePaths, file.path]
  );

  return (
    <div
      className={`
        flex items-center gap-4 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-150
        ${isDropTarget
          ? 'bg-indigo-100 dark:bg-indigo-950/70 ring-2 ring-indigo-500'
          : selected
            ? 'bg-primary-100 dark:bg-indigo-950/60 ring-1 ring-primary-300 dark:ring-indigo-500/60 ring-inset'
            : 'hover:bg-primary-50 dark:hover:bg-slate-800/70'
        }
        ${file.isHidden === true ? 'opacity-50' : ''}
      `}
      draggable
      onDragStart={handleDragStart}
      onDragOver={file.isDirectory ? onDragOverFolder : undefined}
      onDragLeave={file.isDirectory ? onDragLeaveFolder : undefined}
      onDrop={file.isDirectory ? onDropOnFolder : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onKeyPress={handleKeyPress}
    >
      {/* Colorful file type icon */}
      <Icon className={`w-5 h-5 flex-shrink-0 ${colorClass}`} />
      <span
        className={`flex-1 truncate text-sm font-medium ${
          selected
            ? 'text-primary-900 dark:text-white'
            : 'text-primary-800 dark:text-slate-200'
        }`}
      >
        {file.name}
      </span>
      {!file.isDirectory && (
        <>
          <span className="text-xs text-primary-400 dark:text-slate-400 w-20 text-right tabular-nums">
            {formatFileSize(file.size)}
          </span>
          <span className="text-xs text-primary-400 dark:text-slate-400 w-24 text-right">
            {formatDate(file.modified)}
          </span>
        </>
      )}
    </div>
  );
});

FileListItem.displayName = 'FileListItem';
