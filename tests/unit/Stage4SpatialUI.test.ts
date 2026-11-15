import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { ipcMain } from 'electron';
import {
  buildVaultAssetUrl,
  getMimeTypeForAssetExtension,
  getVaultAssetKind,
  isPreviewableAssetExtension,
} from '@shared/utils/vaultAssetUrl';
import {
  getPrivilegedSchemeConfig,
  handleVaultAssetRequest,
  resolveVaultAssetRequest,
} from '@main/services/AssetProtocol';
import { PathValidator } from '@main/services/PathValidator';
import { FileSystemService } from '@main/services/FileSystemService';
import { WorkspaceKnowledgeGraph } from '@main/services/WorkspaceKnowledgeGraph';
import { VectorStore } from '../../src/llm/services/VectorStore';
import { registerAllHandlers, unregisterAllHandlers } from '@main/handlers/ipcHandlers';
import { resetPathValidator } from '@main/handlers/securityMiddleware';
import { ConfigManager } from '@shared/config';
import { IPCChannel, IPCEnvelope } from '@shared/ipc/contracts';
import {
  ContentSearchMatch,
  FileNode,
  GraphInsightsResponse,
  LLMModelsSnapshot,
} from '@shared/contracts';
import {
  computeGridGeometry,
  extractDraggedPaths,
  parseCitationSegments,
  sortFileNodes,
  toggleMultiSelection,
} from '@renderer/utils/explorerHelpers';
import { joinChildPath } from '@renderer/utils/pathHelpers';

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
    getAllWindows: jest.fn(() => []),
  },
  shell: {
    openPath: jest.fn(),
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(),
  },
}));

