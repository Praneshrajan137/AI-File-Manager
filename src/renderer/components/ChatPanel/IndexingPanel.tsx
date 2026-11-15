import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Check, Loader2, Database } from 'lucide-react';
import { IndexingStatus as IIndexingStatus } from '@renderer/hooks/useLLM';
import { ConfirmDialog } from '@renderer/components/common/ConfirmDialog';
import { IndexingPanelBody } from './IndexingPanelBody';

interface IndexingPanelProps {
  indexingStatus: IIndexingStatus;
  currentPath: string;
  onStartIndexing: (path: string) => Promise<void>;
  onStopIndexing: () => Promise<void>;
  onClearIndex?: () => Promise<void>;
}

/**
 * Collapsible panel for triggering, monitoring, stopping, and clearing workspace indexing.
 */
export const IndexingPanel: React.FC<IndexingPanelProps> = ({
  indexingStatus,
  currentPath,
  onStartIndexing,
  onStopIndexing,
  onClearIndex,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const notifTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return (): void => {
      if (notifTimerRef.current) {
        clearTimeout(notifTimerRef.current);
      }
    };
  }, []);

  const showTransientNotification = useCallback((message: string, durationMs = 3000): void => {
    setNotification(message);
    if (notifTimerRef.current) {
      clearTimeout(notifTimerRef.current);
    }
    notifTimerRef.current = setTimeout(() => setNotification(null), durationMs);
  }, []);

  const handleIndexCurrentDir = useCallback(async (): Promise<void> => {
    if (!currentPath) {
      setError('No directory selected');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setNotification(null);

    try {
      await onStartIndexing(currentPath);
      showTransientNotification(`Indexing started for ${currentPath.split(/[\\/]/).pop()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start indexing');
    } finally {
      setIsProcessing(false);
    }
  }, [currentPath, onStartIndexing, showTransientNotification]);

  const handleIndexCustomPath = useCallback(async (): Promise<void> => {
    if (!customPath.trim()) {
      setError('Please enter a path');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setNotification(null);

    try {
      await onStartIndexing(customPath.trim());
      showTransientNotification('Indexing started for custom path...');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start indexing');
    } finally {
      setIsProcessing(false);
    }
  }, [customPath, onStartIndexing, showTransientNotification]);

  const handleStopIndexing = useCallback(async (): Promise<void> => {
    setIsProcessing(true);
    try {
      await onStopIndexing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop indexing');
    } finally {
      setIsProcessing(false);
    }
  }, [onStopIndexing]);

  const handleConfirmClearIndex = useCallback(async (): Promise<void> => {
    if (!onClearIndex) return;
    setConfirmClearOpen(false);
    setIsProcessing(true);
    setError(null);

    try {
      await onClearIndex();
      showTransientNotification('Index cleared successfully. Please re-index to use AI features.', 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear index');
    } finally {
      setIsProcessing(false);
    }
  }, [onClearIndex, showTransientNotification]);

  const { indexed, total, inProgress } = indexingStatus;
  const progress = total > 0 ? Math.round((indexed / total) * 100) : 0;

  return (
    <div
      className="bg-gradient-to-r from-accent-50 to-slate-50 dark:from-slate-900 dark:to-slate-900 border-b border-accent-100 dark:border-slate-800"
      data-testid="indexing-panel"
    >
      <button
        type="button"
        onClick={(): void => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/60 dark:hover:bg-slate-800/50 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="indexing-panel-content"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-accent-600 dark:text-accent-400" aria-hidden="true" />
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">File Indexing</span>

          {inProgress ? (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-xs rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              {progress}%
            </span>
          ) : indexed > 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs rounded-full">
              <Check className="w-3 h-3" aria-hidden="true" />
              {indexed} files
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded-full">
              Not indexed
            </span>
          )}
        </div>

        <svg
          aria-hidden="true"
          className={`w-4 h-4 text-accent-600 dark:text-accent-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <IndexingPanelBody
          indexingStatus={indexingStatus}
          currentPath={currentPath}
          customPath={customPath}
          isProcessing={isProcessing}
          error={error}
          notification={notification}
          hasClearHandler={Boolean(onClearIndex)}
          onChangeCustomPath={setCustomPath}
          onDismissError={(): void => setError(null)}
          onIndexCurrentDir={(): void => {
            void handleIndexCurrentDir();
          }}
          onIndexCustomPath={(): void => {
            void handleIndexCustomPath();
          }}
          onStopIndexing={(): void => {
            void handleStopIndexing();
          }}
          onRequestClearIndex={(): void => setConfirmClearOpen(true)}
        />
      )}

      <ConfirmDialog
        isOpen={confirmClearOpen}
        title="Clear Search Index?"
        description="Clear all indexed files? You will need to re-index to use AI queries."
        confirmLabel="Clear Index"
        destructive={true}
        busy={isProcessing}
        dataTestId="clear-index-confirm-dialog"
        onConfirm={handleConfirmClearIndex}
        onCancel={(): void => setConfirmClearOpen(false)}
      />
    </div>
  );
};
