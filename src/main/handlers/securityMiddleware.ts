/**
 * securityMiddleware.ts - Security middleware for IPC handlers
 * 
 * Provides centralized security validation for all IPC requests:
 * - Path validation using PathValidator
 * - Type checking for request payloads
 * - Rate limiting for expensive operations
 * - Error serialization using ErrorSerializer
 * 
 * CRITICAL: All IPC handlers MUST use this middleware before processing.
 * 
 * @example
 * ipcMain.handle('FS:READ_DIR', async (event, request) => {
 *   const validatedPath = await validatePathRequest(request.path);
 *   return fileSystemService.readDirectory(validatedPath);
 * });
 */

import { PathValidator } from '@main/services/PathValidator';
import { ErrorSerializer, SerializedError } from '@main/middleware/ErrorSerializer';
import { SecurityLogger, IPCLogger } from '@shared/logging';
import { ConfigManager } from '@shared/config';
import os from 'os';

/**
 * Default path validator instance.
 * Uses user's home directory as allowed root by default.
 */
let defaultValidator: PathValidator | null = null;

/**
 * Get or create default path validator.
 * 
 * @returns PathValidator instance
 */
export function getPathValidator(): PathValidator {
  if (!defaultValidator) {
    // Always use home directory as allowed root to allow access to all user folders
    const homeDir = os.homedir();
    defaultValidator = new PathValidator(homeDir);
    SecurityLogger.info('Path validator initialized', { root: homeDir });
  }

  return defaultValidator;
}

/**
 * Validate path and throw if invalid.
 * 
 * @param path - Path to validate
 * @param customValidator - Optional custom validator
 * @returns Validated path (unchanged if valid)
 * @throws Error if path is invalid
 * 
 * @example
 * const validPath = validatePathOrThrow('/home/user/file.txt');
 */
export function validatePathOrThrow(
  path: string,
  customValidator?: PathValidator
): string {
  const validator = customValidator || getPathValidator();
  const result = validator.validate(path);

  if (!result.valid) {
    SecurityLogger.error('Path validation failed', {
      path,
      error: result.error,
      details: result.details,
    });

    throw new Error(result.details || `Invalid path: ${result.error}`);
  }

  return path;
}

/**
 * Validate multiple paths and throw if any are invalid.
 * 
 * @param paths - Array of paths to validate
 * @param customValidator - Optional custom validator
 * @returns Validated paths (unchanged if valid)
 * @throws Error if any path is invalid
 * 
 * @example
 * const [source, dest] = validatePathsOrThrow([sourceFile, destFile]);
 */
export function validatePathsOrThrow(
  paths: string[],
  customValidator?: PathValidator
): string[] {
  return paths.map(path => validatePathOrThrow(path, customValidator));
}

/**
 * Type guard for object with path property.
 */
interface WithPath {
  path: string;
}

/**
 * Type guard to check if request has path property.
 * 
 * @param request - Request object
 * @returns True if request has path property
 */
function hasPath(request: unknown): request is WithPath {
  return (
    typeof request === 'object' &&
    request !== null &&
    'path' in request &&
    typeof (request as any).path === 'string'
  );
}

/**
 * Validate request payload has required path property.
 * 
 * @param request - Request payload
 * @param fieldName - Name of path field (default: 'path')
 * @returns Validated path string
 * @throws Error if path field missing or invalid type
 * 
 * @example
 * const path = validatePathRequest(request);
 */
export function validatePathRequest(
  request: unknown,
  fieldName: string = 'path'
): string {
  if (!request || typeof request !== 'object') {
    throw new TypeError('Request payload must be an object');
  }

  if (!(fieldName in request)) {
    throw new TypeError(`Request missing required field: ${fieldName}`);
  }

  const path = (request as any)[fieldName];

  if (typeof path !== 'string') {
    throw new TypeError(`Field "${fieldName}" must be a string`);
  }

  if (path.trim() === '') {
    throw new TypeError(`Field "${fieldName}" cannot be empty`);
  }

  // Validate path security
  return validatePathOrThrow(path);
}

