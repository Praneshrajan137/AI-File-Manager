import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  FileDeleteMode,
  OperationJournalState,
  OperationRecord,
  TrashVaultEntry,
  UndoRedoResult,
} from '@shared/contracts';
import { resolveDefaultTrashVaultDir as resolveSharedTrashVaultDir } from '@shared/config';
import { CanonicalValidationContext, PathValidator } from './PathValidator';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { FileSystemService } from './FileSystemService';
import { getReactiveWorkspaceKernel, hasActiveReactiveWorkspaceKernel } from './ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { atomicWriteFile, renameWithWindowsRetry } from '@shared/utils/atomicFs';
import { ErrorFactory } from '@shared/errors';
import { FileSystemLogger } from '@shared/logging';

const DEFAULT_MAX_HISTORY = 20;
const DEFAULT_MAX_VAULT_BYTES = 512 * 1024 * 1024; // 512 MB
const DEFAULT_MAX_VAULT_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days TTL

interface PersistedJournalData {
  undoStack: OperationRecord[];
  redoStack: OperationRecord[];
}

export type BatchOperationStep =
  | { type: 'move' | 'rename'; source: string; destination: string }
  | { type: 'copy'; source: string; destination: string }
  | { type: 'delete'; path: string; recursive?: boolean; mode?: FileDeleteMode }
  | { type: 'create_dir'; path: string }
  | { type: 'edit_links'; filePath: string; previousContent: string; nextContent: string };

export interface OperationJournalOptions {
  vaultDir?: string;
  maxHistory?: number;
  maxVaultBytes?: number;
  maxVaultAgeMs?: number;
  validator: PathValidator;
  fileSystemService: FileSystemService;
  osTrashFn?: (targetPath: string) => Promise<void>;
  onSuppressWatchPaths?: (paths: string[], ttlMs?: number) => void;
}

export interface BatchRollbackFailureDetail {
  stepId: string;
  description: string;
  error: string;
}

export class BatchRollbackError extends Error {
  readonly originalError: unknown;
  readonly rollbackFailures: BatchRollbackFailureDetail[];

  constructor(
    message: string,
    originalError: unknown,
    rollbackFailures: BatchRollbackFailureDetail[]
  ) {
    super(message);
    this.name = 'BatchRollbackError';
    this.originalError = originalError;
    this.rollbackFailures = rollbackFailures;
  }
}

interface WalPendingState {
  batchId: string;
  description: string;
  status: 'pending' | 'rollback_failed';
  startedAt: number;
  completed: OperationRecord[];
  failureReason?: string;
  rollbackFailures?: BatchRollbackFailureDetail[];
}

export function resolveDefaultTrashVaultDir(): string {
  return resolveSharedTrashVaultDir();
}

function getFsErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * OperationJournal - Transactional 20-step Undo/Redo ledger + Staging Recycle Vault.
 *
 * Replaces destructive bare `fs.rm` deletes with atomic reversible staging
 * across Windows, OneDrive sync folders, macOS, and Linux tmpfs, supporting:
 * - Symlink-safe unlinking & link-only moves (never dereferences external targets)
 * - Atomic multi-step `'batch'` group transactions with reverse rollback & 1-click Undo
 * - 512 MB size cap + 30-day automatic payload TTL eviction
 */
export class OperationJournal {
  private readonly vaultDir: string;
  private readonly payloadsDir: string;
  private readonly journalFile: string;
  private readonly walFile: string;
  private readonly walJournalFile: string;
  private readonly maxHistory: number;
  private readonly maxVaultBytes: number;
  private readonly maxVaultAgeMs: number;
  private readonly fileSystemService: FileSystemService;
  private readonly osTrashFn: (targetPath: string) => Promise<void>;
  private readonly onSuppressWatchPaths?: (paths: string[], ttlMs?: number) => void;
  private validator: PathValidator;

  private undoStack: OperationRecord[] = [];
  private redoStack: OperationRecord[] = [];
  private initialized = false;
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(options: OperationJournalOptions) {
    this.vaultDir = path.resolve(options.vaultDir ?? resolveDefaultTrashVaultDir());
    this.payloadsDir = path.join(this.vaultDir, 'payloads');
    this.journalFile = path.join(this.vaultDir, 'journal.json');
    this.walFile = path.join(this.vaultDir, 'wal-pending.json');
    this.walJournalFile = path.join(this.vaultDir, 'wal-pending.jsonl');
    this.maxHistory = Math.max(10, options.maxHistory ?? DEFAULT_MAX_HISTORY);
    this.maxVaultBytes = options.maxVaultBytes ?? DEFAULT_MAX_VAULT_BYTES;
    this.maxVaultAgeMs = options.maxVaultAgeMs ?? DEFAULT_MAX_VAULT_AGE_MS;
    this.validator = options.validator;
    this.fileSystemService = options.fileSystemService;
    this.osTrashFn = options.osTrashFn ?? OperationJournal.defaultOsTrash;
    this.onSuppressWatchPaths = options.onSuppressWatchPaths;
  }

  private static async defaultOsTrash(targetPath: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronModule = require('electron') as {
      shell?: { trashItem?: (p: string) => Promise<void> };
    };
    const trashItem = electronModule?.shell?.trashItem;
    if (typeof trashItem !== 'function') {
      throw new Error('OS Recycle Bin / Trash API unavailable in current runtime');
    }
    await trashItem(targetPath);
  }

