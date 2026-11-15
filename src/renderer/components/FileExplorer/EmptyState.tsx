import React from 'react';
import { FolderOpen, SearchX } from 'lucide-react';

interface EmptyStateProps {
  searchQuery?: string | null;
  onClearSearch?: () => void;
}

/**
 * Accessible empty state for both empty directories and zero-match search queries.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  searchQuery = null,
  onClearSearch,
}) => {
  if (searchQuery) {
    return (
      <div
        data-testid="search-empty-state"
        className="flex flex-col items-center justify-center h-full px-6 text-center text-slate-600 dark:text-slate-300"
      >
        <SearchX className="w-14 h-14 mb-3 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
          No files match &ldquo;{searchQuery}&rdquo;
        </p>
        <p className="text-sm mt-1.5 text-slate-600 dark:text-slate-300">
          Try a different keyword or return to the current folder.
        </p>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            data-testid="empty-clear-search-button"
            className="mt-4 px-3.5 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-xs font-medium"
          >
            Clear search filter
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="folder-empty-state"
      className="flex flex-col items-center justify-center h-full px-6 text-center text-slate-600 dark:text-slate-300"
    >
      <FolderOpen className="w-16 h-16 mb-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      <p className="text-lg font-medium text-slate-800 dark:text-slate-100">This folder is empty</p>
      <p className="text-sm mt-2 text-slate-600 dark:text-slate-300">
        Drop files here or create a new file
      </p>
    </div>
  );
};
