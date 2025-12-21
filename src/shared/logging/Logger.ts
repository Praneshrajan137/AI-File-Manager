/**
 * Logger.ts - Structured logging service using Winston
 * 
 * Enterprise-grade logging with multiple transports, levels, and formatting.
 * 
 * Features:
 * - Multiple log levels (error, warn, info, debug, trace)
 * - Structured JSON format for machine parsing
 * - Console transport (development)
 * - File transport with rotation (production)
 * - Contextual logging with metadata
 * - Performance timing utilities
 * - Async/non-blocking
 * 
 * @example
 * import { Logger } from '@shared/logging';
 * 
 * const logger = Logger.getInstance();
 * logger.info('Application started', { version: '1.0.0' });
 * logger.error('Operation failed', { error: err, context: {...} });
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import os from 'os';

/**
 * Log levels (in order of severity).
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  /** Log level (default: 'info' in prod, 'debug' in dev) */
  level?: LogLevel;

  /** Enable console transport (default: true in dev, false in prod) */
  console?: boolean;

  /** Enable file transport (default: false in dev, true in prod) */
  file?: boolean;

  /** Log file directory (default: ~/.project2-file-manager/logs/) */
  logDir?: string;

  /** Maximum file size before rotation (default: '10m') */
  maxSize?: string;

  /** Maximum number of days to keep logs (default: 30) */
  maxFiles?: number;

  /** Service name for log entries */
  service?: string;
}

/**
 * Log entry metadata.
 */
export interface LogMetadata {
  [key: string]: unknown;
}

/**
 * Structured logging service.
 * 
 * Singleton pattern - use getInstance() to access.
 */
export class Logger {
  private static instance: Logger | null = null;
  private logger: winston.Logger;
  private service: string;

  /**
   * Private constructor (singleton pattern).
   */
  private constructor(options: LoggerOptions = {}) {
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Default options
    const opts: Required<LoggerOptions> = {
      level: options.level ?? (isDevelopment ? 'debug' : 'info'),
      console: options.console ?? isDevelopment,
      file: options.file ?? !isDevelopment,
      logDir: options.logDir ?? this.getDefaultLogDir(),
      maxSize: options.maxSize ?? '10m',
      maxFiles: options.maxFiles ?? 30,
      service: options.service ?? 'project2-file-manager',
    };

    this.service = opts.service;
    this.logger = this.createWinstonLogger(opts);
  }

  /**
   * Initialize logger with options.
   * 
   * Must be called once at app startup.
   * 
   * @param options - Logger options
   * 
   * @example
   * Logger.initialize({
   *   level: 'debug',
   *   console: true,
   *   file: true,
   * });
   */
  static initialize(options?: LoggerOptions): void {
    if (Logger.instance) {
      // Already initialized - silently return
      return;
    }

    Logger.instance = new Logger(options);
  }

  /**
   * Get logger instance.
   * 
   * @returns Logger instance
   * @throws Error if not initialized
   * 
   * @example
   * const logger = Logger.getInstance();
   * logger.info('Hello world');
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      // Auto-initialize with defaults if not explicitly initialized
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Log error message.
   * 
   * @param message - Log message
   * @param metadata - Additional context
   * 
   * @example
   * logger.error('Failed to read file', { path: '/test', error: err });
   */
  error(message: string, metadata?: LogMetadata): void {
    this.logger.error(message, this.enrichMetadata(metadata));
  }

  /**
   * Log warning message.
   * 
   * @param message - Log message
   * @param metadata - Additional context
   * 
   * @example
   * logger.warn('Deprecated API used', { api: 'oldMethod' });
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.logger.warn(message, this.enrichMetadata(metadata));
  }

  /**
   * Log info message.
   * 
   * @param message - Log message
   * @param metadata - Additional context
   * 
   * @example
   * logger.info('User logged in', { userId: '123' });
   */
  info(message: string, metadata?: LogMetadata): void {
    this.logger.info(message, this.enrichMetadata(metadata));
  }

