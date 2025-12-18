/**
 * FileSystemError.ts - File system operation errors
 * 
 * Extends BaseError for file system-specific error codes.
 * Used throughout FileSystemService, DirectoryScanner, etc.
 * 
 * Error Codes:
 * - FILE_NOT_FOUND: File or directory doesn't exist
 * - PERMISSION_DENIED: Insufficient permissions
 * - DISK_FULL: No space left on device
 * - INVALID_PATH: Path format is invalid
 * - PATH_TRAVERSAL: Attempted directory traversal attack
 * - UNAUTHORIZED_ACCESS: Access to forbidden path
 * - FILE_TOO_LARGE: File exceeds size limit
 * - DIRECTORY_NOT_EMPTY: Cannot delete non-empty directory
 * - ALREADY_EXISTS: File or directory already exists
 * 
 * @example
 * throw new FileSystemError(
 *   'FILE_NOT_FOUND',
 *   'Cannot find file.txt',
 *   { path: '/home/user/file.txt' }
 * );
 */

import { BaseError } from './BaseError';

/**
 * File system error codes.
 * Used for programmatic error handling.
 */
export type FileSystemErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'DISK_FULL'
  | 'INVALID_PATH'
  | 'PATH_TRAVERSAL'
  | 'UNAUTHORIZED_ACCESS'
  | 'FILE_TOO_LARGE'
  | 'DIRECTORY_NOT_EMPTY'
  | 'ALREADY_EXISTS'
  | 'UNKNOWN';

/**
 * File system error metadata.
 * Additional context for file operations.
 */
export interface FileSystemErrorMetadata {
  /** Path where error occurred */
  path?: string;
  
  /** Original fs error code (ENOENT, EACCES, etc.) */
  originalCode?: string;
  
  /** Operation that failed (read, write, delete, etc.) */
  operation?: string;
  
  /** File size (for FILE_TOO_LARGE errors) */
  size?: number;
  
  /** Maximum allowed size (for FILE_TOO_LARGE errors) */
  maxSize?: number;
  
  /** Any other relevant context */
  [key: string]: unknown;
}

/**
 * Error class for file system operations.
 * 
 * All file system errors should use this class for consistency.
 * Always operational (isOperational=true) since file errors are expected.
 */
export class FileSystemError extends BaseError {
  /**
   * Create a file system error.
   * 
   * @param code - Specific file system error code
   * @param message - Human-readable error message
   * @param metadata - Additional context (path, operation, etc.)
   * 
   * @example
   * // File not found
   * throw new FileSystemError(
   *   'FILE_NOT_FOUND',
   *   'Cannot find configuration.json',
   *   { path: '/etc/app/configuration.json', operation: 'read' }
   * );
   * 
   * @example
   * // Permission denied
   * throw new FileSystemError(
   *   'PERMISSION_DENIED',
   *   'Cannot write to protected directory',
   *   { path: '/root/secret', operation: 'write' }
   * );
   * 
   * @example
   * // File too large
   * throw new FileSystemError(
   *   'FILE_TOO_LARGE',
   *   'File exceeds maximum size limit',
   *   { path: '/uploads/large.mp4', size: 1073741824, maxSize: 10485760 }
   * );
   */
  constructor(
    code: FileSystemErrorCode,
    message: string,
    metadata?: FileSystemErrorMetadata
  ) {
    // All file system errors are operational (expected)
    super(code, message, true, metadata);
    
    // Set name for stack traces
    this.name = 'FileSystemError';
  }

  /**
   * Create FileSystemError from Node.js fs error.
   * 
   * Maps fs error codes to our error codes.
   * 
   * @param fsError - Original error from fs module
   * @param path - Path where error occurred
   * @param operation - Operation that failed
   * @returns FileSystemError instance
   * 
   * @example
   * try {
   *   await fs.readFile('/path/to/file');
   * } catch (err) {
   *   throw FileSystemError.fromFsError(err, '/path/to/file', 'read');
   * }
   */
  static fromFsError(
    fsError: any,
    path?: string,
    operation?: string
  ): FileSystemError {
    let code: FileSystemErrorCode = 'UNKNOWN';
    let message = fsError.message || 'Unknown file system error';

    // Map Node.js fs error codes to our error codes
    switch (fsError.code) {
      case 'ENOENT':
        code = 'FILE_NOT_FOUND';
        message = path 
          ? `File or directory not found: ${path}`
          : 'File or directory not found';
        break;

      case 'EACCES':
      case 'EPERM':
        code = 'PERMISSION_DENIED';
        message = path
          ? `Permission denied: ${path}`
          : 'Permission denied';
        break;

      case 'ENOSPC':
        code = 'DISK_FULL';
        message = 'No space left on device';
        break;

      case 'EEXIST':
        code = 'ALREADY_EXISTS';
        message = path
          ? `File or directory already exists: ${path}`
          : 'File or directory already exists';
        break;

      case 'ENOTEMPTY':
        code = 'DIRECTORY_NOT_EMPTY';
        message = path
          ? `Directory not empty: ${path}`
          : 'Directory not empty';
        break;

      case 'EINVAL':
        code = 'INVALID_PATH';
        message = path
          ? `Invalid path: ${path}`
          : 'Invalid path';
        break;

      default:
        code = 'UNKNOWN';
        message = `File system error (${fsError.code || 'unknown'}): ${message}`;
    }

    return new FileSystemError(code, message, {
      path,
      operation,
      originalCode: fsError.code,
    });
  }
}
