import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  FileConnectionsSummary,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
} from '@shared/contracts';
import type { VaultAssetKind } from '@shared/utils/vaultAssetUrl';
import { Spinner } from '@renderer/components/common/Spinner';
import { PreviewConnectionsTab } from './PreviewConnectionsTab';

interface PreviewBodyProps {
  file: FileNode;
  activeTab: 'content' | 'connections';
  preview: FilePreviewResult | null;
  lineRange: FileLineRangeResult | null;
  highlightRange: { startLine: number; endLine?: number } | null;
  fileConnections: FileConnectionsSummary | null;
  connectionsLoading: boolean;
  loading: boolean;
  error: string | null;
  assetKind: VaultAssetKind;
  assetUrl: string | null;
  assetError: string | null;
  isEditing?: boolean;
  editContent?: string;
  editSaving?: boolean;
  editError?: string | null;
  onChangeEditContent?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onAssetError: (msg: string) => void;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
}

/** Renders the scrollable text, inline editor, line-range citation, vault-asset media, binary notice, or graph connections body. */
export const PreviewBody: React.FC<PreviewBodyProps> = ({
  file,
  activeTab,
  preview,
  lineRange,
  highlightRange,
  fileConnections,
  connectionsLoading,
  loading,
  error,
  assetKind,
  assetUrl,
  assetError,
  isEditing = false,
  editContent = '',
  editSaving = false,
  editError = null,
  onChangeEditContent,
  onSaveEdit,
  onCancelEdit,
  onAssetError,
  onOpenCitation,
}) => {
  const focusEndLine = highlightRange ? highlightRange.endLine ?? highlightRange.startLine : undefined;

  return (
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

          {!loading && editError && (
            <div
              role="alert"
              data-testid="preview-edit-error"
              className="mb-3 p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200"
            >
              {editError}
            </div>
          )}

          {!loading && !error && isEditing && (
            <div className="h-full flex flex-col">
              <textarea
                value={editContent}
                onChange={(e): void => onChangeEditContent?.(e.target.value)}
                onKeyDown={(e): void => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    onSaveEdit?.();
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    onCancelEdit?.();
                  }
                }}
                disabled={editSaving}
                aria-label={`Edit ${file.name}`}
                data-testid="preview-editor-textarea"
                spellCheck={false}
                className="w-full h-full min-h-[360px] flex-1 p-3 rounded-lg bg-slate-900 text-slate-100 border border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono text-xs leading-5 resize-none"
              />
            </div>
          )}

          {!loading && !error && !isEditing && lineRange && (
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

          {!loading && !error && !isEditing && !lineRange && assetUrl && !assetError && (
            <div className="h-full flex flex-col items-center justify-center p-2" data-testid="preview-asset-viewer">
              {assetKind === 'image' && (
                <img
                  src={assetUrl}
                  alt={file.name}
                  data-testid="preview-asset-image"
                  onError={(): void => onAssetError('Failed to stream image via vault-asset://')}
                  className="max-w-full max-h-[520px] rounded-lg border border-slate-800 object-contain bg-slate-900"
                />
              )}
              {assetKind === 'pdf' && (
                <iframe
                  src={assetUrl}
                  title={file.name}
                  referrerPolicy="no-referrer"
                  data-testid="preview-asset-pdf"
                  className="w-full h-full min-h-[480px] rounded-lg border border-slate-700 bg-white"
                />
              )}
              {assetKind === 'video' && (
                <video
                  src={assetUrl}
                  controls
                  data-testid="preview-asset-video"
                  onError={(): void => onAssetError('Failed to stream video via vault-asset://')}
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
                    onError={(): void => onAssetError('Failed to stream audio via vault-asset://')}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}

          {!loading && !error && !isEditing && !lineRange && assetError && (
            <div role="alert" className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200">
              {assetError}
            </div>
          )}

          {!loading && !error && !isEditing && !lineRange && !assetUrl && preview?.binary && (
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

          {!loading && !error && !isEditing && !lineRange && !assetUrl && preview && !preview.binary && (
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
  );
};