  /**
   * Log debug message.
   * 
   * @param message - Log message
   * @param metadata - Additional context
   * 
   * @example
   * logger.debug('Cache hit', { key: 'user:123', ttl: 3600 });
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.logger.debug(message, this.enrichMetadata(metadata));
  }

  /**
   * Log trace message (most verbose).
   * 
   * @param message - Log message
   * @param metadata - Additional context
   * 
   * @example
   * logger.trace('Function called', { function: 'readFile', args: [...] });
   */
  trace(message: string, metadata?: LogMetadata): void {
    // Winston doesn't have trace, use debug with level indication
    this.logger.debug(message, {
      ...this.enrichMetadata(metadata),
      level: 'trace',
    });
  }

  /**
   * Start performance timer.
   * 
   * Returns function to call when operation completes.
   * 
   * @param label - Timer label
   * @returns Function to end timer
   * 
   * @example
   * const endTimer = logger.startTimer('database_query');
   * await db.query('SELECT * FROM users');
   * endTimer({ success: true, rows: 100 });
   */
  startTimer(label: string): (metadata?: LogMetadata) => void {
    const start = Date.now();

    return (metadata?: LogMetadata) => {
      const duration = Date.now() - start;
      this.info(`[Timer] ${label}`, {
        ...metadata,
        duration_ms: duration,
        label,
      });
    };
  }

  /**
   * Create child logger with additional context.
   * 
   * @param defaultMetadata - Default metadata for all logs
   * @returns Child logger function
   * 
   * @example
   * const userLogger = logger.child({ userId: '123', requestId: 'abc' });
   * userLogger.info('Action performed', { action: 'login' });
   * // Logs with { userId: '123', requestId: 'abc', action: 'login' }
   */
  child(defaultMetadata: LogMetadata): Omit<Logger, 'child' | 'startTimer'> {
    return {
      error: (msg: string, meta?: LogMetadata) => this.error(msg, { ...defaultMetadata, ...meta }),
      warn: (msg: string, meta?: LogMetadata) => this.warn(msg, { ...defaultMetadata, ...meta }),
      info: (msg: string, meta?: LogMetadata) => this.info(msg, { ...defaultMetadata, ...meta }),
      debug: (msg: string, meta?: LogMetadata) => this.debug(msg, { ...defaultMetadata, ...meta }),
      trace: (msg: string, meta?: LogMetadata) => this.trace(msg, { ...defaultMetadata, ...meta }),
    } as any;
  }

  /**
   * Create Winston logger with transports.
   * 
   * @param options - Logger options
   * @returns Winston logger instance
   */
  private createWinstonLogger(options: Required<LoggerOptions>): winston.Logger {
    const transports: winston.transport[] = [];

    // Console transport (development)
    if (options.console) {
      transports.push(this.createConsoleTransport());
    }

    // File transport (production)
    if (options.file) {
      transports.push(this.createFileTransport(options));
    }

    return winston.createLogger({
      level: options.level,
      format: this.createLogFormat(),
      transports,
      exitOnError: false, // Don't exit on logged errors
    });
  }

  /**
   * Create log format.
   * 
   * @returns Winston format
   */
  private createLogFormat(): winston.Logform.Format {
    return winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );
  }

  /**
   * Create console transport.
   * 
   * @returns Console transport
   */
  private createConsoleTransport(): winston.transport {
    return new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
          const meta = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
          return `${timestamp} [${level}]: ${message} ${meta}`;
        })
      ),
    });
  }

  /**
   * Create file transport with rotation.
   * 
   * @param options - Logger options
   * @returns File transport
   */
  private createFileTransport(options: Required<LoggerOptions>): winston.transport {
    return new DailyRotateFile({
      dirname: options.logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: options.maxSize,
      maxFiles: `${options.maxFiles}d`,
      zippedArchive: true,
      format: winston.format.json(),
    });
  }

  /**
   * Get default log directory.
   * 
   * @returns Log directory path
   */
  private getDefaultLogDir(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.project2-file-manager', 'logs');
  }

  /**
   * Enrich metadata with service name and timestamp.
   * 
   * @param metadata - Original metadata
   * @returns Enriched metadata
   */
  private enrichMetadata(metadata?: LogMetadata): LogMetadata {
    return {
      service: this.service,
      ...metadata,
    };
  }
}

/**
 * Get logger instance (convenience export).
 * 
 * @example
 * import { getLogger } from '@shared/logging';
 * const logger = getLogger();
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}
