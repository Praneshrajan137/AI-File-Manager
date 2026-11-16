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
  resolveAllowedRoots,
  validateCanonicalPathOrThrow,
} from './securityMiddleware';
import { FileSystemService } from '../services/FileSystemService';
import {
  getReactiveWorkspaceKernel,
  resetReactiveWorkspaceKernelSync,
} from '../services/ReactiveWorkspaceKernel';
import { getOperationJournal, resetOperationJournal, type BatchOperationStep } from '../services/OperationJournal';
import { buildBatchMarkdownLinkRepairSteps } from '../services/MarkdownLinkRepair';
import { checkWorkspaceGraphImpact } from './llmHandlers';
import {
  BatchTransferResult,
  BatchTransferStep,
  FileDeleteMode,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
  FileStats,
  OperationJournalState,
  OperationRecord,
  SystemPaths,
  UndoRedoResult,
} from '@shared/contracts';
import { FileSystemLogger, IPCLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';
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
  resetOperationJournal();
  resetReactiveWorkspaceKernelSync();
}

function getSystemPaths(): SystemPaths {
  const homeDir = os.homedir();
  return {
    home: homeDir,
    documents: path.join(homeDir, 'Documents'),
    downloads: path.join(homeDir, 'Downloads'),
    pictures: path.join(homeDir, 'Pictures'),
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
  await kernel.activateDirectory(input.path);

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

  const kernel = getReactiveWorkspaceKernel();
  const result = await kernel.getFileSystemService().writeFile(input.path, input.content);
  kernel.notifyMutation('change', input.path);

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

  const kernel = getReactiveWorkspaceKernel();
  const journal = getOperationJournal();
  await journal.delete(input.path, input.recursive ?? true, mode);
  kernel.notifyMutation('unlink', input.path);

  FileSystemLogger.info('Delete successful', { path: input.path, mode });

  return { success: true };
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

  const kernel = getReactiveWorkspaceKernel();
  const journal = getOperationJournal();

  if (input.repairMarkdownLinks) {
    let linkSteps: Awaited<ReturnType<typeof buildBatchMarkdownLinkRepairSteps>> = [];
    try {
      const impact = checkWorkspaceGraphImpact([input.source]);
      const mdRefs = impact.references.filter((r) => r.isMarkdownLink);
      linkSteps = await buildBatchMarkdownLinkRepairSteps(
        [{ source: input.source, destination: input.destination }],
        mdRefs
      );
    } catch (repairErr: unknown) {
      FileSystemLogger.warn('Markdown link repair planning skipped; proceeding with standard move', {
        error: repairErr instanceof Error ? repairErr.message : String(repairErr),
      });
    }

    if (linkSteps.length > 0) {
      const steps: BatchOperationStep[] = [
        { type: 'move', source: input.source, destination: input.destination },
        ...linkSteps,
      ];
      const batchRes = await journal.executeBatch(
        `Move ${path.basename(input.source)} + repair ${linkSteps.length} link(s)`,
        steps
      );
      const canonicalDest = batchRes.operation.children?.[0]?.destinationPath ?? input.destination;
      kernel.notifyMutation('unlink', input.source);
      kernel.notifyMutation('create', canonicalDest);
      for (const edit of linkSteps) {
        kernel.notifyMutation('change', edit.filePath);
      }
      return {
        success: true,
        newPath: canonicalDest,
        repairedLinksCount: linkSteps.length,
      };
    }
  }

  const result = await journal.move(input.source, input.destination, 'move');
  kernel.notifyMutation('unlink', input.source);
  kernel.notifyMutation('create', result.newPath);

  FileSystemLogger.info('Move successful', {
    source: input.source,
    destination: result.newPath,
  });

  return { success: result.success, newPath: result.newPath };
}

async function handleCopy(
  _event: IpcMainInvokeEvent,
  input: { source: string; destination: string }
): Promise<{ success: boolean; copiedPath: string }> {
  FileSystemLogger.info('Copying file/directory', {
    source: input.source,
    destination: input.destination,
  });

  const kernel = getReactiveWorkspaceKernel();
  const journal = getOperationJournal();
  const result = await journal.copy(input.source, input.destination);
  kernel.notifyMutation('create', result.copiedPath);

  FileSystemLogger.info('Copy successful', {
    source: input.source,
    destination: result.copiedPath,
  });

  return { success: result.success, copiedPath: result.copiedPath };
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

  const kernel = getReactiveWorkspaceKernel();
  await kernel.getFileSystemService().writeFile(fullPath, initialContent);
  await getOperationJournal().recordCreation(fullPath, false, Buffer.byteLength(initialContent, 'utf-8'));
  kernel.notifyMutation('create', fullPath);

  FileSystemLogger.info('File created successfully', { path: fullPath });

  return { success: true, path: fullPath };
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

  const kernel = getReactiveWorkspaceKernel();
  await kernel.getFileSystemService().createDirectory(fullPath);
  await getOperationJournal().recordCreation(fullPath, true, 0);
  kernel.notifyMutation('create', fullPath);

  FileSystemLogger.info('Directory created successfully', { path: fullPath });

  return { success: true, path: fullPath };
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

  const kernel = getReactiveWorkspaceKernel();
  const result = await getOperationJournal().move(input.oldPath, canonicalNewPath, 'rename');
  kernel.notifyMutation('unlink', input.oldPath);
  kernel.notifyMutation('create', result.newPath);

  FileSystemLogger.info('File renamed successfully', {
    oldPath: input.oldPath,
    newPath: result.newPath,
  });

  return { success: result.success, newPath: result.newPath };
}

function notifyRecordMutations(
  record: OperationRecord | undefined,
  direction: 'undo' | 'redo'
): void {
  if (!record) return;
  if (record.children && record.children.length > 0) {
    const seq = direction === 'undo' ? [...record.children].reverse() : record.children;
    for (const child of seq) {
      notifyRecordMutations(child, direction);
    }
    return;
  }

  const kernel = getReactiveWorkspaceKernel();
  if (record.type === 'delete') {
    kernel.notifyMutation(direction === 'undo' ? 'create' : 'unlink', record.sourcePath);
  } else if (record.type === 'move' || record.type === 'rename') {
    if (direction === 'undo') {
      if (record.destinationPath) kernel.notifyMutation('unlink', record.destinationPath);
      kernel.notifyMutation('create', record.sourcePath);
    } else {
      kernel.notifyMutation('unlink', record.sourcePath);
      if (record.destinationPath) kernel.notifyMutation('create', record.destinationPath);
    }
  } else if (record.type === 'copy') {
    if (record.destinationPath) {
      kernel.notifyMutation(direction === 'undo' ? 'unlink' : 'create', record.destinationPath);
    }
  } else if (record.type === 'edit_links') {
    kernel.notifyMutation('change', record.sourcePath);
  } else if (record.type === 'create_file' || record.type === 'create_dir') {
    kernel.notifyMutation(direction === 'undo' ? 'unlink' : 'create', record.sourcePath);
  }
}

async function handleUndo(_event: IpcMainInvokeEvent): Promise<UndoRedoResult> {
  const result = await getOperationJournal().undo();
  if (result.success) {
    notifyRecordMutations(result.operation, 'undo');
  }
  return result;
}

async function handleRedo(_event: IpcMainInvokeEvent): Promise<UndoRedoResult> {
  const result = await getOperationJournal().redo();
  if (result.success) {
    notifyRecordMutations(result.operation, 'redo');
  }
  return result;
}

async function handleGetJournalState(_event: IpcMainInvokeEvent): Promise<OperationJournalState> {
  return getOperationJournal().getState();
}

async function handleEmptyTrashVault(_event: IpcMainInvokeEvent): Promise<OperationJournalState> {
  return getOperationJournal().emptyVault();
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
  const journalSteps: BatchOperationStep[] = input.steps.map((step) => {
    if (step.type === 'delete') {
      return {
        type: 'delete',
        path: step.path,
        recursive: step.recursive ?? true,
        mode: step.mode ?? 'vault',
      };
    }
    return {
      type: step.type,
      source: step.source,
      destination: step.destination,
    };
  });

  const description =
    input.description?.trim() || `Batch transfer (${input.steps.length} items)`;
  const result = await getOperationJournal().executeBatch(description, journalSteps);
  const kernel = getReactiveWorkspaceKernel();

  for (const step of input.steps) {
    if (step.type === 'move') {
      kernel.notifyMutation('unlink', step.source);
      kernel.notifyMutation('create', step.destination);
    } else if (step.type === 'copy') {
      kernel.notifyMutation('create', step.destination);
    } else {
      kernel.notifyMutation('unlink', step.path);
    }
  }

  return {
    success: result.success,
    count: input.steps.length,
    operationId: result.operation.id,
    journalState: result.state,
  };
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
  ipcMain.handle('FS:EMPTY_TRASH_VAULT', withContract('FS:EMPTY_TRASH_VAULT', handleEmptyTrashVault));
  ipcMain.handle('FS:WATCH_SPLIT_DIR', withContract('FS:WATCH_SPLIT_DIR', handleWatchSplitDir));
  ipcMain.handle('FS:BATCH_TRANSFER', withContract('FS:BATCH_TRANSFER', handleBatchTransfer));

  IPCLogger.info('File system IPC handlers registered successfully');
  return [...FILE_SYSTEM_CHANNELS];
}
