import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { ipcMain, dialog } from 'electron';
import { DirectoryScanner } from '@main/services/DirectoryScanner';
import { FileSystemService } from '@main/services/FileSystemService';
import { FileNode } from '@shared/contracts';
import { ConfigManager, getDefaultForbiddenPaths } from '@shared/config';
import { registerAllHandlers, unregisterAllHandlers, getRegisteredChannels } from '@main/handlers/ipcHandlers';
import { searchWorkspacePaths } from '@main/handlers/searchHandlers';
import { getReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { ALL_IPC_CHANNELS } from '@shared/ipc/contracts';
import { resetPathValidator } from '@main/handlers/securityMiddleware';
import { PathValidator } from '@main/services/PathValidator';

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: jest.fn(() => null),
  },
  shell: {
    openPath: jest.fn(),
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(),
  },
}));

describe('Stage 1 (M7): DirectoryScanner Exclusions & Vault IPC Kernel Reload', () => {
  let sandboxDir: string;
  let rootA: string;
  let rootB: string;
  let configPath: string;
  let prevAllowedRootsEnv: string | undefined;

  beforeEach(async () => {
    prevAllowedRootsEnv = process.env.FILE_MANAGER_ALLOWED_ROOTS;
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-scanner-test-'));
    rootA = path.join(sandboxDir, 'root-a');
    rootB = path.join(sandboxDir, 'root-b');
    configPath = path.join(sandboxDir, 'config.json');
    await fs.mkdir(rootA, { recursive: true });
    await fs.mkdir(rootB, { recursive: true });
    await fs.writeFile(path.join(rootA, 'readme.md'), '# Alpha Root', 'utf-8');
    await fs.writeFile(path.join(rootB, 'beta.txt'), 'Beta Workspace Content', 'utf-8');

    process.env.FILE_MANAGER_ALLOWED_ROOTS = rootA;
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [rootA], false);
    ConfigManager.getInstance().set('fileSystem.indexedRoots', [], false);
    ConfigManager.getInstance().set('fileSystem.favorites', [], true);

    jest.clearAllMocks();
    resetPathValidator();
  });

  afterEach(async () => {
    unregisterAllHandlers();
    resetPathValidator();
    ConfigManager.resetForTesting();
    if (prevAllowedRootsEnv === undefined) {
      delete process.env.FILE_MANAGER_ALLOWED_ROOTS;
    } else {
      process.env.FILE_MANAGER_ALLOWED_ROOTS = prevAllowedRootsEnv;
    }
    if (fsSync.existsSync(sandboxDir)) {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    }
  });

  it('excludes .git, node_modules, trash-vault, and symlinks by default in DirectoryScanner', async () => {
    const mockFs = new FileSystemService(rootA) as jest.Mocked<FileSystemService>;
    const makeNode = (name: string, isDir: boolean, extra: Partial<FileNode> = {}): FileNode => ({
      path: path.join(rootA, name),
      name,
      isDirectory: isDir,
      size: isDir ? 0 : 10,
      modified: Date.now(),
      extension: isDir ? '' : 'ts',
      mimeType: 'text/plain',
      ...extra,
    });

    const spyReadDir = jest.spyOn(mockFs, 'readDirectory').mockResolvedValue([
      makeNode('src', true),
      makeNode('node_modules', true),
      makeNode('.git', true),
      makeNode('trash-vault', true),
      makeNode('app.ts', false),
      makeNode('escape-link', true, { isSymbolicLink: true } as Partial<FileNode> & { isSymbolicLink?: boolean }),
    ]);

    const scanner = new DirectoryScanner(mockFs);
    const defaultScan = await scanner.scan(rootA, { recursive: false });
    expect(defaultScan.map((e) => e.name)).toEqual(['src', 'app.ts']);

    // Opting out of exclusions reveals excluded folders cleanly
    const fullScan = await scanner.scan(rootA, { recursive: false, excludedDirs: [] });
    expect(fullScan.map((e) => e.name)).toContain('node_modules');
    expect(fullScan.map((e) => e.name)).toContain('.git');
    spyReadDir.mockRestore();
  });

  it('registers all Vault and Undo/Redo IPC contracts and enforces kernel hot-reload', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    });

    registerAllHandlers();
    expect(getRegisteredChannels()).toEqual(expect.arrayContaining(ALL_IPC_CHANNELS));

    const fakeEvent = { sender: { id: 1 } } as never;

    // 1. Before adding rootB, reading rootB via FS:READ_DIR fails UNAUTHORIZED_ACCESS
    const readDirHandler = handlers.get('FS:READ_DIR')!;
    const blockedRes = (await readDirHandler(fakeEvent, { path: rootB })) as { ok: boolean };
    expect(blockedRes.ok).toBe(false);

    // 2. Add rootB via VAULT:ADD_ROOT dialog mock -> hot-reloads PathValidator & FileSystemService
    (dialog.showOpenDialog as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      filePaths: [rootB],
    });
    const addRootHandler = handlers.get('VAULT:ADD_ROOT')!;
    const addRes = (await addRootHandler(fakeEvent, { pickDialog: true })) as {
      ok: boolean;
      data: { cancelled: boolean; addedPath?: string; config: { allowedRoots: string[] } };
    };
    expect(addRes.ok).toBe(true);
    expect(addRes.data.cancelled).toBe(false);
    expect(addRes.data.config.allowedRoots.length).toBe(2);

    // Now FS:READ_DIR on rootB succeeds immediately without app restart!
    const allowedRes = (await readDirHandler(fakeEvent, { path: rootB })) as {
      ok: boolean;
      data: FileNode[];
    };
    expect(allowedRes.ok).toBe(true);
    expect(allowedRes.data.some((f) => f.name === 'beta.txt')).toBe(true);

    // 3. Opt-in AI indexing toggle & Favorites toggle
    const setIndexedHandler = handlers.get('VAULT:SET_INDEXED')!;
    const indexedOn = (await setIndexedHandler(fakeEvent, { path: rootB, enabled: true })) as {
      ok: boolean;
      data: { indexedRoots: string[] };
    };
    expect(indexedOn.ok).toBe(true);
    expect(indexedOn.data.indexedRoots.length).toBe(1);

    const favHandler = handlers.get('VAULT:TOGGLE_FAVORITE')!;
    const favAdded = (await favHandler(fakeEvent, { path: path.join(rootB, 'beta.txt') })) as {
      ok: boolean;
      data: { favorites: string[] };
    };
    expect(favAdded.ok).toBe(true);
    expect(favAdded.data.favorites.length).toBe(1);

    // 4. Removing rootB cleans its indexedRoot/favorite and refuses removing the final rootA
    const removeRootHandler = handlers.get('VAULT:REMOVE_ROOT')!;
    const afterRemoveB = (await removeRootHandler(fakeEvent, { path: rootB })) as {
      ok: boolean;
      data: { allowedRoots: string[]; indexedRoots: string[]; favorites: string[] };
    };
    expect(afterRemoveB.ok).toBe(true);
    expect(afterRemoveB.data.allowedRoots).toHaveLength(1);
    expect(afterRemoveB.data.indexedRoots).toHaveLength(0);
    expect(afterRemoveB.data.favorites).toHaveLength(0);

    const removeLastRes = (await removeRootHandler(fakeEvent, { path: rootA })) as { ok: boolean };
    expect(removeLastRes.ok).toBe(false);
  });

  it('accepts non-symlink short-path aliases under canonical roots while blocking external symlinks into roots', () => {
    const fakeCanonicalRoot = path.join(path.parse(sandboxDir).root, 'Users', 'runneradmin', 'vault-a');
    const fakeShortPath = path.join(path.parse(sandboxDir).root, 'Users', 'RUNNER~1', 'vault-a', 'note.txt');
    const fakeOutsideSymlinkTarget = path.join(path.parse(sandboxDir).root, 'outside', 'link-to-vault', 'note.txt');

    const lstatSpy = jest.spyOn(fsSync, 'lstatSync').mockImplementation(((p: fsSync.PathLike) => {
      const target = String(p).toLowerCase();
      if (target.endsWith('link-to-vault')) {
        return { isSymbolicLink: () => true } as fsSync.Stats;
      }
      return { isSymbolicLink: () => false } as fsSync.Stats;
    }) as typeof fsSync.lstatSync);

    const resolveMockAlias = (p: fsSync.PathLike): string => {
      const s = String(p).replace(/RUNNER~1/gi, 'runneradmin');
      return s.toLowerCase().includes('link-to-vault') ? fakeCanonicalRoot : s;
    };

    const nativeSpy = jest
      .spyOn(fsSync.realpathSync, 'native')
      .mockImplementation(resolveMockAlias as typeof fsSync.realpathSync.native);

    const realpathSpy = jest
      .spyOn(fsSync, 'realpathSync')
      .mockImplementation(resolveMockAlias as typeof fsSync.realpathSync);

    try {
      const validator = new PathValidator([fakeCanonicalRoot]);
      expect(validator.validate(fakeShortPath).valid).toBe(true);
      expect(validator.validate(fakeOutsideSymlinkTarget)).toMatchObject({
        valid: false,
        error: 'UNAUTHORIZED_ACCESS',
      });
    } finally {
      lstatSpy.mockRestore();
      nativeSpy.mockRestore();
      realpathSpy.mockRestore();
    }
  });

  it('rejects drive roots/forbidden paths on VAULT:ADD_ROOT, retains default forbiddenPaths, and keeps FS:READ_DIR visible while excluding .env from search', async () => {
    // 1. User config attempting to empty security.forbiddenPaths must still retain OS defaults
    const customConfigPath = path.join(sandboxDir, 'override-config.json');
    await fs.writeFile(
      customConfigPath,
      JSON.stringify({
        fileSystem: { allowedRoots: [rootA] },
        security: { forbiddenPaths: [] },
      }),
      'utf-8'
    );
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath: customConfigPath });
    const configuredForbidden = ConfigManager.getInstance().get('security').forbiddenPaths;
    expect(configuredForbidden).toEqual(expect.arrayContaining(getDefaultForbiddenPaths()));

    // Restore test config path before handler registration
    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [rootA], true);

    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    });
    registerAllHandlers();
    const fakeEvent = { sender: { id: 2 } } as never;

    const addRootHandler = handlers.get('VAULT:ADD_ROOT')!;
    const driveRoot = path.parse(sandboxDir).root;
    const driveReject = (await addRootHandler(fakeEvent, {
      pickDialog: false,
      path: driveRoot,
    })) as { ok: boolean; error?: { code: string } };
    expect(driveReject.ok).toBe(false);

    const traversalReject = (await addRootHandler(fakeEvent, {
      pickDialog: false,
      path: path.join(sandboxDir, '..', 'escape-attempt'),
    })) as { ok: boolean };
    expect(traversalReject.ok).toBe(false);

    // 2. .env stays visible in human explorer (FS:READ_DIR) while hidden from SEARCH:QUERY & PathTrie
    const envPath = path.join(rootA, '.env');
    await fs.writeFile(envPath, 'OPENAI_API_KEY=sk-proj-testsecret1234567890123456\n', 'utf-8');
    getReactiveWorkspaceKernel().getFileSystemService().invalidatePath(rootA);

    const readDirHandler = handlers.get('FS:READ_DIR')!;
    const explorerRes = (await readDirHandler(fakeEvent, { path: rootA })) as {
      ok: boolean;
      data: FileNode[];
    };
    expect(explorerRes.ok).toBe(true);
    expect(explorerRes.data.some((f) => f.name === '.env')).toBe(true);

    const searchQueryHandler = handlers.get('SEARCH:QUERY')!;
    const searchRes = (await searchQueryHandler(fakeEvent, {
      query: 'env',
      searchRoot: rootA,
    })) as { ok: boolean; data: FileNode[] };
    expect(searchRes.ok).toBe(true);
    expect(searchRes.data.some((f) => f.name === '.env')).toBe(false);

    const agentSearchHits = await searchWorkspacePaths('env', rootA);
    expect(agentSearchHits.some((p) => p.endsWith('.env'))).toBe(false);

    // 3. Outside test mode, programmatic pickDialog:false VAULT:ADD_ROOT is rejected cleanly
    const prevNodeEnv = process.env.NODE_ENV;
    const prevE2e = process.env.E2E_TEST;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.E2E_TEST;
      const prodBypassAttempt = (await addRootHandler(fakeEvent, {
        pickDialog: false,
        path: rootB,
      })) as { ok: boolean; error?: { code: string } };
      expect(prodBypassAttempt.ok).toBe(false);
      expect(prodBypassAttempt.error?.code).toBe('UNAUTHORIZED_ACCESS');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevE2e === undefined) delete process.env.E2E_TEST;
      else process.env.E2E_TEST = prevE2e;
    }
  });
});
