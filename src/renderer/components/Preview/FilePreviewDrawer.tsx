import React, { useEffect } from 'react';
import { X, RefreshCw, ExternalLink, Copy, FileText, AlertTriangle } from 'lucide-react';
import type { FileNode, FilePreviewResult } from '@shared/contracts';
import { formatFileSize } from '@renderer/utils/formatters';
import { Spinner } from '@renderer/components/common/Spinner';

interface FilePreviewDrawerProps {
  isOpen: boolean;
  file: FileNode | null;
  preview: FilePreviewResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onOpenExternal: () => void;
  onCopyPath: () => void;
}

export const FilePreviewDrawer: React.FC<FilePreviewDrawerProps> = ({
  isOpen,
  file,
  preview,
  loading,
  error,
  onClose,
  onRefresh,
  onOpenExternal,
  onCopyPath,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !file) {
    return null;
  }

  return (
    <aside
      className="w-[420px] bg-white border-l border-gray-200 shadow-xl flex flex-col h-full"
      data-testid="file-preview-drawer"
      aria-label={`Quick Preview: ${file.name}`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary-600 flex-shrink-0" />
            <h3 className="text-sm font-semibold text-gray-900 truncate" title={file.name}>
              {file.name}
            </h3>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
            <span>{formatFileSize(preview?.size ?? file.size)}</span>
            {preview && (
              <span
                data-testid="preview-cache-badge"
                className={`px-1.5 py-0.5 rounded font-mono ${
                  preview.fromCache
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
              >
                {preview.fromCache ? 'LRUCache HIT' : 'RingBuffer(100)'}
              </span>
            )}
            {preview?.truncated && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                Capped
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopyPath}
            title="Copy file path"
            aria-label="Copy file path"
            className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh preview"
            aria-label="Refresh preview"
            data-testid="preview-refresh"
            className="p-1.5 rounded hover:bg-gray-200 text-gray-600 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onOpenExternal}
            title="Open with OS default app"
            aria-label="Open externally"
            data-testid="preview-open-external"
            className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close preview"
            aria-label="Close preview"
            data-testid="preview-close"
            className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 bg-slate-950 text-slate-100 font-mono text-xs">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Spinner size="md" />
          </div>
        )}

        {!loading && error && (
          <div className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && preview?.binary && (
          <div
            className="p-4 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 space-y-2"
            data-testid="preview-binary-notice"
          >
            <div className="flex items-center gap-2 text-amber-400 font-semibold">
              <AlertTriangle className="w-4 h-4" />
              Binary File Detected
            </div>
            <p className="text-slate-400 font-sans text-xs">
              Binary content is not rendered in the bounded text drawer. Open this file in your OS default application instead.
            </p>
          </div>
        )}

        {!loading && !error && preview && !preview.binary && (
          <div className="space-y-0.5" data-testid="preview-lines">
            {preview.lines.length === 0 ? (
              <div className="text-slate-400 italic p-2">(File is empty)</div>
            ) : (
              preview.lines.map((line, index) => (
                <div key={index} className="flex hover:bg-slate-900 px-1 rounded">
                  <span className="w-10 text-right pr-3 text-slate-500 select-none flex-shrink-0 tabular-nums">
                    {index + 1}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {preview && (
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-[11px] text-gray-500 flex items-center justify-between">
          <span>{preview.totalLinesBuffered} lines buffered (RingBuffer max 100)</span>
          <span className="truncate max-w-[180px]" title={preview.path}>
            {preview.path}
          </span>
        </div>
      )}
    </aside>
  );
};
