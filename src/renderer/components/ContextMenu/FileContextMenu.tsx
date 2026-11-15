import React, { useEffect, useRef, useState } from 'react';
import { Copy, Trash2, Edit, FolderOpen, Eye, Star, ArrowRightLeft, Files } from 'lucide-react';
import { FileNode } from '@shared/contracts';
import { useRegisterOverlay } from '@renderer/hooks/useOverlayStack';

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
  onDuplicate?: () => void;
  onCopyToOtherPane?: () => void;
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
  onDuplicate,
  onCopyToOtherPane,
  isFavorite = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [coords, setCoords] = useState<{ left: number; top: number }>(() => {
    if (typeof window === 'undefined') {
      return { left: position.x, top: position.y };
    }
    return {
      left: Math.max(8, Math.min(position.x, window.innerWidth - 220)),
      top: Math.max(8, Math.min(position.y, window.innerHeight - 280)),
    };
  });

  useRegisterOverlay('file-context-menu', true, onClose);

  useEffect(() => {
    const handleClickOutside = (): void => onClose();

    if (menuRef.current && typeof window !== 'undefined') {
      const rect = menuRef.current.getBoundingClientRect();
      const clampedLeft = Math.max(
        8,
        Math.min(position.x, window.innerWidth - Math.max(rect.width, 190) - 8)
      );
      const clampedTop = Math.max(
        8,
        Math.min(position.y, window.innerHeight - Math.max(rect.height, 200) - 8)
      );
      setCoords({ left: clampedLeft, top: clampedTop });
    }

    const focusTimer = setTimeout(() => {
      itemRefs.current[0]?.focus();
    }, 0);

    // Delay adding listener to prevent immediate dismissal from the triggering click
    const timeoutId = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);

    return (): void => {
      clearTimeout(focusTimer);
      clearTimeout(timeoutId);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [onClose, position.x, position.y]);

  const menuItems = [
    { label: 'Open', icon: FolderOpen, action: onOpen },
    ...(!file.isDirectory && onPreview
      ? [{ label: 'Quick Preview', icon: Eye, action: onPreview }]
      : []),
    { label: 'Rename', icon: Edit, action: onRename },
    ...(onDuplicate && !file.isDirectory
      ? [{ label: 'Duplicate File', icon: Files, action: onDuplicate }]
      : []),
    ...(onCopyToOtherPane
      ? [{ label: 'Copy to Split Pane', icon: ArrowRightLeft, action: onCopyToOtherPane }]
      : []),
    ...(onToggleFavorite
      ? [{ label: isFavorite ? 'Unpin Favorite' : 'Pin to Favorites', icon: Star, action: onToggleFavorite }]
      : []),
    { label: 'Delete', icon: Trash2, action: onDelete, danger: true },
    { label: 'Copy Path', icon: Copy, action: onCopyPath },
  ];

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const activeIdx = itemRefs.current.findIndex((btn) => btn === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (activeIdx + 1) % menuItems.length;
      itemRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (activeIdx - 1 + menuItems.length) % menuItems.length;
      itemRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      itemRefs.current[menuItems.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 z-50 min-w-[180px]"
      style={{ top: coords.top, left: coords.left }}
      role="menu"
      aria-label={`Actions for ${file.name}`}
      data-testid="file-context-menu"
      onKeyDown={handleMenuKeyDown}
      onClick={(e): void => e.stopPropagation()}
    >
      {menuItems.map((item, idx) => (
        <button
          key={item.label}
          ref={(el): void => {
            itemRefs.current[idx] = el;
          }}
          type="button"
          onClick={(): void => {
            item.action();
            onClose();
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 focus-visible:outline-none transition-colors ${
            item.danger
              ? 'text-error-700 dark:text-red-400'
              : 'text-slate-700 dark:text-slate-200'
          }`}
          role="menuitem"
        >
          <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
