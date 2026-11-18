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
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { normalizePathKey } from '@main/platform/pathNormalize';
import { defaultOsTrash } from '@main/platform/journal/osTrashAdapter';
import { TrashVaultStore } from '@main/platform/journal/TrashVaultStore';
import { BatchRollbackFailureDetail, WalJournalLog } from '@main/platform/journal/WalJournalLog';
import { CanonicalValidationContext, PathValidator } from './PathValidator';
import { FileSystemService } from './FileSystemService';
import { getReactiveWorkspaceKernel, hasActiveReactiveWorkspaceKernel } from './ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { ErrorFactory } from '@shared/errors';
import { FileSystemLogger } from '@shared/logging';
import { renameWithWindowsRetry } from '@shared/utils/atomicFs';

const DEFAULT_MAX_HISTORY = 20;
const DEFAULT_MAX_VAULT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_VAULT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

export type { BatchRollbackFailureDetail };

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

function areDisjointMovePairs(pairs: ReadonlyArray<{ src: string; dst: string }>): boolean {
  if (pairs.length <= 8) return false;
  const allEndpoints = new Set<string>();
  for (const pair of pairs) {
    const sKey = normalizePathKey(pair.src);
    const dKey = normalizePathKey(pair.dst);
    if (sKey === dKey || allEndpoints.has(sKey) || allEndpoints.has(dKey)) return false;
    allEndpoints.add(sKey);
    allEndpoints.add(dKey);
  }
  for (const pair of pairs) {
    for (const endpoint of [pair.src, pair.dst]) {
      let cur = path.dirname(path.resolve(endpoint));
      for (let depth = 0; depth < 32; depth += 1) {
        if (allEndpoints.has(normalizePathKey(cur))) return false;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }
  }
  return true;
}

export class OperationJournal {
  private readonly maxVaultBytes: number;
  private readonly store: TrashVaultStore;
  private readonly wal: WalJournalLog;
  private readonly fileSystemService: FileSystemService;
  private readonly osTrashFn: (targetPath: string) => Promise<void>;
  private readonly onSuppressWatchPaths?: (paths: string[], ttlMs?: number) => void;
  private validator: PathValidator;
  private undoStack: OperationRecord[] = [];
  private redoStack: OperationRecord[] = [];
  private initialized = false;
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(options: OperationJournalOptions) {
    const vaultDir = path.resolve(options.vaultDir ?? resolveSharedTrashVaultDir());
    const maxHistory = Math.max(10, options.maxHistory ?? DEFAULT_MAX_HISTORY);
    this.maxVaultBytes = options.maxVaultBytes ?? DEFAULT_MAX_VAULT_BYTES;
    const maxVaultAgeMs = options.maxVaultAgeMs ?? DEFAULT_MAX_VAULT_AGE_MS;

    this.store = new TrashVaultStore(vaultDir, maxHistory, this.maxVaultBytes, maxVaultAgeMs);
    this.wal = new WalJournalLog(vaultDir);
    this.validator = options.validator;
    this.fileSystemService = options.fileSystemService;
    this.osTrashFn = options.osTrashFn ?? defaultOsTrash;
    this.onSuppressWatchPaths = options.onSuppressWatchPaths;
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
    if (this.initialized) return;

    const loaded = await this.store.loadStacks();
    this.undoStack = loaded.undoStack;
    this.redoStack = loaded.redoStack;

    const recoveredWal = await this.wal.recoverPendingWal((completed) =>
      this.rollbackCompletedStepsUnlocked(completed)
    );
    const evicted = await this.store.evictExpiredRecords(this.undoStack, this.redoStack);
    this.undoStack = evicted.undoStack;
    this.redoStack = evicted.redoStack;

    this.initialized = true;
    if (evicted.changed || recoveredWal) {
      await this.store.saveStacks(this.undoStack, this.redoStack);
    }
  }

  private suppressWatchPathsForStep(paths: Array<string | undefined>, ttlMs: number = 1500): void {
    const clean = paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    if (clean.length === 0) return;
    this.onSuppressWatchPaths?.(clean, ttlMs);
    if (hasActiveReactiveWorkspaceKernel()) {
      getReactiveWorkspaceKernel().suppressPaths(clean, ttlMs);
    }
  }

  private toValidationError(targetPath: string, errorCode: string | undefined, details?: string): Error {
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

  private async pushUndoRecord(record: OperationRecord): Promise<void> {
    for (const stale of this.redoStack) {
      await this.store.removeRecordPayloads(stale);
    }
    this.redoStack = [];
    this.undoStack.push(record);
    await this.store.enforceQuotas(this.undoStack, this.redoStack);
    await this.store.saveStacks(this.undoStack, this.redoStack);
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
        rollbackFailures.push({
          stepId: child.id,
          description: child.description,
          error: rbErr instanceof Error ? rbErr.message : String(rbErr),
        });
        remainingRecords.unshift(child);
      }
    }

    return { rollbackFailures, remainingRecords };
  }

  private async performSingleDeleteUnlocked(
    requestedPath: string,
    recursive: boolean,
    mode: FileDeleteMode
  ): Promise<{ success: boolean; mode: FileDeleteMode; operationId?: string; record?: OperationRecord }> {
    const { resolvedPath, isSymlink, lstatInfo } = await this.resolveLinkAwareTarget(requestedPath);
    const isDirectory = isSymlink ? false : lstatInfo.isDirectory();

    if (isDirectory && !recursive) {
      throw ErrorFactory.createFileSystemError('UNKNOWN', requestedPath, undefined, {
        details: 'Directory deletion requires recursive=true',
      });
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
        description: `Delete symlink ${path.basename(resolvedPath)}`,
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

    const entrySize = await this.store.computeEntrySize(resolvedPath);
    if (entrySize > this.maxVaultBytes) {
      throw ErrorFactory.createFileSystemError('DISK_FULL', requestedPath, undefined, {
        details: `Entry size (${entrySize} bytes) exceeds Trash Vault capacity (${this.maxVaultBytes} bytes). Use OS Trash or Permanent Delete.`,
      });
    }

    const id = randomUUID();
    const entryBase = path.basename(resolvedPath);
    const vaultPayloadPath = path.join(this.store.payloadsDir, `${id}-${entryBase}`);
    await this.store.movePathAtomicOrCrossDevice(resolvedPath, vaultPayloadPath, isDirectory);
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
      description: opType === 'rename' ? `Rename ${baseSrc} -> ${baseDst}` : `Move ${baseSrc} -> ${baseDst}`,
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
    const entrySize = isSymlink ? 0 : await this.store.computeEntrySize(result.copiedPath);
    const id = randomUUID();
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
      description: `Copy ${path.basename(resolvedSource)} -> ${path.basename(result.copiedPath)}`,
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
    return {
      record: {
        id: randomUUID(),
        type: 'edit_links',
        timestamp: Date.now(),
        sourcePath: canonicalTarget,
        previousContent,
        nextContent,
        isDirectory: false,
        size: Buffer.byteLength(nextContent, 'utf-8'),
        undoable: true,
        description: `Repair links in ${path.basename(canonicalTarget)}`,
      },
    };
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
      return { success: outcome.success, mode: outcome.mode, operationId: outcome.operationId };
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
      return { success: outcome.success, newPath: outcome.newPath, operationId: outcome.operationId };
    });
  }

  async executeBatch(
    description: string,
    steps: BatchOperationStep[]
  ): Promise<{ success: boolean; operation: OperationRecord; state: OperationJournalState }> {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw ErrorFactory.createValidationError('INVALID_INPUT', 'steps', steps, 'Batch steps cannot be empty');
    }

    return this.serialize(async () => {
      await this.ensureInitialized();
      const batchId = randomUUID();
      const startedAt = Date.now();
      const completed: OperationRecord[] = [];
      let totalSize = 0;

      const walWriter = await this.wal.openBatchWriter(batchId, description, startedAt);
      const validatorCtx = await this.validator.createCanonicalContext();
      const fsCtx = await this.fileSystemService.createCanonicalContext();

      try {
        let idx = 0;
        while (idx < steps.length) {
          const step = steps[idx];
          if (step.type === 'move' || step.type === 'rename') {
            let endIdx = idx + 1;
            while (endIdx < steps.length && (steps[endIdx].type === 'move' || steps[endIdx].type === 'rename')) {
              endIdx += 1;
            }
            const slice = steps.slice(idx, endIdx) as Array<Extract<BatchOperationStep, { type: 'move' | 'rename' }>>;
            if (areDisjointMovePairs(slice.map((s) => ({ src: s.source, dst: s.destination })))) {
              const MOVE_WAVE_SIZE = 8;
              for (let waveStart = 0; waveStart < slice.length; waveStart += MOVE_WAVE_SIZE) {
                const wave = slice.slice(waveStart, waveStart + MOVE_WAVE_SIZE);
                const settled = await Promise.allSettled(
                  wave.map(async (s) => {
                    this.suppressWatchPathsForStep([s.source, s.destination]);
                    return this.performSingleMoveUnlocked(s.source, s.destination, s.type, validatorCtx, fsCtx);
                  })
                );
                let firstWaveError: unknown = null;
                const waveRecords: OperationRecord[] = [];
                for (const outcome of settled) {
                  if (outcome.status === 'fulfilled') {
                    completed.push(outcome.value.record);
                    waveRecords.push(outcome.value.record);
                    totalSize += outcome.value.record.size;
                  } else if (firstWaveError === null) {
                    firstWaveError = outcome.reason;
                  }
                }
                await walWriter.appendChunk(waveRecords);
                if (firstWaveError !== null) throw firstWaveError;
              }
              idx = endIdx;
              continue;
            }

            for (const s of slice) {
              this.suppressWatchPathsForStep([s.source, s.destination]);
              const res = await this.performSingleMoveUnlocked(s.source, s.destination, s.type, validatorCtx, fsCtx);
              completed.push(res.record);
              totalSize += res.record.size;
              await walWriter.appendStep(res.record);
            }
            idx = endIdx;
            continue;
          }

          if (step.type === 'delete') {
            this.suppressWatchPathsForStep([step.path]);
            const res = await this.performSingleDeleteUnlocked(step.path, step.recursive ?? true, step.mode ?? 'vault');
            if (res.record) {
              completed.push(res.record);
              totalSize += res.record.size;
              await walWriter.appendStep(res.record);
            }
          } else if (step.type === 'create_dir') {
            this.suppressWatchPathsForStep([step.path]);
            const canonicalDir = await this.validateCanonicalOrThrow(step.path, validatorCtx);
            if (!(await this.store.pathExists(canonicalDir))) {
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
              await walWriter.appendStep(dirRec);
            }
          } else if (step.type === 'copy') {
            this.suppressWatchPathsForStep([step.source, step.destination]);
            const res = await this.performSingleCopyUnlocked(step.source, step.destination);
            completed.push(res.record);
            totalSize += res.record.size;
            await walWriter.appendStep(res.record);
          } else if (step.type === 'edit_links') {
            this.suppressWatchPathsForStep([step.filePath]);
            const res = await this.performSingleEditLinksUnlocked(
              step.filePath,
              step.previousContent,
              step.nextContent
            );
            completed.push(res.record);
            await walWriter.appendStep(res.record);
          }
          idx += 1;
        }
      } catch (err) {
        await walWriter.close();
        const { rollbackFailures, remainingRecords } = await this.rollbackCompletedStepsUnlocked(completed);

        if (rollbackFailures.length > 0) {
          const origMsg = err instanceof Error ? err.message : String(err);
          const failedFile = await this.wal
            .writeFailedArtifact(batchId, {
              batchId,
              description,
              status: 'rollback_failed',
              startedAt,
              completed: remainingRecords,
              failureReason: origMsg,
              rollbackFailures,
            })
            .catch(() => '');
          await this.wal.removePendingWalFiles().catch(() => undefined);

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

        await this.wal.removePendingWalFiles();
        throw err;
      }

      await walWriter.close();

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
      await this.wal.removePendingWalFiles();
      return {
        success: true,
        operation: batchRecord,
        state: this.store.buildStateSnapshot(this.undoStack, this.redoStack),
      };
    });
  }

  async recordCreation(createdPath: string, isDirectory: boolean, size: number = 0): Promise<string> {
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

  private async runBatchChildrenInWaves(
    items: OperationRecord[],
    direction: 'undo' | 'redo',
    validatorContext?: CanonicalValidationContext,
    fsContext?: CanonicalValidationContext
  ): Promise<OperationRecord[]> {
    const updated = new Array<OperationRecord>(items.length);
    const batchValidatorCtx = validatorContext ?? (await this.validator.createCanonicalContext());
    const batchFsCtx = fsContext ?? (await this.fileSystemService.createCanonicalContext());

    let idx = 0;
    while (idx < items.length) {
      const current = items[idx];
      if ((current.type === 'move' || current.type === 'rename') && !current.isSymlink) {
        let endIdx = idx + 1;
        while (
          endIdx < items.length &&
          (items[endIdx].type === 'move' || items[endIdx].type === 'rename') &&
          !items[endIdx].isSymlink
        ) {
          endIdx += 1;
        }
        const slice = items.slice(idx, endIdx);
        const pairs = slice.map((c) =>
          direction === 'undo'
            ? { src: c.destinationPath!, dst: c.sourcePath }
            : { src: c.sourcePath, dst: c.destinationPath! }
        );
        if (slice.every((c) => Boolean(c.destinationPath)) && areDisjointMovePairs(pairs)) {
          let cursor = 0;
          let firstError: unknown = null;
          const CONCURRENCY = 8;
          const worker = async (): Promise<void> => {
            while (cursor < slice.length && firstError === null) {
              const offset = cursor;
              cursor += 1;
              try {
                const res =
                  direction === 'undo'
                    ? await this.undoSingleRecordUnlocked(slice[offset], batchValidatorCtx, batchFsCtx)
                    : await this.redoSingleRecordUnlocked(slice[offset], batchValidatorCtx, batchFsCtx);
                updated[idx + offset] = res.updatedRecord;
              } catch (err: unknown) {
                if (firstError === null) firstError = err;
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slice.length) }, () => worker()));
          if (firstError !== null) throw firstError;
          idx = endIdx;
          continue;
        }
      }

      const res =
        direction === 'undo'
          ? await this.undoSingleRecordUnlocked(current, batchValidatorCtx, batchFsCtx)
          : await this.redoSingleRecordUnlocked(current, batchValidatorCtx, batchFsCtx);
      updated[idx] = res.updatedRecord;
      idx += 1;
    }

    return updated;
  }

  private async undoSingleRecordUnlocked(
    record: OperationRecord,
    validatorContext?: CanonicalValidationContext,
    fsContext?: CanonicalValidationContext
  ): Promise<{ updatedRecord: OperationRecord; restoredPath: string }> {
    if (record.type === 'batch') {
      const reversedUpdated = await this.runBatchChildrenInWaves(
        [...(record.children ?? [])].reverse(),
        'undo',
        validatorContext,
        fsContext
      );
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
        if (await this.store.pathExists(canonicalTarget)) {
          throw ErrorFactory.createFileSystemError('UNKNOWN', canonicalTarget, undefined, {
            details: `Cannot restore "${path.basename(canonicalTarget)}": destination already exists`,
          });
        }
        await fs.mkdir(path.dirname(canonicalTarget), { recursive: true });
        await fs.symlink(record.symlinkTarget, canonicalTarget);
        this.fileSystemService.invalidatePath(canonicalTarget);
        return { updatedRecord: { ...record }, restoredPath: canonicalTarget };
      }

      if (!record.vaultPayloadPath || !(await this.store.pathExists(record.vaultPayloadPath))) {
        throw ErrorFactory.createFileSystemError('FILE_NOT_FOUND', record.sourcePath, undefined, {
          details: 'Deleted item payload is no longer present in staging vault',
        });
      }
      const canonicalTarget = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      if (await this.store.pathExists(canonicalTarget)) {
        throw ErrorFactory.createFileSystemError('ALREADY_EXISTS', canonicalTarget, 'restore', {
          details: `Cannot restore "${path.basename(canonicalTarget)}": destination already exists`,
        });
      }
      await this.store.movePathAtomicOrCrossDevice(record.vaultPayloadPath, canonicalTarget, record.isDirectory);
      this.fileSystemService.invalidatePath(canonicalTarget);
      return { updatedRecord: { ...record, vaultPayloadPath: undefined }, restoredPath: canonicalTarget };
    }

    if (record.type === 'move' || record.type === 'rename') {
      if (!record.destinationPath) throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      const { resolvedPath: resolvedCurrent, isSymlink } = await this.resolveLinkAwareTarget(
        record.destinationPath,
        validatorContext
      );
      const parentOriginalCheck = record.isSymlink
        ? await this.validator.validateParentCanonicalForLink(record.sourcePath)
        : null;
      const canonicalOriginal =
        parentOriginalCheck?.valid && parentOriginalCheck.canonicalLinkPath
          ? parentOriginalCheck.canonicalLinkPath
          : await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);

      if (await this.store.pathExists(canonicalOriginal)) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', canonicalOriginal, undefined, {
          details: `Cannot undo move: "${path.basename(canonicalOriginal)}" already exists`,
        });
      }

      if (isSymlink) {
        await fs.mkdir(path.dirname(canonicalOriginal), { recursive: true });
        await renameWithWindowsRetry(resolvedCurrent, canonicalOriginal);
        this.fileSystemService.invalidatePath(resolvedCurrent);
        this.fileSystemService.invalidatePath(canonicalOriginal);
      } else {
        await this.fileSystemService.move(resolvedCurrent, canonicalOriginal, fsContext);
      }
      return { updatedRecord: record, restoredPath: canonicalOriginal };
    }

    if (record.type === 'copy') {
      if (!record.destinationPath) throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      const canonicalCopied = await this.validateCanonicalOrThrow(record.destinationPath, validatorContext);
      const vaultPayloadPath = path.join(this.store.payloadsDir, `${record.id}-copy-${path.basename(canonicalCopied)}`);
      if (await this.store.pathExists(canonicalCopied)) {
        await this.store.movePathAtomicOrCrossDevice(canonicalCopied, vaultPayloadPath, record.isDirectory);
        this.fileSystemService.invalidatePath(canonicalCopied);
      }
      return { updatedRecord: { ...record, vaultPayloadPath }, restoredPath: canonicalCopied };
    }

    if (record.type === 'edit_links') {
      const canonicalFile = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      if (record.previousContent !== undefined) {
        await this.fileSystemService.writeFile(canonicalFile, record.previousContent);
      }
      return { updatedRecord: record, restoredPath: canonicalFile };
    }

    const canonicalCreated = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
    const vaultPayloadPath = path.join(this.store.payloadsDir, `${record.id}-redo-${path.basename(canonicalCreated)}`);
    if (await this.store.pathExists(canonicalCreated)) {
      await this.store.movePathAtomicOrCrossDevice(canonicalCreated, vaultPayloadPath, record.isDirectory);
      this.fileSystemService.invalidatePath(canonicalCreated);
    }
    return { updatedRecord: { ...record, vaultPayloadPath }, restoredPath: canonicalCreated };
  }

  private async redoSingleRecordUnlocked(
    record: OperationRecord,
    validatorContext?: CanonicalValidationContext,
    fsContext?: CanonicalValidationContext
  ): Promise<{ updatedRecord: OperationRecord; restoredPath: string }> {
    if (record.type === 'batch') {
      const updatedChildren = await this.runBatchChildrenInWaves(
        record.children ?? [],
        'redo',
        validatorContext,
        fsContext
      );
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
        return { updatedRecord: { ...record }, restoredPath: canonicalTarget };
      }

      const canonicalTarget = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      const vaultPayloadPath = path.join(this.store.payloadsDir, `${record.id}-${path.basename(canonicalTarget)}`);
      await this.store.movePathAtomicOrCrossDevice(canonicalTarget, vaultPayloadPath, record.isDirectory);
      this.fileSystemService.invalidatePath(canonicalTarget);
      return { updatedRecord: { ...record, vaultPayloadPath }, restoredPath: canonicalTarget };
    }

    if (record.type === 'move' || record.type === 'rename') {
      if (!record.destinationPath) throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      const { resolvedPath: resolvedSrc, isSymlink } = await this.resolveLinkAwareTarget(
        record.sourcePath,
        validatorContext
      );
      const parentDstCheck = record.isSymlink
        ? await this.validator.validateParentCanonicalForLink(record.destinationPath)
        : null;
      const canonicalDst =
        parentDstCheck?.valid && parentDstCheck.canonicalLinkPath
          ? parentDstCheck.canonicalLinkPath
          : await this.validateCanonicalOrThrow(record.destinationPath, validatorContext);

      if (await this.store.pathExists(canonicalDst)) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', canonicalDst, undefined, {
          details: `Cannot redo move: "${path.basename(canonicalDst)}" already exists`,
        });
      }

      if (isSymlink) {
        await fs.mkdir(path.dirname(canonicalDst), { recursive: true });
        await fs.rename(resolvedSrc, canonicalDst);
        this.fileSystemService.invalidatePath(resolvedSrc);
        this.fileSystemService.invalidatePath(canonicalDst);
      } else {
        await this.fileSystemService.move(resolvedSrc, canonicalDst, fsContext);
      }
      return { updatedRecord: record, restoredPath: canonicalDst };
    }

    if (record.type === 'copy') {
      if (!record.destinationPath) throw ErrorFactory.createFileSystemError('UNKNOWN', record.sourcePath);
      const canonicalDst = await this.validateCanonicalOrThrow(record.destinationPath, validatorContext);
      if (await this.store.pathExists(canonicalDst)) {
        throw ErrorFactory.createFileSystemError('UNKNOWN', canonicalDst, undefined, {
          details: `Cannot redo copy: "${path.basename(canonicalDst)}" already exists`,
        });
      }
      if (record.vaultPayloadPath && (await this.store.pathExists(record.vaultPayloadPath))) {
        await this.store.movePathAtomicOrCrossDevice(record.vaultPayloadPath, canonicalDst, record.isDirectory);
        this.fileSystemService.invalidatePath(canonicalDst);
      } else {
        await this.fileSystemService.copy(record.sourcePath, canonicalDst);
      }
      return { updatedRecord: { ...record, vaultPayloadPath: undefined }, restoredPath: canonicalDst };
    }

    if (record.type === 'edit_links') {
      const canonicalFile = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
      if (record.nextContent !== undefined) {
        await this.fileSystemService.writeFile(canonicalFile, record.nextContent);
      }
      return { updatedRecord: record, restoredPath: canonicalFile };
    }

    const canonicalTarget = await this.validateCanonicalOrThrow(record.sourcePath, validatorContext);
    if (record.vaultPayloadPath && (await this.store.pathExists(record.vaultPayloadPath))) {
      await this.store.movePathAtomicOrCrossDevice(record.vaultPayloadPath, canonicalTarget, record.isDirectory);
    } else if (record.isDirectory) {
      await this.fileSystemService.createDirectory(canonicalTarget);
    } else {
      await this.fileSystemService.writeFile(canonicalTarget, '');
    }
    this.fileSystemService.invalidatePath(canonicalTarget);
    return { updatedRecord: { ...record, vaultPayloadPath: undefined }, restoredPath: canonicalTarget };
  }

  async undo(): Promise<UndoRedoResult> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const record = this.undoStack[this.undoStack.length - 1];
      if (!record) {
        return { success: false, state: this.store.buildStateSnapshot(this.undoStack, this.redoStack) };
      }

      const { updatedRecord, restoredPath } = await this.undoSingleRecordUnlocked(record);
      this.undoStack.pop();
      this.redoStack.push(updatedRecord);
      await this.store.saveStacks(this.undoStack, this.redoStack);
      return {
        success: true,
        operation: updatedRecord,
        restoredPath,
        state: this.store.buildStateSnapshot(this.undoStack, this.redoStack),
      };
    });
  }

  async redo(): Promise<UndoRedoResult> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const record = this.redoStack[this.redoStack.length - 1];
      if (!record) {
        return { success: false, state: this.store.buildStateSnapshot(this.undoStack, this.redoStack) };
      }

      const { updatedRecord, restoredPath } = await this.redoSingleRecordUnlocked(record);
      this.redoStack.pop();
      this.undoStack.push(updatedRecord);
      await this.store.saveStacks(this.undoStack, this.redoStack);
      return {
        success: true,
        operation: updatedRecord,
        restoredPath,
        state: this.store.buildStateSnapshot(this.undoStack, this.redoStack),
      };
    });
  }

  async emptyVault(): Promise<OperationJournalState> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      for (const record of this.undoStack) await this.store.removeRecordPayloads(record);
      for (const record of this.redoStack) await this.store.removeRecordPayloads(record);
      this.undoStack = this.undoStack.filter(
        (op) => op.type !== 'delete' && !(op.type === 'batch' && op.children?.some((c) => c.type === 'delete'))
      );
      this.redoStack = this.redoStack.filter(
        (op) => op.type !== 'create_file' && op.type !== 'create_dir'
      );
      await this.store.resetPayloadsDir();
      await this.store.saveStacks(this.undoStack, this.redoStack);
      return this.store.buildStateSnapshot(this.undoStack, this.redoStack);
    });
  }

  async getState(): Promise<OperationJournalState> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      return this.store.buildStateSnapshot(this.undoStack, this.redoStack);
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
          if (op.children.length === 0) this.undoStack.splice(i, 1);
          return removed;
        }
      }
    }
    return null;
  }

  private findUndoVaultEntryById(entryId: string): OperationRecord | null {
    for (const op of this.undoStack) {
      if (op.id === entryId && op.type === 'delete') return op;
      if (op.children) {
        const child = op.children.find((c) => c.id === entryId && c.type === 'delete');
        if (child) return child;
      }
    }
    return null;
  }

  async listVaultItems(): Promise<TrashVaultEntry[]> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      return this.store.listVaultEntries(this.undoStack);
    });
  }

  async restoreVaultItem(entryId: string): Promise<UndoRedoResult> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const target = this.findUndoVaultEntryById(entryId);
      if (!target) {
        return { success: false, state: this.store.buildStateSnapshot(this.undoStack, this.redoStack) };
      }
      this.suppressWatchPathsForStep([target.sourcePath]);
      const { updatedRecord, restoredPath } = await this.undoSingleRecordUnlocked(target);
      this.removeUndoVaultEntryById(entryId);
      await this.store.saveStacks(this.undoStack, this.redoStack);
      return {
        success: true,
        operation: updatedRecord,
        restoredPath,
        state: this.store.buildStateSnapshot(this.undoStack, this.redoStack),
      };
    });
  }

  async purgeVaultItem(entryId: string): Promise<OperationJournalState> {
    return this.serialize(async () => {
      await this.ensureInitialized();
      const removed = this.removeUndoVaultEntryById(entryId);
      if (removed) {
        await this.store.removeRecordPayloads(removed);
        await this.store.saveStacks(this.undoStack, this.redoStack);
      }
      return this.store.buildStateSnapshot(this.undoStack, this.redoStack);
    });
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
