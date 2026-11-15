import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DirectoryTreeNode } from './DirectoryTreeNode';
import { FileEvent, FileNode } from '@shared/contracts';
import { useSystemPaths } from '@renderer/contexts/SystemPathsContext';
import { getErrorMessage } from '@renderer/utils/formatters';

interface DirectoryTreeProps {
  rootPath?: string;
  onNavigate: (path: string) => void;
  lastWatcherEvent?: FileEvent | null;
}

export const DirectoryTree: React.FC<DirectoryTreeProps> = ({
  rootPath,
  onNavigate,
  lastWatcherEvent = null,
}) => {
  const { paths, error: systemPathsError, retry: retrySystemPaths } = useSystemPaths();
  const [root, setRoot] = useState<FileNode | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const effectiveRootPath = rootPath || paths?.home || null;

  const loadRoot = useCallback(async (): Promise<void> => {
    if (!effectiveRootPath) return;

    try {
      setStatsError(null);
      const stats = await window.electronAPI.fs.getStats(effectiveRootPath);
      setRoot({
        path: effectiveRootPath,
        name: 'Home',
        isDirectory: true,
        size: stats.size ?? 0,
        modified: stats.modified ?? Date.now(),
        extension: '',
        mimeType: '',
      });
    } catch (err: unknown) {
      setRoot(null);
      setStatsError(getErrorMessage(err, 'Failed to load root directory'));
    }
  }, [effectiveRootPath]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  if (!root && (statsError || (!rootPath && systemPathsError))) {
    return (
      <div className="py-2 px-3">
        <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 mb-2">
          Folders
        </h3>
        <div
          role="alert"
          className="px-2 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-error-700 dark:text-red-200 space-y-2"
        >
          <p>{statsError || systemPathsError}</p>
          <button
            type="button"
            onClick={() => void (!rootPath && systemPathsError ? retrySystemPaths() : loadRoot())}
            data-testid="directory-tree-retry"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 font-medium text-error-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  if (!root) return null;

  return (
    <div className="py-2 px-3" role="tree" aria-label="Directory tree">
      <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 mb-3">
        Folders
      </h3>
      <DirectoryTreeNode node={root} onNavigate={onNavigate} lastWatcherEvent={lastWatcherEvent} />
    </div>
  );
};
