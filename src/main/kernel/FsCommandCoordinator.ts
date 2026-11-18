/**
 * FsCommandCoordinator.ts - Single transactional authority for disk mutations,
 * watcher feedback suppression, cache/trie invalidation, and kernel event emission.
 */

import path from 'path';
import {
  BatchTransferResult,
  BatchTransferStep,
  FileDeleteMode,
  OperationJournalState,
  OperationRecord,
  UndoRedoResult,
} from '@shared/contracts';
import {
  BatchOperationStep,
  OperationJournal,
  getOperationJournal,
} from '@main/services/OperationJournal';
import {
  ReactiveWorkspaceKernel,
  getReactiveWorkspaceKernel,
} from '@main/services/ReactiveWorkspaceKernel';

export type EditLinksBatchStep = Extract<BatchOperationStep, { type: 'edit_links' }>;

export interface MoveCommandOptions {
  repairMarkdownLinks?: boolean;
  action?: 'move' | 'rename';
  buildLinkRepairSteps?: (
    source: string,
    destination: string
  ) => Promise<EditLinksBatchStep[]>;
}

export interface FsCommandCoordinatorDeps {
  getKernel: () => ReactiveWorkspaceKernel;
  getJournal: () => OperationJournal;
}

export class FsCommandCoordinator {
  private readonly deps: FsCommandCoordinatorDeps;

  constructor(deps?: Partial<FsCommandCoordinatorDeps>) {
    this.deps = {
      getKernel: deps?.getKernel ?? getReactiveWorkspaceKernel,
      getJournal: deps?.getJournal ?? getOperationJournal,
    };
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean }> {
    const kernel = this.deps.getKernel();
    kernel.suppressPaths([filePath]);
    const result = await kernel.getFileSystemService().writeFile(filePath, content);
    kernel.notifyMutation('change', filePath);
    return result;
  }

  async createFile(
    canonicalFullPath: string,
    content: string = ''
  ): Promise<{ success: boolean; path: string }> {
    const kernel = this.deps.getKernel();
    const journal = this.deps.getJournal();
    kernel.suppressPaths([canonicalFullPath]);
    await kernel.getFileSystemService().writeFile(canonicalFullPath, content);
    await journal.recordCreation(canonicalFullPath, false, Buffer.byteLength(content, 'utf-8'));
    kernel.notifyMutation('create', canonicalFullPath);
    return { success: true, path: canonicalFullPath };
  }

  async createDirectory(canonicalFullPath: string): Promise<{ success: boolean; path: string }> {
    const kernel = this.deps.getKernel();
    const journal = this.deps.getJournal();
    kernel.suppressPaths([canonicalFullPath]);
    await kernel.getFileSystemService().createDirectory(canonicalFullPath);
    await journal.recordCreation(canonicalFullPath, true, 0);
    kernel.notifyMutation('create', canonicalFullPath);
    return { success: true, path: canonicalFullPath };
  }

  async deletePath(
    targetPath: string,
    recursive: boolean = true,
    mode: FileDeleteMode = 'vault'
  ): Promise<{ success: boolean }> {
    const kernel = this.deps.getKernel();
    const journal = this.deps.getJournal();
    kernel.suppressPaths([targetPath]);
    await journal.delete(targetPath, recursive, mode);
    kernel.notifyMutation('unlink', targetPath);
    return { success: true };
  }

  async moveOrRename(
    source: string,
    destination: string,
    options: MoveCommandOptions = {}
  ): Promise<{ success: boolean; newPath: string; repairedLinksCount?: number }> {
    const kernel = this.deps.getKernel();
    const journal = this.deps.getJournal();

    if (options.repairMarkdownLinks && options.buildLinkRepairSteps) {
      let linkSteps: EditLinksBatchStep[] = [];
      try {
        linkSteps = await options.buildLinkRepairSteps(source, destination);
      } catch {
        // Proceed with move even if optional link repair lookup fails
      }

      if (linkSteps.length > 0) {
        const steps: BatchOperationStep[] = [
          { type: 'move', source, destination },
          ...linkSteps,
        ];
        kernel.suppressPaths([source, destination, ...linkSteps.map((s) => s.filePath)]);
        const batchRes = await journal.executeBatch(
          `Move ${path.basename(source)} + repair ${linkSteps.length} link(s)`,
          steps
        );
        const canonicalDest = batchRes.operation.children?.[0]?.destinationPath ?? destination;
        kernel.notifyMutation('unlink', source);
        kernel.notifyMutation('create', canonicalDest);
        for (const edit of linkSteps) {
          kernel.notifyMutation('change', edit.filePath);
        }
        return {
          success: true,
          newPath: canonicalDest,
          repairedLinksCount: linkSteps.length,
        };
      }
    }

    kernel.suppressPaths([source, destination]);
    const result = await journal.move(source, destination, options.action ?? 'move');
    kernel.notifyMutation('unlink', source);
    kernel.notifyMutation('create', result.newPath);
    return { success: result.success, newPath: result.newPath };
  }

