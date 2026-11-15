/**
 * ErrorSerializer.ts - Serialize errors for IPC transmission
 * 
 * Converts Error objects to JSON-serializable format for sending from
 * Main Process to Renderer Process via IPC.
 * 
 * Security considerations:
 * - Strip sensitive data (API keys, tokens, passwords)
 * - Optionally hide stack traces in production
 * - Sanitize file paths (don't expose full system paths)
 * 
 * @example
 * try {
 *   await fileOperation();
 * } catch (err) {
 *   return ErrorSerializer.serialize(err);
 * }
 */

import { BaseError } from '@shared/errors';
import { redactSensitiveText } from '@shared/security/SecretGuard';

/**
 * Serialized error format for IPC.
 */
export interface SerializedError {
  /** Error name (e.g., 'FileSystemError') */
  name: string;
  
  /** Error code (e.g., 'FILE_NOT_FOUND') */
  code: string;
  
  /** Human-readable error message */
  message: string;
  
  /** When error occurred (Unix timestamp) */
  timestamp: number;
  
  /** Whether this is an operational error */
  isOperational: boolean;
  
  /** Sanitized metadata (sensitive data removed) */
  metadata?: Record<string, unknown>;
  
  /** Stack trace (only in development) */
  stack?: string;
}

/**
 * Serialization options.
 */
export interface SerializationOptions {
  /** Include stack traces (default: true in dev, false in prod) */
  includeStack?: boolean;
  
  /** Sanitize file paths (default: true) */
  sanitizePaths?: boolean;
  
  /** List of keys to remove from metadata */
  sensitiveKeys?: string[];
}

interface DeserializedError extends Error {
  code?: unknown;
  timestamp?: unknown;
  isOperational?: unknown;
  metadata?: unknown;
}

/**
 * Error serializer for IPC transmission.
 */
export class ErrorSerializer {
  private static readonly DEFAULT_SENSITIVE_KEYS = [
    'password',
    'token',
    'apiKey',
    'secret',
    'privateKey',
    'authorization',
    'cookie',
    'session',
  ];

  /**
   * Serialize error for IPC transmission.
   * 
   * @param error - Error to serialize
   * @param options - Serialization options
   * @returns Serialized error object
   * 
   * @example
   * const serialized = ErrorSerializer.serialize(error, {
   *   includeStack: false,
   *   sanitizePaths: true,
   * });
   */
  static serialize(
    error: Error | BaseError,
    options: SerializationOptions = {}
  ): SerializedError {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    const opts = {
      includeStack: options.includeStack ?? isDevelopment,
      sanitizePaths: options.sanitizePaths ?? true,
      sensitiveKeys: [
        ...ErrorSerializer.DEFAULT_SENSITIVE_KEYS,
        ...(options.sensitiveKeys || []),
      ],
    };

    // Handle BaseError (our custom errors)
    if (error instanceof BaseError) {
      return this.serializeBaseError(error, opts);
    }

    // Handle standard Error
    return this.serializeStandardError(error, opts);
  }

  /**
   * Serialize BaseError.
   * 
   * @param error - BaseError instance
   * @param options - Serialization options
   * @returns Serialized error
   */
  private static serializeBaseError(
    error: BaseError,
    options: Required<SerializationOptions>
  ): SerializedError {
    const metadata = error.metadata 
      ? this.sanitizeMetadata(error.metadata, options)
      : undefined;
    const sanitizedMessage = redactSensitiveText(
      options.sanitizePaths ? this.sanitizeText(error.message) : error.message
    ).sanitizedText;
    const sanitizedStack =
      options.includeStack && error.stack
        ? redactSensitiveText(
            options.sanitizePaths ? this.sanitizeText(error.stack) : error.stack
          ).sanitizedText
        : undefined;

    return {
      name: error.name,
      code: error.code,
      message: sanitizedMessage,
      timestamp: error.timestamp,
      isOperational: error.isOperational,
      metadata,
      stack: sanitizedStack,
    };
  }

