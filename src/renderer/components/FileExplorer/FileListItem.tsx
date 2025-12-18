import React, { useCallback } from 'react';
import { FileNode } from '@shared/contracts';
import { getFileIcon } from '@renderer/utils/fileIcons';
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
  const Icon = getFileIcon(file);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onDoubleClick();
    }
  }, [onDoubleClick]);

  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded cursor-pointer transition-colors
        ${selected 
          ? 'bg-primary-100 border-l-4 border-primary-500' 
          : 'hover:bg-gray-100'
        }
        ${file.isHidden === true ? 'opacity-60 italic' : ''}
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onKeyPress={handleKeyPress}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="flex-1 truncate text-sm text-gray-800">{file.name}</span>
      {!file.isDirectory && (
        <>
          <span className="text-xs text-gray-500 w-20 text-right">
            {formatFileSize(file.size)}
          </span>
          <span className="text-xs text-gray-500 w-24 text-right">
            {formatDate(file.modified)}
          </span>
        </>
      )}
    </div>
  );
});

FileListItem.displayName = 'FileListItem';
