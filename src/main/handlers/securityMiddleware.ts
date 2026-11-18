/**
 * securityMiddleware.ts - Security & Contract Middleware for IPC handlers
 *
 * Enforces Zod input contracts, canonical path/symlink validation against
 * ConfigManager allowed roots, rate limiting, RuntimeDiagnostics telemetry,
 * and structured IPCEnvelope serialization.
 */

import type { IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { PathValidator } from '@main/services/PathValidator';
import { ErrorSerializer, SerializedError } from '@main/middleware/ErrorSerializer';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { SecurityLogger, IPCLogger } from '@shared/logging';
import { IPCError, ValidationError } from '@shared/errors';
import {
  IPC_CONTRACTS,
  IPCChannel,
  IPCEnvelope,
  IPCRateLimitPolicy,
  IPCRequest,
  IPCResponse,
  IPCSerializedErrorPayload,
  wrapIPCError,
  wrapIPCSuccess,
} from '@shared/ipc/contracts';

/**
 * Resolve allowed filesystem roots from canonical VaultRootAuthority.
 */
export function resolveAllowedRoots(): string[] {
  return VaultRootAuthority.getInstance().resolveAllowedRoots();
}

/**
 * Get or create canonical path validator synced with VaultRootAuthority.
 */
export function getPathValidator(): PathValidator {
  return VaultRootAuthority.getInstance().getValidator();
}

/**
 * Invalidate cached path validator (used after config changes or in tests).
 */
export function resetPathValidator(): void {
  VaultRootAuthority.getInstance().invalidate();
}

function createPathSecurityError(code: string | undefined, message: string): Error {
  const error = new Error(message) as Error & { code?: string; userMessage?: string };
  error.name = 'SecurityError';
  error.code = code || 'UNAUTHORIZED_ACCESS';
  error.userMessage = message;
  return error;
}

/**
 * Validate path lexically and throw if invalid.
 */
export function validatePathOrThrow(
  requestedPath: string,
  customValidator?: PathValidator
): string {
  const validator = customValidator || getPathValidator();
  const result = validator.validate(requestedPath);

  if (!result.valid) {
    SecurityLogger.error('Path validation failed', {
      path: requestedPath,
      error: result.error,
      details: result.details,
    });

    throw createPathSecurityError(
      result.error,
      result.details || `Invalid path: ${result.error}`
    );
  }

  return requestedPath;
}

/**
 * Validate path both lexically and canonically (resolving symlinks & junctions),
 * returning the canonical resolved path.
 */
export async function validateCanonicalPathOrThrow(
  requestedPath: string,
  customValidator?: PathValidator
): Promise<string> {
  const validator = customValidator || getPathValidator();
  const result = await validator.validateCanonical(requestedPath);

  if (!result.valid) {
    SecurityLogger.error('Canonical path validation failed', {
      path: requestedPath,
      error: result.error,
      details: result.details,
    });

    throw createPathSecurityError(
      result.error,
      result.details || `Invalid path: ${result.error}`
    );
  }

  return result.canonicalPath ?? requestedPath;
}

/**
 * Validate a path whose leaf may legitimately be a symbolic link or NTFS junction
 * (e.g. unlink/move of an in-vault symlink) by verifying its ancestor directory canonically
 * without dereferencing the symlink target itself.
 */
export async function validateParentCanonicalPathOrThrow(
  requestedPath: string,
  customValidator?: PathValidator
): Promise<string> {
  const validator = customValidator || getPathValidator();
  const result = await validator.validateParentCanonicalForLink(requestedPath);

  if (!result.valid) {
    SecurityLogger.error('Link-aware canonical path validation failed', {
      path: requestedPath,
      error: result.error,
      details: result.details,
    });

    throw createPathSecurityError(
      result.error,
      result.details || `Invalid path: ${result.error}`
    );
  }

  return result.canonicalLinkPath ?? requestedPath;
}

/**
 * Validate multiple paths lexically and throw if any are invalid.
 */
export function validatePathsOrThrow(
  paths: string[],
  customValidator?: PathValidator
): string[] {
  return paths.map((entry) => validatePathOrThrow(entry, customValidator));
}

/**
 * Validate request payload has required path property.
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

  const candidatePath = (request as Record<string, unknown>)[fieldName];

  if (typeof candidatePath !== 'string') {
    throw new TypeError(`Field "${fieldName}" must be a string`);
  }

  if (candidatePath.trim() === '') {
    throw new TypeError(`Field "${fieldName}" cannot be empty`);
  }

  return validatePathOrThrow(candidatePath);
}

/**
 * Validate request has required fields of expected primitive types.
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

    const value = (request as Record<string, unknown>)[field];
    const actualType = typeof value;

    if (actualType !== expectedType) {
      throw new TypeError(
        `Field "${field}" must be ${expectedType}, got ${actualType}`
      );
    }
  }
}

/**
 * Serialize any thrown error into a structured IPC payload with preserved error code.
 */
export function serializeIPCError(error: unknown): IPCSerializedErrorPayload {
  const errObj = error instanceof Error ? error : new Error(String(error));
  const serialized = ErrorSerializer.serialize(errObj);
  const errorWithExtras = error as { code?: unknown; userMessage?: unknown } | undefined;

  const code =
    typeof errorWithExtras?.code === 'string' && errorWithExtras.code.length > 0
      ? errorWithExtras.code
      : serialized.code;

  const userMessage =
    typeof errorWithExtras?.userMessage === 'string' && errorWithExtras.userMessage.length > 0
      ? errorWithExtras.userMessage
      : serialized.message;

  return {
    name: serialized.name,
    code,
    message: ErrorSerializer.sanitizeText(serialized.message),
    userMessage: ErrorSerializer.sanitizeText(userMessage),
    isOperational: serialized.isOperational,
    timestamp: serialized.timestamp,
    details: serialized.metadata,
  };
}

/**
 * Validate input against registered contract schema, canonicalize path fields,
 * enforce rate limit, execute handler, record telemetry, and return IPCEnvelope.
 */
async function sanitizeContractFields(
  target: Record<string, unknown>,
  fields: readonly string[],
  validatorFn: (candidate: string) => Promise<string>
): Promise<void> {
  for (const pathField of fields) {
    const candidate = target[pathField];
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      throw new ValidationError(
        'MISSING_REQUIRED_FIELD',
        `Request missing required path field: ${pathField}`,
        { field: pathField }
      );
    }
    target[pathField] = await validatorFn(candidate);
  }
}

