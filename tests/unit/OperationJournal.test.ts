import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { BatchRollbackError, OperationJournal } from '@main/services/OperationJournal';
import { PathValidator } from '@main/services/PathValidator';
import { FileSystemService } from '@main/services/FileSystemService';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';

describe('OperationJournal (Recoverable Safety Kernel)', () => {
  let sandboxDir: string;
  let workspaceRoot: string;
  let outsideRoot: string;
  let vaultDir: string;
  let validator: PathValidator;
  let fsService: FileSystemService;
  let journal: OperationJournal;
  let trashCalls: string[];

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'op-journal-test-'));
    workspaceRoot = path.join(sandboxDir, 'workspace');
    outsideRoot = path.join(sandboxDir, 'outside');
    vaultDir = path.join(sandboxDir, 'trash-vault');
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });

    trashCalls = [];
    validator = new PathValidator([workspaceRoot]);
    fsService = new FileSystemService([workspaceRoot]);
    journal = new OperationJournal({
      vaultDir,
      maxHistory: 10,
      maxVaultBytes: 1024 * 1024,
      validator,
      fileSystemService: fsService,
      osTrashFn: async (target: string) => {
        trashCalls.push(target);
        await fs.rm(target, { recursive: true, force: true });
      },
    });
  });

  afterEach(async () => {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it('deletes to Trash Vault, persists across restart, undoes and redoes cleanly', async () => {
    const filePath = path.join(workspaceRoot, 'notes.txt');
    await fs.writeFile(filePath, 'hello recoverable world', 'utf-8');

    const delRes = await journal.delete(filePath, false, 'vault');
    expect(delRes.success).toBe(true);
    expect(delRes.mode).toBe('vault');
    await expect(fs.stat(filePath)).rejects.toThrow();

    const stateAfterDelete = await journal.getState();
    expect(stateAfterDelete.canUndo).toBe(true);
    expect(stateAfterDelete.canRedo).toBe(false);
    expect(stateAfterDelete.vaultItemCount).toBe(1);
    expect(stateAfterDelete.vaultTotalBytes).toBeGreaterThan(0);

    // Re-instantiate fresh journal pointing at the same vaultDir (simulates app restart)
    const restartedJournal = new OperationJournal({
      vaultDir,
      validator,
      fileSystemService: fsService,
    });
    const undoRes = await restartedJournal.undo();
    expect(undoRes.success).toBe(true);
    expect(await fs.readFile(filePath, 'utf-8')).toBe('hello recoverable world');
    expect(undoRes.state.canRedo).toBe(true);
    expect(undoRes.state.vaultItemCount).toBe(0);

    const redoRes = await restartedJournal.redo();
    expect(redoRes.success).toBe(true);
    await expect(fs.stat(filePath)).rejects.toThrow();
    expect(redoRes.state.canUndo).toBe(true);
    expect(redoRes.state.vaultItemCount).toBe(1);
  });

  it('supports OS trash mode and permanent delete mode explicitly', async () => {
    const trashFile = path.join(workspaceRoot, 'to-trash.txt');
    const permFile = path.join(workspaceRoot, 'to-perm.txt');
    await fs.writeFile(trashFile, 'os trash', 'utf-8');
    await fs.writeFile(permFile, 'perm delete', 'utf-8');

    await journal.delete(trashFile, false, 'trash');
    expect(trashCalls).toHaveLength(1);
    await expect(fs.stat(trashFile)).rejects.toThrow();

    await journal.delete(permFile, false, 'permanent');
    await expect(fs.stat(permFile)).rejects.toThrow();

    const state = await journal.getState();
    expect(state.canUndo).toBe(false);
    expect(state.vaultItemCount).toBe(0);
  });

  it('unlinks an in-vault junction/symlink escaping outside roots without deleting target contents', async () => {
    const outsideSecret = path.join(outsideRoot, 'important.txt');
    await fs.writeFile(outsideSecret, 'DO NOT DELETE ME', 'utf-8');

    const linkPath = path.join(workspaceRoot, 'escape-junction');
    await fs.symlink(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    // Reading through junction is still blocked by PathValidator
    await expect(fsService.readFile(path.join(linkPath, 'important.txt'))).rejects.toMatchObject({
      code: 'UNAUTHORIZED_ACCESS',
    });

    // Deleting the symlink itself unlinks safely without touching outsideRoot/important.txt
    const res = await journal.delete(linkPath, true, 'vault');
    expect(res.success).toBe(true);
    await expect(fs.lstat(linkPath)).rejects.toThrow();
    expect(await fs.readFile(outsideSecret, 'utf-8')).toBe('DO NOT DELETE ME');

    // Moving an escaping symlink relocates only the link without copying outside files
    const link2 = path.join(workspaceRoot, 'link-one');
    const link2Moved = path.join(workspaceRoot, 'link-two');
    await fs.symlink(outsideRoot, link2, process.platform === 'win32' ? 'junction' : 'dir');
    const moveRes = await journal.move(link2, link2Moved, 'move');
    expect(moveRes.success).toBe(true);
    await expect(fs.lstat(link2)).rejects.toThrow();
    expect((await fs.lstat(link2Moved)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(outsideSecret, 'utf-8')).toBe('DO NOT DELETE ME');
  });

  it('executes batch steps atomically, supports 1-click group Undo/Redo, and rolls back on mid-batch failure', async () => {
    const dirA = path.join(workspaceRoot, 'dirA');
    const dirB = path.join(workspaceRoot, 'dirB');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });

    const f1 = path.join(workspaceRoot, 'a.txt');
    const f2 = path.join(workspaceRoot, 'b.txt');
    await fs.writeFile(f1, 'A', 'utf-8');
    await fs.writeFile(f2, 'B', 'utf-8');

    // Mid-batch failure: step 3 points to missing file -> step 1 & step 2 must roll back completely
    await expect(
      journal.executeBatch('Failing Batch', [
        { type: 'move', source: f1, destination: path.join(dirA, 'a.txt') },
        { type: 'move', source: f2, destination: path.join(dirA, 'b.txt') },
        { type: 'move', source: path.join(workspaceRoot, 'missing.txt'), destination: path.join(dirA, 'missing.txt') },
      ])
    ).rejects.toThrow();

    expect(await fs.readFile(f1, 'utf-8')).toBe('A');
    expect(await fs.readFile(f2, 'utf-8')).toBe('B');
    expect((await journal.getState()).canUndo).toBe(false);

    // Succeeding batch -> 1 undo restores all files, 1 redo reapplies
    const batchRes = await journal.executeBatch('Organize into folders', [
      { type: 'move', source: f1, destination: path.join(dirA, 'a.txt') },
      { type: 'move', source: f2, destination: path.join(dirB, 'b.txt') },
    ]);
    expect(batchRes.success).toBe(true);
    expect(await fs.readFile(path.join(dirA, 'a.txt'), 'utf-8')).toBe('A');
    expect(await fs.readFile(path.join(dirB, 'b.txt'), 'utf-8')).toBe('B');

    const undoBatch = await journal.undo();
    expect(undoBatch.success).toBe(true);
    expect(await fs.readFile(f1, 'utf-8')).toBe('A');
    expect(await fs.readFile(f2, 'utf-8')).toBe('B');

    const redoBatch = await journal.redo();
    expect(redoBatch.success).toBe(true);
    expect(await fs.readFile(path.join(dirA, 'a.txt'), 'utf-8')).toBe('A');
    expect(await fs.readFile(path.join(dirB, 'b.txt'), 'utf-8')).toBe('B');
  });

  it('evicts Trash Vault entries older than maxVaultAgeMs (30-day TTL) on startup', async () => {
    const staleFile = path.join(workspaceRoot, 'stale.txt');
    const freshFile = path.join(workspaceRoot, 'fresh.txt');
    await fs.writeFile(staleFile, 'stale content', 'utf-8');
    await fs.writeFile(freshFile, 'fresh content', 'utf-8');

    await journal.delete(staleFile, false, 'vault');
    await journal.delete(freshFile, false, 'vault');

    // Backdate the first record by 31 days in journal.json
    const journalPath = path.join(vaultDir, 'journal.json');
    const persisted = JSON.parse(await fs.readFile(journalPath, 'utf-8')) as {
      undoStack: Array<{ timestamp: number; vaultPayloadPath?: string }>;
      redoStack: unknown[];
    };
    const stalePayload = persisted.undoStack[0].vaultPayloadPath!;
    persisted.undoStack[0].timestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await fs.writeFile(journalPath, JSON.stringify(persisted, null, 2), 'utf-8');

    const reloaded = new OperationJournal({
      vaultDir,
      maxVaultAgeMs: 30 * 24 * 60 * 60 * 1000,
      validator,
      fileSystemService: fsService,
    });
    const state = await reloaded.getState();
    expect(state.undoCount).toBe(1);
    expect(state.vaultItemCount).toBe(1);
    await expect(fs.stat(stalePayload)).rejects.toThrow();

    await reloaded.emptyVault();
    expect((await reloaded.getState()).vaultItemCount).toBe(0);
  });

  it('recovers interrupted wal-pending.json batches on startup and throws BatchRollbackError loudly when rollback fails', async () => {
    RuntimeDiagnostics.resetForTesting();

    // 1. Simulated crash leaving wal-pending.json on disk after step 1 moved src -> dest
    const srcFile = path.join(workspaceRoot, 'crash-src.txt');
    const destDir = path.join(workspaceRoot, 'crash-dest');
    const destFile = path.join(destDir, 'crash-src.txt');
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(destFile, 'important-payload', 'utf-8');

    const crashVault = path.join(sandboxDir, 'crash-vault');
    await fs.mkdir(path.join(crashVault, 'payloads'), { recursive: true });
    await fs.writeFile(
      path.join(crashVault, 'wal-pending.json'),
      JSON.stringify(
        {
          batchId: 'crash-batch-1',
          description: 'Interrupted organize batch',
          status: 'pending',
          startedAt: Date.now(),
          completed: [
            {
              id: 'child-1',
              type: 'move',
              timestamp: Date.now(),
              sourcePath: srcFile,
              destinationPath: destFile,
              isDirectory: false,
              size: 17,
              undoable: true,
              description: 'Move crash-src.txt',
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    );

    const recoveredJournal = new OperationJournal({
      vaultDir: crashVault,
      validator,
      fileSystemService: fsService,
    });
    const recoveredState = await recoveredJournal.getState();
    expect(recoveredState.canUndo).toBe(false);
    expect(await fs.readFile(srcFile, 'utf-8')).toBe('important-payload');
    await expect(fs.stat(destFile)).rejects.toThrow();
    await expect(fs.stat(path.join(crashVault, 'wal-pending.json'))).rejects.toThrow();
    expect(RuntimeDiagnostics.getInstance().getSnapshot().resilience?.walRecoveries).toBe(1);

    // 2. Loud BatchRollbackError when forward failure occurs AND reverse rollback encounters collision
    const liveSrc = path.join(workspaceRoot, 'live-a.txt');
    const liveDest = path.join(destDir, 'live-a.txt');
    const triggerSrc = path.join(workspaceRoot, 'live-b.txt');
    const triggerDest = path.join(destDir, 'live-b.txt');
    await fs.writeFile(liveSrc, 'ALPHA', 'utf-8');
    await fs.writeFile(triggerSrc, 'BETA', 'utf-8');

    const origMove = fsService.move.bind(fsService);
    const moveSpy = jest.spyOn(fsService, 'move').mockImplementation(async (s, d) => {
      if (path.resolve(s) === path.resolve(triggerSrc)) {
        // Plant collision at liveSrc so reverse compensation of step 1 fails loudly
        await fs.writeFile(liveSrc, 'CONFLICT', 'utf-8');
        throw new Error('Injected step 2 move failure');
      }
      return origMove(s, d);
    });

    try {
      await expect(
        journal.executeBatch('Failing Batch With Collision', [
          { type: 'move', source: liveSrc, destination: liveDest },
          { type: 'move', source: triggerSrc, destination: triggerDest },
        ])
      ).rejects.toThrow(BatchRollbackError);

      expect(RuntimeDiagnostics.getInstance().getSnapshot().resilience?.walRollbackFailures).toBe(1);
      const vaultEntries = await fs.readdir(vaultDir);
      expect(vaultEntries.some((name) => name.startsWith('wal-failed-'))).toBe(true);
    } finally {
      moveSpy.mockRestore();
    }
  });
});
