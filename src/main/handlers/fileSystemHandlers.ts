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
import { FileNode, FilePreviewResult, FileStats, SystemPaths } from '@shared/contracts';
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
  input: { path: string; recursive?: boolean }
): Promise<{ success: boolean }> {
  FileSystemLogger.info('Deleting file/directory', {
    path: input.path,
    recursive: input.recursive || false,
  });

  const kernel = getReactiveWorkspaceKernel();
  const result = await kernel.getFileSystemService().delete(input.path, input.recursive);
  kernel.notifyMutation('unlink', input.path);

  FileSystemLogger.info('Delete successful', { path: input.path });

  return result;
}

async function handleMove(
  _event: IpcMainInvokeEvent,
  input: { source: string; destination: string }
): Promise<{ success: boolean; newPath: string }> {
  FileSystemLogger.info('Moving file/directory', {
    source: input.source,
    destination: input.destination,
  });

  const kernel = getReactiveWorkspaceKernel();
  const result = await kernel.getFileSystemService().move(input.source, input.destination);
  kernel.notifyMutation('unlink', input.source);
  kernel.notifyMutation('create', result.newPath);

  FileSystemLogger.info('Move successful', {
    source: input.source,
    destination: result.newPath,
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

  FileSystemLogger.info('Creating file', {
    directory: input.path,
    name: input.name,
    fullPath,
  });

  const kernel = getReactiveWorkspaceKernel();
  await kernel.getFileSystemService().writeFile(fullPath, input.content ?? '');
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
  const result = await kernel.getFileSystemService().move(input.oldPath, canonicalNewPath);
  kernel.notifyMutation('unlink', input.oldPath);
  kernel.notifyMutation('create', result.newPath);

  FileSystemLogger.info('File renamed successfully', {
    oldPath: input.oldPath,
    newPath: result.newPath,
  });

  return result;
}

const FILE_SYSTEM_CHANNELS: IPCChannel[] = [
  'FS:READ_DIR',
  'FS:READ_FILE',
  'FS:PREVIEW_FILE',
  'FS:WRITE_FILE',
  'FS:DELETE',
  'FS:MOVE',
  'FS:CREATE_FILE',
  'FS:CREATE_DIR',
  'FS:GET_STATS',
  'FS:GET_SYSTEM_PATHS',
  'FS:RENAME',
];

/**
 * Register all file system IPC handlers through the declarative contract wrapper.
 */
export function registerFileSystemHandlers(): IPCChannel[] {
  IPCLogger.info('Registering file system IPC handlers');

  ipcMain.handle('FS:READ_DIR', withContract('FS:READ_DIR', handleReadDirectory));
  ipcMain.handle('FS:READ_FILE', withContract('FS:READ_FILE', handleReadFile));
  ipcMain.handle('FS:PREVIEW_FILE', withContract('FS:PREVIEW_FILE', handlePreviewFile));
  ipcMain.handle('FS:WRITE_FILE', withContract('FS:WRITE_FILE', handleWriteFile));
  ipcMain.handle('FS:DELETE', withContract('FS:DELETE', handleDelete));
  ipcMain.handle('FS:MOVE', withContract('FS:MOVE', handleMove));
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

  IPCLogger.info('File system IPC handlers registered successfully');
  return [...FILE_SYSTEM_CHANNELS];
}
