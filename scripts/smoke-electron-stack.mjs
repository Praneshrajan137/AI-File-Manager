import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

if (process.argv.includes('--in-electron')) {
  const electronBinary = require('electron');
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawnSync(electronBinary, [scriptPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
    },
    stdio: 'inherit',
  });
  process.exit(child.status ?? 1);
}

async function run() {
  process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning' && w.message.includes('SQLite')) {
      return;
    }
    console.warn(`${w.name}: ${w.message}`);
  });

  // 1. Verify built-in node:sqlite + FTS5 + bm25() inside Electron 45 runtime
  const sqlite = require('node:sqlite');
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE VIRTUAL TABLE docs_fts USING fts5(path, content, tokenize='unicode61 tokenchars ''_.''');
    INSERT INTO docs_fts(path, content) VALUES ('src/auth.ts', 'PathValidator validateCanonical symlink guard');
  `);
  const row = db
    .prepare("SELECT path, bm25(docs_fts) AS rank FROM docs_fts WHERE docs_fts MATCH 'validateCanonical'")
    .get();
  assert.equal(row?.path, 'src/auth.ts');
  assert.equal(typeof row?.rank, 'number');
  db.close();

  // 2. Verify @lancedb/lancedb@0.41.x native ABI inside Electron 45
  const lancedb = require('@lancedb/lancedb');
  const tmpLance = await fs.mkdtemp(path.join(os.tmpdir(), 'osfm-smoke-lance-'));
  try {
    const conn = await lancedb.connect(tmpLance);
    const tbl = await conn.createTable('smoke', [
      { id: '1', vector: new Array(384).fill(0.1), text: 'hello' },
    ]);
    const hits = await tbl.vectorSearch(new Array(384).fill(0.1)).limit(1).toArray();
    assert.equal(hits.length, 1);
  } finally {
    await fs.rm(tmpLance, { recursive: true, force: true });
  }

  // 3. Verify @huggingface/transformers, pdf-parse@2, mammoth, ollama, dompurify load cleanly
  const transformers = require('@huggingface/transformers');
  assert.equal(typeof transformers.pipeline, 'function');

  const pdfParse = require('pdf-parse');
  assert.equal(typeof pdfParse.PDFParse, 'function');

  const mammoth = require('mammoth');
  assert.equal(typeof mammoth.extractRawText, 'function');

  const { Ollama } = require('ollama');
  assert.equal(typeof Ollama, 'function');

  console.log(
    JSON.stringify({
      ok: true,
      node: process.version,
      electron: process.versions.electron ?? null,
      modules: ['node:sqlite(fts5)', '@lancedb/lancedb', '@huggingface/transformers', 'pdf-parse@2', 'mammoth', 'ollama'],
    })
  );
}

run().catch((err) => {
  console.error('Electron runtime smoke check failed:', err);
  process.exit(1);
});
