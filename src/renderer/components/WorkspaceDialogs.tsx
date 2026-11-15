import React, { Suspense } from 'react';
import { FileContextMenu } from './ContextMenu/FileContextMenu';
import { RenameDialog } from './common/RenameDialog';
import { CreateEntryDialog } from './common/CreateEntryDialog';
import { DeleteConfirmDialog } from './common/DeleteConfirmDialog';
import { Toast } from './common/Toast';
import type { ToastMessage } from '@renderer/hooks/useToast';
import type { UseExplorerActionsReturn } from '@renderer/hooks/useExplorerActions';
import type { UseWorkspaceVaultReturn } from '@renderer/hooks/useWorkspaceVault';
import { extractBasename } from '@renderer/utils/pathHelpers';
import { getErrorMessage } from '@renderer/utils/formatters';
import type {
  FileNode,
  OrganizeApplyResult,
  OrganizePlanResult,
  OrganizeStrategy,
} from '@shared/contracts';

const LazyDiagnosticsModal = React.lazy(() =>
  import('./Diagnostics/DiagnosticsModal').then((m) => ({ default: m.DiagnosticsModal }))
);
const LazyCommandOmnibar = React.lazy(() =>
  import('./SearchBar/CommandOmnibar').then((m) => ({ default: m.CommandOmnibar }))
);
const LazyDryRunPlanModal = React.lazy(() =>
  import('./Organizer/DryRunPlanModal').then((m) => ({ default: m.DryRunPlanModal }))
);

export interface ContextMenuState {
  file: FileNode;
  position: { x: number; y: number };
  fromSecondary?: boolean;
}

interface WorkspaceDialogsProps {
  currentPath: string;
  vault: UseWorkspaceVaultReturn;
  explorer: UseExplorerActionsReturn;
  favoritesSet: Set<string>;
  normalizePathKey: (p: string) => string;
  contextMenu: ContextMenuState | null;
  onCloseContextMenu: () => void;
  renameFile: FileNode | null;
  onCloseRename: () => void;
  createEntryMode: 'file' | 'directory' | null;
  onCloseCreateEntry: () => void;
  pendingDeletePaths: string[] | null;
  onClosePendingDelete: () => void;
  diagnosticsOpen: boolean;
  onCloseDiagnostics: () => void;
  omnibarOpen: boolean;
  onCloseOmnibar: () => void;
  organizeTargetDir: string | null;
  organizeInitialStrategy: OrganizeStrategy;
  organizeInitialPlan: OrganizePlanResult | null;
  onCloseOrganize: () => void;
  toasts: ToastMessage[];
  onRemoveToast: (id: number) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  onFileDoubleClick: (file: FileNode) => Promise<void>;
  onPreviewFile: (file: FileNode) => Promise<void>;
  onOpenRename: (file: FileNode) => void;
  onRequestDelete: (paths: string[]) => void;
  onSearchSelect: (targetPath: string) => Promise<void>;
  onOpenCitation: (filePath: string, startLine?: number, endLine?: number) => Promise<void>;
  onToggleSplitPane: () => void;
  onToggleChat: () => void;
  onStartIndexing: (dirPath: string) => Promise<void>;
  onOpenOrganize: (targetDir: string) => void;
  onRefreshSpatialData: () => Promise<void>;
}