describe('Stage 4 (M10): Spatial UI, vault-asset:// Protocol, Citation Reader & Omnibar IPC', () => {
  let sandboxDir: string;
  let rootDir: string;
  let outsideDir: string;
  let vectorDbDir: string;
  let prevAllowedRoots: string | undefined;
  let prevVectorDbPath: string | undefined;
  let prevFetch: typeof global.fetch;

  beforeEach(async () => {
    prevAllowedRoots = process.env.FILE_MANAGER_ALLOWED_ROOTS;
    prevVectorDbPath = process.env.FILE_MANAGER_VECTOR_DB_PATH;
    prevFetch = global.fetch;

    const rawSandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'stage4-spatial-'));
    sandboxDir = await fs.realpath(rawSandbox);
    rootDir = path.join(sandboxDir, 'workspace');
    outsideDir = path.join(sandboxDir, 'outside');
    vectorDbDir = path.join(sandboxDir, 'vectordb');
    const configPath = path.join(sandboxDir, 'config.json');

    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });

    process.env.FILE_MANAGER_ALLOWED_ROOTS = rootDir;
    process.env.FILE_MANAGER_VECTOR_DB_PATH = vectorDbDir;

    ConfigManager.resetForTesting();
    ConfigManager.initialize({ configPath });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [rootDir], false);
    ConfigManager.getInstance().set('llm.model', 'llama3.2', true);

    jest.clearAllMocks();
    resetPathValidator();
  });

  afterEach(async () => {
    global.fetch = prevFetch;
    unregisterAllHandlers();
    resetPathValidator();
    ConfigManager.resetForTesting();

    if (prevAllowedRoots === undefined) {
      delete process.env.FILE_MANAGER_ALLOWED_ROOTS;
    } else {
      process.env.FILE_MANAGER_ALLOWED_ROOTS = prevAllowedRoots;
    }

    if (prevVectorDbPath === undefined) {
      delete process.env.FILE_MANAGER_VECTOR_DB_PATH;
    } else {
      process.env.FILE_MANAGER_VECTOR_DB_PATH = prevVectorDbPath;
    }

    if (fsSync.existsSync(sandboxDir)) {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    }
  });

  describe('vaultAssetUrl helpers', () => {
    it('classifies previewable extensions cleanly without hijacking .bin binaries', () => {
      expect(getVaultAssetKind('png')).toBe('image');
      expect(getVaultAssetKind('.SVG')).toBe('image');
      expect(getVaultAssetKind('pdf')).toBe('pdf');
      expect(getVaultAssetKind('mp4')).toBe('video');
      expect(getVaultAssetKind('mp3')).toBe('audio');
      expect(getVaultAssetKind('bin')).toBe('unsupported');
      expect(isPreviewableAssetExtension('webp')).toBe(true);
      expect(isPreviewableAssetExtension('txt')).toBe(false);
      expect(getMimeTypeForAssetExtension('svg')).toBe('image/svg+xml');
      expect(getMimeTypeForAssetExtension('exe')).toBeNull();
    });

    it('builds normalized vault-asset:// URLs preserving spaces cleanly', () => {
      const samplePath = 'C:\\Users\\Demo\\My Images\\chart 1.png';
      const url = buildVaultAssetUrl(samplePath);
      expect(url.startsWith('vault-asset://local/file?path=')).toBe(true);
      const parsed = new URL(url);
      expect(parsed.searchParams.get('path')).toBe(samplePath);
    });
  });

  describe('AssetProtocol security & streaming semantics', () => {
    it('keeps bypassCSP disabled in scheme privileges', () => {
      const config = getPrivilegedSchemeConfig();
      expect(config.scheme).toBe('vault-asset');
      expect(config.privileges?.standard).toBe(true);
      expect(config.privileges?.secure).toBe(true);
      expect(config.privileges?.supportFetchAPI).toBe(true);
      expect(config.privileges?.stream).toBe(true);
      expect(config.privileges?.bypassCSP).toBe(false);
    });

    it('blocks traversal, outside-root, directory, missing, and non-media extensions', async () => {
      const validator = new PathValidator([rootDir]);
      const secretFile = path.join(outsideDir, 'secret.png');
      const scriptFile = path.join(rootDir, 'payload.js');
      const subDir = path.join(rootDir, 'sub');
      await fs.writeFile(secretFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await fs.writeFile(scriptFile, 'alert(1);', 'utf-8');
      await fs.mkdir(subDir, { recursive: true });

      const missingParam = await resolveVaultAssetRequest('vault-asset://local/file', validator);
      expect(missingParam).toEqual(expect.objectContaining({ ok: false, status: 400 }));

      const outsideAttempt = await resolveVaultAssetRequest(buildVaultAssetUrl(secretFile), validator);
      expect(outsideAttempt).toEqual(expect.objectContaining({ ok: false, status: 403 }));

      const traversalAttempt = await resolveVaultAssetRequest(
        buildVaultAssetUrl(path.join(rootDir, '..', 'outside', 'secret.png')),
        validator
      );
      expect(traversalAttempt).toEqual(expect.objectContaining({ ok: false, status: 403 }));

      const notFoundAttempt = await resolveVaultAssetRequest(
        buildVaultAssetUrl(path.join(rootDir, 'missing.png')),
        validator
      );
      expect(notFoundAttempt).toEqual(expect.objectContaining({ ok: false, status: 404 }));

      const dirAttempt = await resolveVaultAssetRequest(buildVaultAssetUrl(subDir), validator);
      expect(dirAttempt).toEqual(expect.objectContaining({ ok: false, status: 400 }));

      const disallowedAttempt = await resolveVaultAssetRequest(buildVaultAssetUrl(scriptFile), validator);
      expect(disallowedAttempt).toEqual(expect.objectContaining({ ok: false, status: 415 }));
    });

    it('blocks symlink/junction escapes pointing outside allowed roots', async () => {
      const validator = new PathValidator([rootDir]);
      const outsideMedia = path.join(outsideDir, 'escaped.png');
      await fs.writeFile(outsideMedia, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const junctionPath = path.join(rootDir, 'escape-dir');
      await fs.symlink(outsideDir, junctionPath, process.platform === 'win32' ? 'junction' : 'dir');

      const res = await handleVaultAssetRequest(
        new Request(buildVaultAssetUrl(path.join(junctionPath, 'escaped.png'))),
        () => validator
      );
      expect(res.status).toBe(403);
    });

    it('streams PNG with full content + 206 byte ranges + 416 guard, and enforces SVG sandbox CSP', async () => {
      const validator = new PathValidator([rootDir]);
      const pngPath = path.join(rootDir, 'sample.png');
      const svgPath = path.join(rootDir, 'diagram.svg');
      const payload = Buffer.from('0123456789ABCDEF', 'utf-8');
      await fs.writeFile(pngPath, payload);
      await fs.writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8');

      // Full 200 stream
      const fullRes = await handleVaultAssetRequest(new Request(buildVaultAssetUrl(pngPath)), () => validator);
      expect(fullRes.status).toBe(200);
      expect(fullRes.headers.get('Accept-Ranges')).toBe('bytes');
      expect(fullRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(fullRes.headers.get('Content-Type')).toBe('image/png');
      expect(fullRes.headers.get('Content-Security-Policy')).toBeNull();
      const fullBuf = Buffer.from(await fullRes.arrayBuffer());
      expect(fullBuf.equals(payload)).toBe(true);

      // Partial 206 byte range
      const rangeRes = await handleVaultAssetRequest(
        new Request(buildVaultAssetUrl(pngPath), { headers: { Range: 'bytes=2-5' } }),
        () => validator
      );
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get('Content-Range')).toBe(`bytes 2-5/${payload.length}`);
      expect(Buffer.from(await rangeRes.arrayBuffer()).toString('utf-8')).toBe('2345');

      // Invalid range 416
      const invalidRangeRes = await handleVaultAssetRequest(
        new Request(buildVaultAssetUrl(pngPath), { headers: { Range: 'bytes=999-1005' } }),
        () => validator
      );
      expect(invalidRangeRes.status).toBe(416);

      // Strict CSP sandboxing on SVG
      const svgRes = await handleVaultAssetRequest(new Request(buildVaultAssetUrl(svgPath)), () => validator);
      expect(svgRes.status).toBe(200);
      expect(svgRes.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(svgRes.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox"
      );
    });
  });

  describe('FileSystemService.readFileRange (#Lx-Ly citations)', () => {
    it('extracts bounded 1-based line windows with context padding and rejects binaries', async () => {
      const fsService = new FileSystemService(rootDir);
      const textFile = path.join(rootDir, 'citation.ts');
      const lines = Array.from({ length: 30 }, (_, i) => `const line_${i + 1} = ${i + 1};`);
      await fs.writeFile(textFile, lines.join('\n'), 'utf-8');

      const sliced = await fsService.readFileRange(textFile, 12, 14, 2);
      expect(sliced.startLine).toBe(10);
      expect(sliced.endLine).toBe(16);
      expect(sliced.totalLines).toBe(30);
      expect(sliced.truncated).toBe(false);
      expect(sliced.lines).toHaveLength(7);
      expect(sliced.lines[0]).toEqual({ lineNumber: 10, text: 'const line_10 = 10;' });
      expect(sliced.lines[3]).toEqual({ lineNumber: 13, text: 'const line_13 = 13;' });

      const emptyFile = path.join(rootDir, 'empty.txt');
      await fs.writeFile(emptyFile, '', 'utf-8');
      const emptySlice = await fsService.readFileRange(emptyFile, 1, 5, 2);
      expect(emptySlice.totalLines).toBe(0);
      expect(emptySlice.lines).toEqual([]);

      const binaryFile = path.join(rootDir, 'bin.dat');
      await fs.writeFile(binaryFile, Buffer.from([0x01, 0x00, 0x02, 0x03]));
      await expect(fsService.readFileRange(binaryFile, 1, 2, 0)).rejects.toThrow(/Binary file/);
    });
  });

  describe('Omnibar IPC handlers (SEARCH:CONTENT, GRAPH:QUERY_INSIGHTS, LLM:LIST_MODELS, LLM:SET_MODEL_CONFIG)', () => {
    it('executes full-text FTS5 content search, knowledge-graph insights, and live model switching through ipcMain contracts', async () => {
      const noteA = path.join(rootDir, 'arch-notes.md');
      const noteB = path.join(rootDir, 'dup-copy.md');
      await fs.writeFile(noteA, 'line 1\nVectorProtocolAlpha engine notes', 'utf-8');
      await fs.writeFile(noteB, 'line 1\nVectorProtocolAlpha engine notes', 'utf-8');

      const kg = new WorkspaceKnowledgeGraph(path.join(vectorDbDir, 'knowledge-graph.sqlite'));
      try {
        kg.upsertDocument({
          filePath: noteA,
          sha256: 'shared-sha-1234',
          size: 42,
          mtimeMs: 1700000000000,
          chunks: [
            {
              id: 'chunk-a-0',
              chunkIndex: 0,
              startChar: 0,
              endChar: 40,
              startLine: 10,
              endLine: 18,
              heading: '## Architecture',
              text: 'VectorProtocolAlpha design uses FTS5 bm25 ranking.',
            },
          ],
          symbols: [{ name: 'VectorProtocolAlpha', kind: 'class', lineNumber: 12 }],
          links: [{ targetRef: 'dup-copy.md', kind: 'wikilink', lineNumber: 15 }],
        });
        kg.upsertDocument({
          filePath: noteB,
          sha256: 'shared-sha-1234',
          size: 42,
          mtimeMs: 1700000001000,
          chunks: [
            {
              id: 'chunk-b-0',
              chunkIndex: 0,
              startChar: 0,
              endChar: 40,
              startLine: 4,
              endLine: 9,
              heading: '## Mirror',
              text: 'Duplicate architectural note referencing VectorProtocolAlpha.',
            },
          ],
          links: [{ targetRef: 'dup-copy.md', kind: 'wikilink', lineNumber: 6 }],
        });
      } finally {
        kg.close();
      }

      // Regression check: creating an empty LanceDB table for the first time must preserve
      // any pre-existing SQLite knowledge graph data (as triggered on boot by LLM:INDEX_STATUS).
      const bootStore = new VectorStore();
      await bootStore.initialize(vectorDbDir);
      expect(bootStore.getKnowledgeGraph()?.getStats().totalFiles).toBe(2);
      await bootStore.close();

      global.fetch = jest.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/tags')) {
          return new Response(
            JSON.stringify({
              models: [{ name: 'llama3.2' }, { name: 'qwen2.5-coder:7b' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof global.fetch;

      const handleMock = ipcMain.handle as jest.Mock;
      const registeredHandlers = new Map<
        IPCChannel,
        (event: unknown, payload: unknown) => Promise<IPCEnvelope<unknown>>
      >();
      handleMock.mockImplementation((channel: IPCChannel, handler) => {
        registeredHandlers.set(channel, handler);
      });

      registerAllHandlers();

      const fakeEvent = { sender: { isDestroyed: () => false, send: jest.fn() } };

      const contentHandler = registeredHandlers.get('SEARCH:CONTENT');
      expect(contentHandler).toBeDefined();
      const contentEnv = (await contentHandler!(fakeEvent, {
        query: 'VectorProtocolAlpha',
        topK: 10,
      })) as IPCEnvelope<ContentSearchMatch[]>;
      expect(contentEnv.ok).toBe(true);
      if (contentEnv.ok) {
        expect(contentEnv.data.length).toBeGreaterThanOrEqual(2);
        const matchA = contentEnv.data.find((m) => m.fileName === 'arch-notes.md');
        expect(matchA?.startLine).toBe(10);
        expect(matchA?.endLine).toBe(18);
        expect(matchA?.heading).toBe('## Architecture');
      }

      const graphHandler = registeredHandlers.get('GRAPH:QUERY_INSIGHTS');
      expect(graphHandler).toBeDefined();
      const graphEnv = (await graphHandler!(fakeEvent, {
        symbolQuery: 'VectorProtocol',
        backlinkTarget: 'dup-copy.md',
      })) as IPCEnvelope<GraphInsightsResponse>;
      expect(graphEnv.ok).toBe(true);
      if (graphEnv.ok) {
        expect(graphEnv.data.stats.totalFiles).toBe(2);
        expect(graphEnv.data.stats.duplicateClusters.length).toBe(1);
        expect(graphEnv.data.symbolMatches?.[0]?.symbolName).toBe('VectorProtocolAlpha');
        expect(graphEnv.data.backlinks?.length).toBe(2);
      }

      const listHandler = registeredHandlers.get('LLM:LIST_MODELS');
      const setHandler = registeredHandlers.get('LLM:SET_MODEL_CONFIG');
      expect(listHandler).toBeDefined();
      expect(setHandler).toBeDefined();

      const initialModelsEnv = (await listHandler!(fakeEvent, {})) as IPCEnvelope<LLMModelsSnapshot>;
      expect(initialModelsEnv.ok).toBe(true);
      if (initialModelsEnv.ok) {
        expect(initialModelsEnv.data.available).toBe(true);
        expect(initialModelsEnv.data.models).toEqual(['llama3.2', 'qwen2.5-coder:7b']);
        expect(initialModelsEnv.data.activeModel).toBe('llama3.2');
      }

      const setModelEnv = (await setHandler!(fakeEvent, {
        model: 'qwen2.5-coder:7b',
        temperature: 0.25,
      })) as IPCEnvelope<{ success: boolean; config: LLMModelsSnapshot }>;
      expect(setModelEnv.ok).toBe(true);
      if (setModelEnv.ok) {
        expect(setModelEnv.data.success).toBe(true);
        expect(setModelEnv.data.config.activeModel).toBe('qwen2.5-coder:7b');
        expect(setModelEnv.data.config.temperature).toBe(0.25);
      }
    });
  });

  describe('Spatial UI pure helpers (multi-select, grid geometry, citations, drag-drop paths)', () => {
    it('supports single, Ctrl/Meta toggle, and Shift range selection deterministically', () => {
      const order = ['/a', '/b', '/c', '/d', '/e'];

      const s1 = toggleMultiSelection([], order, '/b', {}, null);
      expect(s1).toEqual({ selected: ['/b'], nextAnchor: '/b' });

      const s2 = toggleMultiSelection(s1.selected, order, '/d', { shiftKey: true }, s1.nextAnchor);
      expect(s2).toEqual({ selected: ['/b', '/c', '/d'], nextAnchor: '/b' });

      const s3 = toggleMultiSelection(s2.selected, order, '/c', { ctrlKey: true }, s2.nextAnchor);
      expect(s3).toEqual({ selected: ['/b', '/d'], nextAnchor: '/c' });

      const s4 = toggleMultiSelection(s3.selected, order, '/e', { metaKey: true }, s3.nextAnchor);
      expect(s4).toEqual({ selected: ['/b', '/d', '/e'], nextAnchor: '/e' });
    });

    it('sorts FileNodes across name, size, modified, and type', () => {
      const nodes: FileNode[] = [
        {
          path: '/b.md',
          name: 'b.md',
          isDirectory: false,
          size: 50,
          modified: 200,
          extension: 'md',
          mimeType: 'text/markdown',
          isHidden: false,
        },
        {
          path: '/a.ts',
          name: 'a.ts',
          isDirectory: false,
          size: 200,
          modified: 100,
          extension: 'ts',
          mimeType: 'text/typescript',
          isHidden: false,
        },
      ];

      expect(sortFileNodes(nodes, 'name', 'asc').map((n) => n.name)).toEqual(['a.ts', 'b.md']);
      expect(sortFileNodes(nodes, 'size', 'desc').map((n) => n.name)).toEqual(['a.ts', 'b.md']);
      expect(sortFileNodes(nodes, 'modified', 'desc').map((n) => n.name)).toEqual(['b.md', 'a.ts']);
      expect(sortFileNodes(nodes, 'type', 'asc').map((n) => n.name)).toEqual(['b.md', 'a.ts']);
    });

    it('computes bounded FixedSizeGrid geometry and parses [file#Lx-Ly] inline citations', () => {
      const geom = computeGridGeometry(700, 500, 10, 156, 148);
      expect(geom.columnCount).toBe(4);
      expect(geom.rowCount).toBe(3);
      expect(geom.columnWidth).toBe(175);

      const parsed = parseCitationSegments(
        'See [arch.md#L12-L24] and [main.ts#L5] for proof.'
      );
      expect(parsed).toEqual([
        { type: 'text', content: 'See ' },
        {
          type: 'citation',
          content: '[arch.md#L12-L24]',
          fileName: 'arch.md',
          startLine: 12,
          endLine: 24,
        },
        { type: 'text', content: ' and ' },
        {
          type: 'citation',
          content: '[main.ts#L5]',
          fileName: 'main.ts',
          startLine: 5,
          endLine: 5,
        },
        { type: 'text', content: ' for proof.' },
      ]);
    });

    it('extracts JSON drag-and-drop paths safely and joins child paths cross-platform', () => {
      const fakeTransfer = {
        getData: (mime: string): string =>
          mime === 'application/x-fm-paths' ? JSON.stringify(['/a/one.txt', '/a/two.txt']) : '',
      } as unknown as DataTransfer;

      expect(extractDraggedPaths(fakeTransfer)).toEqual(['/a/one.txt', '/a/two.txt']);
      expect(extractDraggedPaths(null)).toEqual([]);
      expect(joinChildPath('C:\\work\\dest', 'file.txt')).toBe('C:\\work\\dest\\file.txt');
      expect(joinChildPath('/tmp/dest/', 'file.txt')).toBe('/tmp/dest/file.txt');
    });
  });
});
