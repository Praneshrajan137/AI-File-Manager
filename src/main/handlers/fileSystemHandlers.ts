/**
 * fileSystemHandlers.ts - IPC handlers for file system operations
 * 
 * Implements 8 IPC handlers that map to IFileSystemService methods:
 * - FS:READ_DIR - Read directory contents
 * - FS:READ_FILE - Read file content
 * - FS:WRITE_FILE - Write content to file
 * - FS:DELETE - Delete file or directory
 * - FS:MOVE - Move/rename file or directory
 * - FS:CREATE_FILE - Create new file
 * - FS:CREATE_DIR - Create new directory
 * - FS:GET_STATS - Get file statistics
 * 
 * SECURITY: All handlers use securityMiddleware for validation.
 * 
 * @example
 * // In main.ts:
 * import { registerFileSystemHandlers } from './handlers/fileSystemHandlers';
 * registerFileSystemHandlers();
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { FileSystemService } from '@main/services/FileSystemService';
import {
  validatePathRequest,
  validatePathsOrThrow,
  validateRequestSchema,
  withErrorHandling,
  checkRateLimit,
} from './securityMiddleware';
import { FileNode, FileStats } from '@shared/contracts';
import { FileSystemLogger } from '@shared/logging';
import { ConfigManager } from '@shared/config';
import os from 'os';
import path from 'path';

/**
 * Singleton FileSystemService instance.
 * Uses first allowed root from config, or home directory as fallback.
 */
let fileSystemService: FileSystemService | null = null;

/**
 * Get or create FileSystemService instance.
 * 
 * @returns FileSystemService instance
 */
function getFileSystemService(): FileSystemService {
  if (!fileSystemService) {
    try {
      const config = ConfigManager.getInstance();
      const allowedRoots = config.get('fileSystem').allowedRoots;
      
      const defaultRoot = allowedRoots && allowedRoots.length > 0
        ? allowedRoots[0]
        : os.homedir();
      
      fileSystemService = new FileSystemService(defaultRoot);
      FileSystemLogger.info('FileSystemService initialized', { root: defaultRoot });
    } catch (error) {
      // Fallback to home directory if config not available
      fileSystemService = new FileSystemService(os.homedir());
      FileSystemLogger.info('FileSystemService initialized with fallback', { root: os.homedir() });
    }
  }
  
  return fileSystemService;
}

/**
 * Handler: FS:READ_DIR
 * Read directory contents with metadata.
 * 
 * Input: { path: string }
 * Output: FileNode[]
 */
