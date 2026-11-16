import fs from 'fs/promises';
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

const mockLlmService = {
  abortCopilotQuery: jest.fn(async () => ({ aborted: true })),
  applyWorkspaceOrganize: jest.fn(async () => ({
    planId: 'plan-1',
    appliedCount: 1,
    failedCount: 0,
    repairedLinksCount: 0,
    operationId: 'op-1',
    errors: [],
  })),
  checkOllamaStatus: jest.fn(async () => ({ available: true, models: ['llama3.2'] })),
  checkWorkspaceGraphImpact: jest.fn(async () => ({ impactedFiles: [], impactCount: 0 })),
  cleanupLLMServices: jest.fn(async () => undefined),
  clearAgentTracesHistory: jest.fn(async () => ({ cleared: 2 })),
  clearVectorIndex: jest.fn(async () => ({ success: true })),
  executeCopilotQuery: jest.fn(async () => ({ success: true, sanitizedAnswer: 'ok' })),
  getIndexingStatus: jest.fn(async () => ({ indexed: 3, total: 3, inProgress: false })),
  getRecentAgentTraces: jest.fn(async () => ({ traces: [] })),
  getWorkspaceCollectionsData: jest.fn(async () => []),
  getWorkspaceFileConnectionsData: jest.fn(async () => ({
    filePath: 'a.md',
    outgoing: [],
    incoming: [],
    sharedTags: [],
    sharedEntities: [],
  })),
  getWorkspaceGraphMapData: jest.fn(async () => ({ nodes: [], edges: [] })),
  handleKernelIndexMutation: jest.fn(),
  indexSingleFile: jest.fn(async () => ({ success: true, chunksCreated: 1 })),
  listLlmModels: jest.fn(async () => ({
    provider: 'ollama',
    available: true,
    activeModel: 'llama3.2',
    models: ['llama3.2'],
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    rerankerModel: 'Xenova/ms-marco-MiniLM-L-6-v2',
    embeddingDevice: 'auto',
    temperature: 0.2,
    maxTokens: 1024,
    enableVisionCaptioning: false,
  })),
  planWorkspaceOrganize: jest.fn(async () => ({
    planId: 'plan-1',
    targetDir: '',
    strategy: 'smart_category',
    operations: [],
    skippedCount: 0,
    summary: 'empty',
  })),
  queryWorkspaceGraphInsights: jest.fn(async () => ({
    nodes: [],
    edges: [],
    clusters: [],
  })),
  resolveVectorDbPath: jest.fn(() => '/tmp/vectordb'),
  searchWorkspaceContent: jest.fn(async (_query: string, _topK?: number, searchRoot?: string) => [
    {
      chunkId: 'chunk-1',
      chunkIndex: 0,
      filePath: path.join(searchRoot || '/tmp', 'match.md'),
      fileName: 'match.md',
      score: 0.91,
      snippet: 'matched snippet',
    },
  ]),
  setLlmModelConfig: jest.fn(async (cfg: Record<string, unknown>) => ({
    success: true,
    config: {
      provider: cfg.provider ?? 'ollama',
      available: true,
      activeModel: cfg.model ?? 'llama3.2',
      models: ['llama3.2'],
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      rerankerModel: 'Xenova/ms-marco-MiniLM-L-6-v2',
      embeddingDevice: 'auto',
      temperature: 0.2,
      maxTokens: 1024,
      enableVisionCaptioning: false,
    },
  })),
  startDirectoryIndexing: jest.fn(async () => ({ success: true, total: 4 })),
  stopDirectoryIndexing: jest.fn(async () => ({ success: true })),
};

jest.mock('electron', () => ({
  ipcMain: mockIpcMain,
  shell: {
    openPath: jest.fn(async () => ''),
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(async () => undefined),
  },
  clipboard: { writeText: jest.fn() },
  app: { getPath: jest.fn(() => os.tmpdir()) },
  BrowserWindow: {
    getFocusedWindow: jest.fn(() => null),
    getAllWindows: jest.fn(() => []),
  },
}));

