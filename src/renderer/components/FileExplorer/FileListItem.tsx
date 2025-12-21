import React, { useCallback } from 'react';
import { FileNode } from '@shared/contracts';
import { getFileIconWithColor } from '@renderer/utils/fileIcons';
import { formatFileSize, formatDate } from '@renderer/utils/formatters';

interface FileListItemProps {
  file: FileNode;
  selected?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const FileListItem: React.FC<FileListItemProps> = React.memo(({
  file,
  selected = false,
  onClick,
  onDoubleClick,
  onContextMenu
}) => {
  const { icon: Icon, colorClass } = getFileIconWithColor(file);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onDoubleClick();
    }
  }, [onDoubleClick]);

  return (
    <div
      className={`
        flex items-center gap-4 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-150
        ${selected
          ? 'bg-primary-100 ring-1 ring-primary-300 ring-inset'
          : 'hover:bg-primary-50'
        }
        ${file.isHidden === true ? 'opacity-50' : ''}
      `}
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
      <span className={`flex-1 truncate text-sm font-medium ${selected ? 'text-primary-900' : 'text-primary-800'}`}>
        {file.name}
      </span>
      {!file.isDirectory && (
        <>
          <span className="text-xs text-primary-400 w-20 text-right tabular-nums">
            {formatFileSize(file.size)}
          </span>
          <span className="text-xs text-primary-400 w-24 text-right">
            {formatDate(file.modified)}
          </span>
        </>
      )}
    </div>
  );
});

FileListItem.displayName = 'FileListItem';


