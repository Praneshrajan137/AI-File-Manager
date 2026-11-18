/**
 * fileSystemHandlers.ts - IPC handlers for file system operations
 *
 * Enforces declarative contracts (FS:READ_DIR, FS:READ_FILE, FS:PREVIEW_FILE,
 * FS:WRITE_FILE, FS:DELETE, FS:MOVE, FS:CREATE_FILE, FS:CREATE_DIR,
 * FS:GET_STATS, FS:GET_SYSTEM_PATHS, FS:RENAME) via securityMiddleware.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  withContract,
  getPathValidator,
  resolveAllowedRoots,
  validateCanonicalPathOrThrow,
} from './securityMiddleware';
import { FileSystemService } from '../services/FileSystemService';
import {
  getReactiveWorkspaceKernel,
  resetReactiveWorkspaceKernelSync,
} from '../services/ReactiveWorkspaceKernel';
import {
  getFsCommandCoordinator,
  resetFsCommandCoordinator,
} from '@main/kernel/FsCommandCoordinator';
import { getOperationJournal, resetOperationJournal } from '../services/OperationJournal';
import { buildBatchMarkdownLinkRepairSteps } from '../services/MarkdownLinkRepair';
import { checkGraphImpactSqlite } from '@main/platform/storage/LinkSymbolGraphStore';
import {
  BatchTransferResult,
  BatchTransferStep,
  FileDeleteMode,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
  FileStats,
  OperationJournalState,
  SystemPaths,
  TrashVaultEntry,
  UndoRedoResult,
} from '@shared/contracts';
import { FileSystemLogger, IPCLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

/**
 * Get the kernel-owned FileSystemService configured with canonical allowed roots.
 */
export function getFileSystemService(): FileSystemService {
  void resolveAllowedRoots();
  return getReactiveWorkspaceKernel().getFileSystemService();
}

/**
 * Reset shared FileSystemService / kernel state (used after config changes or in tests).
 */
export function resetFileSystemService(): void {
  resetFsCommandCoordinator();
  resetOperationJournal();
  resetReactiveWorkspaceKernelSync();
}

function resolveKnownUserFolder(
  electronKey: 'documents' | 'downloads' | 'pictures',
  fallbackName: string,
  homeDir: string
): string {
  const defaultPath = path.join(homeDir, fallbackName);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronMod = require('electron') as {
      app?: { getPath?: (name: string) => string };
    };
    const resolved = electronMod?.app?.getPath?.(electronKey);
    const tmpDir = os.tmpdir();
    if (
      typeof resolved === 'string' &&
      resolved.trim().length > 0 &&
      path.resolve(resolved) !== path.resolve(tmpDir) &&
      fsSync.existsSync(resolved) &&
      getPathValidator().validate(resolved).valid
    ) {
      return path.resolve(resolved);
    }
  } catch {
    // Fall back safely when running outside full Electron App runtime
  }
  return defaultPath;
}

function getSystemPaths(): SystemPaths {
  const homeDir = os.homedir();
  return {
    home: homeDir,
    documents: resolveKnownUserFolder('documents', 'Documents', homeDir),
    downloads: resolveKnownUserFolder('downloads', 'Downloads', homeDir),
    pictures: resolveKnownUserFolder('pictures', 'Pictures', homeDir),
  };
}

