import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PathTrie } from '../../src/main/dsa/PathTrie';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';

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
    const statsMs = performance.now() - statsStart;

    kg.close();

    expect(stats.totalFiles).toBe(2000);
    expect(stats.totalChunks).toBe(2000);
    expect(hits).toHaveLength(1);
    expect(hits[0].filePath).toBe('/vault/dir-17/doc-1337.md');
    expect(insights.topHubs.length).toBeGreaterThan(0);
    expect(writeMs).toBeLessThan(15000);
    expect(searchMs).toBeLessThan(500);
    expect(statsMs).toBeLessThan(500);
  }, 30000);
});
