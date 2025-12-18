/**
 * ErrorFactory.ts - Centralized error creation with metadata enrichment
 * 
 * Factory pattern for creating errors with consistent metadata.
 * Provides convenience methods for common error scenarios.
 * 
 * Benefits:
 * - Consistent error construction across codebase
 * - Automatic metadata enrichment (timestamps, context)
 * - Easier testing with mockable factory
 * - Single place to modify error creation logic
 * 
 * @example
 * const error = ErrorFactory.createFileSystemError(
 *   'FILE_NOT_FOUND',
 *   '/path/to/file.txt',
 *   'read'
 * );
 */

import {
  FileSystemError,
  FileSystemErrorCode,
  LLMError,
  LLMErrorCode,
  IPCError,
  IPCErrorCode,
  ValidationError,
  ValidationErrorCode,
} from './index';

/**
 * Factory class for creating errors with enriched metadata.
 * 
 * All methods are static - no need to instantiate.
 */
export class ErrorFactory {
  /**
   * Create a FileSystemError from an fs operation.
   * 
   * Automatically generates appropriate message based on code and path.
   * 
   * @param code - File system error code
   * @param path - Path where error occurred
   * @param operation - Operation that failed (read, write, delete, etc.)
   * @param additionalMetadata - Any additional context
   * @returns FileSystemError instance
   * 
   * @example
   * const error = ErrorFactory.createFileSystemError(
   *   'FILE_NOT_FOUND',
   *   '/home/user/config.json',
   *   'read'
   * );
   */
  static createFileSystemError(
    code: FileSystemErrorCode,
    path: string,
    operation?: string,
    additionalMetadata?: Record<string, unknown>
  ): FileSystemError {
    const message = this.getFileSystemErrorMessage(code, path, operation);
    
    return new FileSystemError(code, message, {
      path,
      operation,
      ...additionalMetadata,
    });
  }

  /**
   * Create FileSystemError from Node.js fs error.
   * 
   * Convenience wrapper around FileSystemError.fromFsError.
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
   *   throw ErrorFactory.fromFsError(err, '/path/to/file', 'read');
   * }
   */
  static fromFsError(
    fsError: any,
    path?: string,
    operation?: string
  ): FileSystemError {
    return FileSystemError.fromFsError(fsError, path, operation);
  }

  /**
   * Create an LLM error.
   * 
   * @param code - LLM error code
   * @param message - Error message
   * @param metadata - Additional context
   * @returns LLMError instance
   * 
   * @example
   * const error = ErrorFactory.createLLMError(
   *   'MODEL_NOT_FOUND',
   *   'Model llama3.2 is not installed',
   *   { model: 'llama3.2', ollamaUrl: 'http://localhost:11434' }
   * );
   */
  static createLLMError(
    code: LLMErrorCode,
    message: string,
    metadata?: Record<string, unknown>
  ): LLMError {
    return new LLMError(code, message, metadata);
  }

  /**
   * Create an IPC error.
   * 
   * @param code - IPC error code
   * @param channel - IPC channel name
   * @param additionalMessage - Additional error details
   * @param metadata - Additional context
   * @returns IPCError instance
   * 
   * @example
   * const error = ErrorFactory.createIPCError(
   *   'TIMEOUT',
   *   'FS:READ_FILE',
   *   'Request took longer than 5000ms'
   * );
   */
  static createIPCError(
    code: IPCErrorCode,
    channel: string,
    additionalMessage?: string,
    metadata?: Record<string, unknown>
  ): IPCError {
    const message = this.getIPCErrorMessage(code, channel, additionalMessage);
    
    return new IPCError(code, message, {
      channel,
      ...metadata,
    });
  }