async function handleReadDirectory(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<FileNode[]> {
  checkRateLimit('FS:READ_DIR');
  
  // Validate and extract path
  const dirPath = validatePathRequest(request, 'path');
  
  FileSystemLogger.info('Reading directory', { path: dirPath });
  
  const service = getFileSystemService();
  const files = await service.readDirectory(dirPath);
  
  FileSystemLogger.info('Directory read successful', {
    path: dirPath,
    fileCount: files.length,
  });
  
  return files;
}

/**
 * Handler: FS:READ_FILE
 * Read file content as string.
 * 
 * Input: { path: string }
 * Output: { content: string, encoding: string }
 */
async function handleReadFile(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ content: string; encoding: string }> {
  checkRateLimit('FS:READ_FILE');
  
  // Validate and extract path
  const filePath = validatePathRequest(request, 'path');
  
  FileSystemLogger.info('Reading file', { path: filePath });
  
  const service = getFileSystemService();
  const content = await service.readFile(filePath);
  
  FileSystemLogger.info('File read successful', {
    path: filePath,
    contentLength: content.length,
  });
  
  return { content, encoding: 'utf-8' };
}

/**
 * Handler: FS:WRITE_FILE
 * Write content to file.
 * 
 * Input: { path: string, content: string }
 * Output: { success: boolean }
 */
async function handleWriteFile(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean }> {
  checkRateLimit('FS:WRITE_FILE');
  
  // Validate request schema
  validateRequestSchema(request, {
    path: 'string',
    content: 'string',
  });
  
  const { path: filePath, content } = request as { path: string; content: string };
  
  // Validate path
  validatePathsOrThrow([filePath]);
  
  FileSystemLogger.info('Writing file', {
    path: filePath,
    contentLength: content.length,
  });
  
  const service = getFileSystemService();
  const result = await service.writeFile(filePath, content);
  
  FileSystemLogger.info('File write successful', { path: filePath });
  
  return result;
}

/**
 * Handler: FS:DELETE
 * Delete file or directory.
 * 
 * Input: { path: string, recursive?: boolean }
 * Output: { success: boolean }
 */
async function handleDelete(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean }> {
  checkRateLimit('FS:DELETE');
  
  // Validate request has path
  if (!request || typeof request !== 'object' || !('path' in request)) {
    throw new TypeError('Request missing required field: path');
  }
  
  const { path: filePath, recursive } = request as { path: string; recursive?: boolean };
  
  // Validate path
  validatePathsOrThrow([filePath]);
  
  // Validate recursive flag if present
  if (recursive !== undefined && typeof recursive !== 'boolean') {
    throw new TypeError('Field "recursive" must be a boolean');
  }
  
  FileSystemLogger.info('Deleting file/directory', {
    path: filePath,
    recursive: recursive || false,
  });
  
  const service = getFileSystemService();
  const result = await service.delete(filePath, recursive);
  
  FileSystemLogger.info('Delete successful', { path: filePath });
  
  return result;
}

/**
 * Handler: FS:MOVE
 * Move or rename file/directory.
 * 
 * Input: { source: string, destination: string }
 * Output: { success: boolean, newPath: string }
 */
async function handleMove(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean; newPath: string }> {
  checkRateLimit('FS:MOVE');
  
  // Validate request schema
  validateRequestSchema(request, {
    source: 'string',
    destination: 'string',
  });
  
  const { source, destination } = request as { source: string; destination: string };
  
  // Validate both paths
  validatePathsOrThrow([source, destination]);
  
  FileSystemLogger.info('Moving file/directory', {
    source,
    destination,
  });
  
  const service = getFileSystemService();
  const result = await service.move(source, destination);
  
  FileSystemLogger.info('Move successful', {
    source,
    destination: result.newPath,
  });
  
  return result;
}

/**
 * Handler: FS:CREATE_FILE
 * Create new empty file.
 * 
 * Input: { path: string, name: string }
 * Output: { success: boolean, path: string }
 */
async function handleCreateFile(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean; path: string }> {
  checkRateLimit('FS:CREATE_FILE');
  
  // Validate request schema
  validateRequestSchema(request, {
    path: 'string',
    name: 'string',
  });
  
  const { path: dirPath, name } = request as { path: string; name: string };
  
  // Validate directory path
  validatePathsOrThrow([dirPath]);
  
  // Construct full file path
  const fullPath = path.join(dirPath, name);
  
  // Validate full path (security check)
  validatePathsOrThrow([fullPath]);
  
  FileSystemLogger.info('Creating file', {
    directory: dirPath,
    name,
    fullPath,
  });
  
  // Create empty file
  const service = getFileSystemService();
  await service.writeFile(fullPath, '');
  
  FileSystemLogger.info('File created successfully', { path: fullPath });
  
  return { success: true, path: fullPath };
}

/**
 * Handler: FS:CREATE_DIR
 * Create new directory.
 * 
 * Input: { path: string, name: string }
 * Output: { success: boolean, path: string }
 */
async function handleCreateDirectory(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<{ success: boolean; path: string }> {
  checkRateLimit('FS:CREATE_DIR');
  
  // Validate request schema
  validateRequestSchema(request, {
    path: 'string',
    name: 'string',
  });
  
  const { path: parentPath, name } = request as { path: string; name: string };
  
  // Validate parent path
  validatePathsOrThrow([parentPath]);
  
  // Construct full directory path
  const fullPath = path.join(parentPath, name);
  
  // Validate full path (security check)
  validatePathsOrThrow([fullPath]);
  
  FileSystemLogger.info('Creating directory', {
    parent: parentPath,
    name,
    fullPath,
  });
  
  // Create directory using FileSystemService
  const service = getFileSystemService();
  await service.createDirectory(fullPath);
  
  FileSystemLogger.info('Directory created successfully', { path: fullPath });
  
  return { success: true, path: fullPath };
}

/**
 * Handler: FS:GET_STATS
 * Get detailed file statistics.
 * 
 * Input: { path: string }
 * Output: FileStats
 */
async function handleGetStats(
  event: IpcMainInvokeEvent,
  request: unknown
): Promise<FileStats> {
  checkRateLimit('FS:GET_STATS');
  
  // Validate and extract path
  const filePath = validatePathRequest(request, 'path');
  
  FileSystemLogger.info('Getting file stats', { path: filePath });
  
  const service = getFileSystemService();
  const stats = await service.getStats(filePath);
  
  FileSystemLogger.debug('File stats retrieved', {
    path: filePath,
    size: stats.size,
    isDirectory: stats.isDirectory,
  });
  
  return stats;
}

/**
 * Register all file system IPC handlers.
 * 
 * Call this once during app initialization.
 * 
 * @example
 * // In main.ts:
 * registerFileSystemHandlers();
 */
export function registerFileSystemHandlers(): void {
  FileSystemLogger.info('Registering file system IPC handlers');
  
  // Register all handlers with error handling middleware
  ipcMain.handle(
    'FS:READ_DIR',
    withErrorHandling(handleReadDirectory, 'FS:READ_DIR')
  );
  
  ipcMain.handle(
    'FS:READ_FILE',
    withErrorHandling(handleReadFile, 'FS:READ_FILE')
  );
  
  ipcMain.handle(
    'FS:WRITE_FILE',
    withErrorHandling(handleWriteFile, 'FS:WRITE_FILE')
  );
  
  ipcMain.handle(
    'FS:DELETE',
    withErrorHandling(handleDelete, 'FS:DELETE')
  );
  
  ipcMain.handle(
    'FS:MOVE',
    withErrorHandling(handleMove, 'FS:MOVE')
  );
  
  ipcMain.handle(
    'FS:CREATE_FILE',
    withErrorHandling(handleCreateFile, 'FS:CREATE_FILE')
  );
  
  ipcMain.handle(
    'FS:CREATE_DIR',
    withErrorHandling(handleCreateDirectory, 'FS:CREATE_DIR')
  );
  
  ipcMain.handle(
    'FS:GET_STATS',
    withErrorHandling(handleGetStats, 'FS:GET_STATS')
  );
  
  FileSystemLogger.info('File system IPC handlers registered successfully');
}
