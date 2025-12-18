/**
 * categories.ts - Category-specific loggers
 * 
 * Pre-configured loggers for different system components.
 * Each logger automatically includes category in metadata.
 * 
 * Categories:
 * - FileSystemLogger: File system operations
 * - IPCLogger: IPC communication
 * - LLMLogger: LLM indexing and queries
 * - SecurityLogger: Authentication and validation
 * - PerformanceLogger: Performance metrics and timing
 * 
 * @example
 * import { FileSystemLogger } from '@shared/logging';
 * 
 * FileSystemLogger.info('Reading directory', { path: '/test' });
 * // Logs with { category: 'FileSystem', path: '/test' }
 */

import { Logger, type LogMetadata } from './Logger';

/**
 * Category logger interface.
 */
interface CategoryLogger {
  error(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  debug(message: string, metadata?: LogMetadata): void;
  trace(message: string, metadata?: LogMetadata): void;
}

/**
 * Create category logger.
 * 
 * @param category - Category name
 * @returns Category logger
 */
function createCategoryLogger(category: string): CategoryLogger {
  return Logger.getInstance().child({ category });
}

/**
 * File system operations logger.
 * 
 * Use for:
 * - Reading/writing files
 * - Directory operations
 * - File watching
 * - Path validation
 * 
 * @example
 * FileSystemLogger.info('File read', { path: '/test/file.txt', size: 1024 });
 * FileSystemLogger.error('Permission denied', { path: '/root/secret', operation: 'read' });
 */
export const FileSystemLogger = createCategoryLogger('FileSystem');

/**
 * IPC communication logger.
 * 
 * Use for:
 * - IPC channel requests
 * - IPC channel responses
 * - Serialization errors
 * - IPC timeouts
 * 
 * @example
 * IPCLogger.debug('IPC request received', { channel: 'FS:READ_FILE', payload: {...} });
 * IPCLogger.error('IPC timeout', { channel: 'FS:READ_FILE', timeout: 5000 });
 */
export const IPCLogger = createCategoryLogger('IPC');

/**
 * LLM operations logger.
 * 
 * Use for:
 * - File indexing
 * - Embedding generation
 * - LLM queries
 * - RAG pipeline
 * 
 * @example
 * LLMLogger.info('Starting indexing', { path: '/workspace', fileCount: 1500 });
 * LLMLogger.debug('Embedding generated', { filePath: '/test.ts', dimensions: 384 });
 */
export const LLMLogger = createCategoryLogger('LLM');

/**
 * Security operations logger.
 * 
 * Use for:
 * - Path validation
 * - Authentication attempts
 * - Authorization checks
 * - Security violations
 * 
 * @example
 * SecurityLogger.warn('Path traversal attempt', { path: '../../etc/passwd', ip: '192.168.1.1' });
 * SecurityLogger.info('Access granted', { user: 'admin', resource: '/admin/panel' });
 */
export const SecurityLogger = createCategoryLogger('Security');

/**
 * Performance monitoring logger.
 * 
 * Use for:
 * - Operation timing
 * - Memory usage
 * - Cache statistics
 * - Performance metrics
 * 
 * @example
 * PerformanceLogger.info('Operation completed', { operation: 'read', duration_ms: 150 });
 * PerformanceLogger.warn('Slow operation', { operation: 'scan', duration_ms: 5000, threshold_ms: 1000 });
 */
export const PerformanceLogger = createCategoryLogger('Performance');