export const WorkspaceDialogs: React.FC<WorkspaceDialogsProps> = ({
  currentPath,
  vault,
  explorer,
  favoritesSet,
  normalizePathKey,
  contextMenu,
  onCloseContextMenu,
  renameFile,
  onCloseRename,
  createEntryMode,
  onCloseCreateEntry,
  pendingDeletePaths,
  onClosePendingDelete,
  diagnosticsOpen,
  onCloseDiagnostics,
  omnibarOpen,
  onCloseOmnibar,
  organizeTargetDir,
  organizeInitialStrategy,
  organizeInitialPlan,
  onCloseOrganize,
  toasts,
  onRemoveToast,
  showToast,
  onFileDoubleClick,
  onPreviewFile,
  onOpenRename,
  onRequestDelete,
  onSearchSelect,
  onOpenCitation,
  onToggleSplitPane,
  onToggleChat,
  onStartIndexing,
  onOpenOrganize,
  onRefreshSpatialData,
}) => {
  const handleRefreshAll = async (): Promise<void> => {
    await explorer.refreshActiveDirectories();
    await vault.refreshWorkspaceMetadata();
    await onRefreshSpatialData();
  };

  return (
    <>
      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          position={contextMenu.position}
          onClose={onCloseContextMenu}
          onOpen={(): void => {
            if (contextMenu.fromSecondary && contextMenu.file.isDirectory) {
              void explorer.loadSecondaryDirectory(contextMenu.file.path);
            } else {
              void onFileDoubleClick(contextMenu.file);
            }
          }}
          onPreview={
            !contextMenu.file.isDirectory
              ? (): void => {
                  void onPreviewFile(contextMenu.file);
                }
              : undefined
          }
          onRename={(): void => onOpenRename(contextMenu.file)}
          onDuplicate={
            !contextMenu.file.isDirectory
              ? (): void => {
                  void explorer.handleDuplicateFile(contextMenu.file);
                }
              : undefined
          }
          onCopyToOtherPane={
            vault.splitPaneOpen && explorer.secondaryPath && !contextMenu.fromSecondary
              ? (): void => {
                  void explorer.handleCopyPathsToDirectory(
                    [contextMenu.file.path],
                    explorer.secondaryPath
                  );
                }
              : undefined
          }
          onToggleFavorite={(): void => {
            void vault.handleToggleFavorite(contextMenu.file.path);
          }}
          isFavorite={favoritesSet.has(normalizePathKey(contextMenu.file.path))}
          onDelete={(): void => onRequestDelete([contextMenu.file.path])}
          onCopyPath={(): void => {
            void window.electronAPI.clipboard.writeText(contextMenu.file.path);
            showToast({ type: 'success', message: 'Path copied to clipboard' });
          }}
        />
      )}

      <RenameDialog
        isOpen={renameFile !== null}
        currentName={renameFile?.name || ''}
        onConfirm={async (newName): Promise<void> => {
          if (!renameFile) return;
          try {
            const res = await window.electronAPI.fs.rename(renameFile.path, newName);
            if (res.success) {
              showToast({ type: 'success', message: `Renamed to ${newName}` });
              await handleRefreshAll();
            } else {
              showToast({ type: 'error', message: 'Failed to rename file' });
            }
          } catch (err: unknown) {
            showToast({ type: 'error', message: getErrorMessage(err, 'Failed to rename file') });
          }
          onCloseRename();
        }}
        onCancel={onCloseRename}
      />

      <CreateEntryDialog
        isOpen={createEntryMode !== null}
        mode={createEntryMode ?? 'file'}
        onConfirm={async (name): Promise<void> => {
          if (!createEntryMode || !currentPath) return;
          try {
            if (createEntryMode === 'file') {
              await window.electronAPI.fs.createFile(currentPath, name, '');
            } else {
              await window.electronAPI.fs.createDirectory(currentPath, name);
            }
            showToast({
              type: 'success',
              message: `Created ${createEntryMode === 'directory' ? 'folder' : 'file'} ${name}`,
            });
            await handleRefreshAll();
          } catch (err: unknown) {
            showToast({
              type: 'error',
              message: getErrorMessage(err, `Failed to create ${createEntryMode}`),
            });
          }
          onCloseCreateEntry();
        }}
        onCancel={onCloseCreateEntry}
      />

      <DeleteConfirmDialog
        isOpen={pendingDeletePaths !== null}
        targetPaths={pendingDeletePaths ?? []}
        defaultMode={vault.vaultConfig?.defaultDeleteMode ?? 'vault'}
        onConfirm={(mode): void => {
          const targets = pendingDeletePaths ?? [];
          onClosePendingDelete();
          void explorer.executeDeletePaths(targets, mode);
        }}
        onCancel={onClosePendingDelete}
      />

      {diagnosticsOpen && (
        <Suspense fallback={null}>
          <LazyDiagnosticsModal isOpen={diagnosticsOpen} onClose={onCloseDiagnostics} />
        </Suspense>
      )}

      {omnibarOpen && (
        <Suspense fallback={null}>
          <LazyCommandOmnibar
            isOpen={omnibarOpen}
            onClose={onCloseOmnibar}
            currentPath={currentPath}
            onNavigateFile={onSearchSelect}
            onOpenCitation={onOpenCitation}
            isDarkMode={vault.isDarkMode}
            onToggleTheme={vault.toggleDarkMode}
            splitPaneOpen={vault.splitPaneOpen}
            onToggleSplitPane={onToggleSplitPane}
            onToggleChat={onToggleChat}
            onIndexCurrentDir={async (): Promise<void> => {
              if (currentPath) {
                await onStartIndexing(currentPath);
                showToast({
                  type: 'info',
                  message: `Indexing started for ${extractBasename(currentPath)}`,
                });
              }
            }}
            onOrganizeCurrentDir={(): void => {
              if (currentPath) onOpenOrganize(currentPath);
            }}
          />
        </Suspense>
      )}

      {organizeTargetDir !== null && (
        <Suspense fallback={null}>
          <LazyDryRunPlanModal
            isOpen={true}
            targetDir={organizeTargetDir}
            initialStrategy={organizeInitialStrategy}
            initialPlan={organizeInitialPlan}
            onClose={onCloseOrganize}
            onApplied={async (result: OrganizeApplyResult): Promise<void> => {
              onCloseOrganize();
              await handleRefreshAll();
              showToast({
                type: 'success',
                message: `Organized ${result.appliedCount} file(s)${
                  result.repairedLinksCount ? ` & repaired ${result.repairedLinksCount} link(s)` : ''
                }`,
                actionLabel: 'Undo',
                onAction: (): void => {
                  void explorer.handleUndo();
                },
              });
            }}
          />
        </Suspense>
      )}

      <div
        className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        <div className="pointer-events-auto space-y-2">
          {toasts.map((toast) => (
            <Toast key={toast.id} {...toast} onClose={(): void => onRemoveToast(toast.id)} />
          ))}
        </div>
      </div>
    </>
  );
};