export function isAllowedAppRendererUrl(
  rawUrl: string,
  options?: { isDevelopment?: boolean; rendererDir?: string }
): boolean {
  const isDev = options?.isDevelopment ?? process.env.NODE_ENV === 'development';
  const defaultRendererDir =
    path.basename(__dirname) === 'handlers'
      ? path.resolve(__dirname, '../../../dist/renderer')
      : path.resolve(__dirname, '../renderer');
  const rendererDir = options?.rendererDir ?? defaultRendererDir;

  try {
    const parsedUrl = new URL(rawUrl);
    if (isDev) {
      return parsedUrl.origin === 'http://localhost:8080';
    }
    if (parsedUrl.protocol !== 'file:') {
      return false;
    }
    const rendererDirUrl = pathToFileURL(rendererDir).href.toLowerCase();
    const rendererDirPrefix = rendererDirUrl.endsWith('/') ? rendererDirUrl : `${rendererDirUrl}/`;
    const lowerHref = parsedUrl.href.toLowerCase();
    return lowerHref === rendererDirUrl || lowerHref.startsWith(rendererDirPrefix);
  } catch {
    return false;
  }
}

function assertAuthorizedSenderFrame(event: IpcMainInvokeEvent, channel: IPCChannel): void {
  const frameUrl = (event as { senderFrame?: { url?: unknown } } | undefined)?.senderFrame?.url;
  if (typeof frameUrl !== 'string' || frameUrl.length === 0) {
    return;
  }
  if (!isAllowedAppRendererUrl(frameUrl)) {
    SecurityLogger.error('Blocked IPC call from unauthorized sender frame', {
      channel,
      frameUrl,
    });
    throw new IPCError('UNAUTHORIZED_REQUEST', 'IPC sender frame is not an authorized app window', {
      channel,
    });
  }
}