  updateValidator(validator: PathValidator): void {
    this.validator = validator;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opChain.then(fn, fn);
    this.opChain = next.catch(() => undefined);
    return next;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(this.payloadsDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.journalFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedJournalData>;
      this.undoStack = Array.isArray(parsed.undoStack) ? parsed.undoStack : [];
      this.redoStack = Array.isArray(parsed.redoStack) ? parsed.redoStack : [];
    } catch (error: unknown) {
      if (getFsErrorCode(error) !== 'ENOENT') {
        FileSystemLogger.warn('Failed to parse operation journal, starting clean', {
          journalFile: this.journalFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.undoStack = [];
      this.redoStack = [];
    }

    const recoveredWal = await this.recoverPendingWal();
    const evictedAny = await this.evictExpiredRecords();
    this.initialized = true;
    if (evictedAny || recoveredWal) {
      await this.persist();
    }
  }

  private suppressWatchPathsForStep(paths: Array<string | undefined>, ttlMs: number = 1500): void {
    const clean = paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    if (clean.length === 0) {
      return;
    }
    this.onSuppressWatchPaths?.(clean, ttlMs);
    if (hasActiveReactiveWorkspaceKernel()) {
      getReactiveWorkspaceKernel().suppressPaths(clean, ttlMs);
    }
  }

  private async writeWalState(state: WalPendingState, targetFile: string = this.walFile): Promise<void> {
    await atomicWriteFile(targetFile, JSON.stringify(state, null, 2), { ensureDir: true });
  }

  private async removeWalFileIgnoreEnoent(): Promise<void> {
    for (const target of [this.walJournalFile, this.walFile]) {
      try {
        await fs.unlink(target);
      } catch (error: unknown) {
        if (getFsErrorCode(error) !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  private async rollbackCompletedStepsUnlocked(
    completed: OperationRecord[]
  ): Promise<{
    rollbackFailures: BatchRollbackFailureDetail[];
    remainingRecords: OperationRecord[];
  }> {
    const rollbackFailures: BatchRollbackFailureDetail[] = [];
    const remainingRecords: OperationRecord[] = [];
    const diagnostics = RuntimeDiagnostics.getInstance();
    const validatorCtx = await this.validator.createCanonicalContext();
    const fsCtx = await this.fileSystemService.createCanonicalContext();

    for (const child of [...completed].reverse()) {
      this.suppressWatchPathsForStep([child.sourcePath, child.destinationPath]);
      try {
        await this.undoSingleRecordUnlocked(child, validatorCtx, fsCtx);
      } catch (rbErr: unknown) {
        diagnostics.recordWalRollbackFailure();
        const detail = rbErr instanceof Error ? rbErr.message : String(rbErr);
        rollbackFailures.push({
          stepId: child.id,
          description: child.description,
          error: detail,
        });
        remainingRecords.unshift(child);
      }
    }

    return { rollbackFailures, remainingRecords };
  }

  private parseNdjsonWal(raw: string): Partial<WalPendingState> | null {
    const lines = raw.split(/\r?\n/);
    interface WalHeaderLine {
      batchId?: string;
      description?: string;
      status?: string;
      startedAt?: number;
    }
    let header: WalHeaderLine | null = null;
    const completed: OperationRecord[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        // Incomplete trailing line from mid-write crash stops cleanly after recovering prior committed lines
        if (!header) {
          throw new Error('Corrupt NDJSON WAL header line');
        }
        break;
      }

      if (parsed.type === 'header') {
        header = parsed as WalHeaderLine;
      } else if (parsed.type === 'step' && parsed.record && typeof parsed.record === 'object') {
        completed.push(parsed.record as OperationRecord);
      }
    }

    if (!header) {
      return null;
    }
    return {
      batchId: header.batchId,
      description: header.description,
      status: header.status === 'pending' ? 'pending' : 'rollback_failed',
      startedAt: header.startedAt,
      completed,
    };
  }

  private async recoverSingleWalPayload(wal: Partial<WalPendingState>): Promise<boolean> {
    if (wal.status !== 'pending') {
      return false;
    }

    const completed = Array.isArray(wal.completed) ? wal.completed : [];
    const diagnostics = RuntimeDiagnostics.getInstance();
    const { rollbackFailures, remainingRecords } =
      await this.rollbackCompletedStepsUnlocked(completed);

    diagnostics.recordWalRecovery();

    if (rollbackFailures.length > 0) {
      const failedFile = path.join(this.vaultDir, `wal-failed-${wal.batchId ?? 'recovery'}.json`);
      await this.writeWalState(
        {
          batchId: wal.batchId ?? randomUUID(),
          description: wal.description ?? 'Interrupted batch',
          status: 'rollback_failed',
          startedAt: wal.startedAt ?? Date.now(),
          completed: remainingRecords,
          failureReason: 'Incomplete crash-recovery rollback',
          rollbackFailures,
        },
        failedFile
      );
      FileSystemLogger.error('WAL crash recovery finished with partial rollback failures', {
        failedFile,
        rollbackFailures,
      });
    } else {
      FileSystemLogger.warn('Recovered interrupted batch transaction from pending WAL', {
        batchId: wal.batchId,
        revertedSteps: completed.length,
      });
    }

    return true;
  }

  private async recoverPendingWal(): Promise<boolean> {
    let recoveredAny = false;

    // 1. Recover fast append-only NDJSON WAL (`wal-pending.jsonl`) if present
    try {
      const rawJsonl = await fs.readFile(this.walJournalFile, 'utf-8');
      const wal = this.parseNdjsonWal(rawJsonl);
      if (wal && (await this.recoverSingleWalPayload(wal))) {
        recoveredAny = true;
      }
    } catch (error: unknown) {
      if (getFsErrorCode(error) !== 'ENOENT') {
        FileSystemLogger.error('Corrupt pending NDJSON WAL encountered during startup recovery', {
          walFile: this.walJournalFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. Recover legacy full-state WAL (`wal-pending.json`) if present
    try {
      const raw = await fs.readFile(this.walFile, 'utf-8');
      const wal = JSON.parse(raw) as Partial<WalPendingState>;
      if (await this.recoverSingleWalPayload(wal)) {
        recoveredAny = true;
      }
    } catch (error: unknown) {
      if (getFsErrorCode(error) !== 'ENOENT') {
        FileSystemLogger.error('Corrupt pending WAL file encountered during startup recovery', {
          walFile: this.walFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.removeWalFileIgnoreEnoent().catch(() => undefined);
    return recoveredAny;
  }

  private async evictExpiredRecords(): Promise<boolean> {
    if (this.maxVaultAgeMs <= 0) {
      return false;
    }
    const cutoff = Date.now() - this.maxVaultAgeMs;
    let changed = false;

    const filterExpired = async (stack: OperationRecord[]): Promise<OperationRecord[]> => {
      const kept: OperationRecord[] = [];
      for (const record of stack) {
        if (record.timestamp < cutoff) {
          await this.removeRecordPayloads(record);
          changed = true;
        } else {
          kept.push(record);
        }
      }
      return kept;
    };

    this.undoStack = await filterExpired(this.undoStack);
    this.redoStack = await filterExpired(this.redoStack);
    return changed;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.payloadsDir, { recursive: true });
    const payload: PersistedJournalData = {
      undoStack: this.undoStack,
      redoStack: this.redoStack,
    };
    await atomicWriteFile(this.journalFile, JSON.stringify(payload, null, 2), { ensureDir: true });
  }

  private toValidationError(
    targetPath: string,
    errorCode: string | undefined,
    details?: string
  ): Error {
    const code =
      errorCode === 'SYMLINK_ESCAPE'
        ? 'UNAUTHORIZED_ACCESS'
        : ((errorCode as 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'INVALID_PATH') || 'UNAUTHORIZED_ACCESS');
    return ErrorFactory.createFileSystemError(code, targetPath, undefined, { details });
  }

  private async validateCanonicalOrThrow(
    targetPath: string,
    canonicalContext?: CanonicalValidationContext
  ): Promise<string> {
    const check = canonicalContext
      ? await this.validator.validateCanonicalWithContext(targetPath, canonicalContext)
      : await this.validator.validateCanonical(targetPath);
    if (!check.valid) {
      throw this.toValidationError(targetPath, check.error, check.details);
    }
    return check.canonicalPath ?? path.resolve(targetPath);
  }

  private async resolveLinkAwareTarget(
    targetPath: string,
    canonicalContext?: CanonicalValidationContext
  ): Promise<{
    resolvedPath: string;
    isSymlink: boolean;
    lstatInfo: Awaited<ReturnType<typeof fs.lstat>>;
  }> {
    const lexical = this.validator.validate(targetPath);
    if (!lexical.valid) {
      throw this.toValidationError(targetPath, lexical.error, lexical.details);
    }

    const absPath = path.resolve(targetPath);
    let lstatInfo: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      lstatInfo = await fs.lstat(absPath);
    } catch (error: unknown) {
      throw ErrorFactory.fromFsError(error, targetPath);
    }

    if (lstatInfo.isSymbolicLink()) {
      const parentCheck = await this.validator.validateParentCanonicalForLink(targetPath);
      if (!parentCheck.valid || !parentCheck.canonicalLinkPath) {
        throw this.toValidationError(targetPath, parentCheck.error, parentCheck.details);
      }
      return {
        resolvedPath: parentCheck.canonicalLinkPath,
        isSymlink: true,
        lstatInfo,
      };
    }

    const canonicalPath = await this.validateCanonicalOrThrow(targetPath, canonicalContext);
    return { resolvedPath: canonicalPath, isSymlink: false, lstatInfo };
  }

  private async computeEntrySize(targetPath: string): Promise<number> {
    const stats = await fs.lstat(targetPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return stats.size;
    }

    let total = 0;
    const stack: string[] = [targetPath];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          stack.push(full);
        } else {
          const st = await fs.lstat(full).catch(() => null);
          if (st) {
            total += st.size;
          }
        }
      }
    }
    return total;
  }

  private countRecordVaultBytes(record: OperationRecord): number {
    let total = record.vaultPayloadPath ? record.size : 0;
    if (record.children) {
      for (const child of record.children) {
        total += this.countRecordVaultBytes(child);
      }
    }
    return total;
  }

  private hasVaultPayload(record: OperationRecord): boolean {
    if (record.vaultPayloadPath || (record.type === 'delete' && record.isSymlink)) {
      return true;
    }
    return Boolean(record.children?.some((child) => this.hasVaultPayload(child)));
  }

  private collectDeleteVaultItems(records: OperationRecord[]): OperationRecord[] {
    const items: OperationRecord[] = [];
    for (const op of records) {
      if (op.type === 'delete' && op.vaultPayloadPath) {
        items.push(op);
      }
      if (op.children) {
        items.push(...this.collectDeleteVaultItems(op.children));
      }
    }
    return items;
  }

  private currentVaultBytes(): number {
    let total = 0;
    for (const op of this.undoStack) {
      total += this.countRecordVaultBytes(op);
    }
    for (const op of this.redoStack) {
      total += this.countRecordVaultBytes(op);
    }
    return total;
  }

  private async removePayload(payloadPath?: string): Promise<void> {
    if (!payloadPath) {
      return;
    }
    await fs.rm(payloadPath, { recursive: true, force: true }).catch(() => undefined);
  }

  private async removeRecordPayloads(record: OperationRecord): Promise<void> {
    await this.removePayload(record.vaultPayloadPath);
    if (record.children) {
      for (const child of record.children) {
        await this.removeRecordPayloads(child);
      }
    }
  }

  private async pushUndoRecord(record: OperationRecord): Promise<void> {
    for (const stale of this.redoStack) {
      await this.removeRecordPayloads(stale);
    }
    this.redoStack = [];
    this.undoStack.push(record);

    while (this.undoStack.length > this.maxHistory) {
      const evicted = this.undoStack.shift();
      if (evicted) {
        await this.removeRecordPayloads(evicted);
      }
    }

    while (this.currentVaultBytes() > this.maxVaultBytes && this.undoStack.length > 1) {
      const oldestWithPayloadIdx = this.undoStack.findIndex(
        (op, idx) => this.hasVaultPayload(op) && idx < this.undoStack.length - 1
      );
      if (oldestWithPayloadIdx === -1) {
        break;
      }
      const [evicted] = this.undoStack.splice(oldestWithPayloadIdx, 1);
      await this.removeRecordPayloads(evicted);
    }

    await this.persist();
  }

  private async movePathAtomicOrCrossDevice(
    sourcePath: string,
    destinationPath: string,
    isDirectory: boolean
  ): Promise<void> {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error: unknown) {
      if (getFsErrorCode(error) !== 'EXDEV') {
        throw error;
      }
      if (isDirectory) {
        await fs.cp(sourcePath, destinationPath, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
        await fs.rm(sourcePath, { recursive: true, force: true });
      } else {
        await fs.copyFile(sourcePath, destinationPath);
        await fs.unlink(sourcePath);
      }
    }
  }

  private async performSingleDeleteUnlocked(
    requestedPath: string,
    recursive: boolean,
    mode: FileDeleteMode
  ): Promise<{ success: boolean; mode: FileDeleteMode; operationId?: string; record?: OperationRecord }> {
    const { resolvedPath, isSymlink, lstatInfo } = await this.resolveLinkAwareTarget(requestedPath);
    const isDirectory = isSymlink ? false : lstatInfo.isDirectory();

    if (isDirectory && !recursive) {
      throw ErrorFactory.createFileSystemError(
        'UNKNOWN',
        requestedPath,
        undefined,
        { details: 'Directory deletion requires recursive=true' }
      );
    }

    if (isSymlink) {
      if (mode === 'permanent') {
        await fs.unlink(resolvedPath);
        this.fileSystemService.invalidatePath(resolvedPath);
        return { success: true, mode };
      }

      if (mode === 'trash') {
        try {
          await this.osTrashFn(resolvedPath);
        } catch {
          await fs.unlink(resolvedPath);
        }
        this.fileSystemService.invalidatePath(resolvedPath);
        return { success: true, mode };
      }

      const symlinkTarget = await fs.readlink(resolvedPath);
      await fs.unlink(resolvedPath);
      this.fileSystemService.invalidatePath(resolvedPath);

      const id = randomUUID();
      const entryBase = path.basename(resolvedPath);
      const record: OperationRecord = {
        id,
        type: 'delete',
        timestamp: Date.now(),
        sourcePath: resolvedPath,
        isDirectory: false,
        isSymlink: true,
        symlinkTarget,
        size: 0,
        undoable: true,
        mode: 'vault',
        description: `Delete symlink ${entryBase}`,
      };
      return { success: true, mode: 'vault', operationId: id, record };
    }

    if (mode === 'permanent') {
      await fs.rm(resolvedPath, { recursive, force: true });
      this.fileSystemService.invalidatePath(resolvedPath);
      return { success: true, mode };
    }

    if (mode === 'trash') {
      await this.osTrashFn(resolvedPath);
      this.fileSystemService.invalidatePath(resolvedPath);
      return { success: true, mode };
    }

    const entrySize = await this.computeEntrySize(resolvedPath);
    if (entrySize > this.maxVaultBytes) {
      throw ErrorFactory.createFileSystemError(
        'DISK_FULL',
        requestedPath,
        undefined,
        {
          details: `Entry size (${entrySize} bytes) exceeds Trash Vault capacity (${this.maxVaultBytes} bytes). Use OS Trash or Permanent Delete.`,
        }
      );
    }

    const id = randomUUID();
    const entryBase = path.basename(resolvedPath);
    const vaultPayloadPath = path.join(this.payloadsDir, `${id}-${entryBase}`);

    await this.movePathAtomicOrCrossDevice(resolvedPath, vaultPayloadPath, isDirectory);
    this.fileSystemService.invalidatePath(resolvedPath);

    const record: OperationRecord = {
      id,
      type: 'delete',
      timestamp: Date.now(),
      sourcePath: resolvedPath,
      vaultPayloadPath,
      isDirectory,
      isSymlink: false,
      size: entrySize,
      undoable: true,
      mode: 'vault',
      description: `Delete ${entryBase}`,
    };

    return { success: true, mode: 'vault', operationId: id, record };
  }

  private async performSingleMoveUnlocked(
    source: string,
    destination: string,
    opType: 'move' | 'rename',
    validatorContext?: CanonicalValidationContext,
    fsContext?: CanonicalValidationContext
  ): Promise<{ success: boolean; newPath: string; operationId: string; record: OperationRecord }> {
    const { resolvedPath: resolvedSource, isSymlink, lstatInfo } = await this.resolveLinkAwareTarget(
      source,
      validatorContext
    );
    const canonicalDest = await this.validateCanonicalOrThrow(destination, validatorContext);

    let result: { success: boolean; newPath: string };
    if (isSymlink) {
      await fs.mkdir(path.dirname(canonicalDest), { recursive: true });
      await fs.rename(resolvedSource, canonicalDest);
      this.fileSystemService.invalidatePath(resolvedSource);
      this.fileSystemService.invalidatePath(canonicalDest);
      result = { success: true, newPath: canonicalDest };
    } else {
      result = await this.fileSystemService.move(resolvedSource, canonicalDest, fsContext);
    }

    const id = randomUUID();
    const baseSrc = path.basename(resolvedSource);
    const baseDst = path.basename(result.newPath);

    const record: OperationRecord = {
      id,
      type: opType,
      timestamp: Date.now(),
      sourcePath: resolvedSource,
      destinationPath: result.newPath,
      isDirectory: isSymlink ? false : lstatInfo.isDirectory(),
      isSymlink,
      size: Number(lstatInfo.size),
      undoable: true,
      description:
        opType === 'rename'
          ? `Rename ${baseSrc} -> ${baseDst}`
          : `Move ${baseSrc} -> ${baseDst}`,
    };

    return { ...result, operationId: id, record };
  }

  private async performSingleCopyUnlocked(
    source: string,
    destination: string
  ): Promise<{ success: boolean; copiedPath: string; operationId: string; record: OperationRecord }> {
    const { resolvedPath: resolvedSource, isSymlink, lstatInfo } = await this.resolveLinkAwareTarget(source);
    const canonicalDest = await this.validateCanonicalOrThrow(destination);

    const result = await this.fileSystemService.copy(resolvedSource, canonicalDest);
    const entrySize = isSymlink ? 0 : await this.computeEntrySize(result.copiedPath);
    const id = randomUUID();
    const baseSrc = path.basename(resolvedSource);
    const baseDst = path.basename(result.copiedPath);

    const record: OperationRecord = {
      id,
      type: 'copy',
      timestamp: Date.now(),
      sourcePath: resolvedSource,
      destinationPath: result.copiedPath,
      isDirectory: isSymlink ? false : lstatInfo.isDirectory(),
      isSymlink,
      size: entrySize,
      undoable: true,
      description: `Copy ${baseSrc} -> ${baseDst}`,
    };

    return { ...result, operationId: id, record };
  }

  private async performSingleEditLinksUnlocked(
    filePath: string,
    previousContent: string,
    nextContent: string
  ): Promise<{ record: OperationRecord }> {
    const canonicalTarget = await this.validateCanonicalOrThrow(filePath);
    await this.fileSystemService.writeFile(canonicalTarget, nextContent);

    const id = randomUUID();
    const record: OperationRecord = {
      id,
      type: 'edit_links',
      timestamp: Date.now(),
      sourcePath: canonicalTarget,
      previousContent,
      nextContent,
      isDirectory: false,
      size: Buffer.byteLength(nextContent, 'utf-8'),
      undoable: true,
      description: `Repair links in ${path.basename(canonicalTarget)}`,
    };
    return { record };
  }

  async copy(
    source: string,
    destination: string
  ): Promise<{ success: boolean; copiedPath: string; operationId: string }> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      this.suppressWatchPathsForStep([source, destination]);
      const outcome = await this.performSingleCopyUnlocked(source, destination);
      await this.pushUndoRecord(outcome.record);
      return {
        success: outcome.success,
        copiedPath: outcome.copiedPath,
        operationId: outcome.operationId,
      };
    });
  }

  async delete(
    requestedPath: string,
    recursive: boolean = true,
    mode: FileDeleteMode = 'vault'
  ): Promise<{ success: boolean; mode: FileDeleteMode; operationId?: string }> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      this.suppressWatchPathsForStep([requestedPath]);
      const outcome = await this.performSingleDeleteUnlocked(requestedPath, recursive, mode);
      if (outcome.record) {
        await this.pushUndoRecord(outcome.record);
      }
      return {
        success: outcome.success,
        mode: outcome.mode,
        operationId: outcome.operationId,
      };
    });
  }

  async move(
    source: string,
    destination: string,
    opType: 'move' | 'rename' = 'move'
  ): Promise<{ success: boolean; newPath: string; operationId: string }> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      this.suppressWatchPathsForStep([source, destination]);
      const outcome = await this.performSingleMoveUnlocked(source, destination, opType);
      await this.pushUndoRecord(outcome.record);
      return {
        success: outcome.success,
        newPath: outcome.newPath,
        operationId: outcome.operationId,
      };
    });
  }

