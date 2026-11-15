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
import { extractBasename } from '@renderer/utils/pathHelpers';
import { Spinner } from '@renderer/components/common/Spinner';

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

  const assetKind = getVaultAssetKind(file.extension || file.name);
  const assetUrl = assetKind !== 'unsupported' ? buildVaultAssetUrl(file.path) : null;
  const focusEndLine = highlightRange
    ? highlightRange.endLine ?? highlightRange.startLine
    : undefined;

  return (
    <aside
      className="w-[440px] bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shadow-xl flex flex-col h-full"
      data-testid="file-preview-drawer"
      aria-label={`Quick Preview: ${file.name}`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between bg-gray-50 dark:bg-slate-950/60">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2">
            {assetKind === 'image' ? (
              <ImageIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
            ) : lineRange ? (
              <FileCode2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            ) : (
              <FileText className="w-4 h-4 text-primary-600 dark:text-slate-300 flex-shrink-0" />
            )}
            <h3
              className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate"
              title={file.name}
            >
              {file.name}
            </h3>
          </div>
          <div className="flex items-center flex-wrap gap-2 mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            <span>{formatFileSize(preview?.size ?? file.size)}</span>
            {lineRange && highlightRange && (
              <span
                data-testid="preview-citation-badge"
                className="px-1.5 py-0.5 rounded font-mono bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
              >
                Citation L{highlightRange.startLine}
                {focusEndLine && focusEndLine > highlightRange.startLine
                  ? `-L${focusEndLine}`
                  : ''}
              </span>
            )}
            {!lineRange && assetUrl && (
              <span
                data-testid="preview-asset-badge"
                className="px-1.5 py-0.5 rounded font-mono bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
              >
                vault-asset://{assetKind}
              </span>
            )}
            {!lineRange && !assetUrl && preview && (
              <span
                data-testid="preview-cache-badge"
                className={`px-1.5 py-0.5 rounded font-mono ${
                  preview.fromCache
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                }`}
              >
                {preview.fromCache ? 'LRUCache HIT' : 'RingBuffer(100)'}
              </span>
            )}
            {preview?.truncated && !lineRange && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">
                Capped
              </span>
            )}
            {lineRange && onClearRangeFocus && (
              <button
                type="button"
                onClick={onClearRangeFocus}
                className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium"
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
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
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
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onOpenExternal}
            title="Open with OS default app"
            aria-label="Open externally"
            data-testid="preview-open-external"
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close preview"
            aria-label="Close preview"
            data-testid="preview-close"
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-tabs: Content / Connections */}
      <div className="px-4 py-1.5 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 text-xs">
        <button
          type="button"
          data-testid="preview-tab-content"
          onClick={(): void => setActiveTab('content')}
          className={`px-2.5 py-1 rounded font-medium transition-colors ${
            activeTab === 'content'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          Content
        </button>
        <button
          type="button"
          data-testid="preview-tab-connections"
          onClick={(): void => setActiveTab('connections')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors ${
            activeTab === 'connections'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          <span>Connections</span>
          {fileConnections && (
            <span className="text-[10px] opacity-85 tabular-nums">
              ({fileConnections.symbols.length + fileConnections.outgoingLinks.length + fileConnections.backlinks.length})
            </span>
          )}
        </button>
      </div>

      {/* Content / Connections Panel */}
      <div className="flex-1 overflow-auto p-3 bg-slate-950 text-slate-100 font-mono text-xs scrollbar-thin">
        {activeTab === 'connections' ? (
          <div className="space-y-4 font-sans text-xs text-slate-200" data-testid="preview-connections-panel">
            {connectionsLoading ? (
              <div className="py-8 text-center text-slate-400">Loading graph connections...</div>
            ) : !fileConnections ? (
              <div className="py-8 text-center text-slate-400">
                Index this workspace to inspect symbols, outgoing references, backlinks, and 2-hop associative neighbors.
              </div>
            ) : (
              <>
                <section className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Symbols ({fileConnections.symbols.length})
                  </h4>
                  {fileConnections.symbols.length === 0 ? (
                    <p className="text-slate-500 text-[11px]">No symbols extracted.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {fileConnections.symbols.map((sym, idx) => (
                        <button
                          key={`${sym.name}-${sym.lineNumber}-${idx}`}
                          type="button"
                          onClick={(): void => onOpenCitation?.(file.path, sym.lineNumber, sym.lineNumber)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-900 border border-slate-700 text-indigo-300 font-mono text-[11px]"
                        >
                          {sym.name} :L{sym.lineNumber}
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Inbound Backlinks ({fileConnections.backlinks.length})
                  </h4>
                  {fileConnections.backlinks.length === 0 ? (
                    <p className="text-slate-500 text-[11px]">No incoming references detected.</p>
                  ) : (
                    <div className="space-y-1">
                      {fileConnections.backlinks.map((bl, idx) => (
                        <button
                          key={`${bl.sourcePath}-${bl.lineNumber}-${idx}`}
                          type="button"
                          onClick={(): void => onOpenCitation?.(bl.sourcePath, bl.lineNumber, bl.lineNumber)}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between gap-2"
                        >
                          <span className="truncate font-medium text-emerald-300">
                            {extractBasename(bl.sourcePath)}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                            L{bl.lineNumber} ({bl.kind})
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Outgoing Links ({fileConnections.outgoingLinks.length})
                  </h4>
                  {fileConnections.outgoingLinks.length === 0 ? (
                    <p className="text-slate-500 text-[11px]">No outgoing references detected.</p>
                  ) : (
                    <div className="space-y-1">
                      {fileConnections.outgoingLinks.map((out, idx) => (
                        <button
                          key={`${out.targetRef}-${out.lineNumber}-${idx}`}
                          type="button"
                          disabled={!out.targetPath}
                          onClick={(): void => {
                            if (out.targetPath) onOpenCitation?.(out.targetPath, 1, 20);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between gap-2 disabled:opacity-60"
                        >
                          <span className="truncate font-mono text-sky-300">{out.targetRef}</span>
                          <span className="text-[10px] font-mono text-slate-400">
                            L{out.lineNumber}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {fileConnections.associativeNeighbors.length > 0 && (
                  <section className="space-y-1.5">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      2-Hop Associative Neighbors
                    </h4>
                    <div className="space-y-1">
                      {fileConnections.associativeNeighbors.map((nb) => (
                        <button
                          key={nb.filePath}
                          type="button"
                          onClick={(): void => onOpenCitation?.(nb.filePath, 1, 20)}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between gap-2"
                        >
                          <span className="truncate text-indigo-300">{extractBasename(nb.filePath)}</span>
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                            {nb.hopDistance}h · {nb.score.toFixed(2)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        ) : (
          <>
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

        {/* Line-Range Citation Inspector View (#Lx-Ly) */}
        {!loading && !error && lineRange && (
          <div className="space-y-0.5" data-testid="preview-line-range">
            {lineRange.lines.length === 0 ? (
              <div className="text-slate-400 italic p-2">(File is empty)</div>
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
                        ? 'bg-indigo-900/50 border-l-2 border-indigo-400 text-white'
                        : 'hover:bg-slate-900'
                    }`}
                  >
                    <span className="w-10 text-right pr-3 text-slate-500 select-none flex-shrink-0 tabular-nums">
                      {entry.lineNumber}
                    </span>
                    <span className="whitespace-pre-wrap break-all">{entry.text}</span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Rich Media Streaming via vault-asset:// (CSP-preserved, sandboxed SVG) */}
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
          <div className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200">
            {assetError}
          </div>
        )}

        {!loading && !error && !lineRange && !assetUrl && preview?.binary && (
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

        {!loading && !error && !lineRange && !assetUrl && preview && !preview.binary && (
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
          </>
        )}
      </div>

      {/* Footer */}
      {(preview || lineRange || assetUrl) && (
        <div className="px-4 py-2 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950/60 text-[11px] text-gray-500 dark:text-slate-400 flex items-center justify-between">
          <span>
            {lineRange
              ? `Lines ${lineRange.startLine}-${lineRange.endLine} of ${lineRange.totalLines}`
              : assetUrl
                ? `Streaming via vault-asset://`
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
