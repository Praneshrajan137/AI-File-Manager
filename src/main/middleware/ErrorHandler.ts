/**
 * ErrorHandler.ts - Global error handler for Main process
 * 
 * Catches and handles all errors in Main Process to prevent app crashes.
 * Distinguishes between operational errors (handle gracefully) and
 * programmer errors (log and potentially exit).
 * 
 * Responsibilities:
 * - Log all errors with full context
 * - Distinguish operational vs programmer errors
 * - Prevent app crashes from operational errors
 * - Alert developers about programmer errors
 * - Implement graceful degradation strategies
 * 
 * @example
 * ErrorHandler.initialize();
 * // Now all unhandled errors will be caught and logged
 */

import { BaseError } from '@shared/errors';

/**
 * Error handler options.
 */
export interface ErrorHandlerOptions {
  /** Whether to exit process on programmer errors (default: false in dev, true in prod) */
  exitOnProgrammerError?: boolean;
  
  /** Custom error logger (default: console.error) */
  logger?: (message: string, context?: Record<string, unknown>) => void;
  
  /** Callback for operational errors */
  onOperationalError?: (error: BaseError) => void;
  
  /** Callback for programmer errors */
  onProgrammerError?: (error: Error) => void;
}

/**
 * Global error handler for Main process.
 * 
 * Implements singleton pattern - only one instance exists.
 */
export class ErrorHandler {
  private static instance: ErrorHandler | null = null;
  private options: Required<ErrorHandlerOptions>;
  private isShuttingDown: boolean = false;

  /**
   * Private constructor (singleton pattern).
   */
  private constructor(options: ErrorHandlerOptions = {}) {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    this.options = {
      exitOnProgrammerError: options.exitOnProgrammerError ?? !isDevelopment,
      logger: options.logger ?? this.defaultLogger,
      onOperationalError: options.onOperationalError ?? this.defaultOperationalHandler,
      onProgrammerError: options.onProgrammerError ?? this.defaultProgrammerHandler,
    };
  }

  /**
   * Initialize global error handler.
   * 
   * Must be called once at app startup.
   * 
   * @param options - Error handler options
   * 
   * @example
   * // In main.ts
   * ErrorHandler.initialize({
   *   exitOnProgrammerError: true,
   *   logger: customLogger.error,
   * });
   */
  static initialize(options?: ErrorHandlerOptions): void {
    if (ErrorHandler.instance) {
      console.warn('ErrorHandler already initialized');
      return;
    }

    ErrorHandler.instance = new ErrorHandler(options);
    ErrorHandler.instance.registerHandlers();
  }

  /**
   * Get error handler instance.
   * 
   * @returns ErrorHandler instance
   * @throws Error if not initialized
   */
  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      throw new Error('ErrorHandler not initialized. Call ErrorHandler.initialize() first.');
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle an error.
   * 
   * Determines if error is operational or programmer error and handles accordingly.
   * 
   * @param error - Error to handle
   * 
   * @example
   * try {
   *   await riskyOperation();
   * } catch (err) {
   *   ErrorHandler.getInstance().handleError(err);
   * }
   */
  handleError(error: Error | BaseError): void {
    // Prevent multiple error handlers from running during shutdown
    if (this.isShuttingDown) {
      return;
    }

    if (this.isOperationalError(error)) {
      this.handleOperationalError(error as BaseError);
    } else {
      this.handleProgrammerError(error);
    }
  }

  /**
   * Register global error handlers.
   * 
   * Catches unhandled rejections and uncaught exceptions.
   */
  private registerHandlers(): void {
    // Unhandled Promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      const error = reason instanceof Error 
        ? reason 
        : new Error(`Unhandled Promise rejection: ${String(reason)}`);
      
      this.options.logger('Unhandled Promise Rejection:', {
        reason: String(reason),
        promise: String(promise),
        stack: error.stack,
      });

      this.handleError(error);
    });

    // Uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.options.logger('Uncaught Exception:', {
        message: error.message,
        stack: error.stack,
      });

      this.handleError(error);
    });

    // SIGTERM signal
    process.on('SIGTERM', () => {
      this.options.logger('SIGTERM received, shutting down gracefully');
      this.shutdown();
    });

    // SIGINT signal (Ctrl+C)
    process.on('SIGINT', () => {
      this.options.logger('SIGINT received, shutting down gracefully');
      this.shutdown();
    });
  }

  /**
   * Check if error is operational (expected) or programmer error (bug).
   * 
   * @param error - Error to check
   * @returns True if operational error
   */
  private isOperationalError(error: Error | BaseError): boolean {
    if (error instanceof BaseError) {
      return error.isOperational;
    }
    return false;
  }

  /**
   * Handle operational error (expected error).
   * 
   * Log error and continue execution.
   * 
   * @param error - Operational error
   */
  private handleOperationalError(error: BaseError): void {
    this.options.logger('Operational Error:', error.toJSON());
    this.options.onOperationalError(error);
  }

  /**
   * Handle programmer error (bug).
   * 
   * Log error and potentially exit process.
   * 
   * @param error - Programmer error
   */
  private handleProgrammerError(error: Error): void {
    this.options.logger('Programmer Error (Bug):', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    this.options.onProgrammerError(error);

    if (this.options.exitOnProgrammerError) {
      this.options.logger('Exiting due to programmer error...');
      this.shutdown(1);
    }
  }

  /**
   * Graceful shutdown.
   * 
   * @param exitCode - Process exit code (0 = success, 1 = error)
   */
  private shutdown(exitCode: number = 0): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Give ongoing operations time to complete
    setTimeout(() => {
      process.exit(exitCode);
    }, 1000);
  }

  /**
   * Default logger implementation.
   * 
   * @param message - Log message
   * @param context - Additional context
   */
  private defaultLogger(message: string, context?: Record<string, unknown>): void {
    console.error(`[ErrorHandler] ${message}`, context || '');
  }

  /**
   * Default operational error handler.
   * 
   * @param error - Operational error
   */
  private defaultOperationalHandler(error: BaseError): void {
    // Default: just log (already done in handleOperationalError)
    // Can be overridden to show notifications, update UI, etc.
  }

  /**
   * Default programmer error handler.
   * 
   * @param error - Programmer error
   */
  private defaultProgrammerHandler(error: Error): void {
    // Default: just log (already done in handleProgrammerError)
    // Can be overridden to send error reports, alert developers, etc.
  }
}
