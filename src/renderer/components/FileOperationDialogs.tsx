import React from 'react';
import { RenameDialog } from './common/RenameDialog';
import { CreateEntryDialog } from './common/CreateEntryDialog';
import { DeleteConfirmDialog } from './common/DeleteConfirmDialog';
import { getErrorMessage } from '@renderer/utils/formatters';
import type { FileDeleteMode, FileNode } from '@shared/contracts';
import type { ToastMessage } from '@renderer/hooks/useToast';

interface FileOperationDialogsProps {
  currentPath: string;
  defaultDeleteMode: FileDeleteMode;
  renameFile: FileNode | null;
  onCloseRename: () => void;
  createEntryMode: 'file' | 'directory' | null;
  onCloseCreateEntry: () => void;
  pendingDeletePaths: string[] | null;
  onClosePendingDelete: () => void;
  onExecuteDelete: (paths: string[], mode: FileDeleteMode) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

/** Rename, New File/Folder, and Delete Confirmation modal group. */
export const FileOperationDialogs: React.FC<FileOperationDialogsProps> = ({
  currentPath,
  defaultDeleteMode,
  renameFile,
  onCloseRename,
  createEntryMode,
  onCloseCreateEntry,
  pendingDeletePaths,
  onClosePendingDelete,
  onExecuteDelete,
  onRefreshAll,
  showToast,
}) => (
  <>
    <RenameDialog
      isOpen={renameFile !== null}
      currentName={renameFile?.name || ''}
      onConfirm={async (newName): Promise<void> => {
        if (!renameFile) return;
        try {
          const res = await window.electronAPI.fs.rename(renameFile.path, newName);
          if (res.success) {
            showToast({ type: 'success', message: `Renamed to ${newName}` });
            await onRefreshAll();
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
          await onRefreshAll();
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
      defaultMode={defaultDeleteMode === 'trash' ? 'trash' : 'vault'}
      onConfirm={(mode): void => {
        const targets = pendingDeletePaths ?? [];
        onClosePendingDelete();
        void onExecuteDelete(targets, mode);
      }}
      onCancel={onClosePendingDelete}
    />
  </>
);
