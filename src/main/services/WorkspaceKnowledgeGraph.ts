import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseSync as NodeSqliteDatabase } from 'node:sqlite';
import { suppressSqliteExperimentalWarning } from '../../shared/utils/processWarnings';
import { GraphImpactReference } from '../../shared/contracts';
import { ExtractedLink, ExtractedSymbol, StructuralChunk } from '../../llm/services/StructuralChunker';

export interface KnowledgeGraphChunkRecord {
  id: string;
  filePath: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
  heading: string;
  chunkText: string;
  indexedAt: number;
  bm25Score: number;
}

export interface DuplicateCluster {
  sha256: string;
  files: string[];
  fileSize: number;
  wastedBytes: number;
}

export interface KnowledgeGraphInsights {
  totalFiles: number;
  totalChunks: number;
  totalTokens: number;
  lastIndexed: number;
  duplicateClusters: DuplicateCluster[];
  totalWastedBytes: number;
  topHubs: Array<{ targetRef: string; backlinkCount: number }>;
  recentFiles: Array<{ path: string; fileType: string; chunkCount: number; indexedAt: number }>;
}

export interface KnowledgeGraphUpsertInput {
  filePath: string;
  sha256?: string;
  size?: number;
  mtimeMs?: number;
  fileType?: string;
  indexedAt?: number;
  chunks: Array<{
    id: string;
    chunkIndex: number;
    text: string;
    startChar: number;
    endChar: number;
    startLine?: number;
    endLine?: number;
    heading?: string;
  }>;
  symbols?: ExtractedSymbol[];
  links?: ExtractedLink[];
}

export function computeBufferSha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Escapes user query strings into safe SQLite FTS5 match expressions while
 * preserving exact identifier tokens (`ALPHA_PROTOCOL_771`, `PathValidator.validate`).
 */
export function buildSafeFtsQuery(rawQuery: string): string {
  const tokens = rawQuery.match(/[A-Za-z0-9_.-]+/g) ?? [];
  const uniqueTokens: string[] = [];
  const seen = new Set<string>();

  for (const raw of tokens) {
    const cleaned = raw.replace(/^[.-]+|[.-]+$/g, '');
    if (cleaned.length < 2) continue;
    const lower = cleaned.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      uniqueTokens.push(cleaned);
    }
    if (uniqueTokens.length >= 16) break;
  }

  if (uniqueTokens.length === 0) {
    return '';
  }

  return uniqueTokens
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ');
}

/**
 * Persistent disk-backed Workspace Knowledge Graph powered by Node 24 / Electron 45
 * built-in `node:sqlite` (WAL mode + FTS5 `bm25()` + SHA-256 duplicates + symbol/link graph).
 * Eliminates in-memory full-table `.toArray()` rebuild scans cleanly at 10k+ scale.
 */
