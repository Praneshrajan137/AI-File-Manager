import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseSync as NodeSqliteDatabase } from 'node:sqlite';
import { suppressSqliteExperimentalWarning } from '../../shared/utils/processWarnings';
import {
  AssociativeBoostResult,
  FileConnectionsSummary,
  GraphImpactReference,
  PersistedAgentTraceRecord,
  SearchScopeFilter,
  WorkspaceCollectionGroup,
  WorkspaceGraphEdge,
  WorkspaceGraphMap,
  WorkspaceGraphNode,
} from '../../shared/contracts';
import { ExtractedLink, ExtractedSymbol, StructuralChunk } from '../../llm/services/StructuralChunker';
import { MAX_PERSISTED_TRACE_RECORDS } from '../../llm/orchestration/TraceLedger';
import { isSensitiveSecretFile, redactSensitiveText } from '../../shared/security/SecretGuard';

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
  vectorSyncStatus?: 'pending' | 'synced';
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

interface GraphAdjacencySnapshot {
  dataVersion: number;
  localWriteEpoch: number;
  allFiles: Array<{ path: string; canonicalPath: string; fileType: string; chunkCount: number }>;
  byKey: Map<string, string>;
  canonByKey: Map<string, string>;
  edges: WorkspaceGraphEdge[];
  adj: Map<string, Set<string>>;
  topSymbolsByFile: Map<string, string[]>;
  inDeg: Map<string, number>;
  outDeg: Map<string, number>;
  linkDegree: Map<string, number>;
}

const RELATIVE_CANDIDATE_EXTS = ['', '.md', '.markdown', '.ts', '.tsx', '.js', '.jsx', '.py', '.json'] as const;
const RELATIVE_INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.md'] as const;

/**
 * Persistent disk-backed Workspace Knowledge Graph powered by Node 24 / Electron 45
 * built-in `node:sqlite` (WAL mode + FTS5 `bm25()` + SHA-256 duplicates + symbol/link graph).
 * Eliminates in-memory full-table `.toArray()` rebuild scans cleanly at 10k+ scale.
 */
