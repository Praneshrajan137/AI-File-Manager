import React, { useEffect, useState } from 'react';
import {
  X,
  RefreshCw,
  ExternalLink,
  Copy,
  FileText,
  AlertTriangle,
  Image as ImageIcon,
  FileCode2,
  Network,
} from 'lucide-react';
import type {
  FileConnectionsSummary,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
} from '@shared/contracts';
import { formatFileSize } from '@renderer/utils/formatters';
import { buildVaultAssetUrl, getVaultAssetKind } from '@shared/utils/vaultAssetUrl';
import { Spinner } from '@renderer/components/common/Spinner';
import { useRegisterOverlay } from '@renderer/hooks/useOverlayStack';
import { PreviewConnectionsTab } from './PreviewConnectionsTab';

interface CitationHighlightRange {
  startLine: number;
  endLine?: number;
}

interface FilePreviewDrawerProps {
  isOpen: boolean;
  file: FileNode | null;
  preview: FilePreviewResult | null;
  lineRange?: FileLineRangeResult | null;
  highlightRange?: CitationHighlightRange | null;
  fileConnections?: FileConnectionsSummary | null;
  connectionsLoading?: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onOpenExternal: () => void;
  onCopyPath: () => void;
  onClearRangeFocus?: () => void;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
}

export const FilePreviewDrawer: React.FC<FilePreviewDrawerProps> = ({
  isOpen,
  file,
  preview,
  lineRange = null,
  highlightRange = null,
  fileConnections = null,
  connectionsLoading = false,
  loading,
  error,
  onClose,
  onRefresh,
  onOpenExternal,
  onCopyPath,
  onClearRangeFocus,
  onOpenCitation,
}) => {
  const [assetError, setAssetError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'connections'>('content');

  useEffect(() => {
    setAssetError(null);
    setActiveTab('content');
  }, [file?.path]);

  useEffect(() => {
    if (lineRange) {
      setActiveTab('content');
    }
  }, [lineRange]);

  useRegisterOverlay('file-preview-drawer', isOpen && Boolean(file), onClose, { blocking: false });

  if (!isOpen || !file) {
    return null;
  }

  const assetKind = getVaultAssetKind(file.extension || file.name);
  const assetUrl = assetKind !== 'unsupported' ? buildVaultAssetUrl(file.path) : null;
  const focusEndLine = highlightRange
    ? highlightRange.endLine ?? highlightRange.startLine
    : undefined;

  return (
    <aside
      className="w-80 sm:w-96 lg:w-[440px] max-w-[90vw] flex-shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col h-full"
      data-testid="file-preview-drawer"
      aria-label={`Quick Preview: ${file.name}`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2">
            {assetKind === 'image' ? (
              <ImageIcon className="w-4 h-4 text-accent-600 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
            ) : lineRange ? (
              <FileCode2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 flex-shrink-0" aria-hidden="true" />
            ) : (
              <FileText className="w-4 h-4 text-slate-600 dark:text-slate-300 flex-shrink-0" aria-hidden="true" />
            )}
            <h3
              className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate"
              title={file.name}
            >
              {file.name}
            </h3>
          </div>
          <div className="flex items-center flex-wrap gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-300">
            <span>{formatFileSize(preview?.size ?? file.size)}</span>
            {lineRange && highlightRange && (
              <span
                data-testid="preview-citation-badge"
                className="px-1.5 py-0.5 rounded font-mono bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
              >
                Citation L{highlightRange.startLine}
                {focusEndLine && focusEndLine > highlightRange.startLine ? `-L${focusEndLine}` : ''}
              </span>
            )}
            {!lineRange && assetUrl && (
              <span
                data-testid="preview-asset-badge"
                className="px-1.5 py-0.5 rounded font-mono bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200"
              >
                vault-asset://{assetKind}
              </span>
            )}
            {!lineRange && !assetUrl && preview && (
              <span
                data-testid="preview-cache-badge"
                className={`px-1.5 py-0.5 rounded font-mono ${
                  preview.fromCache
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                    : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200'
                }`}
              >
                {preview.fromCache ? 'LRUCache HIT' : 'RingBuffer(100)'}
              </span>
            )}
            {preview?.truncated && !lineRange && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 font-medium">
                Capped
              </span>
            )}
            {lineRange && onClearRangeFocus && (
              <button
                type="button"
                onClick={onClearRangeFocus}
                className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                Show File Head
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopyPath}
            title="Copy file path"
            aria-label="Copy file path"
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh preview"
            aria-label="Refresh preview"
            data-testid="preview-refresh"
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpenExternal}
            title="Open with OS default app"
            aria-label="Open externally"
            data-testid="preview-open-external"
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close preview"
            aria-label="Close preview"
            data-testid="preview-close"
            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Sub-tabs: Content / Connections */}
      <div
        role="tablist"
        aria-label="Preview view tabs"
        className="px-4 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'content'}
          data-testid="preview-tab-content"
          onClick={(): void => setActiveTab('content')}
          className={`px-2.5 py-1 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
            activeTab === 'content'
              ? 'bg-accent-600 text-white'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Content
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'connections'}
          data-testid="preview-tab-connections"
          onClick={(): void => setActiveTab('connections')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
            activeTab === 'connections'
              ? 'bg-accent-600 text-white'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Network className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Connections</span>
          {fileConnections && (
            <span className="text-[10px] opacity-95 tabular-nums">
              ({fileConnections.symbols.length + fileConnections.outgoingLinks.length + fileConnections.backlinks.length})
            </span>
          )}
        </button>
      </div>

      {/* Content / Connections Panel */}
      <div
        role="region"
        aria-label="File preview content"
        tabIndex={0}
        className="flex-1 overflow-auto p-3 bg-slate-950 text-slate-100 font-mono text-xs scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset"
      >
        {activeTab === 'connections' ? (
          <PreviewConnectionsTab
            filePath={file.path}
            fileConnections={fileConnections}
            connectionsLoading={connectionsLoading}
            onOpenCitation={onOpenCitation}
          />
        ) : (
          <>
            {loading && (
              <div className="flex items-center justify-center h-full" role="status" aria-live="polite">
                <Spinner size="md" />
              </div>
            )}

            {!loading && error && (
              <div role="alert" className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200">
                {error}
              </div>
            )}

            {!loading && !error && lineRange && (
              <div className="space-y-0.5" data-testid="preview-line-range">
                {lineRange.lines.length === 0 ? (
                  <div className="text-slate-300 italic p-2">(File is empty)</div>
                ) : (
                  lineRange.lines.map((entry) => {
                    const isHighlighted =
                      highlightRange !== null &&
                      entry.lineNumber >= highlightRange.startLine &&
                      entry.lineNumber <= (focusEndLine ?? highlightRange.startLine);

                    return (
                      <div
                        key={entry.lineNumber}
                        data-highlighted={isHighlighted ? 'true' : 'false'}
                        className={`flex px-1.5 py-0.5 rounded ${
                          isHighlighted
                            ? 'bg-indigo-900/60 border-l-2 border-indigo-400 text-white'
                            : 'hover:bg-slate-900'
                        }`}
                      >
                        <span className="w-10 text-right pr-3 text-slate-400 select-none flex-shrink-0 tabular-nums">
                          {entry.lineNumber}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{entry.text}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {!loading && !error && !lineRange && assetUrl && !assetError && (
              <div className="h-full flex flex-col items-center justify-center p-2" data-testid="preview-asset-viewer">
                {assetKind === 'image' && (
                  <img
                    src={assetUrl}
                    alt={file.name}
                    data-testid="preview-asset-image"
                    onError={() => setAssetError('Failed to stream image via vault-asset://')}
                    className="max-w-full max-h-[520px] rounded-lg border border-slate-800 object-contain bg-slate-900"
                  />
                )}
                {assetKind === 'pdf' && (
                  <iframe
                    src={assetUrl}
                    title={file.name}
                    data-testid="preview-asset-pdf"
                    className="w-full h-full min-h-[480px] rounded-lg border border-slate-700 bg-white"
                  />
                )}
                {assetKind === 'video' && (
                  <video
                    src={assetUrl}
                    controls
                    data-testid="preview-asset-video"
                    onError={() => setAssetError('Failed to stream video via vault-asset://')}
                    className="w-full max-h-[420px] rounded-lg bg-black"
                  />
                )}
                {assetKind === 'audio' && (
                  <div className="w-full p-4 rounded-xl bg-slate-900 border border-slate-700 space-y-3">
                    <p className="text-sm font-sans text-slate-200 truncate">{file.name}</p>
                    <audio
                      src={assetUrl}
                      controls
                      data-testid="preview-asset-audio"
                      onError={() => setAssetError('Failed to stream audio via vault-asset://')}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            )}

            {!loading && !error && !lineRange && assetError && (
              <div role="alert" className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200">
                {assetError}
              </div>
            )}

            {!loading && !error && !lineRange && !assetUrl && preview?.binary && (
              <div
                className="p-4 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 space-y-2"
                data-testid="preview-binary-notice"
              >
                <div className="flex items-center gap-2 text-amber-300 font-semibold">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  <span>Binary File Detected</span>
                </div>
                <p className="text-slate-300 font-sans text-xs">
                  Binary content is not rendered in the bounded text drawer. Open this file in your OS default application instead.
                </p>
              </div>
            )}

            {!loading && !error && !lineRange && !assetUrl && preview && !preview.binary && (
              <div className="space-y-0.5" data-testid="preview-lines">
                {preview.lines.length === 0 ? (
                  <div className="text-slate-300 italic p-2">(File is empty)</div>
                ) : (
                  preview.lines.map((line, index) => (
                    <div key={index} className="flex hover:bg-slate-900 px-1 rounded">
                      <span className="w-10 text-right pr-3 text-slate-400 select-none flex-shrink-0 tabular-nums">
                        {index + 1}
                      </span>
                      <span className="whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {(preview || lineRange || assetUrl) && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
          <span>
            {lineRange
              ? `Lines ${lineRange.startLine}-${lineRange.endLine} of ${lineRange.totalLines}`
              : assetUrl
                ? 'Streaming via vault-asset://'
                : `${preview?.totalLinesBuffered ?? 0} lines buffered (RingBuffer max 100)`}
          </span>
          <span className="truncate max-w-[180px]" title={file.path}>
            {file.path}
          </span>
        </div>
      )}
    </aside>
  );
};
