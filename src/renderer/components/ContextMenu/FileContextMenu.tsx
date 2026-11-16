import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  ClipboardPaste,
  Copy,
  Edit,
  Eye,
  Files,
  FolderOpen,
  Scissors,
  Star,
  Trash2,
} from 'lucide-react';
import { FileNode } from '@shared/contracts';
import { useRegisterOverlay } from '@renderer/hooks/useOverlayStack';

interface FileContextMenuProps {
  file: FileNode;
  selectedCount?: number;
  position: { x: number; y: number };
  onClose: () => void;
  onOpen: () => void;
  onPreview?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onCopyFiles?: () => void;
  onCutFiles?: () => void;
  canPaste?: boolean;
  onPasteFiles?: () => void;
  onToggleFavorite?: () => void;
  onDuplicate?: () => void;
  onCopyToOtherPane?: () => void;
  isFavorite?: boolean;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  file,
  selectedCount = 1,
  position,
  onClose,
  onOpen,
  onPreview,
  onRename,
  onDelete,
  onCopyPath,
  onCopyFiles,
  onCutFiles,
  canPaste = false,
  onPasteFiles,
  onToggleFavorite,
  onDuplicate,
  onCopyToOtherPane,
  isFavorite = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [coords, setCoords] = useState<{ left: number; top: number }>(() => {
    if (typeof window === 'undefined') return { left: position.x, top: position.y };
    return {
      left: Math.max(8, Math.min(position.x, window.innerWidth - 220)),
      top: Math.max(8, Math.min(position.y, window.innerHeight - 320)),
    };
  });

  useRegisterOverlay('file-context-menu', true, onClose);

  useEffect(() => {
    const handleClickOutside = (): void => onClose();
    if (menuRef.current && typeof window !== 'undefined') {
      const rect = menuRef.current.getBoundingClientRect();
      setCoords({
        left: Math.max(8, Math.min(position.x, window.innerWidth - Math.max(rect.width, 195) - 8)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - Math.max(rect.height, 220) - 8)),
      });
    }

    const focusTimer = setTimeout(() => itemRefs.current[0]?.focus(), 0);
    const timeoutId = setTimeout(() => window.addEventListener('click', handleClickOutside), 0);

    return (): void => {
      clearTimeout(focusTimer);
      clearTimeout(timeoutId);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [onClose, position.x, position.y]);

  const batchSuffix = selectedCount > 1 ? ` (${selectedCount})` : '';
  const menuItems = [
    ...(selectedCount <= 1 ? [{ label: 'Open', icon: FolderOpen, action: onOpen }] : []),
    ...(selectedCount <= 1 && !file.isDirectory && onPreview
      ? [{ label: 'Quick Preview', icon: Eye, action: onPreview }]
      : []),
    ...(selectedCount <= 1 ? [{ label: 'Rename', icon: Edit, action: onRename }] : []),
    ...(onCopyFiles ? [{ label: `Copy${batchSuffix}`, icon: Files, action: onCopyFiles }] : []),
    ...(onCutFiles ? [{ label: `Cut${batchSuffix}`, icon: Scissors, action: onCutFiles }] : []),
    ...(canPaste && onPasteFiles
      ? [{ label: 'Paste Here', icon: ClipboardPaste, action: onPasteFiles }]
      : []),
    ...(onDuplicate && (selectedCount > 1 || !file.isDirectory)
      ? [{ label: selectedCount > 1 ? `Duplicate (${selectedCount})` : 'Duplicate File', icon: Files, action: onDuplicate }]
      : []),
    ...(onCopyToOtherPane
      ? [{ label: 'Copy to Split Pane', icon: ArrowRightLeft, action: onCopyToOtherPane }]
      : []),
    ...(selectedCount <= 1 && onToggleFavorite
      ? [{ label: isFavorite ? 'Unpin Favorite' : 'Pin to Favorites', icon: Star, action: onToggleFavorite }]
      : []),
    { label: `Delete${batchSuffix}`, icon: Trash2, action: onDelete, danger: true },
    ...(selectedCount <= 1 ? [{ label: 'Copy Path', icon: Copy, action: onCopyPath }] : []),
  ];

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const activeIdx = itemRefs.current.findIndex((btn) => btn === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      itemRefs.current[(activeIdx + 1) % menuItems.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      itemRefs.current[(activeIdx - 1 + menuItems.length) % menuItems.length]?.focus();
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
      className="fixed bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 z-50 min-w-[190px]"
      style={{ top: coords.top, left: coords.left }}
      role="menu"
      aria-label={`Actions for ${selectedCount > 1 ? `${selectedCount} selected items` : file.name}`}
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
            item.danger ? 'text-error-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
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