  /**
   * Create a validation error.
   * 
   * @param code - Validation error code
   * @param field - Field name that failed validation
   * @param value - Actual value provided
   * @param expected - Expected value or type
   * @param additionalMetadata - Additional context
   * @returns ValidationError instance
   * 
   * @example
   * const error = ErrorFactory.createValidationError(
   *   'OUT_OF_RANGE',
   *   'port',
   *   99999,
   *   'number between 1 and 65535',
   *   { min: 1, max: 65535 }
   * );
   */
  static createValidationError(
    code: ValidationErrorCode,
    field: string,
    value: unknown,
    expected?: string,
    additionalMetadata?: Record<string, unknown>
  ): ValidationError {
    const message = this.getValidationErrorMessage(code, field, expected);
    
    return new ValidationError(code, message, {
      field,
      value,
      expected,
      ...additionalMetadata,
    });
  }

  /**
   * Generate human-readable message for file system errors.
   * 
   * @param code - Error code
   * @param path - Path where error occurred
   * @param operation - Operation that failed
   * @returns Error message
   */
  private static getFileSystemErrorMessage(
    code: FileSystemErrorCode,
    path: string,
    operation?: string
  ): string {
    const operationText = operation ? ` during ${operation}` : '';
    
    switch (code) {
      case 'FILE_NOT_FOUND':
        return `File or directory not found: ${path}`;
      
      case 'PERMISSION_DENIED':
        return `Permission denied${operationText}: ${path}`;
      
      case 'DISK_FULL':
        return `No space left on device${operationText}`;
      
      case 'INVALID_PATH':
        return `Invalid path: ${path}`;
      
      case 'PATH_TRAVERSAL':
        return `Path traversal attempt detected: ${path}`;
      
      case 'UNAUTHORIZED_ACCESS':
        return `Unauthorized access to: ${path}`;
      
      case 'FILE_TOO_LARGE':
        return `File too large: ${path}`;
      
      case 'DIRECTORY_NOT_EMPTY':
        return `Directory not empty: ${path}`;
      
      case 'ALREADY_EXISTS':
        return `File or directory already exists: ${path}`;
      
      default:
        return `File system error${operationText}: ${path}`;
    }
  }

  /**
   * Generate human-readable message for IPC errors.
   * 
   * @param code - Error code
   * @param channel - IPC channel
   * @param additionalMessage - Additional details
   * @returns Error message
   */
  private static getIPCErrorMessage(
    code: IPCErrorCode,
    channel: string,
    additionalMessage?: string
  ): string {
    const additional = additionalMessage ? `: ${additionalMessage}` : '';
    
    switch (code) {
      case 'INVALID_CHANNEL':
        return `Invalid IPC channel: ${channel}${additional}`;
      
      case 'SERIALIZATION_FAILED':
        return `Failed to serialize IPC payload for channel: ${channel}${additional}`;
      
      case 'TIMEOUT':
        return `IPC request timeout for channel: ${channel}${additional}`;
      
      case 'UNAUTHORIZED_REQUEST':
        return `Unauthorized IPC request to channel: ${channel}${additional}`;
      
      case 'MALFORMED_PAYLOAD':
        return `Malformed IPC payload for channel: ${channel}${additional}`;
      
      default:
        return `IPC error on channel: ${channel}${additional}`;
    }
  }

  /**
   * Generate human-readable message for validation errors.
   * 
   * @param code - Error code
   * @param field - Field name
   * @param expected - Expected value or type
   * @returns Error message
   */
  private static getValidationErrorMessage(
    code: ValidationErrorCode,
    field: string,
    expected?: string
  ): string {
    const expectation = expected ? ` (expected: ${expected})` : '';
    
    switch (code) {
      case 'INVALID_INPUT':
        return `Invalid input for field: ${field}${expectation}`;
      
      case 'MISSING_REQUIRED_FIELD':
        return `Required field missing: ${field}`;
      
      case 'TYPE_MISMATCH':
        return `Type mismatch for field: ${field}${expectation}`;
      
      case 'OUT_OF_RANGE':
        return `Value out of range for field: ${field}${expectation}`;
      
      case 'REGEX_MISMATCH':
        return `Value does not match required pattern for field: ${field}${expectation}`;
      
      default:
        return `Validation failed for field: ${field}${expectation}`;
    }
  }
}
