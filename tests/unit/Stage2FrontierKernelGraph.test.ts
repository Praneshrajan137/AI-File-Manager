import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ConfigManager } from '@shared/config';
import { resetPathValidator } from '@main/handlers/securityMiddleware';
import { ReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { WorkspaceKnowledgeGraph } from '@main/services/WorkspaceKnowledgeGraph';
import { ContextualChunker, StructuralChunker } from '../../src/llm/services/StructuralChunker';
import { VectorStore } from '../../src/llm/services/VectorStore';

describe('Stage 2 Frontier: Multi-Root Kernel, Contextual Chunker, PPR & Scoped LanceDB', () => {
  let sandboxDir: string;
  let workspaceDir: string;
  let configPath: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    RuntimeDiagnostics.resetForTesting();
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-frontier-s2-'));
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
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [workspaceDir]);
    resetPathValidator();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    ConfigManager.resetForTesting();
    resetPathValidator();
    RuntimeDiagnostics.resetForTesting();
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it('tracks split-pane secondary watch, caps indexed roots LRU at 4, and reconciles offline-deleted/secret files', async () => {
    const primaryDir = path.join(workspaceDir, 'primary');
    const secondaryDir = path.join(workspaceDir, 'secondary');
    const roots = [1, 2, 3, 4, 5].map((n) => path.join(workspaceDir, `root-${n}`));
    await fs.mkdir(primaryDir, { recursive: true });
    await fs.mkdir(secondaryDir, { recursive: true });
    for (const r of roots) {
      await fs.mkdir(r, { recursive: true });
    }

    const indexEvents: Array<{ type: string; path: string }> = [];
    const kernel = new ReactiveWorkspaceKernel({
      allowedRoots: [workspaceDir],
      coalesceMs: 25,
      watchOptions: {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 15 },
        depth: 0,
      },
      indexMutationHook: (type, p): void => {
        indexEvents.push({ type, path: p });
      },
    });

    try {
      await kernel.activateDirectory(primaryDir);
      await kernel.activateSecondaryDirectory(secondaryDir);

      // Watch 5 indexed roots -> LRU eviction caps total indexed root watchers to 4
      for (const r of roots) {
        const ok = await kernel.watchIndexedRoot(r, 4);
        expect(ok).toBe(true);
      }

      const active = kernel.getActiveWatchedPaths().map((p) => path.resolve(p));
      expect(active).toContain(path.resolve(primaryDir));
      expect(active).toContain(path.resolve(secondaryDir));
      expect(active).not.toContain(path.resolve(roots[0])); // Evicted oldest indexed root
      expect(active).toContain(path.resolve(roots[4]));

      // Reconcile offline-deleted file + legacy SecretGuard artifact
      const deletedDoc = path.join(primaryDir, 'gone.md');
      const liveDoc = path.join(primaryDir, 'present.md');
      const legacySecret = path.join(primaryDir, '.env');
      await fs.writeFile(liveDoc, '# Still here', 'utf-8');
      await fs.writeFile(legacySecret, 'SECRET=123', 'utf-8');

      kernel.getPathTrie().insert(deletedDoc, {
        filePath: deletedDoc,
        totalChunks: 1,
        indexedAt: 1,
        fileSize: 10,
      });
      kernel.getPathTrie().insert(legacySecret, {
        filePath: legacySecret,
        totalChunks: 1,
        indexedAt: 1,
        fileSize: 10,
      });

      const purged: string[] = [];
      const count = await kernel.reconcileIndexedFiles(
        [deletedDoc, liveDoc, legacySecret],
        (stalePath) => {
          purged.push(stalePath);
        }
      );

      expect(count).toBe(2);
      expect(purged).toContain(path.normalize(deletedDoc));
      expect(purged).toContain(path.normalize(legacySecret));
      expect(purged).not.toContain(path.normalize(liveDoc));
      expect(kernel.getPathTrie().autocomplete('gone')).toEqual([]);

      await kernel.unwatchIndexedRoot(roots[4]);
      const afterUnwatch = kernel.getActiveWatchedPaths().map((p) => path.resolve(p));
      expect(afterUnwatch).not.toContain(path.resolve(roots[4]));
    } finally {
      await kernel.shutdown();
    }
  });

  it('produces pure-TS class/method AST scopes and bounded Anthropic-style contextual chunk headers', () => {
    const code = [
      "import { verifyJwt } from './jwt-utils';",
      "import { auditLog } from '../audit';",
      '',
      'export class AuthService {',
      ...Array.from({ length: 18 }, (_, i) => `  // context line ${i} documenting session validation flow`),
      '  async verifySessionToken(rawToken: string): Promise<boolean> {',
      '    return verifyJwt(rawToken) && auditLog(rawToken);',
      '  }',
      '}',
    ].join('\n');

    const chunker = new ContextualChunker({ maxTokens: 220, overlapTokens: 24 });
    expect(ContextualChunker).toBe(StructuralChunker);
    const chunks = chunker.chunk(code, path.join(workspaceDir, 'security', 'AuthService.ts'));

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.heading.includes('AuthService.verifySessionToken'))).toBe(true);
    expect(chunks[0].text).toContain('[File: AuthService.ts |');
    expect(chunks[0].text).toContain('Dir: security/AuthService.ts');
    expect(chunks[0].text).toContain('Refs: jwt-utils, audit');
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(220 * 4 + 80);
    }
  });

  it('computes 2-hop hub-damped Personalized PageRank, spatial collections, and exact pre-filtered scoped hybrid search', async () => {
    const kg = new WorkspaceKnowledgeGraph(path.join(sandboxDir, 'kg.sqlite'));
    const store = new VectorStore({ knowledgeGraph: kg });
    await store.initialize(path.join(sandboxDir, 'lancedb'));

    try {
      const folderAuth = path.join(workspaceDir, 'team_alpha', 'auth');
      const folderNoise = path.join(workspaceDir, 'noise_archive');
      await fs.mkdir(folderAuth, { recursive: true });
      await fs.mkdir(folderNoise, { recursive: true });

      const seedFile = path.join(folderAuth, 'oauth-spec.md');
      const hop1Bridge = path.join(folderAuth, 'token-rotation.md');
      const hop2Target = path.join(folderAuth, 'key-vault.md');
      const floodedHub = path.join(workspaceDir, 'index-hub.md');

      const seedContent = '# OAuth Spec\nSee [[token-rotation]] and [Hub](../index-hub.md).';
      const bridgeContent = '# Token Rotation\nBacked by [Key Vault](./key-vault.md).';
      const hop2Content = '# Key Vault KMS\nRotates RSA signing keys every 24h.';

      // Register seed -> bridge -> hop2Target AND flooded hub with 12 decoy edges
      const upserts = [
        { p: seedFile, text: seedContent, vec: [0.9, 0.1, ...new Array(382).fill(0)] },
        { p: hop1Bridge, text: bridgeContent, vec: [0.5, 0.5, ...new Array(382).fill(0)] },
        { p: hop2Target, text: hop2Content, vec: [0.1, 0.9, ...new Array(382).fill(0)] },
        {
          p: floodedHub,
          text: '# Index Hub\nCentral index.',
          vec: [0.2, 0.2, ...new Array(382).fill(0)],
        },
      ];

      for (let i = 0; i < 12; i++) {
        const decoy = path.join(folderNoise, `noise_${i}.md`);
        upserts.push({
          p: decoy,
          text: `# Noise Note ${i}\noauth keyword decoy ranking saturation`,
          vec: [0.99, 0.01, ...new Array(382).fill(0)], // Higher vector similarity than target in auth!
        });
      }

      const chunker = new StructuralChunker({ maxTokens: 420, overlapTokens: 32 });
      const { extractSymbolsAndLinks } = await import('../../src/llm/services/StructuralChunker');

      for (const item of upserts) {
        let content = item.text;
        if (item.p === floodedHub) {
          const refs = upserts
            .filter((u) => u.p !== floodedHub)
            .map((u) => `[[${path.basename(u.p, '.md')}]]`)
            .join(' ');
          content += `\n${refs}`;
        }
        const chunks = chunker.chunk(content, item.p);
        const { symbols, links } = extractSymbolsAndLinks(content, item.p);
        await store.addChunks(
          chunks,
          chunks.map(() => item.vec),
          item.p,
          { symbols, links }
        );
      }

      await store.flushPendingRecords();

      // Re-index multiple files together to exercise batched SQL IN delete without duplicates
      const updatedSeedChunks = chunker.chunk(`${seedContent}\nUpdated revision.`, seedFile);
      await store.addChunks(
        updatedSeedChunks,
        updatedSeedChunks.map(() => [0.91, 0.09, ...new Array(382).fill(0)]),
        seedFile,
        extractSymbolsAndLinks(seedContent, seedFile)
      );
      await store.flushPendingRecords();

      // 1. Verify SQL pre-filtered LanceDB + FTS5 prevents 12 closer noise files from starving folderAuth
      const scopedVecHits = await store.search(
        [0.99, 0.01, ...new Array(382).fill(0)],
        3,
        { folderPath: folderAuth }
      );
      expect(scopedVecHits.length).toBeGreaterThanOrEqual(1);
      expect(scopedVecHits.every((r) => r.file_path.startsWith(folderAuth))).toBe(true);

      const scopedFtsHits = store.searchLexical('oauth', 5, { folderPath: folderAuth });
      expect(scopedFtsHits.length).toBeGreaterThanOrEqual(1);
      expect(scopedFtsHits.every((m) => m.record.file_path.startsWith(folderAuth))).toBe(true);

      // Literal `_` inside `team_alpha` must not match `teamXalpha`
      expect(kg.getFilesInScope({ folderPath: path.join(workspaceDir, 'teamXalpha') })).toEqual([]);

      // 2. Verify 2-hop damped Personalized PageRank reaches hop2Target via hop1Bridge
      const ppr = kg.computeAssociativeBoosts([seedFile], { maxHops: 2, maxBoosts: 15 });
      const hop1Entry = ppr.find((r) => path.resolve(r.filePath) === path.resolve(hop1Bridge));
      const hop2Entry = ppr.find((r) => path.resolve(r.filePath) === path.resolve(hop2Target));
      expect(hop1Entry).toBeDefined();
      expect(hop1Entry?.hopDistance).toBe(1);
      expect(hop2Entry).toBeDefined();
      expect(hop2Entry?.hopDistance).toBe(2);
      expect(hop2Entry?.viaPath).toBeTruthy();

      // 3. Verify Spatial Lens graph map, semantic collections, and FileConnectionsSummary
      const graphMap = kg.getWorkspaceGraphMap(folderAuth);
      expect(graphMap.nodes.map((n) => n.name)).toEqual(
        expect.arrayContaining(['oauth-spec.md', 'token-rotation.md', 'key-vault.md'])
      );
      expect(graphMap.edges.length).toBeGreaterThanOrEqual(2);

      const collections = kg.getSemanticCollections(workspaceDir);
      expect(collections.length).toBeGreaterThanOrEqual(1);

      const connections = kg.getFileConnections(hop1Bridge);
      expect(connections.backlinks.some((b) => path.resolve(b.sourcePath) === path.resolve(seedFile))).toBe(true);
      expect(connections.outgoingLinks.length).toBeGreaterThanOrEqual(1);
      expect(connections.associativeNeighbors.length).toBeGreaterThanOrEqual(1);
    } finally {
      await store.close();
      kg.close();
    }
  }, 30000);
});