  /**
   * Serialize standard Error.
   * 
   * @param error - Standard Error instance
   * @param options - Serialization options
   * @returns Serialized error
   */
  private static serializeStandardError(
    error: Error,
    options: Required<SerializationOptions>
  ): SerializedError {
    const sanitizedMessage = redactSensitiveText(
      options.sanitizePaths ? this.sanitizeText(error.message) : error.message
    ).sanitizedText;
    const sanitizedStack =
      options.includeStack && error.stack
        ? redactSensitiveText(
            options.sanitizePaths ? this.sanitizeText(error.stack) : error.stack
          ).sanitizedText
        : undefined;

    return {
      name: error.name,
      code: 'UNKNOWN',
      message: sanitizedMessage,
      timestamp: Date.now(),
      isOperational: false,
      metadata: undefined,
      stack: sanitizedStack,
    };
  }

  /**
   * Sanitize metadata by removing sensitive keys.
   * 
   * @param metadata - Original metadata
   * @param options - Serialization options
   * @returns Sanitized metadata
   */
  private static sanitizeMetadata(
    metadata: Record<string, unknown>,
    options: Required<SerializationOptions>
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Skip sensitive keys
      if (this.isSensitiveKey(key, options.sensitiveKeys)) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Sanitize file paths
      if (options.sanitizePaths && this.isPathLike(key, value)) {
        sanitized[key] = this.sanitizePath(String(value));
        continue;
      }

      // Recursively sanitize nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(
          value as Record<string, unknown>,
          options
        );
        continue;
      }

      // Keep value as-is
      sanitized[key] = value;
    }

    return sanitized;
  }

  /**
   * Check if key is sensitive.
   * 
   * @param key - Metadata key
   * @param sensitiveKeys - List of sensitive keys
   * @returns True if key is sensitive
   */
  private static isSensitiveKey(key: string, sensitiveKeys: string[]): boolean {
    const lowerKey = key.toLowerCase();
    return sensitiveKeys.some(sensitive => 
      lowerKey.includes(sensitive.toLowerCase())
    );
  }

  /**
   * Check if value looks like a file path.
   * 
   * @param key - Metadata key
   * @param value - Metadata value
   * @returns True if value looks like a path
   */
  private static isPathLike(key: string, value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    const lowerKey = key.toLowerCase();
    const pathKeywords = ['path', 'file', 'directory', 'folder', 'location'];
    
    return pathKeywords.some(keyword => lowerKey.includes(keyword));
  }

  /**
   * Sanitize file path by removing user-specific parts.
   * 
   * @param filePath - Original file path
   * @returns Sanitized path
   */
  /**
   * Sanitize arbitrary message or detail text by redacting OS home directories and user paths.
   */
  static sanitizeText(text: string): string {
    let result = text;
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir.length > 0) {
      const escapedHome = homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = process.platform === 'win32' ? 'gi' : 'g';
      result = result.replace(new RegExp(escapedHome, flags), '~');
    }
    if (process.platform === 'win32') {
      result = result.replace(/C:\\Users\\[^\\/"\s]+/gi, 'C:\\Users\\[user]');
    } else {
      result = result
        .replace(/\/home\/[^/\s"']+/g, '/home/[user]')
        .replace(/\/Users\/[^/\s"']+/g, '/Users/[user]');
    }
    return result;
  }

  private static sanitizePath(filePath: string): string {
    return this.sanitizeText(filePath);
  }

  /**
   * Deserialize error from IPC.
   * 
   * Reconstructs error object from serialized format.
   * 
   * @param serialized - Serialized error
   * @returns Error instance
   * 
   * @example
   * const error = ErrorSerializer.deserialize(ipcPayload);
   * console.error(error.message);
   */
  static deserialize(serialized: SerializedError): Error {
    const error: DeserializedError = new Error(serialized.message);
    error.name = serialized.name;
    error.stack = serialized.stack;
    
    // Attach additional properties
    error.code = serialized.code;
    error.timestamp = serialized.timestamp;
    error.isOperational = serialized.isOperational;
    error.metadata = serialized.metadata;

    return error;
  }
}
