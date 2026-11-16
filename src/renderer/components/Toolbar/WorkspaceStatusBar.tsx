import React from 'react';
import { ClipboardPaste, Command, Database, X } from 'lucide-react';
import type { FileNode } from '@shared/contracts';
import type { FileClipboardState } from '@renderer/hooks/useFileClipboard';
import type { IndexingStatus } from '@renderer/hooks/useLLM';
import { formatFileSize } from '@renderer/utils/formatters';
import { Kbd } from '@renderer/components/common/Kbd';

interface WorkspaceStatusBarProps {
  files: FileNode[];
  currentPath: string;
  searchQuery: string | null;
  clipboard: FileClipboardState | null;
  indexingStatus: IndexingStatus;
  onPaste: () => void;
  onClearClipboard: () => void;
  onOpenChat: () => void;
  onOpenOmnibar: () => void;
}

/** Slim 28px footer surfacing item counts, internal file clipboard queue, indexing telemetry, and palette hint. */
export const WorkspaceStatusBar: React.FC<WorkspaceStatusBarProps> = ({
  files,
  currentPath,
  searchQuery,
  clipboard,
  indexingStatus,
  onPaste,
  onClearClipboard,
  onOpenChat,
  onOpenOmnibar,
}) => {
  const folderCount = files.filter((f) => f.isDirectory).length;
  const fileCount = files.length - folderCount;
  const totalBytes = files.reduce((acc, item) => acc + (item.isDirectory ? 0 : item.size), 0);

  return (
    <footer
      aria-label="Workspace status"
      data-testid="workspace-status-bar"
      className="min-h-[28px] px-3 py-1 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300 flex-shrink-0"
    >
      <div className="flex items-center gap-3 min-w-0 flex-wrap tabular-nums">
        <span data-testid="status-item-counts">
          {searchQuery
            ? `${files.length} search result${files.length === 1 ? '' : 's'}`
            : `${folderCount} folder${folderCount === 1 ? '' : 's'}, ${fileCount} file${fileCount === 1 ? '' : 's'}${
                totalBytes > 0 ? ` · ${formatFileSize(totalBytes)}` : ''
              }`}
        </span>

        {clipboard && clipboard.paths.length > 0 && (
          <div
            data-testid="status-clipboard-badge"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-accent-700 dark:text-indigo-200"
          >
            <span>
              {clipboard.mode === 'cut' ? 'Cut' : 'Copied'} {clipboard.paths.length} item
              {clipboard.paths.length === 1 ? '' : 's'}
            </span>
            {currentPath && (
              <button
                type="button"
                onClick={onPaste}
                data-testid="status-paste-button"
                className="inline-flex items-center gap-1 underline hover:no-underline font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded"
              >
                <ClipboardPaste className="w-3 h-3" aria-hidden="true" />
                <span>Paste (Ctrl+V)</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClearClipboard}
              aria-label="Clear clipboard"
              className="min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded hover:bg-indigo-200/70 dark:hover:bg-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        )}

        {indexingStatus.inProgress && (
          <button
            type="button"
            onClick={onOpenChat}
            data-testid="status-indexing-pill"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <Database className="w-3 h-3 animate-pulse" aria-hidden="true" />
            <span>
              Indexing {indexingStatus.indexed}/{indexingStatus.total}
            </span>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenOmnibar}
        data-testid="status-omnibar-hint"
        className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-accent-600 dark:hover:text-indigo-300 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded px-1"
      >
        <Command className="w-3 h-3" aria-hidden="true" />
        <span>Command Palette</span>
        <Kbd>Ctrl+K</Kbd>
      </button>
    </footer>
  );
};
