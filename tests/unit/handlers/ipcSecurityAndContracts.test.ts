import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import type { IpcMainInvokeEvent } from 'electron';

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const mockShell = {
  openPath: jest.fn().mockResolvedValue(''),
  showItemInFolder: jest.fn(),
};
const mockIpcMain = {
  handle: jest.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    registeredHandlers.set(channel, handler);
  }),
  removeHandler: jest.fn((channel: string) => {
    registeredHandlers.delete(channel);
  }),
};

jest.mock('electron', () => ({
  ipcMain: mockIpcMain,
  shell: mockShell,
  clipboard: { writeText: jest.fn() },
  app: { getPath: jest.fn(() => os.tmpdir()) },
  BrowserWindow: { getAllWindows: jest.fn(() => []) },
}));

import { PathValidator } from '@main/services/PathValidator';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import {
  resetPathValidator,
  resetRateLimiter,
  validateAndInvokeContract,
  resolveAllowedRoots,
} from '@main/handlers/securityMiddleware';
import { resetFileSystemService } from '@main/handlers/fileSystemHandlers';
import { resetSearchService } from '@main/handlers/searchHandlers';
import {
  registerAllHandlers,
  unregisterAllHandlers,
  areHandlersRegistered,
  getRegisteredChannels,
} from '@main/handlers/ipcHandlers';
import { ConfigManager } from '@shared/config/ConfigManager';
import { ALL_IPC_CHANNELS, IPC_CONTRACTS, IPCEnvelope } from '@shared/ipc/contracts';

const mockEvent = {
  sender: {
    id: 1,
    isDestroyed: () => false,
    send: jest.fn(),
  },
} as unknown as IpcMainInvokeEvent;

