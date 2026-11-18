/**
 * linkResolution.ts - Shared relative/wikilink target resolution helpers
 * used across DocumentFtsOutboxStore (write-time) and LinkSymbolGraphStore (read-time).
 */

import path from 'path';
import type { DatabaseSync as NodeSqliteDatabase } from 'node:sqlite';

export const RELATIVE_CANDIDATE_EXTS = [
  '',
  '.md',
  '.markdown',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.json',
] as const;

export const RELATIVE_INDEX_FILES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.md',
] as const;

export type StatementPreparer = (
  db: NodeSqliteDatabase,
  sql: string
) => ReturnType<NodeSqliteDatabase['prepare']>;

export function extractTargetKeyLower(targetRef: string): string {
  const trimmed = targetRef.split('|')[0].split('#')[0].split('?')[0].trim();
  if (!trimmed) return '';
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
  const slashIdx = normalized.lastIndexOf('/');
  const base = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
  return base.toLowerCase();
}

export function extractCleanTrimmedLower(targetRef: string): string {
  return targetRef.trim().toLowerCase();
}

export function resolveLinkTargetPathInDb(
  db: NodeSqliteDatabase,
  prepareCached: StatementPreparer,
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
    const rows = prepareCached(db, sql).all(...queryParams) as Array<{
      path: string;
      path_lower?: string;
    }>;
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
      const row = prepareCached(
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
