/**
 * DocumentFtsOutboxStore.ts - Documents, FTS5 chunk index (bm25), and vector outbox state.
 */

import * as crypto from 'crypto';
import path from 'path';
import type { DatabaseSync as NodeSqliteDatabase } from 'node:sqlite';
import {
  KnowledgeGraphChunkRecord,
  KnowledgeGraphUpsertInput,
  SearchScopeFilter,
} from '@shared/contracts';
import {
  extractCleanTrimmedLower,
  extractTargetKeyLower,
  resolveLinkTargetPathInDb,
} from './linkResolution';
import { VaultSqliteDb } from './VaultSqliteDb';

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

export class DocumentFtsOutboxStore {
  constructor(private readonly sqliteDb: VaultSqliteDb) {}

  needsReindex(filePath: string, mtimeMs: number, size: number, sha256?: string): boolean {
    const db = this.sqliteDb.getDb();
    const row = this.sqliteDb
      .prepareCached(db, 'SELECT sha256, size, mtime_ms, vector_sync_status FROM files WHERE path = ?')
      .get(filePath) as
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
    const changed = this.sqliteDb.withTransaction((db) => {
      const stmt = this.sqliteDb.prepareCached(
        db,
        "UPDATE files SET vector_sync_status = 'synced' WHERE path = ?"
      );
      const caseStmt =
        process.platform === 'win32'
          ? this.sqliteDb.prepareCached(
              db,
              "UPDATE files SET vector_sync_status = 'synced' WHERE path_lower = ?"
            )
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
      this.sqliteDb.bumpWriteEpoch();
    }
    return changed;
  }

  getFilesWithPendingSync(limit: number = 1000): string[] {
    const db = this.sqliteDb.getDb();
    const rows = this.sqliteDb
      .prepareCached(db, "SELECT path FROM files WHERE vector_sync_status != 'synced' LIMIT ?")
      .all(limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  getPendingSyncCount(): number {
    const db = this.sqliteDb.getDb();
    const row = this.sqliteDb
      .prepareCached(db, "SELECT COUNT(*) as cnt FROM files WHERE vector_sync_status != 'synced'")
      .get() as { cnt: number } | undefined;
    return Number(row?.cnt ?? 0);
  }

  upsertDocument(input: KnowledgeGraphUpsertInput): void {
    this.sqliteDb.withTransaction((db) => {
      this.upsertDocumentInTx(db, input);
    });
    this.sqliteDb.bumpWriteEpoch();
  }

  upsertDocumentsBatch(inputs: KnowledgeGraphUpsertInput[]): void {
    if (inputs.length === 0) {
      return;
    }
    this.sqliteDb.withTransaction((db) => {
      for (const item of inputs) {
        this.upsertDocumentInTx(db, item);
      }
    });
    this.sqliteDb.bumpWriteEpoch();
  }

  removeFile(filePath: string): number {
    const removed = this.sqliteDb.withTransaction((db) => {
      this.sqliteDb.prepareCached(db, 'DELETE FROM chunks_fts WHERE file_path = ?').run(filePath);
      const info = this.sqliteDb.prepareCached(db, 'DELETE FROM files WHERE path = ?').run(filePath);
      return Number(info.changes ?? 0);
    });
    if (removed > 0) {
      this.sqliteDb.bumpWriteEpoch();
    }
    return removed;
  }

  clear(): void {
    this.sqliteDb.withTransaction((db) => {
      db.exec(`
        DELETE FROM chunks_fts;
        DELETE FROM symbols;
        DELETE FROM links;
        DELETE FROM chunks;
        DELETE FROM files;
      `);
    });
    this.sqliteDb.bumpWriteEpoch();
  }

  getFilesInScope(scopeFilter?: SearchScopeFilter, limit: number = 10000): string[] {
    const db = this.sqliteDb.getDb();
    const scope = this.buildScopeWhere('path', 'file_type', scopeFilter);
    const rows = db
      .prepare(`SELECT path FROM files WHERE 1 = 1${scope.clause} ORDER BY path ASC LIMIT ?`)
      .all(...scope.params, limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  getChunksForFile(filePath: string, limit: number = 8): KnowledgeGraphChunkRecord[] {
    const db = this.sqliteDb.getDb();
    const resolved = path.resolve(filePath);
    const whereSql =
      process.platform === 'win32'
        ? 'WHERE LOWER(file_path) = LOWER(?) OR file_path = ?'
        : 'WHERE file_path = ? OR file_path = ?';
    const rows = db.prepare(`
      SELECT
        id, file_path, chunk_index, start_char, end_char, start_line, end_line, heading, chunk_text, indexed_at
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

  searchLexical(
    query: string,
    topK: number = 10,
    scopeFilter?: SearchScopeFilter
  ): KnowledgeGraphChunkRecord[] {
    if (topK <= 0) return [];
    const safeMatch = buildSafeFtsQuery(query);
    if (!safeMatch) return [];

    const db = this.sqliteDb.getDb();
    const needsFilesJoin = Boolean(
      scopeFilter?.fileExtensions && scopeFilter.fileExtensions.length > 0
    );
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
    const db = this.sqliteDb.getDb();
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

    const db = this.sqliteDb.getDb();
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
    const db = this.sqliteDb.getDb();
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
    const db = this.sqliteDb.getDb();
    const rows = db
      .prepare('SELECT path FROM files ORDER BY path ASC LIMIT ?')
      .all(limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  listIndexedFilePaths(query?: string, rootPrefix?: string, limit: number = 100): string[] {
    const db = this.sqliteDb.getDb();
    const clamped = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.sqliteDb
      .prepareCached(db, 'SELECT path, canonical_path FROM files ORDER BY indexed_at DESC LIMIT 5000')
      .all() as Array<{ path: string; canonical_path: string | null }>;

    const qLower = query ? query.trim().toLowerCase() : '';
    const normalizedRoot = rootPrefix
      ? this.sqliteDb.canonicalizeLookupPath(rootPrefix).replace(/[\\/]+$/, '')
      : null;

    const results: string[] = [];
    for (const row of rows) {
      if (normalizedRoot !== null) {
        const canon = (row.canonical_path ?? this.sqliteDb.canonicalizeLookupPath(row.path)).replace(
          /[\\/]+$/,
          ''
        );
        if (!this.sqliteDb.isCanonicalWithinPrefix(canon, normalizedRoot)) {
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

  private upsertDocumentInTx(db: NodeSqliteDatabase, input: KnowledgeGraphUpsertInput): void {
    const indexedAt = input.indexedAt ?? Date.now();
    const totalChars = input.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const tokenEstimate = input.chunks.reduce((sum, c) => sum + Math.ceil(c.text.length / 4), 0);
    const computedSha =
      input.sha256 ?? computeBufferSha256(input.chunks.map((c) => c.text).join('\n'));
    const fileType = input.fileType ?? path.extname(input.filePath).toLowerCase().replace(/^\./, '');
    const canonicalPath = this.sqliteDb.canonicalizeLookupPath(input.filePath);
    const pathLower = path.resolve(input.filePath).toLowerCase();
    const basenameLower = path.basename(input.filePath).toLowerCase();
    const stemLower = path.basename(input.filePath, path.extname(input.filePath)).toLowerCase();

    const existing = Boolean(
      this.sqliteDb.prepareCached(db, 'SELECT 1 FROM files WHERE path = ? LIMIT 1').get(input.filePath)
    );
    if (existing) {
      this.sqliteDb.prepareCached(db, 'DELETE FROM chunks_fts WHERE file_path = ?').run(input.filePath);
      this.sqliteDb.prepareCached(db, 'DELETE FROM chunks WHERE file_path = ?').run(input.filePath);
      this.sqliteDb.prepareCached(db, 'DELETE FROM symbols WHERE file_path = ?').run(input.filePath);
      this.sqliteDb.prepareCached(db, 'DELETE FROM links WHERE source_path = ?').run(input.filePath);
    }

    this.sqliteDb.prepareCached(
      db,
      `
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
    `
    ).run(
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

    const insertChunk = this.sqliteDb.prepareCached(
      db,
      `INSERT OR REPLACE INTO chunks (id, file_path, chunk_index, start_char, end_char, start_line, end_line, heading, chunk_text, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertFts = this.sqliteDb.prepareCached(
      db,
      `INSERT INTO chunks_fts (chunk_id, file_path, heading, chunk_text)
       VALUES (?, ?, ?, ?)`
    );

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
      const insertSymbol = this.sqliteDb.prepareCached(
        db,
        'INSERT INTO symbols (file_path, symbol_name, kind, line_number) VALUES (?, ?, ?, ?)'
      );
      for (const sym of input.symbols) {
        insertSymbol.run(input.filePath, sym.name, sym.kind, sym.lineNumber);
      }
    }

    if (input.links && input.links.length > 0) {
      const insertLink = this.sqliteDb.prepareCached(
        db,
        `INSERT INTO links (
          source_path, target_ref, target_path, kind, line_number,
          target_path_lower, target_ref_lower, target_key_lower
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const link of input.links) {
        const targetPath = resolveLinkTargetPathInDb(
          db,
          (innerDb, sql) => this.sqliteDb.prepareCached(innerDb, sql),
          input.filePath,
          link.targetRef,
          link.kind
        );
        insertLink.run(
          input.filePath,
          link.targetRef,
          targetPath,
          link.kind,
          link.lineNumber,
          targetPath ? targetPath.toLowerCase() : null,
          extractCleanTrimmedLower(link.targetRef),
          extractTargetKeyLower(link.targetRef)
        );
      }
    }
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
      conditions.push(`(${lhsExpr} = ? OR INSTR(${lhsExpr}, ?) = 1 OR INSTR(${lhsExpr}, ?) = 1)`);
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

    if (
      Array.isArray(scopeFilter.fileExtensions) &&
      scopeFilter.fileExtensions.length > 0 &&
      fileTypeExpr
    ) {
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
}
