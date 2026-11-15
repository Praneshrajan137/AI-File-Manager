#!/usr/bin/env node
/**
 * eval-real-rag.mjs - Real-Model Hybrid RAG & Cross-Encoder Benchmark
 *
 * Benchmarks real ONNX models (`Xenova/bge-small-en-v1.5` + `Xenova/ms-marco-MiniLM-L-6-v2`)
 * against a deterministic 12-document multi-folder corpus comparing:
 *   1) Lexical BM25-style TF-IDF baseline
 *   2) Real Dense ONNX Bi-Encoder cosine similarity
 *   3) Hybrid RRF + Cross-Encoder Reranking
 *
 * Reports Recall@5, MRR@5, NDCG@5, and per-query embed/rerank latency.
 *
 * Usage:
 *   node scripts/eval-real-rag.mjs [--device cpu|dml|webgpu|auto] [--allow-download] [--json]
 */

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const EMBED_MODEL = 'Xenova/bge-small-en-v1.5';
const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

const GOLDEN_CORPUS = [
  {
    id: 'doc-auth-oauth',
    folder: '/vault/security',
    title: 'oauth-token-rotation.md',
    text: 'Service accounts rotate JWT signing certificates every 72 hours via the JWKS endpoint and enforce strict audience validation.',
  },
  {
    id: 'doc-auth-firewall',
    folder: '/vault/security',
    title: 'secret-guard-policy.ts',
    text: 'SecretGuard blocks .env, private.pem, and SSH keys from indexing and redacts sk- and ghp_ tokens before prompt injection.',
  },
  {
    id: 'doc-auth-validator',
    folder: '/vault/security',
    title: 'path-validator.ts',
    text: 'PathValidator resolves canonical paths with realpathSync to prevent Windows junction escapes, POSIX symlinks, and .. traversal.',
  },
  {
    id: 'doc-db-sqlite',
    folder: '/vault/kernel',
    title: 'knowledge-graph.ts',
    text: 'WorkspaceKnowledgeGraph stores chunks, FTS5 BM25 inverted postings, AST symbols, and 2-hop hub-damped Personalized PageRank links in SQLite WAL.',
  },
  {
    id: 'doc-db-lancedb',
    folder: '/vault/kernel',
    title: 'vector-store.ts',
    text: 'VectorStore batches normalized 384-dimensional float32 embeddings into LanceDB and rebuilds mismatched dimensions automatically.',
  },
  {
    id: 'doc-ui-spatial',
    folder: '/vault/frontend',
    title: 'KnowledgeGraphCanvas.tsx',
    text: 'The spatial canvas renders a radial degree-sorted topology with folder scoping, node degree centrality, and direct preview triggers.',
  },
  {
    id: 'doc-ui-split',
    folder: '/vault/frontend',
    title: 'SplitPaneExplorer.tsx',
    text: 'Dual-pane file explorer allows side-by-side browsing, cross-pane file copy actions, and OS-safe basename notifications.',
  },
  {
    id: 'doc-ops-undo',
    folder: '/vault/ops',
    title: 'operation-journal.ts',
    text: 'Transactional batch undo reverses folder creation, file moves, Trash Vault soft-deletions, and atomic Markdown link repairs in LIFO order.',
  },
  {
    id: 'doc-ops-dedup',
    folder: '/vault/ops',
    title: 'ai-organizer.ts',
    text: 'Dry-run organizer hashes candidate files with SHA-256 to isolate byte-identical duplicates into Duplicates Archive without deleting originals.',
  },
  {
    id: 'doc-ci-watch',
    folder: '/vault/devops',
    title: 'ci-watch.mjs',
    text: 'Non-blocking GitHub Actions watcher enforces strict per-call timeouts, headless PAGER=cat settings, and bounded log line truncation.',
  },
  {
    id: 'doc-rag-fallback',
    folder: '/vault/kernel',
    title: 'offline-synthesis.ts',
    text: 'When Ollama and LM Studio are unreachable, OfflineSynthesisService answers directly from BM25 chunks and 2-hop graph citations offline.',
  },
  {
    id: 'doc-mcp-stdio',
    folder: '/vault/integrations',
    title: 'WorkspaceMcpServer.ts',
    text: 'JSON-RPC 2.0 stdio server exposes six read-only workspace tools and guarantees non-protocol diagnostics write exclusively to stderr.',
  },
];

