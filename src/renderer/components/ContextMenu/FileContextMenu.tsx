import React, { useEffect } from 'react';
import { Copy, Trash2, Edit, FolderOpen } from 'lucide-react';
import { FileNode } from '@shared/contracts';

interface FileContextMenuProps {
  file: FileNode;
  position: { x: number; y: number };
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  file,
  position,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onCopyPath
}) => {
  useEffect(() => {
    const handleClickOutside = () => onClose();
    const handleEscape = (e: KeyboardEvent) => {
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
    { label: 'Rename', icon: Edit, action: onRename },
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