jest.mock('@main/services/LlmWorkspaceService', () => mockLlmService);

import { ConfigManager } from '@shared/config/ConfigManager';
import {
  resetPathValidator,
  resetRateLimiter,
} from '@main/handlers/securityMiddleware';
import {
  registerFileSystemHandlers,
  resetFileSystemService,
} from '@main/handlers/fileSystemHandlers';
import {
  registerNavigationHandlers,
  getNavigationServiceForTesting,
  resetNavigationServices,
} from '@main/handlers/navigationHandlers';
import {
  registerSearchHandlers,
  resetSearchService,
  searchWorkspacePaths,
  getSearchServiceForTesting,
} from '@main/handlers/searchHandlers';
import {
  registerLLMHandlers,
  cleanupLLMServices,
  resetLLMHandlersForTesting,
} from '@main/handlers/llmHandlers';
import { getReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import type {
  FileMetadata,
  FileNode,
  BatchTransferResult,
  ContentSearchMatch,
} from '@shared/contracts';

function makeFileMetadata(filePath: string): FileMetadata {
  return {
    filePath,
    totalChunks: 1,
    indexedAt: Date.now(),
    fileSize: 16,
  };
}

interface IPCEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const fakeEvent = {
  sender: {
    id: 42,
    isDestroyed: (): boolean => false,
    send: jest.fn(),
  },
} as unknown as IpcMainInvokeEvent;

async function invokeRegistered<T = unknown>(
  channel: string,
  payload?: unknown
): Promise<IPCEnvelope<T>> {
  const handler = registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`Missing handler for ${channel}`);
  }
  return (await handler(fakeEvent, payload)) as IPCEnvelope<T>;
}

