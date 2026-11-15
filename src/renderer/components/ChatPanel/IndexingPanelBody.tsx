import React from 'react';
import {
  FolderSearch,
  Play,
  Square,
  Check,
  AlertCircle,
  Loader2,
  FolderOpen,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { IndexingStatus } from '@renderer/hooks/useLLM';

interface IndexingPanelBodyProps {
  indexingStatus: IndexingStatus;
  currentPath: string;
  customPath: string;
  isProcessing: boolean;
  error: string | null;
  notification: string | null;
  hasClearHandler: boolean;
  onChangeCustomPath: (value: string) => void;
  onDismissError: () => void;
  onIndexCurrentDir: () => void;
  onIndexCustomPath: () => void;
  onStopIndexing: () => void;
  onRequestClearIndex: () => void;
}

/**
 * Expanded body content of IndexingPanel displaying progress, quick-index CTA,
 * custom path indexing, and index statistics/reset controls.
 */
export const IndexingPanelBody: React.FC<IndexingPanelBodyProps> = ({
  indexingStatus,
  currentPath,
  customPath,
  isProcessing,
  error,
  notification,
  hasClearHandler,
  onChangeCustomPath,
  onDismissError,
  onIndexCurrentDir,
  onIndexCustomPath,
  onStopIndexing,
  onRequestClearIndex,
}) => {
  const { indexed, total, inProgress, currentFile } = indexingStatus;
  const progress = total > 0 ? Math.round((indexed / total) * 100) : 0;

  return (
    <div id="indexing-panel-content" className="px-4 pb-4 space-y-4">
      {notification && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-emerald-800 dark:text-emerald-200">
          <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{notification}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="ml-auto px-1.5 text-red-700 dark:text-red-300 hover:underline"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {inProgress ? (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>Indexing files...</span>
            <span className="tabular-nums">{indexed} / {total}</span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {currentFile && (
            <p className="text-xs text-slate-600 dark:text-slate-300 truncate" title={currentFile}>
              <FolderOpen className="w-3 h-3 inline mr-1" aria-hidden="true" />
              {currentFile.split(/[\\/]/).pop()}
            </p>
          )}

          <button
            type="button"
            onClick={onStopIndexing}
            disabled={isProcessing}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-error-700 hover:bg-error-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Square className="w-4 h-4" aria-hidden="true" />
            )}
            <span>Stop Indexing</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Quick Index
            </span>
            <button
              type="button"
              onClick={onIndexCurrentDir}
              disabled={isProcessing || !currentPath}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-accent-600 hover:bg-accent-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-600 dark:disabled:text-slate-400 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <FolderSearch className="w-4 h-4" aria-hidden="true" />
              )}
              <span>Index Current Directory</span>
            </button>
            {currentPath && (
              <p className="text-xs text-slate-600 dark:text-slate-300 truncate" title={currentPath}>
                Folder: {currentPath}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="indexing-custom-path"
              className="block text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              Or enter a custom path
            </label>
            <div className="flex gap-2">
              <input
                id="indexing-custom-path"
                type="text"
                value={customPath}
                onChange={(e): void => onChangeCustomPath(e.target.value)}
                placeholder="C:\Users\Documents"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-accent-500 outline-none"
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') onIndexCustomPath();
                }}
              />
              <button
                type="button"
                onClick={onIndexCustomPath}
                disabled={isProcessing || !customPath.trim()}
                aria-label="Index custom path"
                title="Index custom path"
                className="px-3 py-2 bg-accent-100 dark:bg-accent-950 hover:bg-accent-200 dark:hover:bg-accent-900 disabled:bg-slate-100 dark:disabled:bg-slate-800 text-accent-700 dark:text-accent-300 disabled:text-slate-500 rounded-lg transition-colors"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {indexed > 0 && (
            <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950 rounded-full flex items-center justify-center">
                  <Check className="w-5 h-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {indexed} files indexed
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">Ready for AI queries</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onIndexCurrentDir}
                  disabled={!currentPath}
                  className="p-2 text-slate-600 dark:text-slate-300 hover:text-accent-600 dark:hover:text-accent-300 hover:bg-accent-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  aria-label="Re-index current directory"
                  title="Re-index files"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
                {hasClearHandler && (
                  <button
                    type="button"
                    onClick={onRequestClearIndex}
                    disabled={isProcessing}
                    data-testid="clear-index-button"
                    className="p-2 text-slate-600 dark:text-slate-300 hover:text-error-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 rounded-lg transition-colors disabled:opacity-50"
                    aria-label="Clear index"
                    title="Clear index"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}

          {indexed === 0 && (
            <div className="p-3 bg-info-50 dark:bg-slate-800 rounded-lg border border-info-100 dark:border-slate-700">
              <p className="text-xs text-info-700 dark:text-sky-300">
                <strong>Tip:</strong> Index a folder to let the AI Assistant search through content and provide grounded answers.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
