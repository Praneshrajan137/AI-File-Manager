import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IpcMainInvokeEvent } from 'electron';

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
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
  shell: { openPath: jest.fn().mockResolvedValue('') },
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
import { ALL_IPC_CHANNELS, IPCEnvelope } from '@shared/ipc/contracts';

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
});
