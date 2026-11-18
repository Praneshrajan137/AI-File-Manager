/**
 * WalJournalLog.ts - Crash-safe NDJSON + JSON Write-Ahead Log manager for batch operations.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { OperationRecord } from '@shared/contracts';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { FileSystemLogger } from '@shared/logging';
import { atomicWriteFile, extractFsErrorCode } from '@shared/utils/atomicFs';

export interface BatchRollbackFailureDetail {
  stepId: string;
  description: string;
  error: string;
}

export interface WalPendingState {
  batchId: string;
  description: string;
  status: 'pending' | 'rollback_failed';
  startedAt: number;
  completed: OperationRecord[];
  failureReason?: string;
  rollbackFailures?: BatchRollbackFailureDetail[];
}

export interface ActiveWalWriter {
  appendStep(record: OperationRecord): Promise<void>;
  appendChunk(records: readonly OperationRecord[]): Promise<void>;
  close(): Promise<void>;
}

export class WalJournalLog {
  readonly walFile: string;
  readonly walJournalFile: string;

  constructor(private readonly vaultDir: string) {
    this.walFile = path.join(vaultDir, 'wal-pending.json');
    this.walJournalFile = path.join(vaultDir, 'wal-pending.jsonl');
  }

  async openBatchWriter(
    batchId: string,
    description: string,
    startedAt: number
  ): Promise<ActiveWalWriter> {
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

    const writeText = (text: string): Promise<void> => {
      const next = walWriteChain.then(() => walHandle.write(text, undefined, 'utf-8'));
      walWriteChain = next.catch(() => undefined);
      return next.then(() => undefined);
    };

    return {
      appendStep: (record: OperationRecord): Promise<void> =>
        writeText(`${JSON.stringify({ type: 'step', record })}\n`),
      appendChunk: (records: readonly OperationRecord[]): Promise<void> => {
        if (records.length === 0) return Promise.resolve();
        const chunk = records.map((r) => `${JSON.stringify({ type: 'step', record: r })}\n`).join('');
        return writeText(chunk);
      },
      close: async (): Promise<void> => {
        await walWriteChain.catch(() => undefined);
        await walHandle.close().catch(() => undefined);
      },
    };
  }

  async writeFailedArtifact(
    batchId: string,
    state: WalPendingState
  ): Promise<string> {
    const failedFile = path.join(this.vaultDir, `wal-failed-${batchId}.json`);
    await atomicWriteFile(failedFile, JSON.stringify(state, null, 2), { ensureDir: true });
    return failedFile;
  }

  async removePendingWalFiles(): Promise<void> {
    for (const target of [this.walJournalFile, this.walFile]) {
      try {
        await fs.unlink(target);
      } catch (error: unknown) {
        if (extractFsErrorCode(error) !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  parseNdjsonWal(raw: string): Partial<WalPendingState> | null {
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

  async recoverPendingWal(
    rollbackCompletedSteps: (completed: OperationRecord[]) => Promise<{
      rollbackFailures: BatchRollbackFailureDetail[];
      remainingRecords: OperationRecord[];
    }>
  ): Promise<boolean> {
    let recoveredAny = false;

    const recoverPayload = async (wal: Partial<WalPendingState>): Promise<boolean> => {
      if (wal.status !== 'pending') {
        return false;
      }
      const completed = Array.isArray(wal.completed) ? wal.completed : [];
      const diagnostics = RuntimeDiagnostics.getInstance();
      const { rollbackFailures, remainingRecords } = await rollbackCompletedSteps(completed);
      diagnostics.recordWalRecovery();

      if (rollbackFailures.length > 0) {
        const failedId = wal.batchId ?? 'recovery';
        const failedFile = await this.writeFailedArtifact(failedId, {
          batchId: wal.batchId ?? randomUUID(),
          description: wal.description ?? 'Interrupted batch',
          status: 'rollback_failed',
          startedAt: wal.startedAt ?? Date.now(),
          completed: remainingRecords,
          failureReason: 'Incomplete crash-recovery rollback',
          rollbackFailures,
        });
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
    };

    try {
      const rawJsonl = await fs.readFile(this.walJournalFile, 'utf-8');
      const wal = this.parseNdjsonWal(rawJsonl);
      if (wal && (await recoverPayload(wal))) {
        recoveredAny = true;
      }
    } catch (error: unknown) {
      if (extractFsErrorCode(error) !== 'ENOENT') {
        FileSystemLogger.error('Corrupt pending NDJSON WAL encountered during startup recovery', {
          walFile: this.walJournalFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const raw = await fs.readFile(this.walFile, 'utf-8');
      const wal = JSON.parse(raw) as Partial<WalPendingState>;
      if (await recoverPayload(wal)) {
        recoveredAny = true;
      }
    } catch (error: unknown) {
      if (extractFsErrorCode(error) !== 'ENOENT') {
        FileSystemLogger.error('Corrupt pending WAL file encountered during startup recovery', {
          walFile: this.walFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.removePendingWalFiles().catch(() => undefined);
    return recoveredAny;
  }
}