  private normalizeDisjointKey(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private areDisjointMovePairs(pairs: ReadonlyArray<{ src: string; dst: string }>): boolean {
    if (pairs.length <= 8) {
      return false;
    }
    const allEndpoints = new Set<string>();
    for (const pair of pairs) {
      const sKey = this.normalizeDisjointKey(pair.src);
      const dKey = this.normalizeDisjointKey(pair.dst);
      if (sKey === dKey || allEndpoints.has(sKey) || allEndpoints.has(dKey)) {
        return false;
      }
      allEndpoints.add(sKey);
      allEndpoints.add(dKey);
    }

    for (const pair of pairs) {
      for (const endpoint of [pair.src, pair.dst]) {
        let cur = path.dirname(path.resolve(endpoint));
        for (let depth = 0; depth < 32; depth += 1) {
          if (allEndpoints.has(this.normalizeDisjointKey(cur))) {
            return false;
          }
          const parent = path.dirname(cur);
          if (parent === cur) break;
          cur = parent;
        }
      }
    }
    return true;
  }

  /**
   * Execute multiple move/rename/delete operations as a single atomic journal entry.
   * Rolls back all completed child steps in reverse order if any step fails.
   */
  async executeBatch(
    description: string,
    steps: BatchOperationStep[]
  ): Promise<{ success: boolean; operation: OperationRecord; state: OperationJournalState }> {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw ErrorFactory.createValidationError(
        'INVALID_INPUT',
        'steps',
        steps,
        'Batch steps cannot be empty'
      );
    }

    return this.serialize(async () => {
      await this.ensureInitialized();
      const batchId = randomUUID();
      const startedAt = Date.now();
      const completed: OperationRecord[] = [];
      let totalSize = 0;

      const headerLine = `${JSON.stringify({
        type: 'header',
        batchId,
        description,
        status: 'pending',
        startedAt,
      })}\n`;
      await atomicWriteFile(this.walJournalFile, headerLine, { ensureDir: true });

      const walHandle = await fs.open(this.walJournalFile, 'a');
      let walWriteChain: Promise<unknown> = Promise.resolve();
      const appendWalStep = (record: OperationRecord): Promise<void> => {
        const line = `${JSON.stringify({ type: 'step', record })}\n`;
        const next = walWriteChain.then(() => walHandle.write(line, undefined, 'utf-8'));
        walWriteChain = next.catch(() => undefined);
        return next.then(() => undefined);
      };
      const closeWalHandle = async (): Promise<void> => {
        await walWriteChain.catch(() => undefined);
        await walHandle.close().catch(() => undefined);
      };

      const validatorCtx = await this.validator.createCanonicalContext();
      const fsCtx = await this.fileSystemService.createCanonicalContext();

      try {
        let idx = 0;
        while (idx < steps.length) {
          const step = steps[idx];
          if (step.type === 'move' || step.type === 'rename') {
            // Collect contiguous move/rename slice and run disjoint bulk moves concurrently
            let endIdx = idx + 1;
            while (
              endIdx < steps.length &&
              (steps[endIdx].type === 'move' || steps[endIdx].type === 'rename')
            ) {
              endIdx += 1;
            }
            const slice = steps.slice(idx, endIdx) as Array<
              Extract<BatchOperationStep, { type: 'move' | 'rename' }>
            >;
            const disjoint = this.areDisjointMovePairs(
              slice.map((s) => ({ src: s.source, dst: s.destination }))
            );

            if (disjoint) {
              const MOVE_WAVE_SIZE = 8;
              for (let waveStart = 0; waveStart < slice.length; waveStart += MOVE_WAVE_SIZE) {
                const wave = slice.slice(waveStart, waveStart + MOVE_WAVE_SIZE);
                const settled = await Promise.allSettled(
                  wave.map(async (s) => {
                    this.suppressWatchPathsForStep([s.source, s.destination]);
                    return this.performSingleMoveUnlocked(
                      s.source,
                      s.destination,
                      s.type,
                      validatorCtx,
                      fsCtx
                    );
                  })
                );

                let firstWaveError: unknown = null;
                let waveChunk = '';
                for (const outcome of settled) {
                  if (outcome.status === 'fulfilled') {
                    const rec = outcome.value.record;
                    completed.push(rec);
                    totalSize += rec.size;
                    waveChunk += `${JSON.stringify({ type: 'step', record: rec })}\n`;
                  } else if (firstWaveError === null) {
                    firstWaveError = outcome.reason;
                  }
                }

                if (waveChunk.length > 0) {
                  const nextWrite = walWriteChain.then(() =>
                    walHandle.write(waveChunk, undefined, 'utf-8')
                  );
                  walWriteChain = nextWrite.catch(() => undefined);
                  await nextWrite;
                }

                if (firstWaveError !== null) {
                  throw firstWaveError;
                }
              }
              idx = endIdx;
              continue;
            }

            for (const s of slice) {
              this.suppressWatchPathsForStep([s.source, s.destination]);
              const res = await this.performSingleMoveUnlocked(
                s.source,
                s.destination,
                s.type,
                validatorCtx,
                fsCtx
              );
              completed.push(res.record);
              totalSize += res.record.size;
              await appendWalStep(res.record);
            }
            idx = endIdx;
            continue;
          }

          if (step.type === 'delete') {
            this.suppressWatchPathsForStep([step.path]);
            const mode = step.mode ?? 'vault';
            const res = await this.performSingleDeleteUnlocked(
              step.path,
              step.recursive ?? true,
              mode
            );
            if (res.record) {
              completed.push(res.record);
              totalSize += res.record.size;
              await appendWalStep(res.record);
            }
          } else if (step.type === 'create_dir') {
            this.suppressWatchPathsForStep([step.path]);
            const canonicalDir = await this.validateCanonicalOrThrow(step.path, validatorCtx);
            if (!(await this.pathExists(canonicalDir))) {
              await this.fileSystemService.createDirectory(canonicalDir);
              const dirRec: OperationRecord = {
                id: randomUUID(),
                type: 'create_dir',
                timestamp: Date.now(),
                sourcePath: canonicalDir,
                isDirectory: true,
                size: 0,
                undoable: true,
                description: `Create folder ${path.basename(canonicalDir)}`,
              };
              completed.push(dirRec);
              await appendWalStep(dirRec);
            }
          } else if (step.type === 'copy') {
            this.suppressWatchPathsForStep([step.source, step.destination]);
            const res = await this.performSingleCopyUnlocked(step.source, step.destination);
            completed.push(res.record);
            totalSize += res.record.size;
            await appendWalStep(res.record);
          } else if (step.type === 'edit_links') {
            this.suppressWatchPathsForStep([step.filePath]);
            const res = await this.performSingleEditLinksUnlocked(
              step.filePath,
              step.previousContent,
              step.nextContent
            );
            completed.push(res.record);
            await appendWalStep(res.record);
          }
          idx += 1;
        }
      } catch (err) {
        await closeWalHandle();
        const { rollbackFailures, remainingRecords } =
          await this.rollbackCompletedStepsUnlocked(completed);

        if (rollbackFailures.length > 0) {
          const origMsg = err instanceof Error ? err.message : String(err);
          const failedFile = path.join(this.vaultDir, `wal-failed-${batchId}.json`);
          await this.writeWalState(
            {
              batchId,
              description,
              status: 'rollback_failed',
              startedAt,
              completed: remainingRecords,
              failureReason: origMsg,
              rollbackFailures,
            },
            failedFile
          ).catch(() => undefined);
          await this.removeWalFileIgnoreEnoent().catch(() => undefined);

          FileSystemLogger.error('Batch execution & reverse rollback both encountered failures', {
            batchId,
            description,
            originalError: origMsg,
            rollbackFailures,
            failedFile,
          });
          throw new BatchRollbackError(
            `Batch "${description}" failed (${origMsg}) and ${rollbackFailures.length} rollback step(s) also failed`,
            err,
            rollbackFailures
          );
        }

        await this.removeWalFileIgnoreEnoent();
        throw err;
      }

      await closeWalHandle();

      const batchRecord: OperationRecord = {
        id: batchId,
        type: 'batch',
        timestamp: Date.now(),
        sourcePath: completed[0]?.sourcePath ?? '',
        isDirectory: false,
        size: totalSize,
        undoable: completed.length > 0 && completed.every((c) => c.undoable),
        children: completed,
        description,
      };

      await this.pushUndoRecord(batchRecord);
      await this.removeWalFileIgnoreEnoent();
      return {
        success: true,
        operation: batchRecord,
        state: this.buildStateSnapshot(),
      };
    });
  }

