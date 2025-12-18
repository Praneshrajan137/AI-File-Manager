/**
 * errors/index.ts - Central export for all error classes
 * 
 * Import errors from this file throughout the application.
 * 
 * @example
 * import { FileSystemError, LLMError, ErrorFactory } from '@shared/errors';
 * 
 * // Direct construction
 * throw new FileSystemError('FILE_NOT_FOUND', 'File missing', { path: '/test' });
 * 
 * // Using factory
 * throw ErrorFactory.createFileSystemError('FILE_NOT_FOUND', '/test', 'read');
 */

export { BaseError } from './BaseError';
export { 
  FileSystemError, 
  type FileSystemErrorCode, 
  type FileSystemErrorMetadata 
} from './FileSystemError';
export { 
  LLMError, 
  type LLMErrorCode, 
  type LLMErrorMetadata 
} from './LLMError';
export { 
  IPCError, 
  type IPCErrorCode, 
  type IPCErrorMetadata 
} from './IPCError';
export { 
  ValidationError, 
  type ValidationErrorCode, 
  type ValidationErrorMetadata 
} from './ValidationError';
export { ErrorFactory } from './ErrorFactory';
