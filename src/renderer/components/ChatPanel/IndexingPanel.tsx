/**
 * IndexingPanel - UI for managing file indexing for AI Assistant
 * 
 * Features:
 * - Index current directory button
 * - Progress bar during indexing
 * - Stats display (files indexed, total)
 * - Stop indexing button
 * - Folder selection for custom indexing
 */
import React, { useState, useCallback } from 'react';
import { FolderSearch, Play, Square, Check, AlertCircle, Loader2, FolderOpen, Database, Trash2 } from 'lucide-react';
import { IndexingStatus as IIndexingStatus } from '@renderer/hooks/useLLM';

interface IndexingPanelProps {
    indexingStatus: IIndexingStatus;
    currentPath: string;
    onStartIndexing: (path: string) => Promise<void>;
    onStopIndexing: () => Promise<void>;
    onClearIndex?: () => Promise<void>;
}

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
    const [error, setError] = useState<string | null>(null);
    const [notification, setNotification] = useState<string | null>(null);

    const handleIndexCurrentDir = useCallback(async () => {
        if (!currentPath) {
            setError('No directory selected');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setNotification(null);

        try {
            await onStartIndexing(currentPath);
            setNotification(`Indexing started for ${currentPath.split(/[\\/]/).pop()}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start indexing');
        } finally {
            setIsProcessing(false);
            // Clear notification after 3s
            setTimeout(() => setNotification(null), 3000);
        }
    }, [currentPath, onStartIndexing]);

    const handleIndexCustomPath = useCallback(async () => {
        if (!customPath.trim()) {
            setError('Please enter a path');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setNotification(null);

        try {
            const pathToIndex = customPath.trim();
            await onStartIndexing(pathToIndex);
            setNotification(`Indexing started for custom path...`);
            // Keep path in input until user clears it or completion
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start indexing');
        } finally {
            setIsProcessing(false);
            // Clear notification after 3s
            setTimeout(() => setNotification(null), 3000);
        }
    }, [customPath, onStartIndexing]);

    const handleStopIndexing = useCallback(async () => {
        setIsProcessing(true);
        try {
            await onStopIndexing();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to stop indexing');
        } finally {
            setIsProcessing(false);
        }
    }, [onStopIndexing]);

    const handleClearIndex = useCallback(async () => {
        if (!onClearIndex) return;

        // Confirm before clearing
        if (!window.confirm('Clear all indexed files? You will need to re-index to use AI queries.')) {
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            await onClearIndex();
            setNotification('Index cleared successfully. Please re-index to use AI features.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to clear index');
        } finally {
            setIsProcessing(false);
            setTimeout(() => setNotification(null), 5000);
        }
    }, [onClearIndex]);

    const { indexed, total, inProgress, currentFile } = indexingStatus;
    const progress = total > 0 ? Math.round((indexed / total) * 100) : 0;

    return (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100" data-testid="indexing-panel">
            {/* Collapsed header - always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/50 transition-colors"
                aria-expanded={isExpanded}
                aria-controls="indexing-panel-content"
            >
                <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-600" />
                    <span className="text-sm font-medium text-indigo-900">File Indexing</span>

                    {/* Status badge */}
                    {inProgress ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {progress}%
                        </span>
                    ) : indexed > 0 ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                            <Check className="w-3 h-3" />
                            {indexed} files
                        </span>
                    ) : (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                            Not indexed
                        </span>
                    )}
                </div>

                <svg
                    className={`w-4 h-4 text-indigo-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Expanded content */}
            {isExpanded && (
                <div id="indexing-panel-content" className="px-4 pb-4 space-y-4">
                    {/* Notification message */}
                    {notification && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 animate-in fade-in slide-in-from-top-2">
                            <Check className="w-4 h-4 flex-shrink-0" />
                            <span>{notification}</span>
                        </div>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 animate-in fade-in slide-in-from-top-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>{error}</span>
                            <button
                                onClick={() => setError(null)}
                                className="ml-auto text-red-500 hover:text-red-700"
                                aria-label="Dismiss error"
                            >
                                ×
                            </button>
                        </div>
                    )}

                    {/* Progress bar (when indexing) */}
                    {inProgress && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-gray-600">
                                <span>Indexing files...</span>
                                <span>{indexed} / {total}</span>
                            </div>
                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            {currentFile && (
                                <p className="text-xs text-gray-500 truncate" title={currentFile}>
                                    <FolderOpen className="w-3 h-3 inline mr-1" />
                                    {currentFile.split(/[\\/]/).pop()}
                                </p>
                            )}

                            {/* Stop button */}
                            <button
                                onClick={handleStopIndexing}
                                disabled={isProcessing}
                                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                {isProcessing ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Square className="w-4 h-4" />
                                )}
                                Stop Indexing
                            </button>
                        </div>
                    )}

                    {/* Index actions (when not indexing) */}
                    {!inProgress && (
                        <div className="space-y-3">
                            {/* Index current directory */}
                            <div className="space-y-2">
                                <label className="block text-xs font-medium text-gray-700">
                                    Quick Index
                                </label>
                                <button
                                    onClick={handleIndexCurrentDir}
                                    disabled={isProcessing || !currentPath}
                                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow"
                                >
                                    {isProcessing ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <FolderSearch className="w-4 h-4" />
                                    )}
                                    Index Current Directory
                                </button>
                                {currentPath && (
                                    <p className="text-xs text-gray-500 truncate" title={currentPath}>
                                        📁 {currentPath}
                                    </p>
                                )}
                            </div>

                            {/* Custom path input */}
                            <div className="space-y-2">
                                <label className="block text-xs font-medium text-gray-700">
                                    Or enter a custom path
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={customPath}
                                        onChange={(e) => setCustomPath(e.target.value)}
                                        placeholder="C:\Users\Documents"
                                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                        onKeyDown={(e) => e.key === 'Enter' && handleIndexCustomPath()}
                                    />
                                    <button
                                        onClick={handleIndexCustomPath}
                                        disabled={isProcessing || !customPath.trim()}
                                        className="px-3 py-2 bg-indigo-100 hover:bg-indigo-200 disabled:bg-gray-100 text-indigo-700 disabled:text-gray-400 rounded-lg transition-colors"
                                        title="Index custom path"
                                    >
                                        <Play className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Stats display */}
                            {indexed > 0 && (
                                <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                            <Check className="w-5 h-5 text-green-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{indexed} files indexed</p>
                                            <p className="text-xs text-gray-500">Ready for AI queries</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => {
                                                // Re-index to update
                                                if (currentPath) handleIndexCurrentDir();
                                            }}
                                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                            title="Re-index files"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                        </button>
                                        {onClearIndex && (
                                            <button
                                                onClick={handleClearIndex}
                                                disabled={isProcessing}
                                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                title="Clear index"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Help text */}
                            {indexed === 0 && (
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <p className="text-xs text-blue-700">
                                        <strong>💡 Tip:</strong> Index a folder to let the AI Assistant answer questions about your files.
                                        The AI will search through indexed content to provide relevant answers.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
