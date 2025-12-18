/**
 * IPCError.ts - IPC communication errors
 * 
 * Extends BaseError for IPC-specific error codes.
 * Used when Main <-> Renderer communication fails.
 * 
 * Error Codes:
 * - INVALID_CHANNEL: Unknown IPC channel
 * - SERIALIZATION_FAILED: Cannot serialize/deserialize data
 * - TIMEOUT: IPC request timed out
 * - UNAUTHORIZED_REQUEST: Request not allowed by security policy
 * - MALFORMED_PAYLOAD: Request payload is invalid
 * 
 * @example
 * throw new IPCError(
 *   'INVALID_CHANNEL',
 *   'Unknown IPC channel: INVALID:CHANNEL',
 *   { channel: 'INVALID:CHANNEL', sender: 'renderer' }
 * );
 */

import { BaseError } from './BaseError';

/**
 * IPC error codes.
 */
export type IPCErrorCode =
  | 'INVALID_CHANNEL'
  | 'SERIALIZATION_FAILED'
  | 'TIMEOUT'
  | 'UNAUTHORIZED_REQUEST'
  | 'MALFORMED_PAYLOAD'
  | 'UNKNOWN';

/**
 * IPC error metadata.
 */
export interface IPCErrorMetadata {
  /** IPC channel name */
  channel?: string;
  
  /** Sender (main or renderer) */
  sender?: 'main' | 'renderer';
  
  /** Request payload (sanitized) */
  payload?: unknown;
  
  /** Timeout duration (ms) */
  timeout?: number;
  
  /** Validation errors */
  validationErrors?: string[];
  
  [key: string]: unknown;
}

/**
 * Error class for IPC operations.
 * 
 * Used in IPC handlers and preload scripts.
 * Always operational (isOperational=true).
 */
export class IPCError extends BaseError {
  /**
   * Create an IPC error.
   * 
   * @param code - Specific IPC error code
   * @param message - Human-readable error message
   * @param metadata - Additional context
   * 
   * @example
   * throw new IPCError(
   *   'TIMEOUT',
   *   'IPC request timed out after 5000ms',
   *   { channel: 'FS:READ_FILE', timeout: 5000 }
   * );
   */
  constructor(
    code: IPCErrorCode,
    message: string,
    metadata?: IPCErrorMetadata
  ) {
    super(code, message, true, metadata);
    this.name = 'IPCError';
  }
}