async function handleReadDirectory(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<FileNode[]> {
  FileSystemLogger.info('Reading directory', { path: input.path });

  const kernel = getReactiveWorkspaceKernel();
  const service = kernel.getFileSystemService();
  const files = await service.readDirectory(input.path);

  kernel.warmDirectory(files);
  kernel.scheduleActivateDirectory(input.path);

  FileSystemLogger.info('Directory read successful', {
    path: input.path,
    fileCount: files.length,
  });

  return files;
}

async function handleReadFile(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<{ content: string; encoding: string }> {
  FileSystemLogger.info('Reading file', { path: input.path });

  const service = getFileSystemService();
  const content = await service.readFile(input.path);

  FileSystemLogger.info('File read successful', {
    path: input.path,
    contentLength: content.length,
  });

  return { content, encoding: 'utf-8' };
}

async function handlePreviewFile(
  _event: IpcMainInvokeEvent,
  input: { path: string; maxLines?: number }
): Promise<FilePreviewResult> {
  const service = getFileSystemService();
  return await service.previewFile(input.path, input.maxLines);
}

async function handleReadFileRange(
  _event: IpcMainInvokeEvent,
  input: { path: string; startLine: number; endLine?: number; contextLines?: number }
): Promise<FileLineRangeResult> {
  const service = getFileSystemService();
  return await service.readFileRange(
    input.path,
    input.startLine,
    input.endLine,
    input.contextLines
  );
}

async function handleWriteFile(
  _event: IpcMainInvokeEvent,
  input: { path: string; content: string }
): Promise<{ success: boolean }> {
  FileSystemLogger.info('Writing file', {
    path: input.path,
    contentLength: input.content.length,
  });

  const result = await getFsCommandCoordinator().writeFile(input.path, input.content);

  FileSystemLogger.info('File write successful', { path: input.path });

  return result;
}

async function handleDelete(
  _event: IpcMainInvokeEvent,
  input: { path: string; recursive?: boolean; mode?: FileDeleteMode }
): Promise<{ success: boolean }> {
  const mode: FileDeleteMode = input.mode ?? 'vault';
  FileSystemLogger.info('Deleting file/directory', {
    path: input.path,
    recursive: input.recursive ?? false,
    mode,
  });

  const result = await getFsCommandCoordinator().deletePath(
    input.path,
    input.recursive ?? true,
    mode
  );

  FileSystemLogger.info('Delete successful', { path: input.path, mode });

  return result;
}

async function handleMove(
  _event: IpcMainInvokeEvent,
  input: { source: string; destination: string; repairMarkdownLinks?: boolean }
): Promise<{ success: boolean; newPath: string; repairedLinksCount?: number }> {
  FileSystemLogger.info('Moving file/directory', {
    source: input.source,
    destination: input.destination,
    repairMarkdownLinks: Boolean(input.repairMarkdownLinks),
  });

  const result = await getFsCommandCoordinator().moveOrRename(input.source, input.destination, {
    repairMarkdownLinks: input.repairMarkdownLinks,
    action: 'move',
    buildLinkRepairSteps: async (src, dst) => {
      try {
        const impact = checkGraphImpactSqlite([src]);
        const mdRefs = impact.references.filter((r) => r.isMarkdownLink);
        return buildBatchMarkdownLinkRepairSteps([{ source: src, destination: dst }], mdRefs);
      } catch (repairErr: unknown) {
        FileSystemLogger.warn('Markdown link repair planning skipped; proceeding with standard move', {
          error: repairErr instanceof Error ? repairErr.message : String(repairErr),
        });
        return [];
      }
    },
  });

  FileSystemLogger.info('Move successful', {
    source: input.source,
    destination: result.newPath,
  });

  return result;
}

async function handleCopy(
  _event: IpcMainInvokeEvent,
  input: { source: string; destination: string }
): Promise<{ success: boolean; copiedPath: string }> {
  FileSystemLogger.info('Copying file/directory', {
    source: input.source,
    destination: input.destination,
  });

  const result = await getFsCommandCoordinator().copy(input.source, input.destination);

  FileSystemLogger.info('Copy successful', {
    source: input.source,
    destination: result.copiedPath,
  });

  return result;
}

async function handleCreateFile(
  _event: IpcMainInvokeEvent,
  input: { path: string; name: string; content?: string }
): Promise<{ success: boolean; path: string }> {
  // Entry name already validated by safeEntryNameSchema; re-verify full joined canonical target
  const candidatePath = path.join(input.path, input.name);
  const fullPath = await validateCanonicalPathOrThrow(candidatePath);
  const initialContent = input.content ?? '';

  FileSystemLogger.info('Creating file', {
    directory: input.path,
    name: input.name,
    fullPath,
  });

  const result = await getFsCommandCoordinator().createFile(fullPath, initialContent);

  FileSystemLogger.info('File created successfully', { path: fullPath });

  return result;
}

async function handleCreateDirectory(
  _event: IpcMainInvokeEvent,
  input: { path: string; name: string }
): Promise<{ success: boolean; path: string }> {
  const candidatePath = path.join(input.path, input.name);
  const fullPath = await validateCanonicalPathOrThrow(candidatePath);

  FileSystemLogger.info('Creating directory', {
    parent: input.path,
    name: input.name,
    fullPath,
  });

  const result = await getFsCommandCoordinator().createDirectory(fullPath);

  FileSystemLogger.info('Directory created successfully', { path: fullPath });

  return result;
}

async function handleGetStats(
  _event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<FileStats> {
  FileSystemLogger.debug('Getting file stats', { path: input.path });

  const service = getFileSystemService();
  const stats = await service.getStats(input.path);

  return stats;
}

async function handleRename(
  _event: IpcMainInvokeEvent,
  input: { oldPath: string; newName: string }
): Promise<{ success: boolean; newPath: string }> {
  const directory = path.dirname(input.oldPath);
  const candidateNewPath = path.join(directory, input.newName);
  const canonicalNewPath = await validateCanonicalPathOrThrow(candidateNewPath);

  FileSystemLogger.info('Renaming file', {
    oldPath: input.oldPath,
    newPath: canonicalNewPath,
    newName: input.newName,
  });

  const result = await getFsCommandCoordinator().moveOrRename(input.oldPath, canonicalNewPath, {
    action: 'rename',
  });

  FileSystemLogger.info('File renamed successfully', {
    oldPath: input.oldPath,
    newPath: result.newPath,
  });

  return { success: result.success, newPath: result.newPath };
}

async function handleUndo(_event: IpcMainInvokeEvent): Promise<UndoRedoResult> {
  return getFsCommandCoordinator().undo();
}

async function handleRedo(_event: IpcMainInvokeEvent): Promise<UndoRedoResult> {
  return getFsCommandCoordinator().redo();
}

async function handleGetJournalState(_event: IpcMainInvokeEvent): Promise<OperationJournalState> {
  return getOperationJournal().getState();
}

async function handleListTrashVault(_event: IpcMainInvokeEvent): Promise<TrashVaultEntry[]> {
  return getOperationJournal().listVaultItems();
}

async function handleRestoreTrashItem(
  _event: IpcMainInvokeEvent,
  input: { id: string }
): Promise<UndoRedoResult> {
  return getFsCommandCoordinator().restoreTrashItem(input.id);
}

async function handlePurgeTrashItem(
  _event: IpcMainInvokeEvent,
  input: { id: string }
): Promise<OperationJournalState> {
  return getFsCommandCoordinator().purgeTrashItem(input.id);
}

async function handleEmptyTrashVault(_event: IpcMainInvokeEvent): Promise<OperationJournalState> {
  return getFsCommandCoordinator().emptyTrashVault();
}

async function handleWatchSplitDir(
  _event: IpcMainInvokeEvent,
  input: { path: string | null }
): Promise<{ watching: boolean; path: string | null }> {
  const kernel = getReactiveWorkspaceKernel();
  if (!input.path) {
    await kernel.activateSecondaryDirectory(null);
    return { watching: false, path: null };
  }
  const canonicalPath = await validateCanonicalPathOrThrow(input.path);
  await kernel.activateSecondaryDirectory(canonicalPath);
  return { watching: true, path: canonicalPath };
}

async function handleBatchTransfer(
  _event: IpcMainInvokeEvent,
  input: { description?: string; steps: BatchTransferStep[] }
): Promise<BatchTransferResult> {
  return getFsCommandCoordinator().batchTransfer(input.steps, input.description);
}

const FILE_SYSTEM_CHANNELS: IPCChannel[] = [
  'FS:READ_DIR',
  'FS:READ_FILE',
  'FS:PREVIEW_FILE',
  'FS:READ_FILE_RANGE',
  'FS:WRITE_FILE',
  'FS:DELETE',
  'FS:MOVE',
  'FS:COPY',
  'FS:CREATE_FILE',
  'FS:CREATE_DIR',
  'FS:GET_STATS',
  'FS:GET_SYSTEM_PATHS',
  'FS:RENAME',
  'FS:UNDO',
  'FS:REDO',
  'FS:GET_JOURNAL_STATE',
  'FS:LIST_TRASH_VAULT',
  'FS:RESTORE_TRASH_ITEM',
  'FS:PURGE_TRASH_ITEM',
  'FS:EMPTY_TRASH_VAULT',
  'FS:WATCH_SPLIT_DIR',
  'FS:BATCH_TRANSFER',
];

/**
 * Register all file system IPC handlers through the declarative contract wrapper.
 */
export function registerFileSystemHandlers(): IPCChannel[] {
  IPCLogger.info('Registering file system IPC handlers');

  ipcMain.handle('FS:READ_DIR', withContract('FS:READ_DIR', handleReadDirectory));
  ipcMain.handle('FS:READ_FILE', withContract('FS:READ_FILE', handleReadFile));
  ipcMain.handle('FS:PREVIEW_FILE', withContract('FS:PREVIEW_FILE', handlePreviewFile));
  ipcMain.handle('FS:READ_FILE_RANGE', withContract('FS:READ_FILE_RANGE', handleReadFileRange));
  ipcMain.handle('FS:WRITE_FILE', withContract('FS:WRITE_FILE', handleWriteFile));
  ipcMain.handle('FS:DELETE', withContract('FS:DELETE', handleDelete));
  ipcMain.handle('FS:MOVE', withContract('FS:MOVE', handleMove));
  ipcMain.handle('FS:COPY', withContract('FS:COPY', handleCopy));
  ipcMain.handle('FS:CREATE_FILE', withContract('FS:CREATE_FILE', handleCreateFile));
  ipcMain.handle('FS:CREATE_DIR', withContract('FS:CREATE_DIR', handleCreateDirectory));
  ipcMain.handle('FS:GET_STATS', withContract('FS:GET_STATS', handleGetStats));
  ipcMain.handle(
    'FS:GET_SYSTEM_PATHS',
    withContract('FS:GET_SYSTEM_PATHS', async () => {
      FileSystemLogger.debug('Getting system paths');
      return getSystemPaths();
    })
  );
  ipcMain.handle('FS:RENAME', withContract('FS:RENAME', handleRename));
  ipcMain.handle('FS:UNDO', withContract('FS:UNDO', handleUndo));
  ipcMain.handle('FS:REDO', withContract('FS:REDO', handleRedo));
  ipcMain.handle('FS:GET_JOURNAL_STATE', withContract('FS:GET_JOURNAL_STATE', handleGetJournalState));
  ipcMain.handle('FS:LIST_TRASH_VAULT', withContract('FS:LIST_TRASH_VAULT', handleListTrashVault));
  ipcMain.handle('FS:RESTORE_TRASH_ITEM', withContract('FS:RESTORE_TRASH_ITEM', handleRestoreTrashItem));
  ipcMain.handle('FS:PURGE_TRASH_ITEM', withContract('FS:PURGE_TRASH_ITEM', handlePurgeTrashItem));
  ipcMain.handle('FS:EMPTY_TRASH_VAULT', withContract('FS:EMPTY_TRASH_VAULT', handleEmptyTrashVault));
  ipcMain.handle('FS:WATCH_SPLIT_DIR', withContract('FS:WATCH_SPLIT_DIR', handleWatchSplitDir));
  ipcMain.handle('FS:BATCH_TRANSFER', withContract('FS:BATCH_TRANSFER', handleBatchTransfer));

  IPCLogger.info('File system IPC handlers registered successfully');
  return [...FILE_SYSTEM_CHANNELS];
}
