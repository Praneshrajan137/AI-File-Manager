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
import { FileNode, FilePreviewResult, FileStats, SystemPaths } from '@shared/contracts';
import { FileSystemLogger, IPCLogger } from '@shared/logging';
import { IPCChannel } from '@shared/ipc/contracts';
import os from 'os';
import path from 'path';

let fileSystemService: FileSystemService | null = null;

/**
 * Get or create FileSystemService instance configured with canonical allowed roots.
 */
export function getFileSystemService(): FileSystemService {
  if (!fileSystemService) {
    const roots = resolveAllowedRoots();
    fileSystemService = new FileSystemService(roots);
    FileSystemLogger.info('FileSystemService initialized', { roots });
  }

  return fileSystemService;
}

/**
 * Reset singleton FileSystemService (used after config changes or in tests).
 */
export function resetFileSystemService(): void {
  fileSystemService = null;
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

  const service = getFileSystemService();
  const files = await service.readDirectory(input.path);

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
  const maxLines = input.maxLines ?? 100;
  const service = getFileSystemService();
  const stats = await service.getStats(input.path);
  const raw = await service.readFile(input.path);
  const binary = raw.includes('\0');
  const allLines = binary ? [] : raw.split(/\r?\n/);
  const sliced = allLines.slice(0, maxLines);

  return {
    path: input.path,
    name: path.basename(input.path),
    extension: path.extname(input.path).replace(/^\./, '').toLowerCase(),
    size: stats.size,
    modified: stats.modified,
    lines: sliced,
    totalLinesBuffered: sliced.length,
    truncated: allLines.length > maxLines,
    binary,
    fromCache: false,
  };
}

async function handleWriteFile(
  _event: IpcMainInvokeEvent,
  input: { path: string; content: string }
): Promise<{ success: boolean }> {
  FileSystemLogger.info('Writing file', {
    path: input.path,
    contentLength: input.content.length,
  });

  const service = getFileSystemService();
  const result = await service.writeFile(input.path, input.content);

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

  const service = getFileSystemService();
  const result = await service.delete(input.path, input.recursive);

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

  const service = getFileSystemService();
  const result = await service.move(input.source, input.destination);

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

  const service = getFileSystemService();
  await service.writeFile(fullPath, input.content ?? '');

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

  const service = getFileSystemService();
  await service.createDirectory(fullPath);

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

  const service = getFileSystemService();
  const result = await service.move(input.oldPath, canonicalNewPath);

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
