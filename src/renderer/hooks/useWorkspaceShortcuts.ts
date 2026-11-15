import { useEffect, useMemo } from 'react';
import { FileNode } from '@shared/contracts';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

export interface UseWorkspaceShortcutsOptions {
  hasModalOpen: boolean;
  currentPath: string;
  files: FileNode[];
  selectedFiles: string[];
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
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
}

export function useWorkspaceShortcuts({
  hasModalOpen,
  currentPath,
  files,
  selectedFiles,
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
    if (hasModalOpen) {
      return {};
    }
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
        if (selectedFiles.length > 0) {
          onRequestDelete([...selectedFiles]);
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
    hasModalOpen,
    currentPath,
    files,
    selectedFiles,
    onToggleChat,
    onBack,
    onForward,
    onToggleQuickLook,
    onToggleSplitPane,
    onRefresh,
    onRequestRename,
    onRequestDelete,
    onSelectAll,
    onCreateFile,
    onCreateDirectory,
    onUndo,
    onRedo,
  ]);

  useKeyboardShortcuts(shortcuts);
}
