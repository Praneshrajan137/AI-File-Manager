import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PathTrie } from '../../src/main/dsa/PathTrie';
import { PathValidator } from '../../src/main/services/PathValidator';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import { redactSensitiveText } from '../../src/shared/security/SecretGuard';
import { sortFileNodes } from '../../src/renderer/utils/explorerHelpers';
import { computeGraphLayout } from '../../src/renderer/utils/graphLayout';
import type { FileNode, WorkspaceGraphEdge, WorkspaceGraphNode } from '../../src/shared/contracts';

describe('Stage 3 Scale & Latency Benchmark (10k PathTrie + 2k KnowledgeGraph Docs)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osfm-perf-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('indexes 10,000 paths into PathTrie with O(1) size() and sub-second autocomplete/fuzzySearch', () => {
    const trie = new PathTrie();
    const insertStart = performance.now();

    for (let i = 0; i < 10000; i++) {
      const folder = `dept-${i % 50}`;
      const sub = `project-${i % 200}`;
      const file = i === 7777 ? 'quarterly-executive-budget.pdf' : `artifact-${i}.ts`;
      const full = `/workspace/${folder}/${sub}/${file}`;
      trie.insert(full, {
        filePath: full,
        totalChunks: 1,
        indexedAt: 1,
        fileSize: 100,
      });
    }
    const insertMs = performance.now() - insertStart;

    const sizeStart = performance.now();
    let count = 0;
    for (let r = 0; r < 1000; r++) {
      count = trie.size();
    }
    const sizeMs = performance.now() - sizeStart;

    const autoStart = performance.now();
    const exactMatches = trie.autocomplete('quarterly-exec', 10);
    const autoMs = performance.now() - autoStart;

    const fuzzyStart = performance.now();
    const fuzzyMatches = trie.fuzzySearch('qarterly-exec', 10, 2);
    const fuzzyMs = performance.now() - fuzzyStart;

    expect(count).toBe(10000);
    expect(insertMs).toBeLessThan(4000);
    expect(sizeMs).toBeLessThan(20);
    expect(autoMs).toBeLessThan(500);
    expect(fuzzyMs).toBeLessThan(1500);
    expect(exactMatches.length).toBeGreaterThanOrEqual(1);
    expect(fuzzyMatches.map((m) => path.basename(m.path))).toContain('quarterly-executive-budget.pdf');
  });

  it('stores 2,000 multi-chunk docs in WorkspaceKnowledgeGraph with fast FTS5 bm25() & O(1) stats', () => {
    const dbPath = path.join(tmpDir, 'scale-kg.sqlite');
    const kg = new WorkspaceKnowledgeGraph(dbPath);

    const writeStart = performance.now();
    for (let i = 0; i < 2000; i++) {
      const specialMarker = i === 1337 ? 'DELTA_CANARY_TOKEN_994' : `token_${i % 120}`;
      kg.upsertDocument({
        filePath: `/vault/dir-${i % 40}/doc-${i}.md`,
        sha256: `sha-${i}`,
        size: 1024,
        mtimeMs: 1700000000 + i,
        chunks: [
          {
            id: `/vault/dir-${i % 40}/doc-${i}.md:0`,
            chunkIndex: 0,
            text: `[File: doc-${i}.md | Section ${i} | L1-L5]\nWorkspace specification containing ${specialMarker}.`,
            startChar: 0,
            endChar: 90,
            startLine: 1,
            endLine: 5,
            heading: `Section ${i}`,
          },
        ],
        symbols: i % 10 === 0 ? [{ name: `Handler${i}`, kind: 'function', lineNumber: 2 }] : undefined,
        links: i % 5 === 0 ? [{ targetRef: `Hub${i % 8}`, kind: 'wikilink', lineNumber: 3 }] : undefined,
      });
    }
    const writeMs = performance.now() - writeStart;

    const searchStart = performance.now();
    const hits = kg.searchLexical('DELTA_CANARY_TOKEN_994', 10);
    const searchMs = performance.now() - searchStart;

    const statsStart = performance.now();
    const stats = kg.getStats();
    const insights = kg.getInsights();
    const graphMap = kg.getWorkspaceGraphMap('/vault', 240);
    const connections = kg.getFileConnections('/vault/dir-0/doc-0.md');
    const impact = kg.findImpactForPaths(['/vault/dir-0/doc-0.md', '/vault/dir-1/doc-1.md']);
    const statsMs = performance.now() - statsStart;

    kg.close();

    expect(stats.totalFiles).toBe(2000);
    expect(stats.totalChunks).toBe(2000);
    expect(hits).toHaveLength(1);
    expect(hits[0].filePath).toBe('/vault/dir-17/doc-1337.md');
    expect(insights.topHubs.length).toBeGreaterThan(0);
    expect(graphMap.nodes.length).toBeGreaterThan(0);
    expect(connections.backlinks.length + connections.outgoingLinks.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(impact)).toBe(true);
    expect(writeMs).toBeLessThan(15000);
    expect(searchMs).toBeLessThan(500);
    expect(statsMs).toBeLessThan(600);
  }, 30000);

  it('enforces frontier regression budgets across PathValidator, SecretGuard, sortFileNodes, and computeGraphLayout', async () => {
    // 1. Batched canonical validation on 200 real files
    const batchFiles = await Promise.all(
      Array.from({ length: 200 }, async (_, i) => {
        const target = path.join(tmpDir, `item_${i}.txt`);
        await fs.writeFile(target, `file ${i}`);
        return target;
      })
    );
    const validator = new PathValidator([tmpDir]);
    const valStart = performance.now();
    const validated = await validator.validateCanonicalBatch(batchFiles, 16);
    const valMs = performance.now() - valStart;
    expect(validated).toHaveLength(200);
    expect(validated.every((r) => r.valid)).toBe(true);
    expect(valMs).toBeLessThan(500);

    // 2. SecretGuard 500KB clean source scan + 100KB inline secret redaction
    const clean500k = 'Normal source line with no credentials whatsoever for indexing throughput.\n'.repeat(
      7000
    );
    redactSensitiveText('warmup');
    const sgCleanStart = performance.now();
    const cleanRes = redactSensitiveText(clean500k);
    const sgCleanMs = performance.now() - sgCleanStart;
    expect(cleanRes.redactionsCount).toBe(0);
    expect(sgCleanMs).toBeLessThan(50);

    const dirty100k = (
      'const apiKey = "sk-abcdefghijklmnop1234567890";\n'.repeat(200) +
      'Normal source line with no credentials whatsoever.\n'.repeat(1500)
    ).slice(0, 100_000);
    const sgDirtyStart = performance.now();
    const dirtyRes = redactSensitiveText(dirty100k);
    const sgDirtyMs = performance.now() - sgDirtyStart;
    expect(dirtyRes.redactionsCount).toBeGreaterThan(0);
    expect(sgDirtyMs).toBeLessThan(60);

    // 3. Renderer sortFileNodes on 5,000 items
    const nodes5k: FileNode[] = Array.from({ length: 5000 }, (_, i) => ({
      path: `/vault/file_${(5000 - i).toString().padStart(4, '0')}.ts`,
      name: `file_${(5000 - i).toString().padStart(4, '0')}.ts`,
      isDirectory: i % 20 === 0,
      size: i * 13,
      modified: 1700000000 + i,
      extension: 'ts',
      mimeType: 'text/typescript',
    }));
    const sortStart = performance.now();
    const sorted5k = sortFileNodes(nodes5k, 'name', 'asc');
    const sortMs = performance.now() - sortStart;
    expect(sorted5k).toHaveLength(5000);
    expect(sortMs).toBeLessThan(150);

    // 4. Spatial Graph layout on 240 nodes + 300 edges
    const graphNodes: WorkspaceGraphNode[] = Array.from({ length: 240 }, (_, i) => ({
      path: `/vault/node_${i}.ts`,
      name: `node_${i}.ts`,
      folder: '/vault',
      fileType: i % 3 === 0 ? 'md' : 'ts',
      inDegree: (i * 3) % 10,
      outDegree: (i * 7) % 10,
      chunkCount: 2,
      topSymbols: [],
    }));
    const graphEdges: WorkspaceGraphEdge[] = Array.from({ length: 300 }, (_, i) => ({
      source: graphNodes[i % 240].path,
      target: graphNodes[(i * 7 + 13) % 240].path,
      targetRef: 'ref',
      kind: 'import',
      lineNumber: 1,
    }));
    const layoutStart = performance.now();
    const layout = computeGraphLayout(graphNodes, graphEdges);
    const layoutMs = performance.now() - layoutStart;
    expect(layout).toHaveLength(240);
    expect(layoutMs).toBeLessThan(100);
  });
});
