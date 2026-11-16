import { useEffect, useMemo } from 'react';
import { FileNode } from '@shared/contracts';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

export interface UseWorkspaceShortcutsOptions {
  hasModalOpen: boolean;
  currentPath: string;
  files: FileNode[];
  selectedFiles: string[];
  hasActiveSearch: boolean;
  canPaste: boolean;
  onToggleOmnibar: () => void;
  onToggleChat: () => void;
  onBack: () => Promise<void>;
  onForward: () => Promise<void>;
  onToggleQuickLook: () => void;
  onToggleSplitPane: () => void;
  onRefresh: () => void;
  onRequestRename: (node: FileNode) => void;
  onRequestDelete: (paths: string[]) => void;
  onSelectAll: () => void;
  onClearSearch: () => Promise<void>;
  onClearSelection: () => void;
  onCopySelection: (paths: string[]) => void;
  onCutSelection: (paths: string[]) => void;
  onPasteSelection: (destinationDir: string) => Promise<void>;
  onDuplicateSelection: (paths: string[]) => Promise<void>;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
}

function hasNativeTextSelection(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return false;
  }
  const text = window.getSelection()?.toString();
  return Boolean(text && text.length > 0);
}

export function useWorkspaceShortcuts({
  hasModalOpen,
  currentPath,
  files,
  selectedFiles,
  hasActiveSearch,
  canPaste,
  onToggleOmnibar,
  onToggleChat,
  onBack,
  onForward,
  onToggleQuickLook,
  onToggleSplitPane,
  onRefresh,
  onRequestRename,
  onRequestDelete,
  onSelectAll,
  onClearSearch,
  onClearSelection,
  onCopySelection,
  onCutSelection,
  onPasteSelection,
  onDuplicateSelection,
  onCreateFile,
  onCreateDirectory,
  onUndo,
  onRedo,
}: UseWorkspaceShortcutsOptions): void {
  useEffect(() => {
    const handleGlobalOmnibar = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onToggleOmnibar();
      }
    };
    window.addEventListener('keydown', handleGlobalOmnibar);
    return (): void => window.removeEventListener('keydown', handleGlobalOmnibar);
  }, [onToggleOmnibar]);

  const shortcuts = useMemo<Record<string, () => void>>(() => {
    if (hasModalOpen) return {};

    const map: Record<string, () => void> = {
      'Ctrl+Shift+L': onToggleChat,
      'Alt+Left': (): void => {
        void onBack();
      },
      'Alt+Right': (): void => {
        void onForward();
      },
      'Alt+P': onToggleQuickLook,
      ' ': onToggleQuickLook,
      F6: onToggleSplitPane,
      F5: (): void => {
        if (currentPath) onRefresh();
      },
      F2: (): void => {
        if (selectedFiles.length === 1) {
          const node = files.find((f) => f.path === selectedFiles[0]);
          if (node) onRequestRename(node);
        }
      },
      Delete: (): void => {
        if (selectedFiles.length > 0) onRequestDelete([...selectedFiles]);
      },
      Escape: (): void => {
        if (hasActiveSearch) {
          void onClearSearch();
        } else if (selectedFiles.length > 0) {
          onClearSelection();
        }
      },
      'Ctrl+C': (): void => {
        if (!hasNativeTextSelection() && selectedFiles.length > 0) {
          onCopySelection(selectedFiles);
        }
      },
      'Ctrl+X': (): void => {
        if (!hasNativeTextSelection() && selectedFiles.length > 0) {
          onCutSelection(selectedFiles);
        }
      },
      'Ctrl+V': (): void => {
        if (canPaste && currentPath) {
          void onPasteSelection(currentPath);
        }
      },
      'Ctrl+D': (): void => {
        if (selectedFiles.length > 0) {
          void onDuplicateSelection(selectedFiles);
        }
      },
      'Ctrl+A': onSelectAll,
      'Ctrl+N': onCreateFile,
      'Ctrl+Shift+N': onCreateDirectory,
      'Ctrl+Z': (): void => {
        void onUndo();
      },
      'Ctrl+Y': (): void => {
        void onRedo();
      },
      'Ctrl+Shift+Z': (): void => {
        void onRedo();
      },
    };
    return map;
  }, [
    canPaste,
    currentPath,
    files,
    hasActiveSearch,
    hasModalOpen,
    onBack,
    onClearSearch,
    onClearSelection,
    onCopySelection,
    onCreateDirectory,
    onCreateFile,
    onCutSelection,
    onDuplicateSelection,
    onForward,
    onPasteSelection,
    onRedo,
    onRefresh,
    onRequestDelete,
    onRequestRename,
    onSelectAll,
    onToggleChat,
    onToggleQuickLook,
    onToggleSplitPane,
    onUndo,
    selectedFiles,
  ]);

  useKeyboardShortcuts(shortcuts);
}