  async recordCreation(
    createdPath: string,
    isDirectory: boolean,
    size: number = 0
  ): Promise<string> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const canonicalPath = await this.validateCanonicalOrThrow(createdPath);
      const id = randomUUID();
      const base = path.basename(canonicalPath);

      await this.pushUndoRecord({
        id,
        type: isDirectory ? 'create_dir' : 'create_file',
        timestamp: Date.now(),
        sourcePath: canonicalPath,
        isDirectory,
        size,
        undoable: true,
        description: isDirectory ? `Create folder ${base}` : `Create file ${base}`,
      });

      return id;
    });
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.lstat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async undoSingleRecordUnlocked(
    record: OperationRecord,
    validatorContext?: CanonicalValidationContext,
    fsContext?: CanonicalValidationContext
  ): Promise<{ updatedRecord: OperationRecord; restoredPath: string }> {
    if (record.type === 'batch') {
      const childrenReversed = [...(record.children ?? [])].reverse();
      const reversedUpdated = new Array<OperationRecord>(childrenReversed.length);
      const batchValidatorCtx = validatorContext ?? (await this.validator.createCanonicalContext());
      const batchFsCtx = fsContext ?? (await this.fileSystemService.createCanonicalContext());

      let idx = 0;
      while (idx < childrenReversed.length) {
        const current = childrenReversed[idx];
        if ((current.type === 'move' || current.type === 'rename') && !current.isSymlink) {
          let endIdx = idx + 1;
          while (
            endIdx < childrenReversed.length &&
            (childrenReversed[endIdx].type === 'move' || childrenReversed[endIdx].type === 'rename') &&
            !childrenReversed[endIdx].isSymlink
          ) {
            endIdx += 1;
          }
          const slice = childrenReversed.slice(idx, endIdx);
          const disjoint =
            slice.every((c) => Boolean(c.destinationPath)) &&
            this.areDisjointMovePairs(
              slice.map((c) => ({ src: c.destinationPath!, dst: c.sourcePath }))
            );

          if (disjoint) {
            let cursor = 0;
            let firstError: unknown = null;
            const UNDO_CONCURRENCY = 8;
            const runUndoWorker = async (): Promise<void> => {
              while (cursor < slice.length && firstError === null) {
                const localOffset = cursor;
                cursor += 1;
                const item = slice[localOffset];
                try {
                  const res = await this.undoSingleRecordUnlocked(
                    item,
                    batchValidatorCtx,
                    batchFsCtx
                  );
                  reversedUpdated[idx + localOffset] = res.updatedRecord;
                } catch (err: unknown) {
                  if (firstError === null) {
                    firstError = err;
                  }
                }
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(UNDO_CONCURRENCY, slice.length) }, () => runUndoWorker())
            );
            if (firstError !== null) {
              throw firstError;
            }
            idx = endIdx;
            continue;
          }
        }

        const res = await this.undoSingleRecordUnlocked(current, batchValidatorCtx, batchFsCtx);
        reversedUpdated[idx] = res.updatedRecord;
        idx += 1;
      }

      reversedUpdated.reverse();
      return {
        updatedRecord: { ...record, children: reversedUpdated },
        restoredPath: reversedUpdated[0]?.sourcePath ?? record.sourcePath,
      };
    }

    this.suppressWatchPathsForStep([record.sourcePath, record.destinationPath, record.vaultPayloadPath]);

    if (record.type === 'delete') {
      if (record.isSymlink && record.symlinkTarget) {
        const parentCheck = await this.validator.validateParentCanonicalForLink(record.sourcePath);
        if (!parentCheck.valid || !parentCheck.canonicalLinkPath) {
          throw this.toValidationError(record.sourcePath, parentCheck.error, parentCheck.details);
        }
        const canonicalTarget = parentCheck.canonicalLinkPath;
        if (await this.pathExists(canonicalTarget)) {
          throw ErrorFactory.createFileSystemError(
            'UNKNOWN',
            canonicalTarget,
            undefined,
            { details: `Cannot restore "${path.basename(canonicalTarget)}": destination already exists` }
          );
        }
        await fs.mkdir(path.dirname(canonicalTarget), { recursive: true });
        await fs.symlink(record.symlinkTarget, canonicalTarget);
        this.fileSystemService.invalidatePath(canonicalTarget);
        return {
          updatedRecord: { ...record },
          restoredPath: canonicalTarget,
        };
      }

      if (!record.vaultPayloadPath || !(await this.pathExists(record.vaultPayloadPath))) {
        throw ErrorFactory.createFileSystemError(
          'FILE_NOT_FOUND',
          record.sourcePath,
          undefined,
          { details: 'Deleted item payload is no longer present in staging vault' }
        );
      }
      const canonicalTarget = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      if (await this.pathExists(canonicalTarget)) {
        throw ErrorFactory.createFileSystemError(
          'ALREADY_EXISTS',
          canonicalTarget,
          'restore',
          { details: `Cannot restore "${path.basename(canonicalTarget)}": destination already exists` }
        );
      }
      await this.movePathAtomicOrCrossDevice(
        record.vaultPayloadPath,
        canonicalTarget,
        record.isDirectory
      );
      this.fileSystemService.invalidatePath(canonicalTarget);

      return {
        updatedRecord: { ...record, vaultPayloadPath: undefined },
        restoredPath: canonicalTarget,
      };
    }

    if (record.type === 'move' || record.type === 'rename') {
      if (!record.destinationPath) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      }
      const { resolvedPath: resolvedCurrent, isSymlink } = await this.resolveLinkAwareTarget(
        record.destinationPath,
        validatorContext
      );
      const parentOriginalCheck = record.isSymlink
        ? await this.validator.validateParentCanonicalForLink(record.sourcePath)
        : null;
      const canonicalOriginal = parentOriginalCheck?.valid && parentOriginalCheck.canonicalLinkPath
        ? parentOriginalCheck.canonicalLinkPath
        : await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);

      if (await this.pathExists(canonicalOriginal)) {
        throw ErrorFactory.createFileSystemError(
          'UNKNOWN',
          canonicalOriginal,
          undefined,
          { details: `Cannot undo move: "${path.basename(canonicalOriginal)}" already exists` }
        );
      }

      if (isSymlink) {
        await fs.mkdir(path.dirname(canonicalOriginal), { recursive: true });
        await renameWithWindowsRetry(resolvedCurrent, canonicalOriginal);
        this.fileSystemService.invalidatePath(resolvedCurrent);
        this.fileSystemService.invalidatePath(canonicalOriginal);
      } else {
        await this.fileSystemService.move(resolvedCurrent, canonicalOriginal, fsContext);
      }

      return {
        updatedRecord: record,
        restoredPath: canonicalOriginal,
      };
    }

    if (record.type === 'copy') {
      if (!record.destinationPath) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      }
      const canonicalCopied = await this.validateCanonicalOrThrow(record.destinationPath, validatorContext);
      const vaultPayloadPath = path.join(
        this.payloadsDir,
        `${record.id}-copy-${path.basename(canonicalCopied)}`
      );
      if (await this.pathExists(canonicalCopied)) {
        await this.movePathAtomicOrCrossDevice(canonicalCopied, vaultPayloadPath, record.isDirectory);
        this.fileSystemService.invalidatePath(canonicalCopied);
      }
      return {
        updatedRecord: { ...record, vaultPayloadPath },
        restoredPath: canonicalCopied,
      };
    }

    if (record.type === 'edit_links') {
      const canonicalFile = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      if (record.previousContent !== undefined) {
        await this.fileSystemService.writeFile(canonicalFile, record.previousContent);
      }
      return {
        updatedRecord: record,
        restoredPath: canonicalFile,
      };
    }

    // create_file / create_dir -> move into staging vault so Redo preserves content
    const canonicalCreated = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
    const vaultPayloadPath = path.join(
      this.payloadsDir,
      `${record.id}-redo-${path.basename(canonicalCreated)}`
    );
    if (await this.pathExists(canonicalCreated)) {
      await this.movePathAtomicOrCrossDevice(canonicalCreated, vaultPayloadPath, record.isDirectory);
      this.fileSystemService.invalidatePath(canonicalCreated);
    }

    return {
      updatedRecord: { ...record, vaultPayloadPath },
      restoredPath: canonicalCreated,
    };
  }

  private async redoSingleRecordUnlocked(
    record: OperationRecord,
    validatorContext?: CanonicalValidationContext,
    fsContext?: CanonicalValidationContext
  ): Promise<{ updatedRecord: OperationRecord; restoredPath: string }> {
    if (record.type === 'batch') {
      const children = record.children ?? [];
      const updatedChildren = new Array<OperationRecord>(children.length);
      const batchValidatorCtx = validatorContext ?? (await this.validator.createCanonicalContext());
      const batchFsCtx = fsContext ?? (await this.fileSystemService.createCanonicalContext());

      let idx = 0;
      while (idx < children.length) {
        const current = children[idx];
        if ((current.type === 'move' || current.type === 'rename') && !current.isSymlink) {
          let endIdx = idx + 1;
          while (
            endIdx < children.length &&
            (children[endIdx].type === 'move' || children[endIdx].type === 'rename') &&
            !children[endIdx].isSymlink
          ) {
            endIdx += 1;
          }
          const slice = children.slice(idx, endIdx);
          const disjoint =
            slice.every((c) => Boolean(c.destinationPath)) &&
            this.areDisjointMovePairs(
              slice.map((c) => ({ src: c.sourcePath, dst: c.destinationPath! }))
            );

          if (disjoint) {
            let cursor = 0;
            let firstError: unknown = null;
            const REDO_CONCURRENCY = 8;
            const runRedoWorker = async (): Promise<void> => {
              while (cursor < slice.length && firstError === null) {
                const localOffset = cursor;
                cursor += 1;
                const item = slice[localOffset];
                try {
                  const res = await this.redoSingleRecordUnlocked(
                    item,
                    batchValidatorCtx,
                    batchFsCtx
                  );
                  updatedChildren[idx + localOffset] = res.updatedRecord;
                } catch (err: unknown) {
                  if (firstError === null) {
                    firstError = err;
                  }
                }
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(REDO_CONCURRENCY, slice.length) }, () => runRedoWorker())
            );
            if (firstError !== null) {
              throw firstError;
            }
            idx = endIdx;
            continue;
          }
        }

        const res = await this.redoSingleRecordUnlocked(current, batchValidatorCtx, batchFsCtx);
        updatedChildren[idx] = res.updatedRecord;
        idx += 1;
      }

      return {
        updatedRecord: { ...record, children: updatedChildren },
        restoredPath: updatedChildren[updatedChildren.length - 1]?.destinationPath ?? record.sourcePath,
      };
    }

    this.suppressWatchPathsForStep([record.sourcePath, record.destinationPath, record.vaultPayloadPath]);

    if (record.type === 'delete') {
      if (record.isSymlink) {
        const parentCheck = await this.validator.validateParentCanonicalForLink(record.sourcePath);
        if (!parentCheck.valid || !parentCheck.canonicalLinkPath) {
          throw this.toValidationError(record.sourcePath, parentCheck.error, parentCheck.details);
        }
        const canonicalTarget = parentCheck.canonicalLinkPath;
        await fs.unlink(canonicalTarget);
        this.fileSystemService.invalidatePath(canonicalTarget);
        return {
          updatedRecord: { ...record },
          restoredPath: canonicalTarget,
        };
      }

      const canonicalTarget = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      const vaultPayloadPath = path.join(
        this.payloadsDir,
        `${record.id}-${path.basename(canonicalTarget)}`
      );
      await this.movePathAtomicOrCrossDevice(canonicalTarget, vaultPayloadPath, record.isDirectory);
      this.fileSystemService.invalidatePath(canonicalTarget);

      return {
        updatedRecord: { ...record, vaultPayloadPath },
        restoredPath: canonicalTarget,
      };
    }

    if (record.type === 'move' || record.type === 'rename') {
      if (!record.destinationPath) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      }
      const { resolvedPath: resolvedSrc, isSymlink } = await this.resolveLinkAwareTarget(
        record.sourcePath,
        validatorContext
      );
      const parentDstCheck = record.isSymlink
        ? await this.validator.validateParentCanonicalForLink(record.destinationPath)
        : null;
      const canonicalDst = parentDstCheck?.valid && parentDstCheck.canonicalLinkPath
        ? parentDstCheck.canonicalLinkPath
        : await this.validateCanonicalOrThrow(record.destinationPath, validatorContext);

      if (await this.pathExists(canonicalDst)) {
        throw ErrorFactory.createFileSystemError(
          'UNKNOWN',
          canonicalDst,
          undefined,
          { details: `Cannot redo move: "${path.basename(canonicalDst)}" already exists` }
        );
      }

      if (isSymlink) {
        await fs.mkdir(path.dirname(canonicalDst), { recursive: true });
        await fs.rename(resolvedSrc, canonicalDst);
        this.fileSystemService.invalidatePath(resolvedSrc);
        this.fileSystemService.invalidatePath(canonicalDst);
      } else {
        await this.fileSystemService.move(resolvedSrc, canonicalDst, fsContext);
      }

      return {
        updatedRecord: record,
        restoredPath: canonicalDst,
      };
    }

    if (record.type === 'copy') {
      if (!record.destinationPath) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      }
      const canonicalDst = await this.validateCanonicalOrThrow(record.destinationPath, validatorContext);
      if (await this.pathExists(canonicalDst)) {
        throw ErrorFactory.createFileSystemError(
          'UNKNOWN',
          canonicalDst,
          undefined,
          { details: `Cannot redo copy: "${path.basename(canonicalDst)}" already exists` }
        );
      }
      if (record.vaultPayloadPath && (await this.pathExists(record.vaultPayloadPath))) {
        await this.movePathAtomicOrCrossDevice(record.vaultPayloadPath, canonicalDst, record.isDirectory);
        this.fileSystemService.invalidatePath(canonicalDst);
      } else {
        await this.fileSystemService.copy(record.sourcePath, canonicalDst);
      }
      return {
        updatedRecord: { ...record, vaultPayloadPath: undefined },
        restoredPath: canonicalDst,
      };
    }

    if (record.type === 'edit_links') {
      const canonicalFile = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      if (record.nextContent !== undefined) {
        await this.fileSystemService.writeFile(canonicalFile, record.nextContent);
      }
      return {
        updatedRecord: record,
        restoredPath: canonicalFile,
      };
    }

    const canonicalTarget = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
    if (record.vaultPayloadPath && (await this.pathExists(record.vaultPayloadPath))) {
      await this.movePathAtomicOrCrossDevice(
        record.vaultPayloadPath,
        canonicalTarget,
        record.isDirectory
      );
    } else if (record.isDirectory) {
      await this.fileSystemService.createDirectory(canonicalTarget);
    } else {
      await this.fileSystemService.writeFile(canonicalTarget, '');
    }
    this.fileSystemService.invalidatePath(canonicalTarget);

    return {
      updatedRecord: { ...record, vaultPayloadPath: undefined },
      restoredPath: canonicalTarget,
    };
  }

  async undo(): Promise<UndoRedoResult> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const record = this.undoStack[this.undoStack.length - 1];
      if (!record) {
        return { success: false, state: this.buildStateSnapshot() };
      }

      const { updatedRecord, restoredPath } = await this.undoSingleRecordUnlocked(record);
      this.undoStack.pop();
      this.redoStack.push(updatedRecord);
      await this.persist();
      return {
        success: true,
        operation: updatedRecord,
        restoredPath,
        state: this.buildStateSnapshot(),
      };
    });
  }

  async redo(): Promise<UndoRedoResult> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const record = this.redoStack[this.redoStack.length - 1];
      if (!record) {
        return { success: false, state: this.buildStateSnapshot() };
      }

      const { updatedRecord, restoredPath } = await this.redoSingleRecordUnlocked(record);
      this.redoStack.pop();
      this.undoStack.push(updatedRecord);
      await this.persist();
      return {
        success: true,
        operation: updatedRecord,
        restoredPath,
        state: this.buildStateSnapshot(),
      };
    });
  }

  async emptyVault(): Promise<OperationJournalState> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      for (const record of this.undoStack) {
        await this.removeRecordPayloads(record);
      }
      for (const record of this.redoStack) {
        await this.removeRecordPayloads(record);
      }
      this.undoStack = this.undoStack.filter(
        (op) => op.type !== 'delete' && !(op.type === 'batch' && op.children?.some((c) => c.type === 'delete'))
      );
      this.redoStack = this.redoStack.filter(
        (op) => op.type !== 'create_file' && op.type !== 'create_dir'
      );
      await fs.rm(this.payloadsDir, { recursive: true, force: true }).catch(() => undefined);
      await fs.mkdir(this.payloadsDir, { recursive: true });
      await this.persist();
      return this.buildStateSnapshot();
    });
  }

  async getState(): Promise<OperationJournalState> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      return this.buildStateSnapshot();
    });
  }

  private removeUndoVaultEntryById(entryId: string): OperationRecord | null {
    for (let i = 0; i < this.undoStack.length; i += 1) {
      const op = this.undoStack[i];
      if (op.id === entryId && op.type === 'delete') {
        this.undoStack.splice(i, 1);
        return op;
      }
      if (op.children && op.children.length > 0) {
        const childIdx = op.children.findIndex((c) => c.id === entryId && c.type === 'delete');
        if (childIdx >= 0) {
          const [removed] = op.children.splice(childIdx, 1);
          if (op.children.length === 0) {
            this.undoStack.splice(i, 1);
          }
          return removed;
        }
      }
    }
    return null;
  }

  private findUndoVaultEntryById(entryId: string): OperationRecord | null {
    for (const op of this.undoStack) {
      if (op.id === entryId && op.type === 'delete') {
        return op;
      }
      if (op.children) {
        const child = op.children.find((c) => c.id === entryId && c.type === 'delete');
        if (child) {
          return child;
        }
      }
    }
    return null;
  }

  async listVaultItems(): Promise<TrashVaultEntry[]> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const rawItems = this.collectDeleteVaultItems(this.undoStack);
      const entries: TrashVaultEntry[] = [];
      for (const item of rawItems) {
        if (item.vaultPayloadPath && !(await this.pathExists(item.vaultPayloadPath))) {
          continue;
        }
        entries.push({
          id: item.id,
          name: path.basename(item.sourcePath),
          originalPath: item.sourcePath,
          deletedAt: item.timestamp,
          size: item.size,
          isDirectory: item.isDirectory,
          isSymlink: Boolean(item.isSymlink),
          description: item.description,
        });
      }
      return entries.sort((a, b) => b.deletedAt - a.deletedAt);
    });
  }

  async restoreVaultItem(entryId: string): Promise<UndoRedoResult> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const target = this.findUndoVaultEntryById(entryId);
      if (!target) {
        return { success: false, state: this.buildStateSnapshot() };
      }
      this.suppressWatchPathsForStep([target.sourcePath]);
      const { updatedRecord, restoredPath } = await this.undoSingleRecordUnlocked(target);
      this.removeUndoVaultEntryById(entryId);
      await this.persist();
      return {
        success: true,
        operation: updatedRecord,
        restoredPath,
        state: this.buildStateSnapshot(),
      };
    });
  }

  async purgeVaultItem(entryId: string): Promise<OperationJournalState> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const removed = this.removeUndoVaultEntryById(entryId);
      if (removed) {
        await this.removeRecordPayloads(removed);
        await this.persist();
      }
      return this.buildStateSnapshot();
    });
  }

  private buildStateSnapshot(): OperationJournalState {
    const vaultItems = this.collectDeleteVaultItems(this.undoStack);
    const redoPayloads = this.collectDeleteVaultItems(this.redoStack);
    const vaultTotalBytes = this.currentVaultBytes();

    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      lastUndoDescription: this.undoStack[this.undoStack.length - 1]?.description,
      lastRedoDescription: this.redoStack[this.redoStack.length - 1]?.description,
      vaultItemCount: vaultItems.length + (redoPayloads.length > 0 ? 0 : 0),
      vaultTotalBytes,
    };
  }
}

let journalSingleton: OperationJournal | null = null;
let unsubscribeJournalRoots: (() => void) | null = null;

export function getOperationJournal(): OperationJournal {
  const kernel = getReactiveWorkspaceKernel();
  const fsService = kernel.getFileSystemService();
  const authority = VaultRootAuthority.getInstance();
  const validator = authority.getValidator();

  if (!journalSingleton) {
    journalSingleton = new OperationJournal({
      validator,
      fileSystemService: fsService,
    });
    unsubscribeJournalRoots?.();
    unsubscribeJournalRoots = authority.onRootsChanged(() => {
      journalSingleton?.updateValidator(authority.getValidator());
    });
  } else {
    journalSingleton.updateValidator(validator);
  }
  return journalSingleton;
}

export function resetOperationJournal(): void {
  unsubscribeJournalRoots?.();
  unsubscribeJournalRoots = null;
  journalSingleton = null;
}
