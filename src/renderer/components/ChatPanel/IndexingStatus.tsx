import React from 'react';
import { Loader } from 'lucide-react';
import { IndexingStatus as IIndexingStatus } from '@renderer/hooks/useLLM';

export const IndexingStatus: React.FC<IIndexingStatus> = ({
  indexed,
  total,
  inProgress,
  currentFile
}) => {
  if (!inProgress && indexed === total && total > 0) {
    return (
      <div className="text-xs text-emerald-700 dark:text-emerald-300">
        ✓ {indexed} files indexed
      </div>
    );
  }

  if (inProgress) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <Loader className="w-3 h-3 animate-spin" aria-hidden="true" />
        <span>Indexing: {indexed} / {total}</span>
        {currentFile && (
          <span className="truncate max-w-[150px]">({currentFile})</span>
        )}
      </div>
    );
  }

  return null;
};
