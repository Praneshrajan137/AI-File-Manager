/**
 * DuplicateClusterStore.ts - Content SHA-256 duplicate clustering and bounded vault insights.
 */

import path from 'path';
import { DuplicateCluster, KnowledgeGraphInsights } from '@shared/contracts';
import { isSensitiveSecretFile } from '@shared/security/SecretGuard';
import { DocumentFtsOutboxStore } from './DocumentFtsOutboxStore';
import { VaultSqliteDb } from './VaultSqliteDb';

export class DuplicateClusterStore {
  constructor(
    private readonly sqliteDb: VaultSqliteDb,
    private readonly docStore: DocumentFtsOutboxStore
  ) {}

  getDuplicateClusters(): DuplicateCluster[] {
    const db = this.sqliteDb.getDb();
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

  getInsights(allowedRoots?: readonly string[]): KnowledgeGraphInsights {
    const db = this.sqliteDb.getDb();
    const allFiles = this.sqliteDb
      .prepareCached(
        db,
        'SELECT path, canonical_path, sha256, size, file_type, chunk_count, token_estimate, indexed_at FROM files ORDER BY indexed_at DESC'
      )
      .all() as Array<{
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
    const normalizedRoots = hasRootScope ? this.sqliteDb.canonicalizePrefixList(allowedRoots!) : [];

    const visibleFiles: typeof allFiles = [];
    const canonByNorm = new Map<string, string>();
    for (const f of allFiles) {
      if (isSensitiveSecretFile(f.path).blocked) continue;
      const canon = (f.canonical_path ?? this.sqliteDb.canonicalizeLookupPath(f.path)).replace(
        /[\\/]+$/,
        ''
      );
      canonByNorm.set(this.sqliteDb.normalizeLookupPath(f.path), canon);
      if (
        hasRootScope &&
        !normalizedRoots.some((root) => this.sqliteDb.isCanonicalWithinPrefix(canon, root))
      ) {
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
      : this.docStore.getStats();

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

    const visiblePathSet = new Set(visibleFiles.map((f) => this.sqliteDb.normalizeLookupPath(f.path)));
    const allLinkRows = this.sqliteDb
      .prepareCached(db, 'SELECT source_path, target_ref FROM links')
      .all() as Array<{ source_path: string; target_ref: string }>;
    const hubCounts = new Map<string, number>();
    for (const row of allLinkRows) {
      if (!visiblePathSet.has(this.sqliteDb.normalizeLookupPath(row.source_path))) {
        continue;
      }
      const ref = row.target_ref;
      if (!ref || isSensitiveSecretFile(ref).blocked || ref.includes('..') || ref.includes('\0')) {
        continue;
      }
      if (hasRootScope && (path.isAbsolute(ref) || /^[A-Za-z]:[\\/]/.test(ref))) {
        const knownCanon =
          canonByNorm.get(this.sqliteDb.normalizeLookupPath(ref)) ??
          this.sqliteDb.canonicalizeLookupPath(ref);
        if (!normalizedRoots.some((root) => this.sqliteDb.isCanonicalWithinPrefix(knownCanon, root))) {
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
}
