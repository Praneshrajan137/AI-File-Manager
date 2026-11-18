import React, { Suspense } from 'react';
import { ErrorBoundary } from './common/ErrorBoundary';
import type { FileNode } from '@shared/contracts';
import type { UsePreviewDrawerReturn } from '@renderer/hooks/usePreviewDrawer';
import type { ToastMessage } from '@renderer/hooks/useToast';
import { normalizeComparablePath } from '@renderer/utils/pathHelpers';

const LazyFilePreviewDrawer = React.lazy(() =>
  import('./Preview/FilePreviewDrawer').then((m) => ({ default: m.FilePreviewDrawer }))
);

interface PreviewDrawerSlotProps {
  preview: UsePreviewDrawerReturn;
  orderedFiles: FileNode[];
  developerBadges?: boolean;
  setSelectedFiles: (paths: string[]) => void;
  onOpenExternal: (file: FileNode) => Promise<void>;
  onOpenCitation: (filePath: string, startLine?: number, endLine?: number) => Promise<void>;
  onFileSaved?: () => Promise<void> | void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

/** Lazy-loaded preview drawer slot with sibling Prev/Next file cycling, quick edit, and toast feedback. */
export const PreviewDrawerSlot: React.FC<PreviewDrawerSlotProps> = ({
  preview,
  orderedFiles,
  developerBadges = false,
  setSelectedFiles,
  onOpenExternal,
  onOpenCitation,
  onFileSaved,
  showToast,
}) => {
  if (!preview.previewFileNode) return null;

  const siblings = orderedFiles.filter((f) => !f.isDirectory);
  const currentIdx = siblings.findIndex(
    (f) => normalizeComparablePath(f.path) === normalizeComparablePath(preview.previewFileNode!.path)
  );
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < siblings.length - 1;

  return (
    <ErrorBoundary title="File Preview">
      <Suspense fallback={null}>
        <LazyFilePreviewDrawer
          isOpen={true}
          file={preview.previewFileNode}
          preview={preview.previewResult}
          lineRange={preview.previewLineRange}
          highlightRange={preview.previewHighlightRange}
          fileConnections={preview.fileConnections}
          connectionsLoading={preview.connectionsLoading}
          loading={preview.previewLoading}
          error={preview.previewError}
          developerBadges={developerBadges}
          isEditing={preview.isEditing}
          editContent={preview.editContent}
          editDirty={preview.editDirty}
          editSaving={preview.editSaving}
          editError={preview.editError}
          onStartEdit={(): void => {
            void preview.startEditing();
          }}
          onCancelEdit={preview.cancelEditing}
          onChangeEditContent={preview.updateEditContent}
          onSaveEdit={(): void => {
            void (async (): Promise<void> => {
              const saved = await preview.saveEdit();
              if (saved && preview.previewFileNode) {
                showToast({ type: 'success', message: `Saved ${preview.previewFileNode.name}` });
                await onFileSaved?.();
              }
            })();
          }}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrevFile={(): void => {
            if (!hasPrev) return;
            const prevNode = siblings[currentIdx - 1];
            setSelectedFiles([prevNode.path]);
            void preview.loadFilePreview(prevNode);
          }}
          onNextFile={(): void => {
            if (!hasNext) return;
            const nextNode = siblings[currentIdx + 1];
            setSelectedFiles([nextNode.path]);
            void preview.loadFilePreview(nextNode);
          }}
          onCopyContentSuccess={(): void => {
            showToast({ type: 'success', message: 'Preview text copied to clipboard' });
          }}
          onClose={preview.closePreview}
          onRefresh={preview.refreshPreview}
          onOpenExternal={(): void => {
            if (preview.previewFileNode) void onOpenExternal(preview.previewFileNode);
          }}
          onCopyPath={(): void => {
            if (preview.previewFileNode) {
              void window.electronAPI.clipboard.writeText(preview.previewFileNode.path);
              showToast({ type: 'success', message: 'Path copied to clipboard' });
            }
          }}
          onClearRangeFocus={preview.clearRangeFocus}
          onOpenCitation={onOpenCitation}
        />
      </Suspense>
    </ErrorBoundary>
  );
};
