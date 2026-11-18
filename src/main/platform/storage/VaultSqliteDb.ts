/**
 * VaultSqliteDb.ts - Canonical node:sqlite connection, WAL/busy_timeout pragma configuration,
 * v1->v2 schema migrations, statement caching, and transaction management.
 */

import fs from 'fs';
import path from 'path';
import type { DatabaseSync as NodeSqliteDatabase } from 'node:sqlite';
import { suppressSqliteExperimentalWarning } from '@shared/utils/processWarnings';
import { normalizePathKey } from '@main/platform/pathNormalize';
import { extractCleanTrimmedLower, extractTargetKeyLower } from './linkResolution';

export class VaultSqliteDb {
  private db: NodeSqliteDatabase | null = null;
  private readonly dbPath: string;
  private readonly stmts = new Map<string, ReturnType<NodeSqliteDatabase['prepare']>>();
  private writeEpoch = 0;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    this.openAndMigrate();
  }

  getDb(): NodeSqliteDatabase {
    if (!this.db) {
      this.openAndMigrate();
    }
    return this.db!;
  }

  getWriteEpoch(): number {
    return this.writeEpoch;
  }

  bumpWriteEpoch(): void {
    this.writeEpoch += 1;
  }

  prepareCached(db: NodeSqliteDatabase, sql: string): ReturnType<NodeSqliteDatabase['prepare']> {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  readDataVersion(): number {
    const db = this.getDb();
    const row = this.prepareCached(db, 'PRAGMA data_version').get() as
      | { data_version?: number }
      | undefined;
    return Number(row?.data_version ?? 0);
  }

  withTransaction<T>(fn: (db: NodeSqliteDatabase) => T): T {
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
        // Ignore rollback failure after transaction error
      }
      throw error;
    }
  }

  normalizeLookupPath(targetPath: string): string {
    return normalizePathKey(targetPath);
  }

  canonicalizeLookupPath(targetPath: string): string {
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

  canonicalizePrefixList(prefixes: readonly string[]): string[] {
    return prefixes.map((p) => this.canonicalizeLookupPath(p).replace(/[\\/]+$/, ''));
  }

  isCanonicalWithinPrefix(canonicalTarget: string, normalizedPrefix: string): boolean {
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

  close(): void {
    this.stmts.clear();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
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

      this.migrateLegacyColumnsAndBackfill(db);
      db.exec('PRAGMA user_version = 2;');
    }

    this.db = db;
  }

  private migrateLegacyColumnsAndBackfill(db: NodeSqliteDatabase): void {
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

    const needsFileBackfill = Boolean(
      db.prepare('SELECT 1 FROM files WHERE path_lower IS NULL OR canonical_path IS NULL LIMIT 1').get()
    );
    const needsLinkBackfill = Boolean(
      db.prepare('SELECT 1 FROM links WHERE target_key_lower IS NULL OR target_ref_lower IS NULL LIMIT 1').get()
    );
    if (!needsFileBackfill && !needsLinkBackfill) {
      return;
    }

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
          updateFileStmt.run(
            this.canonicalizeLookupPath(row.path),
            path.resolve(row.path).toLowerCase(),
            path.basename(row.path).toLowerCase(),
            path.basename(row.path, path.extname(row.path)).toLowerCase(),
            row.path
          );
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
            extractCleanTrimmedLower(row.target_ref),
            extractTargetKeyLower(row.target_ref),
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
}