export class WorkspaceKnowledgeGraph {
  private db: NodeSqliteDatabase | null = null;
  private readonly dbPath: string;
  private stmts = new Map<string, ReturnType<NodeSqliteDatabase['prepare']>>();
  private localWriteEpoch = 0;
  private cachedAdjacency: GraphAdjacencySnapshot | null = null;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    this.openAndMigrate();
  }

  private prepareCached(db: NodeSqliteDatabase, sql: string): ReturnType<NodeSqliteDatabase['prepare']> {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  private readDataVersion(db: NodeSqliteDatabase): number {
    const row = this.prepareCached(db, 'PRAGMA data_version').get() as { data_version?: number } | undefined;
    return Number(row?.data_version ?? 0);
  }

  private invalidateGraphSnapshot(): void {
    this.localWriteEpoch += 1;
    this.cachedAdjacency = null;
  }

  private extractTargetKeyLower(targetRef: string): string {
    const trimmed = targetRef.split('|')[0].split('#')[0].split('?')[0].trim();
    if (!trimmed) return '';
    const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
    const slashIdx = normalized.lastIndexOf('/');
    const base = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
    return base.toLowerCase();
  }

  private extractCleanTrimmedLower(targetRef: string): string {
    return targetRef.trim().toLowerCase();
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
    `);

    const uvRow = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    const currentVersion = Number(uvRow?.user_version ?? 0);

    if (currentVersion < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          path TEXT PRIMARY KEY,
          sha256 TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime_ms INTEGER NOT NULL,
          file_type TEXT NOT NULL,
          chunk_count INTEGER NOT NULL,
          token_estimate INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL,
          vector_sync_status TEXT NOT NULL DEFAULT 'synced',
          canonical_path TEXT,
          path_lower TEXT,
          basename_lower TEXT,
          stem_lower TEXT
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
          line_number INTEGER NOT NULL,
          target_path_lower TEXT,
          target_ref_lower TEXT,
          target_key_lower TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_ref);
        CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);

        CREATE TABLE IF NOT EXISTS agent_traces (
          trace_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          mode TEXT NOT NULL,
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          query_preview TEXT NOT NULL,
          status TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          step_count INTEGER NOT NULL,
          duplicate_calls_prevented INTEGER NOT NULL DEFAULT 0,
          verified_citations INTEGER NOT NULL DEFAULT 0,
          ungrounded_citations_count INTEGER NOT NULL DEFAULT 0,
          redactions_applied INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          error_summary TEXT,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_traces_created_at ON agent_traces(created_at DESC);
      `);

      // Idempotent schema migration for pre-existing v1 databases
      const fileColumns = db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
      const fileColSet = new Set(fileColumns.map((c) => c.name));
      if (!fileColSet.has('vector_sync_status')) {
        db.exec("ALTER TABLE files ADD COLUMN vector_sync_status TEXT NOT NULL DEFAULT 'synced';");
      }
      if (!fileColSet.has('canonical_path')) {
        db.exec('ALTER TABLE files ADD COLUMN canonical_path TEXT;');
      }
      if (!fileColSet.has('path_lower')) {
        db.exec('ALTER TABLE files ADD COLUMN path_lower TEXT;');
      }
      if (!fileColSet.has('basename_lower')) {
        db.exec('ALTER TABLE files ADD COLUMN basename_lower TEXT;');
      }
      if (!fileColSet.has('stem_lower')) {
        db.exec('ALTER TABLE files ADD COLUMN stem_lower TEXT;');
      }

      const linkColumns = db.prepare('PRAGMA table_info(links)').all() as Array<{ name: string }>;
      const linkColSet = new Set(linkColumns.map((c) => c.name));
      if (!linkColSet.has('target_path')) {
        db.exec('ALTER TABLE links ADD COLUMN target_path TEXT;');
      }
      if (!linkColSet.has('target_path_lower')) {
        db.exec('ALTER TABLE links ADD COLUMN target_path_lower TEXT;');
      }
      if (!linkColSet.has('target_ref_lower')) {
        db.exec('ALTER TABLE links ADD COLUMN target_ref_lower TEXT;');
      }
      if (!linkColSet.has('target_key_lower')) {
        db.exec('ALTER TABLE links ADD COLUMN target_key_lower TEXT;');
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_vector_sync ON files(vector_sync_status);
        CREATE INDEX IF NOT EXISTS idx_files_path_lower ON files(path_lower);
        CREATE INDEX IF NOT EXISTS idx_files_basename_lower ON files(basename_lower);
        CREATE INDEX IF NOT EXISTS idx_files_stem_lower ON files(stem_lower);
        CREATE INDEX IF NOT EXISTS idx_files_indexed_at ON files(indexed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_links_target_path ON links(target_path);
        CREATE INDEX IF NOT EXISTS idx_links_target_path_lower ON links(target_path_lower);
        CREATE INDEX IF NOT EXISTS idx_links_target_ref_lower ON links(target_ref_lower);
        CREATE INDEX IF NOT EXISTS idx_links_target_key_lower ON links(target_key_lower);
      `);

      // Backfill legacy rows once if upgrading an existing v1 database
      const needsFileBackfill = Boolean(
        db.prepare('SELECT 1 FROM files WHERE path_lower IS NULL OR canonical_path IS NULL LIMIT 1').get()
      );
      const needsLinkBackfill = Boolean(
        db.prepare('SELECT 1 FROM links WHERE target_key_lower IS NULL OR target_ref_lower IS NULL LIMIT 1').get()
      );
      if (needsFileBackfill || needsLinkBackfill) {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (needsFileBackfill) {
            const legacyFiles = db
              .prepare('SELECT path FROM files WHERE path_lower IS NULL OR canonical_path IS NULL')
              .all() as Array<{ path: string }>;
            const updateFileStmt = db.prepare(
              'UPDATE files SET canonical_path = ?, path_lower = ?, basename_lower = ?, stem_lower = ? WHERE path = ?'
            );
            for (const row of legacyFiles) {
              const canon = this.canonicalizeLookupPath(row.path);
              const lowerPath = path.resolve(row.path).toLowerCase();
              const baseLower = path.basename(row.path).toLowerCase();
              const stemLower = path.basename(row.path, path.extname(row.path)).toLowerCase();
              updateFileStmt.run(canon, lowerPath, baseLower, stemLower, row.path);
            }
          }
          if (needsLinkBackfill) {
            const legacyLinks = db
              .prepare('SELECT id, target_ref, target_path FROM links WHERE target_key_lower IS NULL OR target_ref_lower IS NULL')
              .all() as Array<{ id: number; target_ref: string; target_path: string | null }>;
            const updateLinkStmt = db.prepare(
              'UPDATE links SET target_path_lower = ?, target_ref_lower = ?, target_key_lower = ? WHERE id = ?'
            );
            for (const row of legacyLinks) {
              updateLinkStmt.run(
                row.target_path ? row.target_path.toLowerCase() : null,
                this.extractCleanTrimmedLower(row.target_ref),
                this.extractTargetKeyLower(row.target_ref),
                row.id
              );
            }
          }
          db.exec('COMMIT');
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // Ignore rollback failure after migration error
          }
          throw err;
        }
      }

      db.exec('PRAGMA user_version = 2;');
    }

    this.db = db;
  }

  private normalizeLookupPath(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private canonicalizeLookupPath(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    const realpathFn =
      typeof fs.realpathSync?.native === 'function'
        ? (p: string): string => fs.realpathSync.native(p)
        : typeof fs.realpathSync === 'function'
          ? (p: string): string => fs.realpathSync(p)
          : null;

    let canonical = resolved;
    if (realpathFn) {
      let probe = resolved;
      const tail: string[] = [];
      for (let i = 0; i < 64; i += 1) {
        try {
          const realProbe = realpathFn(probe);
          canonical = tail.length > 0 ? path.join(realProbe, ...tail.reverse()) : realProbe;
          break;
        } catch {
          const parent = path.dirname(probe);
          if (parent === probe) {
            canonical = resolved;
            break;
          }
          tail.push(path.basename(probe));
          probe = parent;
        }
      }
    }

    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  }

  private canonicalizePrefixList(prefixes: readonly string[]): string[] {
    return prefixes.map((p) => this.canonicalizeLookupPath(p).replace(/[\\/]+$/, ''));
  }

  private isCanonicalWithinPrefix(canonicalTarget: string, normalizedPrefix: string): boolean {
    const target = canonicalTarget.replace(/[\\/]+$/, '');
    if (!normalizedPrefix) {
      return target.startsWith('/');
    }
    return (
      target === normalizedPrefix ||
      target.startsWith(`${normalizedPrefix}/`) ||
      target.startsWith(`${normalizedPrefix}\\`)
    );
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
      const orderedCandidates: string[] = [];
      for (const ext of RELATIVE_CANDIDATE_EXTS) {
        orderedCandidates.push(ext ? `${baseCandidate}${ext}` : baseCandidate);
      }
      for (const indexFile of RELATIVE_INDEX_FILES) {
        orderedCandidates.push(path.join(baseCandidate, indexFile));
      }

      const isWin = process.platform === 'win32';
      const placeholders = orderedCandidates.map(() => '?').join(', ');
      const sql = isWin
        ? `SELECT path, path_lower FROM files WHERE path_lower IN (${placeholders})`
        : `SELECT path FROM files WHERE path IN (${placeholders})`;
      const queryParams = isWin ? orderedCandidates.map((c) => c.toLowerCase()) : orderedCandidates;
      const rows = this.prepareCached(db, sql).all(...queryParams) as Array<{ path: string; path_lower?: string }>;
      if (rows.length > 0) {
        const hitMap = new Map<string, string>();
        for (const r of rows) {
          hitMap.set(isWin ? (r.path_lower ?? r.path.toLowerCase()) : r.path, r.path);
        }
        for (const cand of orderedCandidates) {
          const hit = hitMap.get(isWin ? cand.toLowerCase() : cand);
          if (hit) {
            return hit;
          }
        }
      }
      return baseCandidate;
    }

    if (kind === 'wikilink') {
      const cleanedName = trimmed.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
      if (cleanedName) {
        const row = this.prepareCached(
          db,
          'SELECT path FROM files WHERE basename_lower = ? OR stem_lower = ? ORDER BY rowid ASC LIMIT 1'
        ).get(cleanedName, cleanedName) as { path: string } | undefined;
        if (row) {
          return row.path;
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
    const row = this.prepareCached(
      db,
      'SELECT sha256, size, mtime_ms, vector_sync_status FROM files WHERE path = ?'
    ).get(filePath) as
      | { sha256: string; size: number; mtime_ms: number; vector_sync_status?: string }
      | undefined;

    if (!row) return true;
    if (row.vector_sync_status && row.vector_sync_status !== 'synced') {
      return true;
    }
    if (sha256) {
      return row.sha256 !== sha256;
    }
    return row.size !== size || Math.round(row.mtime_ms) !== Math.round(mtimeMs);
  }

  markFilesVectorSynced(filePaths: string[]): number {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return 0;
    }
    const unique = Array.from(new Set(filePaths.filter(Boolean)));
    if (unique.length === 0) {
      return 0;
    }
    const changed = this.withTransaction((db) => {
      const stmt = this.prepareCached(db, "UPDATE files SET vector_sync_status = 'synced' WHERE path = ?");
      const caseStmt =
        process.platform === 'win32'
          ? this.prepareCached(db, "UPDATE files SET vector_sync_status = 'synced' WHERE path_lower = ?")
          : null;
      let updated = 0;
      for (const filePath of unique) {
        const res = stmt.run(filePath);
        let rowChanges = Number(res.changes ?? 0);
        if (rowChanges === 0 && caseStmt) {
          rowChanges = Number(caseStmt.run(path.resolve(filePath).toLowerCase()).changes ?? 0);
        }
        updated += rowChanges;
      }
      return updated;
    });
    if (changed > 0) {
      this.invalidateGraphSnapshot();
    }
    return changed;
  }

  getFilesWithPendingSync(limit: number = 1000): string[] {
    const db = this.getDb();
    const rows = this.prepareCached(
      db,
      "SELECT path FROM files WHERE vector_sync_status != 'synced' LIMIT ?"
    ).all(limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  getPendingSyncCount(): number {
    const db = this.getDb();
    const row = this.prepareCached(
      db,
      "SELECT COUNT(*) as cnt FROM files WHERE vector_sync_status != 'synced'"
    ).get() as { cnt: number } | undefined;
    return Number(row?.cnt ?? 0);
  }

  private upsertDocumentInTx(db: NodeSqliteDatabase, input: KnowledgeGraphUpsertInput): void {
    const indexedAt = input.indexedAt ?? Date.now();
    const totalChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const tokenEstimate = input.chunks.reduce((sum, c) => sum + Math.ceil(c.text.length / 4), 0);
    const computedSha =
      input.sha256 ??
      computeBufferSha256(input.chunks.map((c) => c.text).join('\n'));
    const fileType = input.fileType ?? path.extname(input.filePath).toLowerCase().replace(/^\./, '');
    const canonicalPath = this.canonicalizeLookupPath(input.filePath);
    const pathLower = path.resolve(input.filePath).toLowerCase();
    const basenameLower = path.basename(input.filePath).toLowerCase();
    const stemLower = path.basename(input.filePath, path.extname(input.filePath)).toLowerCase();

    const existing = Boolean(
      this.prepareCached(db, 'SELECT 1 FROM files WHERE path = ? LIMIT 1').get(input.filePath)
    );
    if (existing) {
      this.prepareCached(db, 'DELETE FROM chunks_fts WHERE file_path = ?').run(input.filePath);
      this.prepareCached(db, 'DELETE FROM chunks WHERE file_path = ?').run(input.filePath);
      this.prepareCached(db, 'DELETE FROM symbols WHERE file_path = ?').run(input.filePath);
      this.prepareCached(db, 'DELETE FROM links WHERE source_path = ?').run(input.filePath);
    }

    this.prepareCached(db, `
      INSERT INTO files (
        path, sha256, size, mtime_ms, file_type, chunk_count, token_estimate, indexed_at, vector_sync_status,
        canonical_path, path_lower, basename_lower, stem_lower
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        sha256 = excluded.sha256,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        file_type = excluded.file_type,
        chunk_count = excluded.chunk_count,
        token_estimate = excluded.token_estimate,
        indexed_at = excluded.indexed_at,
        vector_sync_status = excluded.vector_sync_status,
        canonical_path = excluded.canonical_path,
        path_lower = excluded.path_lower,
        basename_lower = excluded.basename_lower,
        stem_lower = excluded.stem_lower
    `).run(
      input.filePath,
      computedSha,
      input.size ?? totalChars,
      Math.round(input.mtimeMs ?? indexedAt),
      fileType || 'unknown',
      input.chunks.length,
      tokenEstimate,
      indexedAt,
      input.vectorSyncStatus ?? 'synced',
      canonicalPath,
      pathLower,
      basenameLower,
      stemLower
    );

    const insertChunk = this.prepareCached(db, `
      INSERT OR REPLACE INTO chunks (id, file_path, chunk_index, start_char, end_char, start_line, end_line, heading, chunk_text, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.prepareCached(db, `
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
      const insertSymbol = this.prepareCached(
        db,
        'INSERT INTO symbols (file_path, symbol_name, kind, line_number) VALUES (?, ?, ?, ?)'
      );
      for (const sym of input.symbols) {
        insertSymbol.run(input.filePath, sym.name, sym.kind, sym.lineNumber);
      }
    }

    if (input.links && input.links.length > 0) {
      const insertLink = this.prepareCached(
        db,
        `INSERT INTO links (
          source_path, target_ref, target_path, kind, line_number,
          target_path_lower, target_ref_lower, target_key_lower
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const link of input.links) {
        const targetPath = this.resolveLinkTargetPath(db, input.filePath, link.targetRef, link.kind);
        insertLink.run(
          input.filePath,
          link.targetRef,
          targetPath,
          link.kind,
          link.lineNumber,
          targetPath ? targetPath.toLowerCase() : null,
          this.extractCleanTrimmedLower(link.targetRef),
          this.extractTargetKeyLower(link.targetRef)
        );
      }
    }
  }

  upsertDocument(input: KnowledgeGraphUpsertInput): void {
    this.withTransaction((db) => {
      this.upsertDocumentInTx(db, input);
    });
    this.invalidateGraphSnapshot();
  }

  upsertDocumentsBatch(inputs: KnowledgeGraphUpsertInput[]): void {
    if (inputs.length === 0) {
      return;
    }
    this.withTransaction((db) => {
      for (const item of inputs) {
        this.upsertDocumentInTx(db, item);
      }
    });
    this.invalidateGraphSnapshot();
  }

  removeFile(filePath: string): number {
    const removed = this.withTransaction((db) => {
      this.prepareCached(db, 'DELETE FROM chunks_fts WHERE file_path = ?').run(filePath);
      const info = this.prepareCached(db, 'DELETE FROM files WHERE path = ?').run(filePath);
      return Number(info.changes ?? 0);
    });
    if (removed > 0) {
      this.invalidateGraphSnapshot();
    }
    return removed;
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
    this.invalidateGraphSnapshot();
  }

  private buildScopeWhere(
    pathExpr: string,
    fileTypeExpr: string | null,
    scopeFilter?: SearchScopeFilter
  ): { clause: string; params: Array<string | number> } {
    if (!scopeFilter) {
      return { clause: '', params: [] };
    }

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    const isWindows = process.platform === 'win32';
    if (scopeFilter.folderPath && scopeFilter.folderPath.trim().length > 0) {
      const resolvedFolder = path.resolve(scopeFilter.folderPath).replace(/[\\/]+$/, '');
      const folderKey = isWindows ? resolvedFolder.toLowerCase() : resolvedFolder;
      const prefixWithSlash = `${folderKey}/`;
      const prefixWithBackslash = `${folderKey}\\`;
      const lhsExpr = isWindows ? `LOWER(${pathExpr})` : pathExpr;
      conditions.push(
        `(${lhsExpr} = ? OR INSTR(${lhsExpr}, ?) = 1 OR INSTR(${lhsExpr}, ?) = 1)`
      );
      params.push(folderKey, prefixWithSlash, prefixWithBackslash);
    }

    if (Array.isArray(scopeFilter.filePaths) && scopeFilter.filePaths.length > 0) {
      const cleanedPaths = scopeFilter.filePaths
        .map((p) => {
          const resolved = path.resolve(p);
          return isWindows ? resolved.toLowerCase() : resolved;
        })
        .filter(Boolean);
      if (cleanedPaths.length === 0) {
        return { clause: ' AND 1 = 0', params: [] };
      }
      const placeholders = cleanedPaths.map(() => '?').join(', ');
      const lhsExpr = isWindows ? `LOWER(${pathExpr})` : pathExpr;
      conditions.push(`${lhsExpr} IN (${placeholders})`);
      params.push(...cleanedPaths);
    }

    if (Array.isArray(scopeFilter.fileExtensions) && scopeFilter.fileExtensions.length > 0 && fileTypeExpr) {
      const cleanedExts = scopeFilter.fileExtensions
        .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
        .filter(Boolean);
      if (cleanedExts.length === 0) {
        return { clause: ' AND 1 = 0', params: [] };
      }
      const placeholders = cleanedExts.map(() => '?').join(', ');
      conditions.push(`LOWER(${fileTypeExpr}) IN (${placeholders})`);
      params.push(...cleanedExts);
    }

    if (conditions.length === 0) {
      return { clause: '', params: [] };
    }

    return {
      clause: ` AND ${conditions.join(' AND ')}`,
      params,
    };
  }

  getFilesInScope(scopeFilter?: SearchScopeFilter, limit: number = 10000): string[] {
    const db = this.getDb();
    const scope = this.buildScopeWhere('path', 'file_type', scopeFilter);
    const rows = db
      .prepare(`SELECT path FROM files WHERE 1 = 1${scope.clause} ORDER BY path ASC LIMIT ?`)
      .all(...scope.params, limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  getChunksForFile(filePath: string, limit: number = 8): KnowledgeGraphChunkRecord[] {
    const db = this.getDb();
    const resolved = path.resolve(filePath);
    const whereSql =
      process.platform === 'win32'
        ? 'WHERE LOWER(file_path) = LOWER(?) OR file_path = ?'
        : 'WHERE file_path = ? OR file_path = ?';
    const rows = db.prepare(`
      SELECT
        id,
        file_path,
        chunk_index,
        start_char,
        end_char,
        start_line,
        end_line,
        heading,
        chunk_text,
        indexed_at
      FROM chunks
      ${whereSql}
      ORDER BY chunk_index ASC
      LIMIT ?
    `).all(resolved, filePath, limit) as Array<{
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
      bm25Score: 0,
    }));
  }

  searchLexical(query: string, topK: number = 10, scopeFilter?: SearchScopeFilter): KnowledgeGraphChunkRecord[] {
    if (topK <= 0) return [];
    const safeMatch = buildSafeFtsQuery(query);
    if (!safeMatch) return [];

    const db = this.getDb();
    const needsFilesJoin = Boolean(scopeFilter?.fileExtensions && scopeFilter.fileExtensions.length > 0);
    const scope = this.buildScopeWhere('c.file_path', needsFilesJoin ? 'f.file_type' : null, scopeFilter);
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
        ${needsFilesJoin ? 'LEFT JOIN files f ON f.path = c.file_path' : ''}
        WHERE chunks_fts MATCH ?${scope.clause}
        ORDER BY raw_bm25 ASC
        LIMIT ?
      `).all(safeMatch, ...scope.params, topK) as Array<{
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

  getChunkLocationsBatch(
    chunkIds: string[]
  ): Map<string, { startLine: number; endLine: number; heading: string }> {
    const out = new Map<string, { startLine: number; endLine: number; heading: string }>();
    if (chunkIds.length === 0) {
      return out;
    }

    const db = this.getDb();
    const uniqueIds = Array.from(new Set(chunkIds));
    const BATCH_LIMIT = 900;
    for (let start = 0; start < uniqueIds.length; start += BATCH_LIMIT) {
      const slice = uniqueIds.slice(start, start + BATCH_LIMIT);
      const placeholders = slice.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT id, start_line, end_line, heading FROM chunks WHERE id IN (${placeholders})`
        )
        .all(...slice) as Array<{
        id: string;
        start_line: number;
        end_line: number;
        heading: string;
      }>;
      for (const row of rows) {
        out.set(row.id, {
          startLine: row.start_line,
          endLine: row.end_line,
          heading: row.heading,
        });
      }
    }
    return out;
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
    const rows = this.prepareCached(db, `
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

    const cleanedLower = cleaned.toLowerCase();
    const baseWithExt = path.basename(cleaned).toLowerCase();
    const stemNoExt = path.basename(cleaned, path.extname(cleaned)).toLowerCase();
    const resolvedTarget = path.isAbsolute(cleaned) ? path.resolve(cleaned) : cleaned;
    const resolvedLower = resolvedTarget.toLowerCase();

    const rows = this.prepareCached(db, `
      SELECT source_path, target_ref, target_path, kind, line_number
      FROM (
        SELECT id, source_path, target_ref, target_path, kind, line_number
        FROM links
        WHERE target_path_lower = ?
        UNION
        SELECT id, source_path, target_ref, target_path, kind, line_number
        FROM links
        WHERE target_ref_lower = ?
        UNION
        SELECT id, source_path, target_ref, target_path, kind, line_number
        FROM links
        WHERE target_key_lower IN (?, ?)
          AND (
            (
              kind = 'wikilink'
              AND (
                target_ref_lower = ?
                OR target_ref_lower = ?
                OR target_ref_lower LIKE ?
                OR target_ref_lower LIKE ?
              )
            )
            OR (
              kind IN ('import', 'mdlink', 'markdown_link')
              AND (
                target_ref_lower = ?
                OR target_ref_lower LIKE ?
                OR target_ref_lower LIKE ?
              )
            )
          )
      )
      ORDER BY id ASC
      LIMIT ?
    `).all(
      resolvedLower,
      cleanedLower,
      baseWithExt,
      stemNoExt,
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
    const indexedFiles = this.prepareCached(db, 'SELECT path FROM files').all() as Array<{ path: string }>;
    const expandedTargets = new Set<string>();

    const normalizedTargets = targetPaths
      .filter(Boolean)
      .map((rawTarget) => {
        const normTarget = this.normalizeLookupPath(rawTarget);
        const prefix = normTarget.endsWith(path.sep) ? normTarget : `${normTarget}${path.sep}`;
        expandedTargets.add(path.resolve(rawTarget));
        return { normTarget, prefix };
      });

    if (normalizedTargets.length > 0) {
      for (const f of indexedFiles) {
        const normFile = this.normalizeLookupPath(f.path);
        for (const t of normalizedTargets) {
          if (normFile === t.normTarget || normFile.startsWith(t.prefix)) {
            expandedTargets.add(f.path);
            break;
          }
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
          isMarkdownLink: link.kind === 'wikilink' || link.kind === 'mdlink' || link.kind === 'markdown_link',
        });
      }
    }

    return refs;
  }

  getInsights(allowedRoots?: readonly string[]): KnowledgeGraphInsights {
    const db = this.getDb();
    const allFiles = this.prepareCached(
      db,
      'SELECT path, canonical_path, sha256, size, file_type, chunk_count, token_estimate, indexed_at FROM files ORDER BY indexed_at DESC'
    ).all() as Array<{
      path: string;
      canonical_path: string | null;
      sha256: string;
      size: number;
      file_type: string;
      chunk_count: number;
      token_estimate: number;
      indexed_at: number;
    }>;

    const hasRootScope = Array.isArray(allowedRoots) && allowedRoots.length > 0;
    const normalizedRoots = hasRootScope ? this.canonicalizePrefixList(allowedRoots!) : [];

    const visibleFiles: typeof allFiles = [];
    const canonByNorm = new Map<string, string>();
    for (const f of allFiles) {
      if (isSensitiveSecretFile(f.path).blocked) continue;
      const canon = (f.canonical_path ?? this.canonicalizeLookupPath(f.path)).replace(/[\\/]+$/, '');
      canonByNorm.set(this.normalizeLookupPath(f.path), canon);
      if (hasRootScope && !normalizedRoots.some((root) => this.isCanonicalWithinPrefix(canon, root))) {
        continue;
      }
      visibleFiles.push(f);
    }

    const stats = hasRootScope
      ? {
          totalFiles: visibleFiles.length,
          totalChunks: visibleFiles.reduce((sum, f) => sum + Number(f.chunk_count ?? 0), 0),
          totalTokens: visibleFiles.reduce((sum, f) => sum + Number(f.token_estimate ?? 0), 0),
          lastIndexed: visibleFiles.reduce(
            (maxTs, f) => Math.max(maxTs, Number(f.indexed_at ?? 0)),
            0
          ),
        }
      : this.getStats();

    const byHash = new Map<string, { fileSize: number; files: string[] }>();
    for (const file of visibleFiles) {
      if (Number(file.size ?? 0) <= 0 || !file.sha256) continue;
      const existing = byHash.get(file.sha256);
      if (existing) {
        existing.files.push(file.path);
        existing.fileSize = Math.max(existing.fileSize, Number(file.size));
      } else {
        byHash.set(file.sha256, { fileSize: Number(file.size), files: [file.path] });
      }
    }
    const duplicateClusters: DuplicateCluster[] = Array.from(byHash.entries())
      .filter(([, group]) => group.files.length >= 2)
      .map(([sha256, group]) => ({
        sha256,
        files: [...group.files].sort(),
        fileSize: group.fileSize,
        wastedBytes: group.fileSize * (group.files.length - 1),
      }))
      .sort((a, b) => b.wastedBytes - a.wastedBytes)
      .slice(0, 100);
    const totalWastedBytes = duplicateClusters.reduce((s, c) => s + c.wastedBytes, 0);

    const visiblePathSet = new Set(visibleFiles.map((f) => this.normalizeLookupPath(f.path)));
    const allLinkRows = this.prepareCached(db, 'SELECT source_path, target_ref FROM links').all() as Array<{
      source_path: string;
      target_ref: string;
    }>;
    const hubCounts = new Map<string, number>();
    for (const row of allLinkRows) {
      if (!visiblePathSet.has(this.normalizeLookupPath(row.source_path))) {
        continue;
      }
      const ref = row.target_ref;
      if (!ref || isSensitiveSecretFile(ref).blocked || ref.includes('..') || ref.includes('\0')) {
        continue;
      }
      if (hasRootScope && (path.isAbsolute(ref) || /^[A-Za-z]:[\\/]/.test(ref))) {
        const knownCanon = canonByNorm.get(this.normalizeLookupPath(ref)) ?? this.canonicalizeLookupPath(ref);
        if (!normalizedRoots.some((root) => this.isCanonicalWithinPrefix(knownCanon, root))) {
          continue;
        }
      }
      hubCounts.set(ref, (hubCounts.get(ref) ?? 0) + 1);
    }

    const topHubs = Array.from(hubCounts.entries())
      .map(([targetRef, backlinkCount]) => ({ targetRef, backlinkCount }))
      .sort((a, b) => b.backlinkCount - a.backlinkCount || a.targetRef.localeCompare(b.targetRef))
      .slice(0, 10);

    const recentFiles = visibleFiles.slice(0, 10).map((r) => ({
      path: r.path,
      fileType: r.file_type,
      chunkCount: Number(r.chunk_count),
      indexedAt: Number(r.indexed_at),
    }));

    return {
      ...stats,
      duplicateClusters,
      totalWastedBytes,
      topHubs,
      recentFiles,
    };
  }

  private getOrBuildGraphSnapshot(db: NodeSqliteDatabase): GraphAdjacencySnapshot {
    const dataVersion = this.readDataVersion(db);
    if (
      this.cachedAdjacency &&
      this.cachedAdjacency.dataVersion === dataVersion &&
      this.cachedAdjacency.localWriteEpoch === this.localWriteEpoch
    ) {
      return this.cachedAdjacency;
    }

    const fileRows = this.prepareCached(
      db,
      'SELECT path, canonical_path, file_type, chunk_count FROM files ORDER BY path ASC'
    ).all() as Array<{ path: string; canonical_path: string | null; file_type: string; chunk_count: number }>;

    const byKey = new Map<string, string>();
    const canonByKey = new Map<string, string>();
    const byBasename = new Map<string, string[]>();
    const byStem = new Map<string, string[]>();
    const allFiles: Array<{ path: string; canonicalPath: string; fileType: string; chunkCount: number }> = [];

    for (const row of fileRows) {
      const key = this.normalizeLookupPath(row.path);
      const canon = row.canonical_path ?? this.canonicalizeLookupPath(row.path);
      byKey.set(key, row.path);
      canonByKey.set(key, canon);
      allFiles.push({
        path: row.path,
        canonicalPath: canon,
        fileType: row.file_type,
        chunkCount: Number(row.chunk_count),
      });

      const base = path.basename(row.path).toLowerCase();
      let baseList = byBasename.get(base);
      if (!baseList) {
        baseList = [];
        byBasename.set(base, baseList);
      }
      baseList.push(row.path);

      const stem = path.basename(row.path, path.extname(row.path)).toLowerCase();
      if (stem) {
        let stemList = byStem.get(stem);
        if (!stemList) {
          stemList = [];
          byStem.set(stem, stemList);
        }
        stemList.push(row.path);
      }
    }

    const resolveEdgeTarget = (
      sourcePath: string,
      targetRef: string,
      targetPath: string | null,
      kind: string
    ): string | null => {
      if (targetPath) {
        const hit = byKey.get(this.normalizeLookupPath(targetPath));
        if (hit) return hit;
        for (let i = 1; i < RELATIVE_CANDIDATE_EXTS.length; i += 1) {
          const extHit = byKey.get(this.normalizeLookupPath(`${targetPath}${RELATIVE_CANDIDATE_EXTS[i]}`));
          if (extHit) return extHit;
        }
      }

      const trimmed = targetRef.split('|')[0].split('#')[0].split('?')[0].trim();
      if (!trimmed) return null;

      if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
        const baseCand = path.resolve(path.dirname(sourcePath), trimmed);
        for (const ext of RELATIVE_CANDIDATE_EXTS) {
          const hit = byKey.get(this.normalizeLookupPath(ext ? `${baseCand}${ext}` : baseCand));
          if (hit) return hit;
        }
      }

      const cleanedBase = path.basename(trimmed).toLowerCase();
      if (cleanedBase) {
        const exactBaseMatches = byBasename.get(cleanedBase);
        if (exactBaseMatches && exactBaseMatches.length === 1) {
          return exactBaseMatches[0];
        }
        const cleanedStem = path.basename(trimmed, path.extname(trimmed)).toLowerCase();
        const stemMatches = byStem.get(cleanedStem);
        if (kind === 'wikilink' && stemMatches && stemMatches.length > 0) {
          return stemMatches[0];
        }
        if (stemMatches && stemMatches.length === 1) {
          return stemMatches[0];
        }
      }

      return null;
    };

    const linkRows = this.prepareCached(
      db,
      'SELECT source_path, target_ref, target_path, kind, line_number FROM links'
    ).all() as Array<{
      source_path: string;
      target_ref: string;
      target_path: string | null;
      kind: string;
      line_number: number;
    }>;

    const adj = new Map<string, Set<string>>();
    const edges: WorkspaceGraphEdge[] = [];
    const seenEdgeKeys = new Set<string>();
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const linkDegree = new Map<string, number>();

    const addNeighbor = (a: string, b: string): void => {
      if (a === b) return;
      let setA = adj.get(a);
      if (!setA) {
        setA = new Set<string>();
        adj.set(a, setA);
      }
      setA.add(b);
    };

    for (const row of linkRows) {
      const canonicalSource = byKey.get(this.normalizeLookupPath(row.source_path)) ?? row.source_path;
      const canonicalTarget = resolveEdgeTarget(canonicalSource, row.target_ref, row.target_path, row.kind);
      if (!canonicalTarget || canonicalTarget === canonicalSource) {
        continue;
      }

      addNeighbor(canonicalSource, canonicalTarget);
      addNeighbor(canonicalTarget, canonicalSource);

      const dedup = `${canonicalSource}->${canonicalTarget}:${row.kind}:${row.line_number}`;
      if (!seenEdgeKeys.has(dedup)) {
        seenEdgeKeys.add(dedup);
        edges.push({
          source: canonicalSource,
          target: canonicalTarget,
          targetRef: row.target_ref,
          kind: row.kind,
          lineNumber: Number(row.line_number),
        });
        outDeg.set(canonicalSource, (outDeg.get(canonicalSource) ?? 0) + 1);
        inDeg.set(canonicalTarget, (inDeg.get(canonicalTarget) ?? 0) + 1);
        linkDegree.set(canonicalSource, (linkDegree.get(canonicalSource) ?? 0) + 1);
        linkDegree.set(canonicalTarget, (linkDegree.get(canonicalTarget) ?? 0) + 1);
      }
    }

    const symbolRows = this.prepareCached(
      db,
      'SELECT file_path, symbol_name FROM symbols ORDER BY line_number ASC'
    ).all() as Array<{ file_path: string; symbol_name: string }>;
    const topSymbolsByFile = new Map<string, string[]>();
    for (const row of symbolRows) {
      let list = topSymbolsByFile.get(row.file_path);
      if (!list) {
        list = [];
        topSymbolsByFile.set(row.file_path, list);
      }
      if (list.length < 4 && !list.includes(row.symbol_name)) {
        list.push(row.symbol_name);
      }
    }

    const snapshot: GraphAdjacencySnapshot = {
      dataVersion,
      localWriteEpoch: this.localWriteEpoch,
      allFiles,
      byKey,
      canonByKey,
      edges,
      adj,
      topSymbolsByFile,
      inDeg,
      outDeg,
      linkDegree,
    };
    this.cachedAdjacency = snapshot;
    return snapshot;
  }

  /**
   * 2-hop hub-damped Personalized PageRank (HippoRAG-lite associative retrieval).
   * Traverses outgoing links and incoming backlinks up to `maxHops` (default 2) with a
   * `1 / sqrt(degree)` hub penalty so high-degree index files do not flood specific topics.
   */
  computeAssociativeBoosts(
    seedFilePaths: string[],
    options: { maxHops?: 1 | 2; damping?: number; maxBoosts?: number; excludeSeeds?: boolean } = {}
  ): AssociativeBoostResult[] {
    if (!Array.isArray(seedFilePaths) || seedFilePaths.length === 0) {
      return [];
    }

    const maxHops = options.maxHops ?? 2;
    const damping = Math.max(0.1, Math.min(0.95, options.damping ?? 0.65));
    const maxBoosts = Math.max(1, options.maxBoosts ?? 16);
    const excludeSeeds = options.excludeSeeds ?? true;

    const db = this.getDb();
    const { byKey, adj } = this.getOrBuildGraphSnapshot(db);

    const seedMap = new Map<string, number>();
    const canonicalSeeds: string[] = [];
    seedFilePaths.forEach((raw, idx) => {
      if (!raw) return;
      const canonical = byKey.get(this.normalizeLookupPath(raw)) ?? raw;
      if (!seedMap.has(canonical)) {
        // Earlier top-ranked retrieval seeds carry stronger personalization mass
        seedMap.set(canonical, 1 / Math.sqrt(idx + 1));
        canonicalSeeds.push(canonical);
      }
    });

    const totalSeedWeight = Array.from(seedMap.values()).reduce((s, w) => s + w, 0) || 1;
    const hop1Mass = new Map<string, number>();
    const viaMap = new Map<string, { viaPath: string; score: number }>();

    // Hop 1 propagation
    for (const seed of canonicalSeeds) {
      const seedMass = (seedMap.get(seed) ?? 0) / totalSeedWeight;
      const neighbors = adj.get(seed);
      if (!neighbors || neighbors.size === 0) continue;
      const penalty = Math.sqrt(neighbors.size);
      for (const nb of neighbors) {
        const contribution = (seedMass * damping) / penalty;
        hop1Mass.set(nb, (hop1Mass.get(nb) ?? 0) + contribution);
        const prev = viaMap.get(nb);
        if (!prev || contribution > prev.score) {
          viaMap.set(nb, { viaPath: seed, score: contribution });
        }
      }
    }

    const totalScores = new Map<string, number>();
    const minHop = new Map<string, 1 | 2>();

    for (const [node, score] of hop1Mass.entries()) {
      totalScores.set(node, score);
      minHop.set(node, 1);
    }

    // Hop 2 propagation
    if (maxHops >= 2) {
      for (const [hop1Node, mass] of hop1Mass.entries()) {
        if (seedMap.has(hop1Node)) continue;
        const neighbors = adj.get(hop1Node);
        if (!neighbors || neighbors.size === 0) continue;
        const penalty = Math.sqrt(neighbors.size);
        for (const nb of neighbors) {
          const contribution = (mass * damping) / penalty;
          totalScores.set(nb, (totalScores.get(nb) ?? 0) + contribution);
          if (!minHop.has(nb)) {
            minHop.set(nb, 2);
            viaMap.set(nb, { viaPath: hop1Node, score: contribution });
          }
        }
      }
    }

    const results: AssociativeBoostResult[] = [];
    for (const [filePath, score] of totalScores.entries()) {
      if (excludeSeeds && seedMap.has(filePath)) {
        continue;
      }
      if (score <= 0) continue;
      results.push({
        filePath,
        score,
        hopDistance: minHop.get(filePath) ?? 2,
        viaPath: viaMap.get(filePath)?.viaPath,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxBoosts);
  }

  getWorkspaceGraphMap(rootPrefix?: string, maxNodes: number = 120): WorkspaceGraphMap {
    const db = this.getDb();
    const snapshot = this.getOrBuildGraphSnapshot(db);
    const normalizedPrefix = rootPrefix
      ? this.canonicalizeLookupPath(rootPrefix).replace(/[\\/]+$/, '')
      : null;

    let scopedFiles = snapshot.allFiles;
    let scopedEdges = snapshot.edges;
    let inDeg = snapshot.inDeg;
    let outDeg = snapshot.outDeg;

    if (normalizedPrefix !== null) {
      scopedFiles = snapshot.allFiles.filter((f) =>
        this.isCanonicalWithinPrefix(f.canonicalPath, normalizedPrefix)
      );
      const scopedSet = new Set(scopedFiles.map((f) => f.path));
      scopedEdges = snapshot.edges.filter((e) => scopedSet.has(e.source) && scopedSet.has(e.target));
      inDeg = new Map<string, number>();
      outDeg = new Map<string, number>();
      for (const edge of scopedEdges) {
        outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
        inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
      }
    }

    const rankedNodes: WorkspaceGraphNode[] = scopedFiles
      .map((f) => ({
        path: f.path,
        name: path.basename(f.path),
        fileType: f.fileType,
        chunkCount: f.chunkCount,
        inDegree: inDeg.get(f.path) ?? 0,
        outDegree: outDeg.get(f.path) ?? 0,
        topSymbols: snapshot.topSymbolsByFile.get(f.path) ?? [],
        folder: path.dirname(f.path),
      }))
      .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree) || a.name.localeCompare(b.name))
      .slice(0, maxNodes);

    const visiblePaths = new Set(rankedNodes.map((n) => n.path));
    return {
      rootPrefix: rootPrefix ?? null,
      nodes: rankedNodes,
      edges: scopedEdges.filter((e) => visiblePaths.has(e.source) && visiblePaths.has(e.target)),
      totalFilesIndexed: scopedFiles.length,
    };
  }

  getSemanticCollections(rootPrefix?: string): WorkspaceCollectionGroup[] {
    const db = this.getDb();
    const snapshot = this.getOrBuildGraphSnapshot(db);
    const canonPrefixRaw = rootPrefix ? this.canonicalizeLookupPath(rootPrefix) : null;
    const normalizedPrefix = canonPrefixRaw !== null ? canonPrefixRaw.replace(/[\\/]+$/, '') : null;

    const scopedFiles =
      normalizedPrefix !== null
        ? snapshot.allFiles.filter((f) => this.isCanonicalWithinPrefix(f.canonicalPath, normalizedPrefix))
        : snapshot.allFiles;

    const linkScore = snapshot.linkDegree;
    const groups = new Map<string, WorkspaceCollectionGroup>();
    for (const file of scopedFiles) {
      let topFolder = 'Workspace Root';
      if (canonPrefixRaw !== null) {
        const rel = path.relative(canonPrefixRaw, file.canonicalPath);
        const segments = rel.split(/[\\/]+/).filter(Boolean);
        topFolder = segments.length > 1 ? segments[0] : 'Workspace Root';
      } else {
        const parentBase = path.basename(path.dirname(file.path));
        if (parentBase && parentBase !== '.' && parentBase !== '/' && !parentBase.endsWith(':')) {
          topFolder = parentBase;
        }
      }
      const domainCategory = this.classifyCollectionLabel(topFolder, file.fileType);
      const groupId = `${domainCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      let group = groups.get(groupId);
      if (!group) {
        group = {
          id: groupId,
          label: domainCategory,
          clusteringMode: 'structural_heuristic',
          reason:
            topFolder === 'Workspace Root'
              ? `Structural grouping by ${file.fileType || 'document'} extension (enable AI indexing for vector clustering)`
              : `Structural grouping under ${topFolder}/ folder & links (index files with ONNX embeddings for vector clustering)`,
          files: [],
          dominantSymbols: [],
        };
        groups.set(groupId, group);
      }

      const fullSyms = snapshot.topSymbolsByFile.get(file.path);
      const syms = fullSyms && fullSyms.length > 3 ? fullSyms.slice(0, 3) : (fullSyms ?? []);
      group.files.push({
        path: file.path,
        name: path.basename(file.path),
        fileType: file.fileType,
        chunkCount: file.chunkCount,
        topSymbol: syms[0],
      });
      for (const s of syms) {
        if (group.dominantSymbols.length < 5 && !group.dominantSymbols.includes(s)) {
          group.dominantSymbols.push(s);
        }
      }
    }

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        files: g.files.sort((a, b) => (linkScore.get(b.path) ?? 0) - (linkScore.get(a.path) ?? 0) || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.files.length - a.files.length || a.label.localeCompare(b.label));
  }

  private classifyCollectionLabel(folderName: string, fileType: string): string {
    if (folderName && folderName !== 'Workspace Root' && !folderName.startsWith('.')) {
      return folderName.charAt(0).toUpperCase() + folderName.slice(1);
    }
    const ext = fileType.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c'].includes(ext)) return 'Source Code & Modules';
    if (['md', 'markdown', 'mdx', 'txt', 'rst'].includes(ext)) return 'Notes & Knowledge Docs';
    if (['pdf', 'docx'].includes(ext)) return 'Reports & Documents';
    if (['json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'sql'].includes(ext)) return 'Structured Data & Config';
    return 'General Workspace Files';
  }

  getFileConnections(filePath: string): FileConnectionsSummary {
    const db = this.getDb();
    const { byKey } = this.getOrBuildGraphSnapshot(db);
    const canonical = byKey.get(this.normalizeLookupPath(filePath)) ?? path.resolve(filePath);

    const symWhere =
      process.platform === 'win32' ? 'LOWER(file_path) = LOWER(?)' : 'file_path = ?';
    const linksWhere =
      process.platform === 'win32' ? 'LOWER(source_path) = LOWER(?)' : 'source_path = ?';

    const symRows = this.prepareCached(
      db,
      `SELECT symbol_name, kind, line_number FROM symbols WHERE ${symWhere} ORDER BY line_number ASC LIMIT 60`
    ).all(canonical) as Array<{ symbol_name: string; kind: string; line_number: number }>;

    const outRows = this.prepareCached(
      db,
      `SELECT target_ref, target_path, kind, line_number FROM links WHERE ${linksWhere} ORDER BY line_number ASC LIMIT 60`
    ).all(canonical) as Array<{ target_ref: string; target_path: string | null; kind: string; line_number: number }>;

    const backlinks = this.findBacklinks(canonical, 50).map((b) => ({
      sourcePath: b.sourcePath,
      targetRef: b.targetRef,
      kind: b.kind,
      lineNumber: b.lineNumber,
    }));

    const associativeNeighbors = this.computeAssociativeBoosts([canonical], {
      maxHops: 2,
      maxBoosts: 12,
      excludeSeeds: true,
    });

    return {
      filePath: canonical,
      symbols: symRows.map((s) => ({
        name: s.symbol_name,
        kind: s.kind,
        lineNumber: Number(s.line_number),
      })),
      outgoingLinks: outRows.map((o) => ({
        targetRef: o.target_ref,
        targetPath: o.target_path ?? undefined,
        kind: o.kind,
        lineNumber: Number(o.line_number),
      })),
      backlinks,
      associativeNeighbors,
    };
  }

  recordAgentTrace(record: PersistedAgentTraceRecord): void {
    const db = this.getDb();
    // Defense-in-depth SecretGuard enforcement at persistence boundary
    const safeQueryPreview = redactSensitiveText(record.queryPreview).sanitizedText.slice(0, 220);
    const safeError = record.errorSummary
      ? redactSensitiveText(record.errorSummary).sanitizedText.slice(0, 300)
      : null;
    const rawJson = JSON.stringify({
      steps: record.steps,
      sources: record.sources,
      verification: record.verification,
    });
    const safePayloadJson = redactSensitiveText(rawJson).sanitizedText;

    this.withTransaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO agent_traces (
          trace_id, created_at, mode, model, provider, prompt_version,
          query_preview, status, duration_ms, step_count,
          duplicate_calls_prevented, verified_citations, ungrounded_citations_count,
          redactions_applied, prompt_tokens, completion_tokens, total_tokens,
          error_summary, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.traceId,
        record.createdAt,
        record.mode,
        record.model,
        record.provider,
        record.promptVersion,
        safeQueryPreview,
        record.status,
        record.durationMs,
        record.stepCount,
        record.duplicateCallsPrevented,
        record.verifiedCitations,
        record.ungroundedCitationsCount,
        record.redactionsApplied,
        record.promptTokens ?? null,
        record.completionTokens ?? null,
        record.totalTokens ?? null,
        safeError,
        safePayloadJson
      );

      // Keep bounded retention on disk
      db.prepare(`
        DELETE FROM agent_traces
        WHERE trace_id NOT IN (
          SELECT trace_id FROM agent_traces ORDER BY created_at DESC LIMIT ?
        )
      `).run(MAX_PERSISTED_TRACE_RECORDS);
    });
  }

  getRecentAgentTraces(limit: number = 25): PersistedAgentTraceRecord[] {
    const db = this.getDb();
    const clamped = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = db
      .prepare(`
        SELECT trace_id, created_at, mode, model, provider, prompt_version,
               query_preview, status, duration_ms, step_count,
               duplicate_calls_prevented, verified_citations, ungrounded_citations_count,
               redactions_applied, prompt_tokens, completion_tokens, total_tokens,
               error_summary, payload_json
        FROM agent_traces
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(clamped) as Array<{
      trace_id: string;
      created_at: number;
      mode: string;
      model: string;
      provider: string;
      prompt_version: string;
      query_preview: string;
      status: string;
      duration_ms: number;
      step_count: number;
      duplicate_calls_prevented: number;
      verified_citations: number;
      ungrounded_citations_count: number;
      redactions_applied: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      error_summary: string | null;
      payload_json: string;
    }>;

    return rows.map((row) => {
      let parsedPayload: {
        steps?: PersistedAgentTraceRecord['steps'];
        sources?: PersistedAgentTraceRecord['sources'];
        verification?: PersistedAgentTraceRecord['verification'];
      } = {};
      try {
        parsedPayload = JSON.parse(row.payload_json) as typeof parsedPayload;
      } catch {
        parsedPayload = {};
      }
      return {
        traceId: row.trace_id,
        createdAt: Number(row.created_at),
        mode: row.mode === 'agent' ? 'agent' : 'rag',
        model: row.model,
        provider: row.provider,
        promptVersion: row.prompt_version,
        queryPreview: row.query_preview,
        status: row.status as PersistedAgentTraceRecord['status'],
        durationMs: Number(row.duration_ms),
        stepCount: Number(row.step_count),
        duplicateCallsPrevented: Number(row.duplicate_calls_prevented),
        verifiedCitations: Number(row.verified_citations),
        ungroundedCitationsCount: Number(row.ungrounded_citations_count),
        redactionsApplied: Number(row.redactions_applied),
        ...(row.prompt_tokens !== null ? { promptTokens: Number(row.prompt_tokens) } : {}),
        ...(row.completion_tokens !== null ? { completionTokens: Number(row.completion_tokens) } : {}),
        ...(row.total_tokens !== null ? { totalTokens: Number(row.total_tokens) } : {}),
        ...(row.error_summary ? { errorSummary: row.error_summary } : {}),
        steps: Array.isArray(parsedPayload.steps) ? parsedPayload.steps : [],
        sources: Array.isArray(parsedPayload.sources) ? parsedPayload.sources : [],
        ...(parsedPayload.verification ? { verification: parsedPayload.verification } : {}),
      };
    });
  }

  clearAgentTraces(): number {
    const db = this.getDb();
    const res = db.prepare('DELETE FROM agent_traces').run();
    return Number(res.changes ?? 0);
  }

  listIndexedFilePaths(query?: string, rootPrefix?: string, limit: number = 100): string[] {
    const db = this.getDb();
    const clamped = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.prepareCached(
      db,
      'SELECT path, canonical_path FROM files ORDER BY indexed_at DESC LIMIT 5000'
    ).all() as Array<{ path: string; canonical_path: string | null }>;

    const qLower = query ? query.trim().toLowerCase() : '';
    const normalizedRoot = rootPrefix
      ? this.canonicalizeLookupPath(rootPrefix).replace(/[\\/]+$/, '')
      : null;

    const results: string[] = [];
    for (const row of rows) {
      if (normalizedRoot !== null) {
        const canon = (row.canonical_path ?? this.canonicalizeLookupPath(row.path)).replace(/[\\/]+$/, '');
        if (!this.isCanonicalWithinPrefix(canon, normalizedRoot)) {
          continue;
        }
      }
      if (qLower && !row.path.toLowerCase().includes(qLower)) {
        continue;
      }
      results.push(row.path);
      if (results.length >= clamped) {
        break;
      }
    }
    return results;
  }

  close(): void {
    this.stmts.clear();
    this.cachedAdjacency = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export type { StructuralChunk };