  async copy(source: string, destination: string): Promise<{ success: boolean; copiedPath: string }> {
    const kernel = this.deps.getKernel();
    const journal = this.deps.getJournal();
    kernel.suppressPaths([destination]);
    const result = await journal.copy(source, destination);
    kernel.notifyMutation('create', result.copiedPath);
    return { success: result.success, copiedPath: result.copiedPath };
  }

  suppressBatchSteps(steps: BatchOperationStep[]): void {
    const kernel = this.deps.getKernel();
    const suppressList: string[] = [];
    for (const step of steps) {
      if (step.type === 'move' || step.type === 'rename') {
        suppressList.push(step.source, step.destination);
      } else if (step.type === 'copy') {
        suppressList.push(step.destination);
      } else if (step.type === 'delete' || step.type === 'create_dir') {
        suppressList.push(step.path);
      } else if (step.type === 'edit_links') {
        suppressList.push(step.filePath);
      }
    }
    kernel.suppressPaths(suppressList);
  }

  async executeBatch(
    description: string,
    steps: BatchOperationStep[]
  ): Promise<Awaited<ReturnType<OperationJournal['executeBatch']>>> {
    this.suppressBatchSteps(steps);
    const result = await this.deps.getJournal().executeBatch(description, steps);
    this.emitRecordMutations(result.operation, 'redo');
    return result;
  }

  async batchTransfer(steps: BatchTransferStep[], description?: string): Promise<BatchTransferResult> {
    const journalSteps: BatchOperationStep[] = steps.map((step) => {
      if (step.type === 'delete') {
        return {
          type: 'delete',
          path: step.path,
          recursive: step.recursive ?? true,
          mode: step.mode ?? 'vault',
        };
      }
      return {
        type: step.type,
        source: step.source,
        destination: step.destination,
      };
    });

    const label = description?.trim() || `Batch transfer (${steps.length} items)`;
    const result = await this.executeBatch(label, journalSteps);
    return {
      success: result.success,
      count: steps.length,
      operationId: result.operation.id,
      journalState: result.state,
    };
  }

  async undo(): Promise<UndoRedoResult> {
    const result = await this.deps.getJournal().undo();
    if (result.success) {
      this.emitRecordMutations(result.operation, 'undo');
    }
    return result;
  }

  async redo(): Promise<UndoRedoResult> {
    const result = await this.deps.getJournal().redo();
    if (result.success) {
      this.emitRecordMutations(result.operation, 'redo');
    }
    return result;
  }

  async restoreTrashItem(entryId: string): Promise<UndoRedoResult> {
    const result = await this.deps.getJournal().restoreVaultItem(entryId);
    if (result.success && result.restoredPath) {
      this.deps.getKernel().notifyMutation('create', result.restoredPath);
    }
    return result;
  }

  async purgeTrashItem(entryId: string): Promise<OperationJournalState> {
    return this.deps.getJournal().purgeVaultItem(entryId);
  }

  async emptyTrashVault(): Promise<OperationJournalState> {
    return this.deps.getJournal().emptyVault();
  }

  emitRecordMutations(record: OperationRecord | undefined, direction: 'undo' | 'redo'): void {
    if (!record) return;
    if (record.children && record.children.length > 0) {
      const seq = direction === 'undo' ? [...record.children].reverse() : record.children;
      for (const child of seq) {
        this.emitRecordMutations(child, direction);
      }
      return;
    }

    const kernel = this.deps.getKernel();
    if (record.type === 'delete') {
      kernel.notifyMutation(direction === 'undo' ? 'create' : 'unlink', record.sourcePath);
    } else if (record.type === 'move' || record.type === 'rename') {
      if (direction === 'undo') {
        if (record.destinationPath) kernel.notifyMutation('unlink', record.destinationPath);
        kernel.notifyMutation('create', record.sourcePath);
      } else {
        kernel.notifyMutation('unlink', record.sourcePath);
        if (record.destinationPath) kernel.notifyMutation('create', record.destinationPath);
      }
    } else if (record.type === 'copy') {
      if (record.destinationPath) {
        kernel.notifyMutation(direction === 'undo' ? 'unlink' : 'create', record.destinationPath);
      }
    } else if (record.type === 'edit_links') {
      kernel.notifyMutation('change', record.sourcePath);
    } else if (record.type === 'create_file' || record.type === 'create_dir') {
      kernel.notifyMutation(direction === 'undo' ? 'unlink' : 'create', record.sourcePath);
    }
  }
}

let coordinatorSingleton: FsCommandCoordinator | null = null;

export function getFsCommandCoordinator(): FsCommandCoordinator {
  if (!coordinatorSingleton) {
    coordinatorSingleton = new FsCommandCoordinator();
  }
  return coordinatorSingleton;
}

export function resetFsCommandCoordinator(): void {
  coordinatorSingleton = null;
}
