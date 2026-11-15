import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Windows NTFS transient lock codes emitted by Defender, Windows Search indexer,
 * thumbnail extractors, or overlapping file handles during rename/replace operations.
 */
const WINDOWS_RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

const DEFAULT_RENAME_BACKOFF_MS = [15, 30, 60, 120, 240] as const;

export interface RenameRetryOptions {
  /** Custom delay schedule in ms between retries. */
  backoffMs?: readonly number[];
  /** Override platform check (primarily for deterministic cross-platform tests). */
  platform?: NodeJS.Platform;
  /** Retry even on non-win32 platforms when explicitly requested by tests/callers. */
  forceRetry?: boolean;
  /** Invoked each time a transient lock triggers a retry attempt. */
  onRetry?: (attempt: number, code: string) => void;
}

export interface AtomicWriteOptions extends RenameRetryOptions {
  /** Character encoding for string payloads (default: `'utf-8'`). */
  encoding?: BufferEncoding;
  /** Create missing parent directories prior to writing temp file (default: `false`). */
  ensureDir?: boolean;
}

export function extractFsErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function shouldRetryRenameError(error: unknown, options?: RenameRetryOptions): boolean {
  const code = extractFsErrorCode(error);
  if (!code || !WINDOWS_RETRYABLE_FS_CODES.has(code)) {
    return false;
  }
  const activePlatform = options?.platform ?? process.platform;
  return activePlatform === 'win32' || options?.forceRetry === true;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeUnlinkIgnoreError(targetPath: string): Promise<void> {
  try {
    await fs.unlink(targetPath);
  } catch {
    // Ignore cleanup errors (including ENOENT or auto-mocked Jest functions returning undefined)
  }
}

/**
 * Atomically rename `source` to `destination`, retrying transient Windows NTFS
 * file-sharing lock errors (`EPERM` / `EBUSY` / `EACCES`) with bounded backoff.
 */
export async function renameWithWindowsRetry(
  source: string,
  destination: string,
  options?: RenameRetryOptions
): Promise<void> {
  const schedule = options?.backoffMs ?? DEFAULT_RENAME_BACKOFF_MS;

  for (let attempt = 0; attempt <= schedule.length; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error: unknown) {
      if (attempt >= schedule.length || !shouldRetryRenameError(error, options)) {
        throw error;
      }
      const code = extractFsErrorCode(error) ?? 'UNKNOWN';
      const waitMs = schedule[attempt];
      options?.onRetry?.(attempt + 1, code);
      await delayMs(waitMs);
    }
  }
}

/**
 * Crash-safe atomic file write via sibling temp file + atomic rename.
 * Ensures the original destination file is never left partially truncated
 * if the process terminates or disk/rename errors occur mid-write.
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array,
  options?: AtomicWriteOptions
): Promise<void> {
  if (options?.ensureDir) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
  }

  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    if (typeof data === 'string') {
      await fs.writeFile(tempPath, data, options?.encoding ?? 'utf-8');
    } else {
      await fs.writeFile(tempPath, data);
    }
    await renameWithWindowsRetry(tempPath, targetPath, options);
  } catch (error: unknown) {
    await safeUnlinkIgnoreError(tempPath);
    throw error;
  }
}

/**
 * Synchronous crash-safe atomic file write for config initialization/persistence.
 */
export function atomicWriteFileSync(
  targetPath: string,
  data: string,
  encoding: BufferEncoding = 'utf-8'
): void {
  const dir = path.dirname(targetPath);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    fsSync.writeFileSync(tempPath, data, encoding);
    fsSync.renameSync(tempPath, targetPath);
  } catch (error: unknown) {
    try {
      if (fsSync.existsSync(tempPath)) {
        fsSync.unlinkSync(tempPath);
      }
    } catch {
      // Ignore secondary cleanup error
    }
    throw error;
  }
}