describe('M2 Canonical Security Boundary & Declarative IPC Contracts', () => {
  const originalEnv = { ...process.env };
  let sandboxDir: string;
  let allowedRoot: string;
  let secondRoot: string;
  let outsideRoot: string;
  let isolatedConfigPath: string;

  beforeAll(async () => {
    sandboxDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fm-m2-sec-'));
    allowedRoot = path.join(sandboxDir, 'allowed');
    secondRoot = path.join(sandboxDir, 'second-allowed');
    outsideRoot = path.join(sandboxDir, 'outside-secret');
    isolatedConfigPath = path.join(sandboxDir, 'config.json');

    await fs.promises.mkdir(allowedRoot, { recursive: true });
    await fs.promises.mkdir(secondRoot, { recursive: true });
    await fs.promises.mkdir(outsideRoot, { recursive: true });
    await fs.promises.writeFile(path.join(allowedRoot, 'safe.txt'), 'hello world');
    await fs.promises.writeFile(path.join(secondRoot, 'second.txt'), 'multi root ok');
    await fs.promises.writeFile(path.join(outsideRoot, 'secret.txt'), 'top secret');
  });

  afterAll(async () => {
    await fs.promises.rm(sandboxDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    registeredHandlers.clear();
    mockIpcMain.handle.mockClear();
    mockIpcMain.removeHandler.mockClear();
    resetRateLimiter();
    RuntimeDiagnostics.resetForTesting();

    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
    };
    delete process.env.FILE_MANAGER_ALLOWED_ROOTS;
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath: isolatedConfigPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [allowedRoot, secondRoot]);
    resetPathValidator();
    resetFileSystemService();
    resetSearchService();
  });

  afterEach(() => {
    unregisterAllHandlers();
    process.env = { ...originalEnv };
    ConfigManager.resetForTesting();
    resetPathValidator();
    resetFileSystemService();
    resetSearchService();
  });

  it('supports multiple allowed roots and Windows case-insensitive system blocks', () => {
    const validator = new PathValidator([allowedRoot, secondRoot]);
    expect(validator.validate(path.join(allowedRoot, 'safe.txt')).valid).toBe(true);
    expect(validator.validate(path.join(secondRoot, 'second.txt')).valid).toBe(true);
    expect(validator.validate(path.join(outsideRoot, 'secret.txt')).valid).toBe(false);

    if (process.platform === 'win32') {
      const lowercaseSys = validator.validate('c:\\windows\\system32\\drivers\\etc\\hosts');
      expect(lowercaseSys.valid).toBe(false);
      expect(lowercaseSys.error).toBe('UNAUTHORIZED_ACCESS');
    }
  });

  it('blocks symlink / junction escape for both reads and nested new-file creations', async () => {
    const linkPath = path.join(allowedRoot, 'escape-link');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.promises.symlink(outsideRoot, linkPath, linkType);

    const validator = new PathValidator([allowedRoot]);
    const readEscape = await validator.validateCanonical(path.join(linkPath, 'secret.txt'));
    expect(readEscape.valid).toBe(false);
    expect(readEscape.error).toBe('SYMLINK_ESCAPE');

    const createThroughSymlink = await validator.validateCanonical(
      path.join(linkPath, 'new-nested', 'payload.txt')
    );
    expect(createThroughSymlink.valid).toBe(false);
    expect(createThroughSymlink.error).toBe('SYMLINK_ESCAPE');
  });

  it('registers all declarative contracts dynamically and unregisters cleanly', async () => {
    expect(areHandlersRegistered()).toBe(false);
    registerAllHandlers();

    expect(areHandlersRegistered()).toBe(true);
    expect(getRegisteredChannels().sort()).toEqual([...ALL_IPC_CHANNELS].sort());

    const diagHandler = registeredHandlers.get('RUNTIME:GET_DIAGNOSTICS')!;
    const diagEnvelope = (await diagHandler(mockEvent)) as IPCEnvelope<{
      ipc: { registeredChannels: number };
      allowedRoots: string[];
    }>;
    expect(diagEnvelope.ok).toBe(true);
    if (diagEnvelope.ok) {
      expect(diagEnvelope.data.ipc.registeredChannels).toBe(ALL_IPC_CHANNELS.length);
      expect(diagEnvelope.data.allowedRoots).toContain(path.resolve(allowedRoot));
    }

    unregisterAllHandlers();
    expect(areHandlersRegistered()).toBe(false);
    expect(registeredHandlers.size).toBe(0);
  });

  it('enforces safe entry names on FS:CREATE_FILE, FS:CREATE_DIR, and FS:RENAME', async () => {
    registerAllHandlers();

    const createFile = registeredHandlers.get('FS:CREATE_FILE')!;
    const badCreate = (await createFile(mockEvent, {
      path: allowedRoot,
      name: '../outside-escape.txt',
    })) as IPCEnvelope<unknown>;
    expect(badCreate.ok).toBe(false);
    if (!badCreate.ok) {
      expect(badCreate.error.code).toBe('INVALID_INPUT');
    }

    const createDir = registeredHandlers.get('FS:CREATE_DIR')!;
    const slashDir = (await createDir(mockEvent, {
      path: allowedRoot,
      name: 'nested/sub',
    })) as IPCEnvelope<unknown>;
    expect(slashDir.ok).toBe(false);

    const rename = registeredHandlers.get('FS:RENAME')!;
    const badRename = (await rename(mockEvent, {
      oldPath: path.join(allowedRoot, 'safe.txt'),
      newName: '..\\escape.txt',
    })) as IPCEnvelope<unknown>;
    expect(badRename.ok).toBe(false);

    const goodCreate = (await createFile(mockEvent, {
      path: allowedRoot,
      name: 'created.txt',
      content: 'ok',
    })) as IPCEnvelope<{ success: boolean; path: string }>;
    expect(goodCreate.ok).toBe(true);
    expect(fs.existsSync(path.join(allowedRoot, 'created.txt'))).toBe(true);

    // Symlink in allowedRoot pointing outside should be link-safely renameable without dereferencing target
    const linkOld = path.join(allowedRoot, 'alias-link.txt');
    const linkTarget = path.join(outsideRoot, 'secret.txt');
    try {
      await fs.promises.symlink(linkTarget, linkOld, 'file');
      const renameSymRes = (await rename(mockEvent, {
        oldPath: linkOld,
        newName: 'alias-renamed.txt',
      })) as IPCEnvelope<{ success: boolean; newPath: string }>;
      expect(renameSymRes.ok).toBe(true);
      expect(fs.existsSync(path.join(allowedRoot, 'alias-renamed.txt'))).toBe(true);
    } catch (err: unknown) {
      // Windows developer mode disabled environments may throw EPERM creating file symlinks
      if ((err as { code?: string })?.code !== 'EPERM') {
        throw err;
      }
    }
  });

  it('eliminates path bypasses in SEARCH:QUERY, LLM:START_INDEXING, LLM:INDEX_FILE, SHELL:OPEN_PATH, and LLM:QUERY channel', async () => {
    registerAllHandlers();

    const searchQuery = registeredHandlers.get('SEARCH:QUERY')!;
    const badSearch = (await searchQuery(mockEvent, {
      query: 'secret',
      searchRoot: outsideRoot,
    })) as IPCEnvelope<unknown>;
    expect(badSearch.ok).toBe(false);
    if (!badSearch.ok) {
      expect(badSearch.error.code).toBe('UNAUTHORIZED_ACCESS');
    }

    const validSearch = (await searchQuery(mockEvent, {
      query: 'safe',
      searchRoot: allowedRoot,
    })) as IPCEnvelope<Array<{ name: string }>>;
    expect(validSearch.ok).toBe(true);
    if (validSearch.ok) {
      expect(validSearch.data.map((f) => f.name)).toContain('safe.txt');
    }

    const startIndexing = registeredHandlers.get('LLM:START_INDEXING')!;
    const badIndexDir = (await startIndexing(mockEvent, {
      path: outsideRoot,
    })) as IPCEnvelope<unknown>;
    expect(badIndexDir.ok).toBe(false);

    const indexFile = registeredHandlers.get('LLM:INDEX_FILE')!;
    const badIndexFile = (await indexFile(mockEvent, {
      filePath: path.join(outsideRoot, 'secret.txt'),
    })) as IPCEnvelope<unknown>;
    expect(badIndexFile.ok).toBe(false);

    const shellOpen = registeredHandlers.get('SHELL:OPEN_PATH')!;
    const badShell = (await shellOpen(mockEvent, outsideRoot)) as IPCEnvelope<unknown>;
    expect(badShell.ok).toBe(false);

    const llmQuery = registeredHandlers.get('LLM:QUERY')!;
    const spoofedChannel = (await llmQuery(mockEvent, {
      query: 'hello',
      channel: 'FILE_DELETED',
    })) as IPCEnvelope<unknown>;
    expect(spoofedChannel.ok).toBe(false);
    if (!spoofedChannel.ok) {
      expect(spoofedChannel.error.code).toBe('INVALID_INPUT');
    }
  });

  it('resolves allowed roots via ConfigManager + FILE_MANAGER_ALLOWED_ROOTS and records diagnostics metrics cleanly', async () => {
    const roots = resolveAllowedRoots();
    expect(roots).toEqual([path.resolve(allowedRoot), path.resolve(secondRoot)]);

    process.env.FILE_MANAGER_ALLOWED_ROOTS = outsideRoot;
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath: isolatedConfigPath });
    const envMergedRoots = resolveAllowedRoots();
    expect(envMergedRoots).toContain(path.resolve(outsideRoot));

    const envelope = await validateAndInvokeContract('ping', mockEvent, undefined, async () => 'pong');
    expect(envelope).toEqual({ ok: true, data: 'pong' });
    expect(RuntimeDiagnostics.getInstance().getSnapshot().ipc.totalCalls).toBe(1);
  });

  it('blocks executable SHELL:OPEN_PATH targets, validates senderFrame origins, and enforces rateLimit & bounds on all channels', async () => {
    registerAllHandlers();
    mockShell.openPath.mockClear();
    mockShell.showItemInFolder.mockClear();

    for (const channel of ALL_IPC_CHANNELS) {
      expect(IPC_CONTRACTS[channel].rateLimit).toBeDefined();
    }

    const exeFile = path.join(allowedRoot, 'installer.exe');
    const ps1File = path.join(allowedRoot, 'script.ps1');
    await fs.promises.writeFile(exeFile, 'MZ', 'utf-8');
    await fs.promises.writeFile(ps1File, 'Write-Host 1', 'utf-8');

    const shellOpen = registeredHandlers.get('SHELL:OPEN_PATH')!;
    const blockedExe = (await shellOpen(mockEvent, { path: exeFile })) as IPCEnvelope<unknown>;
    expect(blockedExe.ok).toBe(false);
    if (!blockedExe.ok) {
      expect(blockedExe.error.code).toBe('UNAUTHORIZED_ACCESS');
    }

    const blockedPs1 = (await shellOpen(mockEvent, { path: ps1File })) as IPCEnvelope<unknown>;
    expect(blockedPs1.ok).toBe(false);
    expect(mockShell.openPath).not.toHaveBeenCalled();

    const shellReveal = registeredHandlers.get('SHELL:REVEAL_IN_FOLDER')!;
    const revealRes = (await shellReveal(mockEvent, { path: exeFile })) as IPCEnvelope<{ success: boolean }>;
    expect(revealRes.ok).toBe(true);
    expect(mockShell.showItemInFolder).toHaveBeenCalledWith(await fs.promises.realpath(exeFile));

    const badSenderEvent = {
      ...mockEvent,
      senderFrame: { url: 'https://evil.example/hijack.html' },
    } as unknown as IpcMainInvokeEvent;
    const senderBlocked = (await validateAndInvokeContract(
      'ping',
      badSenderEvent,
      undefined,
      async () => 'pong'
    )) as IPCEnvelope<unknown>;
    expect(senderBlocked.ok).toBe(false);
    if (!senderBlocked.ok) {
      expect(senderBlocked.error.code).toBe('UNAUTHORIZED_REQUEST');
    }

    const goodRendererUrl = pathToFileURL(
      path.resolve(process.cwd(), 'dist', 'renderer', 'index.html')
    ).href;
    const goodSenderEvent = {
      ...mockEvent,
      senderFrame: { url: goodRendererUrl },
    } as unknown as IpcMainInvokeEvent;
    const senderAllowed = await validateAndInvokeContract('ping', goodSenderEvent, undefined, async () => 'pong');
    expect(senderAllowed).toEqual({ ok: true, data: 'pong' });

    const readDir = registeredHandlers.get('FS:READ_DIR')!;
    const overlongPath = await readDir(mockEvent, {
      path: path.join(allowedRoot, 'a'.repeat(4200)),
    }) as IPCEnvelope<unknown>;
    expect(overlongPath.ok).toBe(false);
    if (!overlongPath.ok) {
      expect(overlongPath.error.code).toBe('INVALID_INPUT');
    }

    // FS:BATCH_TRANSFER executes multiple moves in a single transactional Undo step
    const batchDestDir = path.join(allowedRoot, 'batch-dest');
    const srcOne = path.join(allowedRoot, 'batch-1.txt');
    const srcTwo = path.join(allowedRoot, 'batch-2.txt');
    const dstOne = path.join(batchDestDir, 'batch-1.txt');
    const dstTwo = path.join(batchDestDir, 'batch-2.txt');
    await fs.promises.mkdir(batchDestDir, { recursive: true });
    await fs.promises.writeFile(srcOne, 'one', 'utf-8');
    await fs.promises.writeFile(srcTwo, 'two', 'utf-8');

    const batchTransfer = registeredHandlers.get('FS:BATCH_TRANSFER')!;
    const batchRes = (await batchTransfer(mockEvent, {
      description: 'Move 2 batch files',
      steps: [
        { type: 'move', source: srcOne, destination: dstOne },
        { type: 'move', source: srcTwo, destination: dstTwo },
      ],
    })) as IPCEnvelope<{ success: boolean; count: number; journalState: { canUndo: boolean } }>;
    expect(batchRes.ok).toBe(true);
    if (batchRes.ok) {
      expect(batchRes.data.success).toBe(true);
      expect(batchRes.data.count).toBe(2);
      expect(batchRes.data.journalState.canUndo).toBe(true);
    }
    expect(fs.existsSync(dstOne)).toBe(true);
    expect(fs.existsSync(dstTwo)).toBe(true);

    const undoHandler = registeredHandlers.get('FS:UNDO')!;
    await undoHandler(mockEvent, {});
    expect(fs.existsSync(srcOne)).toBe(true);
    expect(fs.existsSync(srcTwo)).toBe(true);
  });
});
