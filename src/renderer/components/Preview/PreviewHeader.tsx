import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyCheck,
  ExternalLink,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Network,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  FileConnectionsSummary,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
} from '@shared/contracts';
import type { VaultAssetKind } from '@shared/utils/vaultAssetUrl';
import { formatFileSize } from '@renderer/utils/formatters';

interface PreviewHeaderProps {
  file: FileNode;
  preview: FilePreviewResult | null;
  lineRange: FileLineRangeResult | null;
  highlightRange: { startLine: number; endLine?: number } | null;
  assetKind: VaultAssetKind;
  assetUrl: string | null;
  fileConnections: FileConnectionsSummary | null;
  loading: boolean;
  activeTab: 'content' | 'connections';
  hasPrev?: boolean;
  hasNext?: boolean;
  hasCopyableText: boolean;
  copiedContent: boolean;
  onSelectTab: (tab: 'content' | 'connections') => void;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  onCopyPath: () => void;
  onCopyContent: () => void;
  onRefresh: () => void;
  onOpenExternal: () => void;
  onClose: () => void;
  onClearRangeFocus?: () => void;
}

/** Header bar, sibling navigation, action controls, and Content/Connections tabs for Quick Preview. */
export const PreviewHeader: React.FC<PreviewHeaderProps> = ({
  file,
  preview,
  lineRange,
  highlightRange,
  assetKind,
  assetUrl,
  fileConnections,
  loading,
  activeTab,
  hasPrev = false,
  hasNext = false,
  hasCopyableText,
  copiedContent,
  onSelectTab,
  onPrevFile,
  onNextFile,
  onCopyPath,
  onCopyContent,
  onRefresh,
  onOpenExternal,
  onClose,
  onClearRangeFocus,
}) => {
  const focusEndLine = highlightRange ? highlightRange.endLine ?? highlightRange.startLine : undefined;

  return (
    <>
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
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={file.name}>
              {file.name}
            </h3>
          </div>
          <div className="flex items-center flex-wrap gap-2 mt-1 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="tabular-nums">{formatFileSize(preview?.size ?? file.size)}</span>
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

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {(onPrevFile || onNextFile) && (
            <>
              <button
                type="button"
                onClick={onPrevFile}
                disabled={!hasPrev}
                title="Previous file preview"
                aria-label="Previous file preview"
                data-testid="preview-prev-button"
                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onNextFile}
                disabled={!hasNext}
                title="Next file preview"
                aria-label="Next file preview"
                data-testid="preview-next-button"
                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </>
          )}
          {hasCopyableText && (
            <button
              type="button"
              onClick={onCopyContent}
              title="Copy preview text"
              aria-label={copiedContent ? 'Copied preview text' : 'Copy preview text'}
              data-testid="preview-copy-content"
              className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {copiedContent ? (
                <CopyCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <CopyCheck className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          )}
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
          onClick={(): void => onSelectTab('content')}
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
          onClick={(): void => onSelectTab('connections')}
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
    </>
  );
};