describe('Handler Suites Coverage: Navigation, Search, FileSystem, and LLM Channels', () => {
  let sandboxDir: string;
  let workspaceDir: string;
  let configPath: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    registeredHandlers.clear();
    mockIpcMain.handle.mockClear();
    resetRateLimiter();
    RuntimeDiagnostics.resetForTesting();

    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handlers-cov-'));
    workspaceDir = path.join(sandboxDir, 'workspace');
    configPath = path.join(sandboxDir, 'config.json');
    await fs.mkdir(workspaceDir, { recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
    };
    delete process.env.FILE_MANAGER_ALLOWED_ROOTS;

    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [workspaceDir], true);

    resetPathValidator();
    resetFileSystemService();
    resetSearchService();
    resetNavigationServices();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanupLLMServices();
    resetFileSystemService();
    resetSearchService();
    resetNavigationServices();
    ConfigManager.resetForTesting();
    process.env = { ...originalEnv };
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  });

  it('exercises navigationHandlers push, back, forward, getState, and resets cleanly', async () => {
    const channels = registerNavigationHandlers();
    expect(channels).toEqual(['NAV:BACK', 'NAV:FORWARD', 'NAV:PUSH', 'NAV:GET_STATE']);

    const dirA = path.join(workspaceDir, 'dir-a');
    const dirB = path.join(workspaceDir, 'dir-b');
    const dirC = path.join(workspaceDir, 'dir-c');
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    await fs.mkdir(dirC, { recursive: true });

    const emptyBack = await invokeRegistered<string | null>('NAV:BACK', {});
    expect(emptyBack).toMatchObject({ ok: true, data: null });

    const emptyForward = await invokeRegistered<string | null>('NAV:FORWARD', {});
    expect(emptyForward).toMatchObject({ ok: true, data: null });

    expect(getNavigationServiceForTesting().getCurrentPath()).toBeNull();

    await invokeRegistered('NAV:PUSH', { path: dirA });
    await invokeRegistered('NAV:PUSH', { path: dirB });
    await invokeRegistered('NAV:PUSH', dirC);

    expect(getNavigationServiceForTesting().getCurrentPath()).toBe(dirC);

    const stateAtC = await invokeRegistered<{ canGoBack: boolean; canGoForward: boolean }>(
      'NAV:GET_STATE',
      {}
    );
    expect(stateAtC).toMatchObject({ ok: true, data: { canGoBack: true, canGoForward: false } });

    const backToB = await invokeRegistered<string | null>('NAV:BACK', {});
    expect(backToB).toMatchObject({ ok: true, data: dirB });

    const forwardToC = await invokeRegistered<string | null>('NAV:FORWARD', {});
    expect(forwardToC).toMatchObject({ ok: true, data: dirC });

    // Outside-root NAV:PUSH must be blocked by withContract
    const outsideRes = await invokeRegistered('NAV:PUSH', {
      path: path.join(sandboxDir, 'outside-nav'),
    });
    expect(outsideRes.ok).toBe(false);

    resetNavigationServices();
    const stateAfterReset = await invokeRegistered<{ canGoBack: boolean; canGoForward: boolean }>(
      'NAV:GET_STATE',
      {}
    );
    expect(stateAfterReset).toMatchObject({
      ok: true,
      data: { canGoBack: false, canGoForward: false },
    });
  });

  it('registers all llmHandlers channels, delegates calls, and tears down kernel hooks on cleanup', async () => {
    const channels = registerLLMHandlers();
    expect(channels).toHaveLength(14);
    expect(channels).toContain('LLM:INDEX_STATUS');
    expect(channels).toContain('AI:ORGANIZE_PLAN');

    const statusRes = await invokeRegistered<{ indexed: number }>('LLM:INDEX_STATUS', {});
    expect(statusRes).toMatchObject({ ok: true, data: { indexed: 3 } });

    const startRes = await invokeRegistered<{ success: boolean }>('LLM:START_INDEXING', {
      path: workspaceDir,
    });
    expect(startRes).toMatchObject({ ok: true, data: { success: true } });

    const stopRes = await invokeRegistered<{ success: boolean }>('LLM:STOP_INDEXING', {});
    expect(stopRes).toMatchObject({ ok: true, data: { success: true } });

    const clearRes = await invokeRegistered<{ success: boolean }>('LLM:CLEAR_INDEX', {});
    expect(clearRes).toMatchObject({ ok: true, data: { success: true } });

    const listRes = await invokeRegistered<{ activeModel: string }>('LLM:LIST_MODELS', {});
    expect(listRes).toMatchObject({ ok: true, data: { activeModel: 'llama3.2' } });

    const cfgRes = await invokeRegistered<{ success: boolean }>('LLM:SET_MODEL_CONFIG', {
      model: 'qwen2.5:7b',
    });
    expect(cfgRes).toMatchObject({ ok: true, data: { success: true } });

    const abortRes = await invokeRegistered<{ aborted: boolean }>('LLM:ABORT_QUERY', {
      channel: 'LLM:QUERY:channel-1',
    });
    expect(abortRes).toMatchObject({ ok: true, data: { aborted: true } });

    const checkRes = await invokeRegistered<{ available: boolean }>('LLM:CHECK_OLLAMA', {});
    expect(checkRes).toMatchObject({ ok: true, data: { available: true } });

    const tracesRes = await invokeRegistered<{ traces: unknown[] }>('LLM:GET_TRACES', { limit: 10 });
    expect(tracesRes).toMatchObject({ ok: true, data: { traces: [] } });

    const clearTracesRes = await invokeRegistered<{ cleared: number }>('LLM:CLEAR_TRACES', {});
    expect(clearTracesRes).toMatchObject({ ok: true, data: { cleared: 2 } });

    const targetFile = path.join(workspaceDir, 'note.md');
    await fs.writeFile(targetFile, '# Note', 'utf-8');
    const idxFileRes = await invokeRegistered<{ success: boolean }>('LLM:INDEX_FILE', {
      filePath: targetFile,
    });
    expect(idxFileRes).toMatchObject({ ok: true, data: { success: true } });

    const queryRes = await invokeRegistered<{ success: boolean }>('LLM:QUERY', {
      query: 'Summarize note',
      channel: 'LLM:QUERY:channel-1',
    });
    expect(queryRes).toMatchObject({ ok: true, data: { success: true } });

    const planRes = await invokeRegistered<{ planId: string }>('AI:ORGANIZE_PLAN', {
      targetDir: workspaceDir,
    });
    expect(planRes).toMatchObject({ ok: true, data: { planId: 'plan-1' } });

    await resetLLMHandlersForTesting();
    expect(mockLlmService.cleanupLLMServices).toHaveBeenCalledTimes(1);
  });

  it('exercises searchHandlers autocomplete, empty & recursive query, PathTrie fallback, and scoped content search', async () => {
    const channels = registerSearchHandlers();
    expect(channels).toEqual(['SEARCH:AUTOCOMPLETE', 'SEARCH:QUERY', 'SEARCH:CONTENT']);

    const notesDir = path.join(workspaceDir, 'notes', 'archive');
    await fs.mkdir(notesDir, { recursive: true });
    const topFile = path.join(workspaceDir, 'alpha-top.txt');
    const nestedFile = path.join(notesDir, 'deep-match.md');
    const envSecret = path.join(workspaceDir, '.env');
    await fs.writeFile(topFile, 'top body', 'utf-8');
    await fs.writeFile(nestedFile, 'nested markdown', 'utf-8');
    await fs.writeFile(envSecret, 'SECRET=123', 'utf-8');

    const kernel = getReactiveWorkspaceKernel();
    kernel.getPathTrie().insert(topFile, makeFileMetadata(topFile));
    kernel.getPathTrie().insert(nestedFile, makeFileMetadata(nestedFile));

    const acRes = await invokeRegistered<string[]>('SEARCH:AUTOCOMPLETE', {
      prefix: 'alpha-top',
      maxResults: 10,
    });
    expect(acRes.ok).toBe(true);
    expect(acRes.data).toContain(topFile);

    const emptyQueryRes = await invokeRegistered<FileNode[]>('SEARCH:QUERY', {
      query: '   ',
      searchRoot: workspaceDir,
    });
    expect(emptyQueryRes.ok).toBe(true);
    expect(emptyQueryRes.data?.some((f) => f.name === 'alpha-top.txt')).toBe(true);
    expect(emptyQueryRes.data?.some((f) => f.name === '.env')).toBe(false);

    const recursiveRes = await invokeRegistered<FileNode[]>('SEARCH:QUERY', {
      query: 'deep-match',
      searchRoot: workspaceDir,
    });
    expect(recursiveRes.ok).toBe(true);
    expect(recursiveRes.data?.some((f) => f.path === nestedFile)).toBe(true);

    // PathTrie fallback when directory is skipped/empty
    const trieOnlyFile = path.join(
      workspaceDir,
      'l1',
      'l2',
      'l3',
      'l4',
      'l5',
      'l6',
      'beyond-bfs-depth.md'
    );
    await fs.mkdir(path.dirname(trieOnlyFile), { recursive: true });
    await fs.writeFile(trieOnlyFile, 'deep fallback', 'utf-8');
    kernel.getPathTrie().insert(trieOnlyFile, makeFileMetadata(trieOnlyFile));

    const fallbackRes = await invokeRegistered<FileNode[]>('SEARCH:QUERY', {
      query: 'beyond-bfs',
      searchRoot: workspaceDir,
    });
    expect(fallbackRes.ok).toBe(true);
    expect(fallbackRes.data?.some((f) => f.path === trieOnlyFile)).toBe(true);

    const contentRes = await invokeRegistered<ContentSearchMatch[]>('SEARCH:CONTENT', {
      query: 'markdown',
      topK: 5,
      searchRoot: workspaceDir,
    });
    expect(contentRes.ok).toBe(true);
    expect(mockLlmService.searchWorkspaceContent).toHaveBeenCalledWith(
      'markdown',
      5,
      await fs.realpath(workspaceDir)
    );

    const agentPathsWithoutRoot = await searchWorkspacePaths('deep-match');
    expect(agentPathsWithoutRoot).toContain(nestedFile);
    const agentDefaultRoots = await searchWorkspacePaths('   ');
    expect(agentDefaultRoots.length).toBeGreaterThanOrEqual(1);
    expect(getSearchServiceForTesting()).toBeDefined();
  });

  it('exercises fileSystemHandlers create, stats, rename, split-dir watch, trash vault, and batch transfer', async () => {
    const channels = registerFileSystemHandlers();
    expect(channels).toContain('FS:BATCH_TRANSFER');
    expect(channels).toContain('FS:WATCH_SPLIT_DIR');

    const createDirRes = await invokeRegistered<{ success: boolean; path: string }>('FS:CREATE_DIR', {
      path: workspaceDir,
      name: 'docs',
    });
    expect(createDirRes.ok).toBe(true);
    const docsDir = createDirRes.data!.path;

    const createFileRes = await invokeRegistered<{ success: boolean; path: string }>(
      'FS:CREATE_FILE',
      {
        path: workspaceDir,
        name: 'draft.txt',
        content: 'hello draft',
      }
    );
    expect(createFileRes.ok).toBe(true);
    const draftPath = createFileRes.data!.path;

    const statsRes = await invokeRegistered<{ size: number; isDirectory: boolean }>('FS:GET_STATS', {
      path: draftPath,
    });
    expect(statsRes.ok).toBe(true);
    expect(statsRes.data?.isDirectory).toBe(false);
    expect(statsRes.data?.size).toBe(11);

    const sysPathsRes = await invokeRegistered<{ home: string }>('FS:GET_SYSTEM_PATHS', {});
    expect(sysPathsRes.ok).toBe(true);
    expect(typeof sysPathsRes.data?.home).toBe('string');

    const renameRes = await invokeRegistered<{ success: boolean; newPath: string }>('FS:RENAME', {
      oldPath: draftPath,
      newName: 'renamed.txt',
    });
    expect(renameRes.ok).toBe(true);
    const renamedPath = renameRes.data!.newPath;

    const watchRes = await invokeRegistered<{ watching: boolean; path: string | null }>(
      'FS:WATCH_SPLIT_DIR',
      { path: docsDir }
    );
    expect(watchRes).toMatchObject({ ok: true, data: { watching: true, path: await fs.realpath(docsDir) } });

    const unwatchRes = await invokeRegistered<{ watching: boolean; path: string | null }>(
      'FS:WATCH_SPLIT_DIR',
      { path: null }
    );
    expect(unwatchRes).toMatchObject({ ok: true, data: { watching: false, path: null } });

    const copiedPath = path.join(docsDir, 'copied.txt');
    const movedPath = path.join(docsDir, 'moved.txt');
    const batchRes = await invokeRegistered<BatchTransferResult>('FS:BATCH_TRANSFER', {
      description: 'Copy then move then delete in one transaction',
      steps: [
        { type: 'copy', source: renamedPath, destination: copiedPath },
        { type: 'move', source: renamedPath, destination: movedPath },
        { type: 'delete', path: copiedPath, recursive: false, mode: 'vault' },
      ],
    });
    expect(batchRes.ok).toBe(true);
    expect(batchRes.data?.count).toBe(3);

    const movedContent = await fs.readFile(movedPath, 'utf-8');
    expect(movedContent).toBe('hello draft');

    const emptyVaultRes = await invokeRegistered('FS:EMPTY_TRASH_VAULT', {});
    expect(emptyVaultRes.ok).toBe(true);

    // Invalid traversal target in FS:RENAME must fail contract/security check
    const badRename = await invokeRegistered('FS:RENAME', {
      oldPath: movedPath,
      newName: '../escape.txt',
    });
    expect(badRename.ok).toBe(false);
  });
});
