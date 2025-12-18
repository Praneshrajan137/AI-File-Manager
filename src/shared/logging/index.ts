/**
 * logging/index.ts - Central export for logging functionality
 * 
 * @example
 * import { Logger, getLogger } from '@shared/logging';
 * 
 * const logger = getLogger();
 * logger.info('Application started');
 */

export { Logger, getLogger, type LogLevel, type LoggerOptions, type LogMetadata } from './Logger';
export * from './categories';