export class WorkspaceKnowledgeGraph {
  private db: NodeSqliteDatabase | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    this.openAndMigrate();
  }

  private openAndMigrate(): void {
    suppressSqliteExperimentalWarning();
    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(this.dbPath);

    if (this.dbPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
    }
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        file_type TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        start_char INTEGER NOT NULL,
        end_char INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        heading TEXT NOT NULL,
        chunk_text TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        file_path,
        heading,
        chunk_text,
        tokenize = 'unicode61 tokenchars ''_'''
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
        symbol_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_number INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(symbol_name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
        target_ref TEXT NOT NULL,
        target_path TEXT,
        kind TEXT NOT NULL,
        line_number INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_ref);
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);
    `);

    // Idempotent schema migration for pre-existing databases adding canonical target_path
    const linkColumns = db.prepare('PRAGMA table_info(links)').all() as Array<{ name: string }>;
    if (!linkColumns.some((c) => c.name === 'target_path')) {
      db.exec('ALTER TABLE links ADD COLUMN target_path TEXT;');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_links_target_path ON links(target_path);');

    this.db = db;
  }

  private normalizeLookupPath(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private resolveLinkTargetPath(
    db: NodeSqliteDatabase,
    sourcePath: string,
    targetRef: string,
    kind: string
  ): string | null {
    const trimmed = targetRef.split('|')[0].split('#')[0].split('?')[0].trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
      const sourceDir = path.dirname(sourcePath);
      const baseCandidate = path.resolve(sourceDir, trimmed);
      const candidateExts = ['', '.md', '.markdown', '.ts', '.tsx', '.js', '.jsx', '.py', '.json'];
      for (const ext of candidateExts) {
        const candidate = ext ? `${baseCandidate}${ext}` : baseCandidate;
        const row = db.prepare('SELECT path FROM files WHERE LOWER(path) = LOWER(?) LIMIT 1').get(candidate) as
          | { path: string }
          | undefined;
        if (row) {
          return row.path;
        }
      }
      // Also check index file inside directory import (`./utils` -> `./utils/index.ts`)
      for (const indexFile of ['index.ts', 'index.tsx', 'index.js', 'index.md']) {
        const candidate = path.join(baseCandidate, indexFile);
        const row = db.prepare('SELECT path FROM files WHERE LOWER(path) = LOWER(?) LIMIT 1').get(candidate) as
          | { path: string }
          | undefined;
        if (row) {
          return row.path;
        }
      }
      return baseCandidate;
    }

    if (kind === 'wikilink') {
      const cleanedName = path.basename(trimmed).toLowerCase();
      const allFiles = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
      for (const f of allFiles) {
        const fileBase = path.basename(f.path).toLowerCase();
        const fileStem = path.basename(f.path, path.extname(f.path)).toLowerCase();
        if (fileBase === cleanedName || fileStem === cleanedName) {
          return f.path;
        }
      }
    }

    return null;
  }

  private getDb(): NodeSqliteDatabase {
    if (!this.db) {
      this.openAndMigrate();
    }
    return this.db!;
  }

  private withTransaction<T>(fn: (db: NodeSqliteDatabase) => T): T {
    const db = this.getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure after error
      }
      throw error;
    }
  }

  needsReindex(filePath: string, mtimeMs: number, size: number, sha256?: string): boolean {
    const db = this.getDb();
    const row = db
      .prepare('SELECT sha256, size, mtime_ms FROM files WHERE path = ?')
      .get(filePath) as { sha256: string; size: number; mtime_ms: number } | undefined;

    if (!row) return true;
    if (sha256) {
      return row.sha256 !== sha256;
    }
    return row.size !== size || Math.round(row.mtime_ms) !== Math.round(mtimeMs);
  }

  upsertDocument(input: KnowledgeGraphUpsertInput): void {
    const indexedAt = input.indexedAt ?? Date.now();
    const totalChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const tokenEstimate = input.chunks.reduce((sum, c) => sum + Math.ceil(c.text.length / 4), 0);
    const computedSha =
      input.sha256 ??
      computeBufferSha256(input.chunks.map((c) => c.text).join('\n'));
    const fileType = input.fileType ?? path.extname(input.filePath).toLowerCase().replace(/^\./, '');

    this.withTransaction((db) => {
      db.prepare('DELETE FROM chunks_fts WHERE file_path = ?').run(input.filePath);
      db.prepare('DELETE FROM chunks WHERE file_path = ?').run(input.filePath);
      db.prepare('DELETE FROM symbols WHERE file_path = ?').run(input.filePath);
      db.prepare('DELETE FROM links WHERE source_path = ?').run(input.filePath);

      db.prepare(`
        INSERT INTO files (path, sha256, size, mtime_ms, file_type, chunk_count, token_estimate, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          sha256 = excluded.sha256,
          size = excluded.size,
          mtime_ms = excluded.mtime_ms,
          file_type = excluded.file_type,
          chunk_count = excluded.chunk_count,
          token_estimate = excluded.token_estimate,
          indexed_at = excluded.indexed_at
      `).run(
        input.filePath,
        computedSha,
        input.size ?? totalChars,
        Math.round(input.mtimeMs ?? indexedAt),
        fileType || 'unknown',
        input.chunks.length,
        tokenEstimate,
        indexedAt
      );

      const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO chunks (id, file_path, chunk_index, start_char, end_char, start_line, end_line, heading, chunk_text, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = db.prepare(`
        INSERT INTO chunks_fts (chunk_id, file_path, heading, chunk_text)
        VALUES (?, ?, ?, ?)
      `);

      for (const chunk of input.chunks) {
        const startLine = chunk.startLine ?? 1;
        const endLine = chunk.endLine ?? startLine;
        const heading = chunk.heading ?? path.basename(input.filePath);
        insertChunk.run(
          chunk.id,
          input.filePath,
          chunk.chunkIndex,
          chunk.startChar,
          chunk.endChar,
          startLine,
          endLine,
          heading,
          chunk.text,
          indexedAt
        );
        insertFts.run(chunk.id, input.filePath, heading, chunk.text);
      }

      if (input.symbols && input.symbols.length > 0) {
        const insertSymbol = db.prepare(
          'INSERT INTO symbols (file_path, symbol_name, kind, line_number) VALUES (?, ?, ?, ?)'
        );
        for (const sym of input.symbols) {
          insertSymbol.run(input.filePath, sym.name, sym.kind, sym.lineNumber);
        }
      }

      if (input.links && input.links.length > 0) {
        const insertLink = db.prepare(
          'INSERT INTO links (source_path, target_ref, target_path, kind, line_number) VALUES (?, ?, ?, ?, ?)'
        );
        for (const link of input.links) {
          const targetPath = this.resolveLinkTargetPath(db, input.filePath, link.targetRef, link.kind);
          insertLink.run(input.filePath, link.targetRef, targetPath, link.kind, link.lineNumber);
        }
      }
    });
  }

  removeFile(filePath: string): number {
    return this.withTransaction((db) => {
      db.prepare('DELETE FROM chunks_fts WHERE file_path = ?').run(filePath);
      const info = db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
      return Number(info.changes ?? 0);
    });
  }

  clear(): void {
    this.withTransaction((db) => {
      db.exec(`
        DELETE FROM chunks_fts;
        DELETE FROM symbols;
        DELETE FROM links;
        DELETE FROM chunks;
        DELETE FROM files;
      `);
    });
  }

  searchLexical(query: string, topK: number = 10): KnowledgeGraphChunkRecord[] {
    if (topK <= 0) return [];
    const safeMatch = buildSafeFtsQuery(query);
    if (!safeMatch) return [];

    const db = this.getDb();
    try {
      const rows = db.prepare(`
        SELECT
          c.id AS id,
          c.file_path AS file_path,
          c.chunk_index AS chunk_index,
          c.start_char AS start_char,
          c.end_char AS end_char,
          c.start_line AS start_line,
          c.end_line AS end_line,
          c.heading AS heading,
          c.chunk_text AS chunk_text,
          c.indexed_at AS indexed_at,
          bm25(chunks_fts, 0.0, 1.5, 1.2, 1.0) AS raw_bm25
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.chunk_id
        WHERE chunks_fts MATCH ?
        ORDER BY raw_bm25 ASC
        LIMIT ?
      `).all(safeMatch, topK) as Array<{
        id: string;
        file_path: string;
        chunk_index: number;
        start_char: number;
        end_char: number;
        start_line: number;
        end_line: number;
        heading: string;
        chunk_text: string;
        indexed_at: number;
        raw_bm25: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        filePath: row.file_path,
        chunkIndex: row.chunk_index,
        startChar: row.start_char,
        endChar: row.end_char,
        startLine: row.start_line,
        endLine: row.end_line,
        heading: row.heading,
        chunkText: row.chunk_text,
        indexedAt: row.indexed_at,
        bm25Score: Math.max(0.01, -Number(row.raw_bm25 ?? 0)),
      }));
    } catch {
      return [];
    }
  }

  getChunkLocation(chunkId: string): { startLine: number; endLine: number; heading: string } | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT start_line, end_line, heading FROM chunks WHERE id = ?')
      .get(chunkId) as { start_line: number; end_line: number; heading: string } | undefined;
    if (!row) return null;
    return {
      startLine: row.start_line,
      endLine: row.end_line,
      heading: row.heading,
    };
  }

  getStats(): {
    totalFiles: number;
    totalChunks: number;
    totalTokens: number;
    lastIndexed: number;
  } {
    const db = this.getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total_files,
        COALESCE(SUM(chunk_count), 0) AS total_chunks,
        COALESCE(SUM(token_estimate), 0) AS total_tokens,
        COALESCE(MAX(indexed_at), 0) AS last_indexed
      FROM files
    `).get() as {
      total_files: number;
      total_chunks: number;
      total_tokens: number;
      last_indexed: number;
    };

    return {
      totalFiles: Number(row?.total_files ?? 0),
      totalChunks: Number(row?.total_chunks ?? 0),
      totalTokens: Number(row?.total_tokens ?? 0),
      lastIndexed: Number(row?.last_indexed ?? 0),
    };
  }

  getIndexedFiles(limit: number = 10000): string[] {
    const db = this.getDb();
    const rows = db
      .prepare('SELECT path FROM files ORDER BY path ASC LIMIT ?')
      .all(limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  getDuplicateClusters(): DuplicateCluster[] {
    const db = this.getDb();
    const dupHashes = db.prepare(`
      SELECT sha256, MAX(size) AS file_size, COUNT(*) AS cnt
      FROM files
      WHERE size > 0
      GROUP BY sha256
      HAVING cnt > 1
      ORDER BY (MAX(size) * (COUNT(*) - 1)) DESC
      LIMIT 100
    `).all() as Array<{ sha256: string; file_size: number; cnt: number }>;

    const findPaths = db.prepare('SELECT path FROM files WHERE sha256 = ? ORDER BY path ASC');
    return dupHashes.map((row) => {
      const files = (findPaths.all(row.sha256) as Array<{ path: string }>).map((f) => f.path);
      return {
        sha256: row.sha256,
        files,
        fileSize: Number(row.file_size),
        wastedBytes: Number(row.file_size) * Math.max(0, files.length - 1),
      };
    });
  }

  findBySymbol(symbolName: string, limit: number = 25): Array<{ filePath: string; symbolName: string; kind: string; lineNumber: number }> {
    const db = this.getDb();
    const rows = db.prepare(`
      SELECT file_path, symbol_name, kind, line_number
      FROM symbols
      WHERE symbol_name LIKE ?
      ORDER BY CASE WHEN LOWER(symbol_name) = LOWER(?) THEN 0 ELSE 1 END, line_number ASC
      LIMIT ?
    `).all(`%${symbolName}%`, symbolName, limit) as Array<{
      file_path: string;
      symbol_name: string;
      kind: string;
      line_number: number;
    }>;

    return rows.map((r) => ({
      filePath: r.file_path,
      symbolName: r.symbol_name,
      kind: r.kind,
      lineNumber: r.line_number,
    }));
  }

  findBacklinks(
    targetRef: string,
    limit: number = 50
  ): Array<{ sourcePath: string; targetRef: string; kind: string; lineNumber: number; targetPath?: string }> {
    const db = this.getDb();
    const cleaned = targetRef.trim();
    if (!cleaned) {
      return [];
    }

    const baseWithExt = path.basename(cleaned).toLowerCase();
    const stemNoExt = path.basename(cleaned, path.extname(cleaned)).toLowerCase();
    const resolvedTarget = path.isAbsolute(cleaned) ? path.resolve(cleaned) : cleaned;

    const rows = db.prepare(`
      SELECT source_path, target_ref, target_path, kind, line_number
      FROM links
      WHERE (target_path IS NOT NULL AND LOWER(target_path) = LOWER(?))
         OR LOWER(target_ref) = LOWER(?)
         OR (
           kind = 'wikilink'
           AND (
             LOWER(TRIM(target_ref)) = ?
             OR LOWER(TRIM(target_ref)) = ?
             OR LOWER(TRIM(target_ref)) LIKE ?
             OR LOWER(TRIM(target_ref)) LIKE ?
           )
         )
         OR (
           kind IN ('import', 'markdown_link')
           AND (
             LOWER(target_ref) = ?
             OR LOWER(target_ref) LIKE ?
             OR LOWER(target_ref) LIKE ?
           )
         )
      LIMIT ?
    `).all(
      resolvedTarget,
      cleaned,
      baseWithExt,
      stemNoExt,
      `${stemNoExt}#%`,
      `${stemNoExt}|%`,
      baseWithExt,
      `%/${baseWithExt}`,
      `%/${stemNoExt}`,
      limit
    ) as Array<{
      source_path: string;
      target_ref: string;
      target_path: string | null;
      kind: string;
      line_number: number;
    }>;

    return rows.map((r) => ({
      sourcePath: r.source_path,
      targetRef: r.target_ref,
      targetPath: r.target_path ?? undefined,
      kind: r.kind,
      lineNumber: r.line_number,
    }));
  }

  /**
   * Compute inbound link impact across files or folders prior to Delete / Move / Rename.
   */
  findImpactForPaths(targetPaths: string[], limitPerTarget: number = 50): GraphImpactReference[] {
    if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
      return [];
    }

    const db = this.getDb();
    const indexedFiles = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
    const expandedTargets = new Set<string>();

    for (const rawTarget of targetPaths) {
      if (!rawTarget) continue;
      const normTarget = this.normalizeLookupPath(rawTarget);
      const prefix = normTarget.endsWith(path.sep) ? normTarget : `${normTarget}${path.sep}`;
      expandedTargets.add(path.resolve(rawTarget));

      for (const f of indexedFiles) {
        const normFile = this.normalizeLookupPath(f.path);
        if (normFile === normTarget || normFile.startsWith(prefix)) {
          expandedTargets.add(f.path);
        }
      }
    }

    const refs: GraphImpactReference[] = [];
    const seen = new Set<string>();
    for (const target of expandedTargets) {
      const targetNorm = this.normalizeLookupPath(target);
      const backlinks = this.findBacklinks(target, limitPerTarget);
      for (const link of backlinks) {
        if (this.normalizeLookupPath(link.sourcePath) === targetNorm) {
          continue;
        }
        const dedupKey = `${link.sourcePath}:${link.lineNumber}:${link.targetRef}:${target}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        refs.push({
          targetPath: target,
          sourcePath: link.sourcePath,
          targetRef: link.targetRef,
          kind: link.kind,
          lineNumber: link.lineNumber,
          isMarkdownLink: link.kind === 'wikilink' || link.kind === 'markdown_link',
        });
      }
    }

    return refs;
  }

  getInsights(): KnowledgeGraphInsights {
    const db = this.getDb();
    const stats = this.getStats();
    const duplicateClusters = this.getDuplicateClusters();
    const totalWastedBytes = duplicateClusters.reduce((s, c) => s + c.wastedBytes, 0);

    const hubRows = db.prepare(`
      SELECT target_ref, COUNT(*) AS backlink_count
      FROM links
      GROUP BY target_ref
      ORDER BY backlink_count DESC
      LIMIT 10
    `).all() as Array<{ target_ref: string; backlink_count: number }>;

    const recentRows = db.prepare(`
      SELECT path, file_type, chunk_count, indexed_at
      FROM files
      ORDER BY indexed_at DESC
      LIMIT 10
    `).all() as Array<{ path: string; file_type: string; chunk_count: number; indexed_at: number }>;

    return {
      ...stats,
      duplicateClusters,
      totalWastedBytes,
      topHubs: hubRows.map((h) => ({
        targetRef: h.target_ref,
        backlinkCount: Number(h.backlink_count),
      })),
      recentFiles: recentRows.map((r) => ({
        path: r.path,
        fileType: r.file_type,
        chunkCount: Number(r.chunk_count),
        indexedAt: Number(r.indexed_at),
      })),
    };
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export type { StructuralChunk };