/**
 * Validate request has required fields of correct types.
 * 
 * @param request - Request payload
 * @param schema - Schema defining required fields and types
 * @throws TypeError if validation fails
 * 
 * @example
 * validateRequestSchema(request, {
 *   path: 'string',
 *   recursive: 'boolean'
 * });
 */
export function validateRequestSchema(
  request: unknown,
  schema: Record<string, 'string' | 'number' | 'boolean' | 'object'>
): void {
  if (!request || typeof request !== 'object') {
    throw new TypeError('Request payload must be an object');
  }

  for (const [field, expectedType] of Object.entries(schema)) {
    if (!(field in request)) {
      throw new TypeError(`Request missing required field: ${field}`);
    }

    const value = (request as any)[field];
    const actualType = typeof value;

    if (actualType !== expectedType) {
      throw new TypeError(
        `Field "${field}" must be ${expectedType}, got ${actualType}`
      );
    }
  }
}

/**
 * Wrap handler function with error serialization.
 * 
 * Catches all errors from handler and serializes them for IPC transmission.
 * 
 * @param handler - Handler function to wrap
 * @param channelName - IPC channel name for logging
 * @returns Wrapped handler that catches and serializes errors
 * 
 * @example
 * ipcMain.handle('FS:READ_DIR', withErrorHandling(async (event, request) => {
 *   // Handler code...
 * }, 'FS:READ_DIR'));
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  channelName: string
): T {
  return (async (...args: Parameters<T>) => {
    const startTime = Date.now();

    try {
      IPCLogger.debug(`IPC request received: ${channelName}`, {
        channel: channelName,
      });

      const result = await handler(...args);

      const duration = Date.now() - startTime;
      IPCLogger.debug(`IPC request completed: ${channelName}`, {
        channel: channelName,
        duration_ms: duration,
        success: true,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      IPCLogger.error(`IPC request failed: ${channelName}`, {
        channel: channelName,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      });

      // Serialize error for IPC transmission
      const serialized: SerializedError = ErrorSerializer.serialize(
        error instanceof Error ? error : new Error(String(error))
      );

      // Re-throw serialized error so renderer receives it
      throw serialized;
    }
  }) as T;
}

/**
 * Rate limiter for expensive operations.
 * 
 * Tracks request counts per channel and enforces limits.
 */
class RateLimiter {
  private requestCounts = new Map<string, { count: number; resetTime: number }>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if request should be rate limited.
   * 
   * @param channel - IPC channel name
   * @returns True if request should be allowed
   */
  checkLimit(channel: string): boolean {
    const now = Date.now();

    // Clean up expired entries periodically to prevent memory leak
    // Only clean if Map has grown large (every 100 entries)
    if (this.requestCounts.size > 100 && this.requestCounts.size % 100 === 0) {
      for (const [ch, rec] of this.requestCounts.entries()) {
        if (now > rec.resetTime) {
          this.requestCounts.delete(ch);
        }
      }
    }

    const record = this.requestCounts.get(channel);

    if (!record || now > record.resetTime) {
      // Start new window (and remove old entry if expired)
      if (record && now > record.resetTime) {
        this.requestCounts.delete(channel);
      }
      this.requestCounts.set(channel, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxRequests) {
      SecurityLogger.warn('Rate limit exceeded', {
        channel,
        count: record.count,
        maxRequests: this.maxRequests,
      });
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Reset rate limit for channel.
   * 
   * @param channel - IPC channel name
   */
  reset(channel: string): void {
    this.requestCounts.delete(channel);
  }

  /**
   * Clear all rate limits.
   */
  clear(): void {
    this.requestCounts.clear();
  }
}

/**
 * Global rate limiter instance.
 */
const rateLimiter = new RateLimiter();

/**
 * Check if request should be rate limited.
 * 
 * @param channel - IPC channel name
 * @throws Error if rate limit exceeded
 * 
 * @example
 * checkRateLimit('FS:READ_DIR');
 */
export function checkRateLimit(channel: string): void {
  if (!rateLimiter.checkLimit(channel)) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }
}

/**
 * Reset rate limiter (useful for testing).
 */
export function resetRateLimiter(): void {
  rateLimiter.clear();
}
