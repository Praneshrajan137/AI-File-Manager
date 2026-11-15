import { useCallback, useEffect, useRef, useState } from 'react';
import { FileNode } from '@shared/contracts';
import type { SelectionModifiers } from './useExplorerActions';

interface UseExplorerKeyboardOptions {
  sortedFiles: FileNode[];
  selectedFiles: string[];
  viewMode: 'list' | 'grid';
  columnCount: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onScrollToIndex: (index: number) => void;
  onFileClick: (file: FileNode, e?: SelectionModifiers) => void;
  onFileDoubleClick: (file: FileNode) => void;
}

interface UseExplorerKeyboardResult {
  activePath: string | null;
  setFocusedPath: React.Dispatch<React.SetStateAction<string | null>>;
  handleItemKeyDown: (file: FileNode, index: number, e: React.KeyboardEvent) => void;
}

function findOptionElement(root: HTMLElement | null, targetPath: string): HTMLElement | null {
  if (!root) return null;
  const options = root.querySelectorAll<HTMLElement>('[role="option"][data-file-path]');
  for (const el of Array.from(options)) {
    if (el.getAttribute('data-file-path') === targetPath) {
      return el;
    }
  }
  return null;
}

/**
 * Provides roving focus, arrow/grid/Home/End navigation, typeahead search,
 * and Ctrl/Shift keyboard multi-selection across virtualized file list & grid views.
 */
export function useExplorerKeyboard({
  sortedFiles,
  selectedFiles,
  viewMode,
  columnCount,
  containerRef,
  onScrollToIndex,
  onFileClick,
  onFileDoubleClick,
}: UseExplorerKeyboardOptions): UseExplorerKeyboardResult {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const typeaheadBufferRef = useRef<string>('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (typeaheadTimerRef.current) {
        clearTimeout(typeaheadTimerRef.current);
      }
      if (focusRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(focusRafRef.current);
      }
    };
  }, []);

  const validPathSet = new Set(sortedFiles.map((file) => file.path));
  const activePath =
    (focusedPath && validPathSet.has(focusedPath) ? focusedPath : null) ||
    selectedFiles.find((p) => validPathSet.has(p)) ||
    sortedFiles[0]?.path ||
    null;

  const focusOptionByPath = useCallback(
    (targetPath: string): void => {
      const immediate = findOptionElement(containerRef.current, targetPath);
      if (immediate) {
        immediate.focus();
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        if (focusRafRef.current !== null) {
          cancelAnimationFrame(focusRafRef.current);
        }
        focusRafRef.current = requestAnimationFrame(() => {
          focusRafRef.current = null;
          findOptionElement(containerRef.current, targetPath)?.focus();
        });
      }
    },
    [containerRef]
  );

  const navigateToIndex = useCallback(
    (nextIndex: number, modifiers?: { shiftKey?: boolean; keepSelection?: boolean }): void => {
      if (sortedFiles.length === 0) return;
      const clamped = Math.max(0, Math.min(sortedFiles.length - 1, nextIndex));
      const targetFile = sortedFiles[clamped];
      if (!targetFile) return;

      setFocusedPath(targetFile.path);
      onScrollToIndex(clamped);

      if (!modifiers?.keepSelection) {
        if (modifiers?.shiftKey) {
          onFileClick(targetFile, { shiftKey: true });
        } else {
          onFileClick(targetFile);
        }
      }

      focusOptionByPath(targetFile.path);
    },
    [focusOptionByPath, onFileClick, onScrollToIndex, sortedFiles]
  );

  const handleItemKeyDown = useCallback(
    (file: FileNode, index: number, e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onFileDoubleClick(file);
        return;
      }

      if (e.key === ' ' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        setFocusedPath(file.path);
        onFileClick(file, {
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
        });
        return;
      }

      const cols = viewMode === 'grid' ? Math.max(1, columnCount) : 1;
      const keepSelection = e.ctrlKey || e.metaKey;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateToIndex(index + cols, { shiftKey: e.shiftKey, keepSelection });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateToIndex(index - cols, { shiftKey: e.shiftKey, keepSelection });
        return;
      }
      if (e.key === 'ArrowRight' && viewMode === 'grid') {
        e.preventDefault();
        navigateToIndex(index + 1, { shiftKey: e.shiftKey, keepSelection });
        return;
      }
      if (e.key === 'ArrowLeft' && viewMode === 'grid') {
        e.preventDefault();
        navigateToIndex(index - 1, { shiftKey: e.shiftKey, keepSelection });
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        navigateToIndex(0, { shiftKey: e.shiftKey, keepSelection });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        navigateToIndex(sortedFiles.length - 1, { shiftKey: e.shiftKey, keepSelection });
        return;
      }

      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /^[a-z0-9._-]$/i.test(e.key)
      ) {
        if (typeaheadTimerRef.current) {
          clearTimeout(typeaheadTimerRef.current);
        }
        typeaheadBufferRef.current += e.key.toLowerCase();
        const needle = typeaheadBufferRef.current;
        typeaheadTimerRef.current = setTimeout(() => {
          typeaheadBufferRef.current = '';
        }, 500);

        for (let offset = 1; offset <= sortedFiles.length; offset++) {
          const candidateIdx = (index + offset) % sortedFiles.length;
          if (sortedFiles[candidateIdx]?.name.toLowerCase().startsWith(needle)) {
            e.preventDefault();
            navigateToIndex(candidateIdx);
            return;
          }
        }
      }
    },
    [columnCount, navigateToIndex, onFileClick, onFileDoubleClick, sortedFiles, viewMode]
  );

  return {
    activePath,
    setFocusedPath,
    handleItemKeyDown,
  };
}
