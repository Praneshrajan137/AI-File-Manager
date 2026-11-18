/**
 * TrashVaultStore.ts - Persistent undo/redo journal serialization, staging vault payloads,
 * TTL/size quota eviction, and cross-device payload movement.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  OperationJournalState,
  OperationRecord,
  TrashVaultEntry,
} from '@shared/contracts';
import { FileSystemLogger } from '@shared/logging';
import { atomicWriteFile, extractFsErrorCode } from '@shared/utils/atomicFs';

interface PersistedJournalData {
  undoStack: OperationRecord[];
  redoStack: OperationRecord[];
}

export class TrashVaultStore {
  readonly payloadsDir: string;
  readonly journalFile: string;

  constructor(
    readonly vaultDir: string,
    private readonly maxHistory: number,
    private readonly maxVaultBytes: number,
    private readonly maxVaultAgeMs: number
  ) {
    this.payloadsDir = path.join(vaultDir, 'payloads');
    this.journalFile = path.join(vaultDir, 'journal.json');
  }

  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.payloadsDir, { recursive: true });
  }

  async loadStacks(): Promise<PersistedJournalData> {
    await this.ensureDirectories();
    try {
      const raw = await fs.readFile(this.journalFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedJournalData>;
      return {
        undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
        redoStack: Array.isArray(parsed.redoStack) ? parsed.redoStack : [],
      };
    } catch (error: unknown) {
      if (extractFsErrorCode(error) !== 'ENOENT') {
        FileSystemLogger.warn('Failed to parse operation journal, starting clean', {
          journalFile: this.journalFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { undoStack: [], redoStack: [] };
    }
  }

  async saveStacks(undoStack: OperationRecord[], redoStack: OperationRecord[]): Promise<void> {
    await this.ensureDirectories();
    const payload: PersistedJournalData = { undoStack, redoStack };
    await atomicWriteFile(this.journalFile, JSON.stringify(payload, null, 2), { ensureDir: true });
  }

  async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.lstat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async computeEntrySize(targetPath: string): Promise<number> {
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
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(full);
        } else {
          const st = await fs.lstat(full).catch(() => null);
          if (st) total += st.size;
        }
      }
    }
    return total;
  }

  async movePathAtomicOrCrossDevice(
    sourcePath: string,
    destinationPath: string,
    isDirectory: boolean
  ): Promise<void> {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error: unknown) {
      if (extractFsErrorCode(error) !== 'EXDEV') {
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

  countRecordVaultBytes(record: OperationRecord): number {
    let total = record.vaultPayloadPath ? record.size : 0;
    if (record.children) {
      for (const child of record.children) {
        total += this.countRecordVaultBytes(child);
      }
    }
    return total;
  }

  hasVaultPayload(record: OperationRecord): boolean {
    if (record.vaultPayloadPath || (record.type === 'delete' && record.isSymlink)) {
      return true;
    }
    return Boolean(record.children?.some((child) => this.hasVaultPayload(child)));
  }

  collectDeleteVaultItems(records: readonly OperationRecord[]): OperationRecord[] {
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

  currentVaultBytes(
    undoStack: readonly OperationRecord[],
    redoStack: readonly OperationRecord[]
  ): number {
    let total = 0;
    for (const op of undoStack) total += this.countRecordVaultBytes(op);
    for (const op of redoStack) total += this.countRecordVaultBytes(op);
    return total;
  }

  async removePayload(payloadPath?: string): Promise<void> {
    if (!payloadPath) return;
    await fs.rm(payloadPath, { recursive: true, force: true }).catch(() => undefined);
  }

  async removeRecordPayloads(record: OperationRecord): Promise<void> {
    await this.removePayload(record.vaultPayloadPath);
    if (record.children) {
      for (const child of record.children) {
        await this.removeRecordPayloads(child);
      }
    }
  }

  async evictExpiredRecords(
    undoStack: OperationRecord[],
    redoStack: OperationRecord[]
  ): Promise<{ changed: boolean; undoStack: OperationRecord[]; redoStack: OperationRecord[] }> {
    if (this.maxVaultAgeMs <= 0) {
      return { changed: false, undoStack, redoStack };
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

    const nextUndo = await filterExpired(undoStack);
    const nextRedo = await filterExpired(redoStack);
    return { changed, undoStack: nextUndo, redoStack: nextRedo };
  }

  async enforceQuotas(undoStack: OperationRecord[], redoStack: OperationRecord[]): Promise<void> {
    while (undoStack.length > this.maxHistory) {
      const evicted = undoStack.shift();
      if (evicted) {
        await this.removeRecordPayloads(evicted);
      }
    }

    while (this.currentVaultBytes(undoStack, redoStack) > this.maxVaultBytes && undoStack.length > 1) {
      const oldestWithPayloadIdx = undoStack.findIndex(
        (op, idx) => this.hasVaultPayload(op) && idx < undoStack.length - 1
      );
      if (oldestWithPayloadIdx === -1) {
        break;
      }
      const [evicted] = undoStack.splice(oldestWithPayloadIdx, 1);
      await this.removeRecordPayloads(evicted);
    }
  }

  async resetPayloadsDir(): Promise<void> {
    await fs.rm(this.payloadsDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(this.payloadsDir, { recursive: true });
  }

  async listVaultEntries(undoStack: readonly OperationRecord[]): Promise<TrashVaultEntry[]> {
    const rawItems = this.collectDeleteVaultItems(undoStack);
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
  }

  buildStateSnapshot(
    undoStack: readonly OperationRecord[],
    redoStack: readonly OperationRecord[]
  ): OperationJournalState {
    const vaultItems = this.collectDeleteVaultItems(undoStack);
    const vaultTotalBytes = this.currentVaultBytes(undoStack, redoStack);

    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoCount: undoStack.length,
      redoCount: redoStack.length,
      lastUndoDescription: undoStack[undoStack.length - 1]?.description,
      lastRedoDescription: redoStack[redoStack.length - 1]?.description,
      vaultItemCount: vaultItems.length,
      vaultTotalBytes,
    };
  }
}