export async function validateAndInvokeContract<C extends IPCChannel>(
  channel: C,
  event: IpcMainInvokeEvent,
  rawRequest: unknown,
  handler: (event: IpcMainInvokeEvent, input: IPCRequest<C>) => Promise<IPCResponse<C>>
): Promise<IPCEnvelope<IPCResponse<C>>> {
  const startTime = Date.now();
  const contract = IPC_CONTRACTS[channel];

  try {
    IPCLogger.debug(`IPC request received: ${channel}`, { channel });
    assertAuthorizedSenderFrame(event, channel);

    const parsed = contract.schema.safeParse(rawRequest);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const fieldPath = firstIssue?.path?.join('.') || 'request';
      const detail = firstIssue?.message || 'Invalid request payload';
      throw new ValidationError(
        'INVALID_INPUT',
        `Invalid IPC payload for ${channel} (${fieldPath}): ${detail}`,
        { field: fieldPath }
      );
    }

    let validatedInput = parsed.data as IPCRequest<C>;

    const linkSafeFields = contract.linkSafePathFields ?? [];
    if ((contract.pathFields.length > 0 || linkSafeFields.length > 0) && validatedInput && typeof validatedInput === 'object') {
      const mutableCopy = { ...(validatedInput as Record<string, unknown>) };
      await sanitizeContractFields(mutableCopy, contract.pathFields, (p) =>
        validateCanonicalPathOrThrow(p)
      );
      await sanitizeContractFields(mutableCopy, linkSafeFields, (p) =>
        validateParentCanonicalPathOrThrow(p)
      );
      validatedInput = mutableCopy as IPCRequest<C>;
    }

    checkRateLimit(channel, contract.rateLimit);

    const data = await handler(event, validatedInput);
    const duration = Date.now() - startTime;

    RuntimeDiagnostics.getInstance().recordIpcCall(channel, duration, true);
    IPCLogger.debug(`IPC request completed: ${channel}`, {
      channel,
      duration_ms: duration,
      success: true,
    });

    return wrapIPCSuccess(data);
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    RuntimeDiagnostics.getInstance().recordIpcCall(channel, duration, false);

    IPCLogger.error(`IPC request failed: ${channel}`, {
      channel,
      duration_ms: duration,
      error: error instanceof Error ? error.message : String(error),
    });

    return wrapIPCError(serializeIPCError(error));
  }
}

/**
 * Wrap an IPC handler with declarative contract validation, canonical path security,
 * telemetry recording, and envelope serialization.
 */
export function withContract<C extends IPCChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, input: IPCRequest<C>) => Promise<IPCResponse<C>>
): (event: IpcMainInvokeEvent, rawRequest?: unknown) => Promise<IPCEnvelope<IPCResponse<C>>> {
  return (event: IpcMainInvokeEvent, rawRequest?: unknown) =>
    validateAndInvokeContract(channel, event, rawRequest, handler);
}

/**
 * Legacy wrapper preserved for backwards compatibility with non-contracted call sites.
 */
export function withErrorHandling<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
  channelName: string
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const startTime = Date.now();

    try {
      IPCLogger.debug(`IPC request received: ${channelName}`, {
        channel: channelName,
      });

      const result = await handler(...args);

      const duration = Date.now() - startTime;
      RuntimeDiagnostics.getInstance().recordIpcCall(channelName, duration, true);
      IPCLogger.debug(`IPC request completed: ${channelName}`, {
        channel: channelName,
        duration_ms: duration,
        success: true,
      });

      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      RuntimeDiagnostics.getInstance().recordIpcCall(channelName, duration, false);

      IPCLogger.error(`IPC request failed: ${channelName}`, {
        channel: channelName,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      });

      const serialized: SerializedError = ErrorSerializer.serialize(
        error instanceof Error ? error : new Error(String(error))
      );

      throw serialized;
    }
  };
}

class RateLimiter {
  private requestCounts = new Map<string, { count: number; resetTime: number }>();
  private readonly defaultWindowMs: number;
  private readonly defaultMaxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.defaultWindowMs = windowMs;
    this.defaultMaxRequests = maxRequests;
  }

  checkLimit(channel: string, policy?: IPCRateLimitPolicy): boolean {
    const now = Date.now();
    const windowMs = policy?.windowMs ?? this.defaultWindowMs;
    const maxRequests = policy?.maxRequests ?? this.defaultMaxRequests;

    if (this.requestCounts.size > 100 && this.requestCounts.size % 100 === 0) {
      for (const [ch, rec] of this.requestCounts.entries()) {
        if (now > rec.resetTime) {
          this.requestCounts.delete(ch);
        }
      }
    }

    const record = this.requestCounts.get(channel);

    if (!record || now > record.resetTime) {
      if (record && now > record.resetTime) {
        this.requestCounts.delete(channel);
      }
      this.requestCounts.set(channel, {
        count: 1,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (record.count >= maxRequests) {
      SecurityLogger.warn('Rate limit exceeded', {
        channel,
        count: record.count,
        maxRequests,
      });
      return false;
    }

    record.count++;
    return true;
  }

  reset(channel: string): void {
    this.requestCounts.delete(channel);
  }

  clear(): void {
    this.requestCounts.clear();
  }
}

const rateLimiter = new RateLimiter();

/**
 * Check if request should be rate limited.
 */
export function checkRateLimit(channel: string, policy?: IPCRateLimitPolicy): void {
  if (!rateLimiter.checkLimit(channel, policy)) {
    throw new IPCError('UNAUTHORIZED_REQUEST', 'Rate limit exceeded. Please try again later.', {
      channel,
    });
  }
}

/**
 * Reset rate limiter (useful for testing).
 */
export function resetRateLimiter(): void {
  rateLimiter.clear();
}
