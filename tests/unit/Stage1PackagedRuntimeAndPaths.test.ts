import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateLegacyConfigIfNeeded,
  resolveCanonicalConfigPath,
  resolveCanonicalGraphDbPath,
  resolveCanonicalVectorDbDir,
  resolveDefaultModelCacheDir,
  resolvePackagedMcpEntryPath,
} from '../../src/shared/config/appPaths';
import {
  inspectLocalModelCache,
  loadTransformers,
  _resetTransformersCacheForTesting,
} from '../../src/llm/models/transformersLoader';
import { buildMcpSnippetJson } from '../../src/renderer/components/Diagnostics/DiagnosticsModal';

describe('Stage 1: Packaged Runtime Paths, Writable ONNX Cache & Unpacked MCP Resolution', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetTransformersCacheForTesting();
    jest.restoreAllMocks();
    jest.dontMock('@huggingface/transformers');
  });

  it('resolves writable model cacheDir outside node_modules and inspects local cache state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-stage1-cache-'));
    try {
      process.env.FILE_MANAGER_MODEL_CACHE_DIR = tmpDir;
      const resolved = resolveDefaultModelCacheDir();
      expect(resolved).toBe(path.resolve(tmpDir));
      expect(resolved).not.toContain('node_modules');

      const emptyStatus = inspectLocalModelCache(['Xenova/bge-small-en-v1.5'], tmpDir);
      expect(emptyStatus.cacheDir).toBe(path.resolve(tmpDir));
      expect(emptyStatus.models[0]).toMatchObject({
        modelId: 'Xenova/bge-small-en-v1.5',
        cached: false,
        bytes: 0,
      });

      const modelDir = path.join(tmpDir, 'Xenova', 'bge-small-en-v1.5', 'onnx');
      fs.mkdirSync(modelDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'Xenova', 'bge-small-en-v1.5', 'config.json'), '{}', 'utf-8');
      fs.writeFileSync(path.join(modelDir, 'model_quantized.onnx'), Buffer.alloc(128, 1));

      const cachedStatus = inspectLocalModelCache(['Xenova/bge-small-en-v1.5'], tmpDir);
      expect(cachedStatus.models[0].cached).toBe(true);
      expect(cachedStatus.models[0].bytes).toBeGreaterThanOrEqual(128);

      const mockEnv: Record<string, unknown> = {
        useBrowserCache: true,
        useFSCache: false,
        cacheDir: 'node_modules/@huggingface/transformers/models',
      };
      jest.doMock('@huggingface/transformers', () => ({
        env: mockEnv,
        pipeline: jest.fn(),
      }));

      await loadTransformers({ allowRemoteModels: false, cacheDir: tmpDir });
      expect(mockEnv.useBrowserCache).toBe(false);
      expect(mockEnv.useFSCache).toBe(true);
      expect(mockEnv.allowRemoteModels).toBe(false);
      expect(mockEnv.cacheDir).toBe(path.resolve(tmpDir));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('migrates legacy ~/.project2-file-manager/config.json to canonical ~/.privatevault/config.json', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-stage1-home-'));
    try {
      jest.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const legacyCfgDir = path.join(fakeHome, '.project2-file-manager');
      fs.mkdirSync(legacyCfgDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyCfgDir, 'config.json'),
        JSON.stringify({ fileSystem: { favorites: ['C:\\notes'] } }),
        'utf-8'
      );

      const canonicalCfg = resolveCanonicalConfigPath();
      expect(canonicalCfg).toBe(path.join(fakeHome, '.privatevault', 'config.json'));
      expect(migrateLegacyConfigIfNeeded(canonicalCfg)).toBe(true);
      expect(fs.existsSync(canonicalCfg)).toBe(true);
      expect(JSON.parse(fs.readFileSync(canonicalCfg, 'utf-8')).fileSystem.favorites).toEqual(['C:\\notes']);
      // Idempotent second call
      expect(migrateLegacyConfigIfNeeded(canonicalCfg)).toBe(false);

      delete process.env.FILE_MANAGER_VECTOR_DB_PATH;
      // Clean installs default to ~/.privatevault/vectordb
      expect(resolveCanonicalVectorDbDir()).toBe(path.join(fakeHome, '.privatevault', 'vectordb'));

      // Pre-existing legacy .file-manager vector store is preserved cleanly
      const legacyDb = path.join(fakeHome, '.file-manager', 'vectordb');
      fs.mkdirSync(legacyDb, { recursive: true });
      fs.writeFileSync(path.join(legacyDb, 'knowledge-graph.sqlite'), 'stub', 'utf-8');
      expect(resolveCanonicalVectorDbDir()).toBe(legacyDb);
      expect(resolveCanonicalGraphDbPath()).toBe(path.join(legacyDb, 'knowledge-graph.sqlite'));
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('resolves unpacked MCP server entrypoint cleanly for app.asar packaged builds and snippets', () => {
    const fakePkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-stage1-pkg-'));
    try {
      const resourcesDir = path.join(fakePkgRoot, 'resources');
      const unpackedMcp = path.join(resourcesDir, 'app.asar.unpacked', 'dist', 'main', 'mcpServer.js');
      fs.mkdirSync(path.dirname(unpackedMcp), { recursive: true });
      fs.writeFileSync(unpackedMcp, '// unpacked mcp', 'utf-8');

      const fakeAsarModuleDir = path.join(resourcesDir, 'app.asar', 'dist', 'main');
      const resolved = resolvePackagedMcpEntryPath(fakeAsarModuleDir);
      expect(resolved).toBe(path.join(resourcesDir, 'app.asar.unpacked', 'dist', 'main', 'mcpServer.js'));

      const snippet = JSON.parse(buildMcpSnippetJson(['D:\\Vault'], resolved)) as {
        mcpServers: Record<string, { command: string; args: string[] }>;
      };
      expect(snippet.mcpServers['privatevault-workspace'].command).toBe('node');
      expect(snippet.mcpServers['privatevault-workspace'].args).toEqual([
        resolved,
        '--root',
        'D:\\Vault',
      ]);
    } finally {
      fs.rmSync(fakePkgRoot, { recursive: true, force: true });
    }
  });
});