// Carefully designed queries testing zero-keyword paraphrases, technical lookups, & cross-concepts
const GOLDEN_QUERIES = [
  {
    query: 'How are leaked credentials stripped before hitting local AI prompts?',
    relevantIds: ['doc-auth-firewall'],
  },
  {
    query: 'What prevents symlink traversal escaping the allowed workspace root?',
    relevantIds: ['doc-auth-validator'],
  },
  {
    query: 'Does the copilot keep working when no local inference server is running?',
    relevantIds: ['doc-rag-fallback'],
  },
  {
    query: 'How do redundant identical files get cleaned up without permanent deletion?',
    relevantIds: ['doc-ops-dedup', 'doc-ops-undo'],
  },
  {
    query: 'Which graph algorithm handles 2-hop neighbor associative retrieval?',
    relevantIds: ['doc-db-sqlite'],
  },
  {
    query: 'How can Claude Desktop inspect files safely over standard input/output?',
    relevantIds: ['doc-mcp-stdio'],
  },
  {
    query: 'When are JSON Web Key credentials cycled for service authentication?',
    relevantIds: ['doc-auth-oauth'],
  },
  {
    query: 'How do side-by-side directory transfers work in the interface?',
    relevantIds: ['doc-ui-split'],
  },
];

function parseArgs(argv) {
  let device = 'cpu';
  let allowDownload = false;
  let jsonOutput = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--device' && argv[i + 1]) device = argv[++i];
    else if (argv[i] === '--allow-download') allowDownload = true;
    else if (argv[i] === '--json') jsonOutput = true;
  }
  return { device, allowDownload, jsonOutput };
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function scoreBm25Baseline(query, docs) {
  const qTokens = tokenize(query);
  const df = new Map();
  const docTokens = docs.map((d) => tokenize(`${d.title} ${d.text}`));
  for (const tokens of docTokens) {
    for (const uniq of new Set(tokens)) {
      df.set(uniq, (df.get(uniq) || 0) + 1);
    }
  }
  const avgDl = docTokens.reduce((s, t) => s + t.length, 0) / docs.length;
  const k1 = 1.2;
  const b = 0.75;

  return docs
    .map((doc, idx) => {
      const tokens = docTokens[idx];
      const tfMap = new Map();
      for (const tok of tokens) tfMap.set(tok, (tfMap.get(tok) || 0) + 1);
      let score = 0;
      for (const q of qTokens) {
        const tf = tfMap.get(q) || 0;
        if (tf === 0) continue;
        const n = df.get(q) || 0;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * tokens.length) / avgDl));
      }
      return { id: doc.id, score };
    })
    .sort((a, b2) => b2.score - a.score)
    .map((r) => r.id);
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function computeMetrics(rankedLists, queries, k = 5) {
  let recallSum = 0;
  let mrrSum = 0;
  let ndcgSum = 0;

  for (let i = 0; i < queries.length; i += 1) {
    const relSet = new Set(queries[i].relevantIds);
    const topK = rankedLists[i].slice(0, k);

    let hits = 0;
    let firstRank = 0;
    let dcg = 0;
    for (let r = 0; r < topK.length; r += 1) {
      if (relSet.has(topK[r])) {
        hits += 1;
        if (firstRank === 0) firstRank = r + 1;
        dcg += 1 / Math.log2(r + 2);
      }
    }
    const idealHits = Math.min(k, relSet.size);
    let idcg = 0;
    for (let r = 0; r < idealHits; r += 1) {
      idcg += 1 / Math.log2(r + 2);
    }

    recallSum += hits / relSet.size;
    mrrSum += firstRank > 0 ? 1 / firstRank : 0;
    ndcgSum += idcg > 0 ? dcg / idcg : 0;
  }

  return {
    recallAt5: Number((recallSum / queries.length).toFixed(4)),
    mrrAt5: Number((mrrSum / queries.length).toFixed(4)),
    ndcgAt5: Number((ndcgSum / queries.length).toFixed(4)),
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const transformers = require('@huggingface/transformers');
  transformers.env.useBrowserCache = false;
  transformers.env.useFSCache = true;
  transformers.env.allowRemoteModels = args.allowDownload;

  const supportedDevices =
    transformers.env?.backends?.onnx?.supportedDevices ??
    transformers.backends?.onnx?.supportedDevices ??
    ['cpu'];

  const requestedDevice = args.device === 'auto' ? (supportedDevices.includes('dml') ? 'dml' : 'cpu') : args.device;
  let extractor;
  try {
    extractor = await transformers.pipeline('feature-extraction', EMBED_MODEL, {
      dtype: 'q8',
      device: requestedDevice,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out = {
      status: 'skipped_models_not_cached',
      reason: message,
      hint: 'Pass --allow-download to fetch ONNX weights (~45MB total) into local HuggingFace cache.',
      supportedDevices,
      bm25Baseline: computeMetrics(
        GOLDEN_QUERIES.map((q) => scoreBm25Baseline(q.query, GOLDEN_CORPUS)),
        GOLDEN_QUERIES
      ),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(RERANK_MODEL);
  const rerankModel = await transformers.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
    dtype: 'q8',
    device: requestedDevice,
  });

  // 1. Embed corpus
  const docVectors = [];
  const embedLatencies = [];
  for (const doc of GOLDEN_CORPUS) {
    const t0 = performance.now();
    const res = await extractor(`${doc.title}\n${doc.text}`, { pooling: 'mean', normalize: true });
    embedLatencies.push(performance.now() - t0);
    docVectors.push(Array.from(res.data));
  }

  // 2. Evaluate BM25, Dense, and Hybrid RRF + CrossEncoder
  const bm25Lists = [];
  const denseLists = [];
  const hybridLists = [];
  const rerankLatencies = [];

  for (const item of GOLDEN_QUERIES) {
    const bm25Ids = scoreBm25Baseline(item.query, GOLDEN_CORPUS);
    bm25Lists.push(bm25Ids);

    const t0 = performance.now();
    const qVecOut = await extractor(item.query, { pooling: 'mean', normalize: true });
    const qVec = Array.from(qVecOut.data);
    embedLatencies.push(performance.now() - t0);

    const denseRanked = GOLDEN_CORPUS.map((d, idx) => ({ id: d.id, score: dot(qVec, docVectors[idx]) }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.id);
    denseLists.push(denseRanked);

    // Reciprocal Rank Fusion of BM25 + Dense -> Top 8 candidates -> CrossEncoder rerank
    const rrfScores = new Map();
    bm25Ids.forEach((id, rank) => rrfScores.set(id, (rrfScores.get(id) || 0) + 1 / (60 + rank + 1)));
    denseRanked.forEach((id, rank) => rrfScores.set(id, (rrfScores.get(id) || 0) + 1 / (60 + rank + 1)));
    const topCandidates = [...rrfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => GOLDEN_CORPUS.find((d) => d.id === id));

    const tr0 = performance.now();
    const queriesArr = topCandidates.map(() => item.query);
    const docsArr = topCandidates.map((d) => `${d.title}\n${d.text}`);
    const encoded = await tokenizer(queriesArr, { text_pair: docsArr, padding: true, truncation: true });
    const logitsOut = await rerankModel(encoded);
    const logits = Array.from(logitsOut.logits.data);
    rerankLatencies.push(performance.now() - tr0);

    const reranked = topCandidates
      .map((d, i) => ({ id: d.id, score: logits[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.id);
    hybridLists.push(reranked);
  }

  const report = {
    status: 'completed',
    embedModel: EMBED_MODEL,
    rerankModel: RERANK_MODEL,
    requestedDevice,
    supportedDevices,
    corpusSize: GOLDEN_CORPUS.length,
    queryCount: GOLDEN_QUERIES.length,
    latencyMs: {
      embedP50: percentile(embedLatencies, 50),
      embedP95: percentile(embedLatencies, 95),
      rerankP50: percentile(rerankLatencies, 50),
      rerankP95: percentile(rerankLatencies, 95),
    },
    metrics: {
      bm25: computeMetrics(bm25Lists, GOLDEN_QUERIES),
      denseBgeSmall: computeMetrics(denseLists, GOLDEN_QUERIES),
      hybridRrfPlusMiniLM: computeMetrics(hybridLists, GOLDEN_QUERIES),
    },
  };

  if (args.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('\n=== Real-Model Hybrid RAG Benchmark ===');
  console.log(`Embedder : ${report.embedModel} (${report.requestedDevice}; supported=${supportedDevices.join(',')})`);
  console.log(`Reranker : ${report.rerankModel}`);
  console.log(`Embed p50/p95  : ${report.latencyMs.embedP50}ms / ${report.latencyMs.embedP95}ms`);
  console.log(`Rerank p50/p95 : ${report.latencyMs.rerankP50}ms / ${report.latencyMs.rerankP95}ms\n`);
  console.table(report.metrics);
}

main().catch((err) => {
  console.error('[eval-real-rag] Failed:', err);
  process.exit(1);
});
