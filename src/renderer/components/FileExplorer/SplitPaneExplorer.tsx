import React from 'react';
import { ArrowUp, RefreshCw, X, ArrowRightLeft } from 'lucide-react';
import { FileNode, SortCriteria, SortDirection } from '@shared/contracts';
import type { ViewMode } from '@renderer/utils/constants';
import type { SelectionModifiers } from '@renderer/hooks/useExplorerActions';
import { extractParentDirectory, normalizeComparablePath } from '@renderer/utils/pathHelpers';
import { FileGrid } from './FileGrid';

interface SplitPaneExplorerProps {
  secondaryPath: string;
  files: FileNode[];
  selectedFiles: string[];
  loading: boolean;
  sortBy: SortCriteria;
  sortDirection: SortDirection;
  viewMode: ViewMode;
  primarySelectedCount?: number;
  onNavigate: (targetPath: string) => void;
  onRefresh: () => void;
  onClose: () => void;
  onCopyFromPrimary?: () => void;
  onFileClick: (file: FileNode, e?: SelectionModifiers) => void;
  onFileDoubleClick: (file: FileNode) => void;
  onFileContextMenu: (file: FileNode, e: React.MouseEvent) => void;
  onDropMove: (sourcePaths: string[], destinationDir: string) => void;
}

export const SplitPaneExplorer: React.FC<SplitPaneExplorerProps> = ({
  secondaryPath,
  files,
  selectedFiles,
  loading,
  sortBy,
  sortDirection,
  viewMode,
  primarySelectedCount = 0,
  onNavigate,
  onRefresh,
  onClose,
  onCopyFromPrimary,
  onFileClick,
  onFileDoubleClick,
  onFileContextMenu,
  onDropMove,
}) => {
  const parentDir = secondaryPath ? extractParentDirectory(secondaryPath) : '';
  const canGoUp =
    Boolean(parentDir) &&
    normalizeComparablePath(parentDir) !== normalizeComparablePath(secondaryPath);

  return (
    <section
      aria-label="Secondary file explorer pane"
      className="w-1/2 min-w-[220px] sm:min-w-[260px] flex flex-col border-l border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 overflow-hidden"
      data-testid="split-pane-right"
    >
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            disabled={!canGoUp}
            onClick={(): void => {
              if (canGoUp) onNavigate(parentDir);
            }}
            data-testid="split-pane-up"
            title="Go to parent directory"
            aria-label="Split pane up"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span
            data-testid="split-pane-path"
            title={secondaryPath}
            className="font-mono text-[11px] text-slate-700 dark:text-slate-200 truncate"
          >
            {secondaryPath || 'Split Pane'}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {onCopyFromPrimary && primarySelectedCount > 0 && secondaryPath && (
            <button
              type="button"
              onClick={onCopyFromPrimary}
              data-testid="split-pane-copy-button"
              title={`Copy ${primarySelectedCount} selected item(s) to this pane`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950/60 text-accent-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <ArrowRightLeft className="w-3 h-3" aria-hidden="true" />
              <span>Copy ({primarySelectedCount})</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            data-testid="split-pane-refresh"
            title="Refresh split pane"
            aria-label="Refresh split pane"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="split-pane-close"
            title="Close split pane (F6)"
            aria-label="Close split pane"
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-3 dark:bg-slate-950">
        <FileGrid
          files={files}
          selectedFiles={selectedFiles}
          onFileClick={onFileClick}
          onFileDoubleClick={onFileDoubleClick}
          onFileContextMenu={onFileContextMenu}
          sortBy={sortBy}
          sortDirection={sortDirection}
          viewMode={viewMode}
          loading={loading}
          currentDirectory={secondaryPath}
          onDropMove={(sources, dest): void => onDropMove(sources, dest)}
        />
      </div>
    </section>
  );
};
