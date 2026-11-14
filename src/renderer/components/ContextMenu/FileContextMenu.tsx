import React, { useEffect } from 'react';
import { Copy, Trash2, Edit, FolderOpen, Eye, Star } from 'lucide-react';
import { FileNode } from '@shared/contracts';

interface FileContextMenuProps {
  file: FileNode;
  position: { x: number; y: number };
  onClose: () => void;
  onOpen: () => void;
  onPreview?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onToggleFavorite?: () => void;
  isFavorite?: boolean;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  file,
  position,
  onClose,
  onOpen,
  onPreview,
  onRename,
  onDelete,
  onCopyPath,
  onToggleFavorite,
  isFavorite = false,
}) => {
  useEffect(() => {
    const handleClickOutside = (): void => onClose();
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };

    // Delay adding listeners to prevent immediate close
    const timeoutId = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
      window.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      // Clear timeout if component unmounts before listeners are added
      clearTimeout(timeoutId);
      
      // Remove listeners (safe to call even if never added)
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const menuItems = [
    { label: 'Open', icon: FolderOpen, action: onOpen },
    ...(!file.isDirectory && onPreview
      ? [{ label: 'Quick Preview', icon: Eye, action: onPreview }]
      : []),
    { label: 'Rename', icon: Edit, action: onRename },
    ...(onToggleFavorite
      ? [{ label: isFavorite ? 'Unpin Favorite' : 'Pin to Favorites', icon: Star, action: onToggleFavorite }]
      : []),
    { label: 'Delete', icon: Trash2, action: onDelete, danger: true },
    { label: 'Copy Path', icon: Copy, action: onCopyPath },
  ];

  return (
    <div
      className="fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[160px]"
      style={{ top: position.y, left: position.x }}
      role="menu"
      onClick={(e) => e.stopPropagation()} // Prevent click outside handler
    >
      {menuItems.map((item, idx) => (
        <button
          key={idx}
          onClick={() => {
            item.action();
            onClose();
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 transition-colors ${
            item.danger ? 'text-error-600' : 'text-gray-700'
          }`}
          role="menuitem"
        >
          <item.icon className="w-4 h-4" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
