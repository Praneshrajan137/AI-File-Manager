/**
 * BaseError.ts - Abstract base class for all application errors
 * 
 * CRITICAL: This is the foundation of the error handling system.
 * All domain-specific errors MUST extend this class.
 * 
 * Design Principles:
 * - Open/Closed: Extensible without modification
 * - Single Responsibility: Only handles common error properties/methods
 * - Liskov Substitution: All subclasses can be used interchangeably
 * 
 * Properties:
 * - code: Machine-readable error code for programmatic handling
 * - message: Human-readable error description
 * - timestamp: When error occurred (Unix milliseconds)
 * - isOperational: Distinguishes expected errors from programmer bugs
 * - metadata: Additional context (paths, user IDs, etc.)
 * - stack: Call stack trace
 * 
 * Methods:
 * - toJSON(): Serialize error for logging/IPC
 * - toString(): Human-readable format
 * - getContext(): Extract contextual information
 * 
 * @example
 * class FileSystemError extends BaseError {
 *   constructor(code: string, message: string, metadata?: Record<string, unknown>) {
 *     super(code, message, true, metadata);
 *     this.name = 'FileSystemError';
 *   }
 * }
 */

/**
 * Abstract base class for all application errors.
 * 
 * MUST be extended - cannot be instantiated directly.
 * 
 * Operational vs Programmer Errors:
 * - Operational (isOperational=true): Expected errors that should be handled
 *   Examples: File not found, network timeout, validation failure
 * - Programmer (isOperational=false): Bugs that need fixing
 *   Examples: Null pointer, type mismatch, logic errors
 */
export abstract class BaseError extends Error {
  /**
   * Machine-readable error code.
   * Used for programmatic error handling and logging.
   * 
   * @example 'FILE_NOT_FOUND', 'PERMISSION_DENIED'
   */
  public readonly code: string;

  /**
   * When the error occurred (Unix timestamp in milliseconds).
   * Automatically set in constructor.
   */
  public readonly timestamp: number;

  /**
   * Whether this is an operational error (expected) vs programmer error (bug).
   * 
   * - true: Operational error - handle gracefully, show to user
   * - false: Programmer error - log, alert developers, may crash app
   * 
   * Default: true (most errors are operational)
   */
  public readonly isOperational: boolean;

  /**
   * Additional context about the error.
   * Can include any relevant information for debugging/logging.
   * 
   * @example { path: '/home/user/file.txt', userId: '123', action: 'read' }
   */
  public readonly metadata?: Record<string, unknown>;

  /**
   * Create a new BaseError.
   * 
   * @param code - Machine-readable error code (e.g., 'FILE_NOT_FOUND')
   * @param message - Human-readable error message
   * @param isOperational - Whether this is an operational error (default: true)
   * @param metadata - Additional context (optional)
   * 
   * @example
   * class MyError extends BaseError {
   *   constructor(message: string, metadata?: Record<string, unknown>) {
   *     super('MY_ERROR_CODE', message, true, metadata);
   *     this.name = 'MyError';
   *   }
   * }
   */
  protected constructor(
    code: string,
    message: string,
    isOperational: boolean = true,
    metadata?: Record<string, unknown>
  ) {
    // Call parent Error constructor
    super(message);

    // Set error name to class name (for stack traces)
    this.name = this.constructor.name;

    // Set error properties
    this.code = code;
    this.timestamp = Date.now();
    this.isOperational = isOperational;
    this.metadata = metadata;

    // Maintain proper stack trace for where error was thrown (V8 only)
    // This ensures stack trace points to where error was created, not here
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error to JSON for logging or IPC transmission.
   * 
   * Includes all error properties for complete context.
   * 
   * @returns JSON-serializable object
   * 
   * @example
   * const error = new MyError('Something failed', { path: '/test' });
   * const json = error.toJSON();
   * console.log(JSON.stringify(json));
   * // Output: {"name":"MyError","code":"MY_ERROR","message":"Something failed",...}
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      isOperational: this.isOperational,
      metadata: this.metadata,
      stack: this.stack,
    };
  }

  /**
   * Convert error to human-readable string.
   * 
   * Format: "ErrorName [CODE]: message"
   * 
   * @returns Formatted error string
   * 
   * @example
   * const error = new FileSystemError('FILE_NOT_FOUND', 'Cannot find file.txt');
   * console.log(error.toString());
   * // Output: "FileSystemError [FILE_NOT_FOUND]: Cannot find file.txt"
   */
  toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  /**
   * Get error context for logging/debugging.
   * 
   * Returns error properties without message/stack for structured logging.
   * 
   * @returns Context object with code, timestamp, isOperational, metadata
   * 
   * @example
   * const error = new MyError('Failed', { userId: '123' });
   * logger.error('Operation failed', error.getContext());
   * // Logs: { code: 'MY_ERROR', timestamp: 1234567890, isOperational: true, metadata: {...} }
   */
  getContext(): Record<string, unknown> {
    return {
      code: this.code,
      timestamp: this.timestamp,
      isOperational: this.isOperational,
      metadata: this.metadata,
    };
  }
}
