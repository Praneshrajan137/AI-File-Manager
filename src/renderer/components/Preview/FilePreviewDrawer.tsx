import React, { useEffect, useRef, useState } from 'react';
import type {
  FileConnectionsSummary,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
} from '@shared/contracts';
import { buildVaultAssetUrl, getVaultAssetKind } from '@shared/pure/vaultAssetUrl';
import { useRegisterOverlay } from '@renderer/hooks/useOverlayStack';
import { PreviewHeader } from './PreviewHeader';
import { PreviewBody } from './PreviewBody';

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
  developerBadges?: boolean;
  isEditing?: boolean;
  editContent?: string;
  editDirty?: boolean;
  editSaving?: boolean;
  editError?: string | null;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onChangeEditContent?: (value: string) => void;
  onSaveEdit?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  onCopyContentSuccess?: () => void;
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
  developerBadges = false,
  isEditing = false,
  editContent = '',
  editDirty = false,
  editSaving = false,
  editError = null,
  onStartEdit,
  onCancelEdit,
  onChangeEditContent,
  onSaveEdit,
  hasPrev = false,
  hasNext = false,
  onPrevFile,
  onNextFile,
  onCopyContentSuccess,
  onClose,
  onRefresh,
  onOpenExternal,
  onCopyPath,
  onClearRangeFocus,
  onOpenCitation,
}) => {
  const [assetError, setAssetError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'connections'>('content');
  const [copiedContent, setCopiedContent] = useState<boolean>(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAssetError(null);
    setActiveTab('content');
    setCopiedContent(false);
  }, [file?.path]);

  useEffect(() => {
    if (lineRange) setActiveTab('content');
  }, [lineRange]);

  useEffect(() => {
    return (): void => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useRegisterOverlay('file-preview-drawer', isOpen && Boolean(file), onClose, { blocking: false });

  if (!isOpen || !file) return null;

  const assetKind = getVaultAssetKind(file.extension || file.name);
  const assetUrl = assetKind !== 'unsupported' ? buildVaultAssetUrl(file.path) : null;
  const copyableText = lineRange
    ? lineRange.lines.map((entry) => entry.text).join('\n')
    : preview && !preview.binary
      ? preview.lines.join('\n')
      : '';

  const handleCopyContent = (): void => {
    if (!copyableText) return;
    if (window.electronAPI?.clipboard?.writeText) {
      void window.electronAPI.clipboard.writeText(copyableText);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(copyableText);
    }
    setCopiedContent(true);
    onCopyContentSuccess?.();
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedContent(false), 1800);
  };

  return (
    <aside
      className="max-[899px]:absolute max-[899px]:inset-y-0 max-[899px]:right-0 max-[899px]:z-40 w-80 lg:w-[400px] xl:w-[440px] max-w-[92vw] flex-shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 max-[899px]:shadow-2xl shadow-xl flex flex-col h-full"
      data-testid="file-preview-drawer"
      aria-label={`Quick Preview: ${file.name}`}
    >
      <PreviewHeader
        file={file}
        preview={preview}
        lineRange={lineRange}
        highlightRange={highlightRange}
        assetKind={assetKind}
        assetUrl={assetUrl}
        fileConnections={fileConnections}
        loading={loading}
        activeTab={activeTab}
        developerBadges={developerBadges}
        hasPrev={hasPrev}
        hasNext={hasNext}
        hasCopyableText={copyableText.length > 0}
        copiedContent={copiedContent}
        isEditing={isEditing}
        editDirty={editDirty}
        editSaving={editSaving}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onSelectTab={setActiveTab}
        onPrevFile={onPrevFile}
        onNextFile={onNextFile}
        onCopyPath={onCopyPath}
        onCopyContent={handleCopyContent}
        onRefresh={onRefresh}
        onOpenExternal={onOpenExternal}
        onClose={onClose}
        onClearRangeFocus={onClearRangeFocus}
      />

      <PreviewBody
        file={file}
        activeTab={activeTab}
        preview={preview}
        lineRange={lineRange}
        highlightRange={highlightRange}
        fileConnections={fileConnections}
        connectionsLoading={connectionsLoading}
        loading={loading}
        error={error}
        assetKind={assetKind}
        assetUrl={assetUrl}
        assetError={assetError}
        isEditing={isEditing}
        editContent={editContent}
        editSaving={editSaving}
        editError={editError}
        onChangeEditContent={onChangeEditContent}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onAssetError={setAssetError}
        onOpenCitation={onOpenCitation}
      />

      {(preview || lineRange || assetUrl) && (
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2 tabular-nums">
          <span>
            {lineRange
              ? `Lines ${lineRange.startLine}-${lineRange.endLine} of ${lineRange.totalLines}`
              : assetUrl
                ? 'Streaming via vault-asset://'
                : developerBadges
                  ? `${preview?.totalLinesBuffered ?? 0} lines buffered (RingBuffer max 100)`
                  : `${preview?.totalLinesBuffered ?? 0} lines buffered`}
          </span>
          <span className="truncate max-w-[180px]" title={file.path}>
            {file.path}
          </span>
        </div>
      )}
    </aside>
  );
};
