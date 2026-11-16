import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, ChevronRight, Loader, RefreshCw } from 'lucide-react';
import { FileEvent, FileNode } from '@shared/contracts';
import { extractParentDirectory, normalizeComparablePath } from '@renderer/utils/pathHelpers';
import { getErrorMessage } from '@renderer/utils/formatters';
import { useDirectoryTreeFocus } from './DirectoryTree';

interface DirectoryTreeNodeProps {
  node: FileNode;
  onNavigate: (path: string) => void;
  level?: number;
  lastWatcherEvent?: FileEvent | null;
}

export const DirectoryTreeNode: React.FC<DirectoryTreeNodeProps> = ({
  node,
  onNavigate,
  level = 0,
  lastWatcherEvent = null,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const treeFocus = useDirectoryTreeFocus();

  const refreshChildren = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const subDirs = await window.electronAPI.fs.readDirectory(node.path);
      const dirs = subDirs.filter((f) => f.isDirectory && f.isHidden !== true);
      setChildren(dirs);
      setLoaded(true);
    } catch (err: unknown) {
      setChildren([]);
      setLoadError(getErrorMessage(err, 'Unable to read folder'));
    } finally {
      setLoading(false);
    }
  }, [node.path]);

  const loadChildrenIfNeeded = async (): Promise<void> => {
    if (!loaded) {
      await refreshChildren();
    }
  };

  useEffect(() => {
    if (!loaded || !lastWatcherEvent) return;
    if (
      lastWatcherEvent.type === 'create' ||
      lastWatcherEvent.type === 'unlink' ||
      lastWatcherEvent.type === 'rename'
    ) {
      const parentOfChange = normalizeComparablePath(extractParentDirectory(lastWatcherEvent.path));
      const thisNodeNorm = normalizeComparablePath(node.path);
      if (parentOfChange === thisNodeNorm) {
        void refreshChildren();
      }
    }
  }, [lastWatcherEvent, loaded, node.path, refreshChildren]);

  const handleChevronClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    treeFocus?.setFocusedPath(node.path);
    if (!expanded) {
      await loadChildrenIfNeeded();
    }
    setExpanded((prev) => !prev);
  };

  const handleClick = (): void => {
    treeFocus?.setFocusedPath(node.path);
    if (!expanded) {
      void loadChildrenIfNeeded();
      setExpanded(true);
    }
    onNavigate(node.path);
  };

  const focusTreeElement = (target: HTMLElement | null | undefined): void => {
    if (!target) return;
    const targetPath = target.dataset.treePath;
    if (targetPath) treeFocus?.setFocusedPath(targetPath);
    target.focus();
  };

  const moveFocus = (delta: number): void => {
    const treeRoot = nodeRef.current?.closest('[role="tree"]');
    if (!treeRoot || !nodeRef.current) return;
    const items = Array.from(treeRoot.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const idx = items.indexOf(nodeRef.current);
    if (idx === -1) return;
    focusTreeElement(items[idx + delta]);
  };

  const focusBoundary = (edge: 'start' | 'end'): void => {
    const treeRoot = nodeRef.current?.closest('[role="tree"]');
    if (!treeRoot) return;
    const items = Array.from(treeRoot.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    focusTreeElement(edge === 'start' ? items[0] : items[items.length - 1]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!expanded) {
        void loadChildrenIfNeeded();
        setExpanded(true);
      } else if (children.length > 0) {
        moveFocus(1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (expanded) {
        setExpanded(false);
      } else {
        const parentWrapper = nodeRef.current?.parentElement?.parentElement?.closest('[data-tree-node="true"]');
        focusTreeElement(parentWrapper?.querySelector<HTMLElement>(':scope > [role="treeitem"]'));
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusBoundary('start');
    } else if (e.key === 'End') {
      e.preventDefault();
      focusBoundary('end');
    }
  };

  const isFocused = treeFocus ? treeFocus.focusedPath === node.path : level === 0;

  return (
    <div data-tree-node="true">
      <div
        ref={nodeRef}
        role="treeitem"
        aria-expanded={expanded}
        aria-level={level + 1}
        aria-label={node.name}
        data-tree-path={node.path}
        tabIndex={isFocused ? 0 : -1}
        className="flex items-center gap-2 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        onFocus={(): void => treeFocus?.setFocusedPath(node.path)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <span
          aria-hidden="true"
          onClick={handleChevronClick}
          className="p-1 min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <ChevronRight
            className={`w-4 h-4 text-slate-600 dark:text-slate-300 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        </span>
        <Folder className="w-4 h-4 text-accent-600 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm truncate flex-1">{node.name}</span>
        {loading && <Loader className="w-3 h-3 animate-spin text-slate-500 dark:text-slate-400" aria-hidden="true" />}
      </div>

      {expanded && loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 py-1 pr-2 text-[11px] text-error-700 dark:text-red-300"
          style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}
        >
          <span className="truncate">{loadError}</span>
          <button
            type="button"
            onClick={(): void => {
              void refreshChildren();
            }}
            className="inline-flex items-center gap-1 underline hover:no-underline flex-shrink-0"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {expanded && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <DirectoryTreeNode
              key={child.path}
              node={child}
              onNavigate={onNavigate}
              level={level + 1}
              lastWatcherEvent={lastWatcherEvent}
            />
          ))}
        </div>
      )}
    </div>
  );
};
