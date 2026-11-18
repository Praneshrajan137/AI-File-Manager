/**
 * LinkSymbolGraphStore.ts - Symbol index, backlinks, move-impact queries,
 * PRAGMA data_version adjacency cache, and 2-hop Personalized PageRank traversal.
 */

import fsSync from 'fs';
import path from 'path';
import type { DatabaseSync as NodeSqliteDatabase } from 'node:sqlite';
import {
  AssociativeBoostResult,
  FileConnectionsSummary,
  GraphImpactCheckResult,
  GraphImpactReference,
  WorkspaceCollectionGroup,
  WorkspaceGraphEdge,
  WorkspaceGraphMap,
  WorkspaceGraphNode,
} from '@shared/contracts';
import { resolveCanonicalGraphDbPath } from '@shared/config';
import { RELATIVE_CANDIDATE_EXTS } from './linkResolution';
import { VaultSqliteDb } from './VaultSqliteDb';

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

export class LinkSymbolGraphStore {
  private cachedAdjacency: GraphAdjacencySnapshot | null = null;

  constructor(private readonly sqliteDb: VaultSqliteDb) {}

  invalidateSnapshot(): void {
    this.cachedAdjacency = null;
  }

  findBySymbol(
    symbolName: string,
    limit: number = 25
  ): Array<{ filePath: string; symbolName: string; kind: string; lineNumber: number }> {
    const db = this.sqliteDb.getDb();
    const rows = this.sqliteDb.prepareCached(
      db,
      `
      SELECT file_path, symbol_name, kind, line_number
      FROM symbols
      WHERE symbol_name LIKE ?
      ORDER BY CASE WHEN LOWER(symbol_name) = LOWER(?) THEN 0 ELSE 1 END, line_number ASC
      LIMIT ?
    `
    ).all(`%${symbolName}%`, symbolName, limit) as Array<{
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
    const db = this.sqliteDb.getDb();
    const cleaned = targetRef.trim();
    if (!cleaned) {
      return [];
    }

    const cleanedLower = cleaned.toLowerCase();
    const baseWithExt = path.basename(cleaned).toLowerCase();
    const stemNoExt = path.basename(cleaned, path.extname(cleaned)).toLowerCase();
    const resolvedTarget = path.isAbsolute(cleaned) ? path.resolve(cleaned) : cleaned;
    const resolvedLower = resolvedTarget.toLowerCase();

    const rows = this.sqliteDb.prepareCached(
      db,
      `
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
    `
    ).all(
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

  findImpactForPaths(targetPaths: string[], limitPerTarget: number = 50): GraphImpactReference[] {
    if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
      return [];
    }

    const db = this.sqliteDb.getDb();
    const indexedFiles = this.sqliteDb.prepareCached(db, 'SELECT path FROM files').all() as Array<{
      path: string;
    }>;
    const expandedTargets = new Set<string>();

    const normalizedTargets = targetPaths.filter(Boolean).map((rawTarget) => {
      const normTarget = this.sqliteDb.normalizeLookupPath(rawTarget);
      const prefix = normTarget.endsWith(path.sep) ? normTarget : `${normTarget}${path.sep}`;
      expandedTargets.add(path.resolve(rawTarget));
      return { normTarget, prefix };
    });

    if (normalizedTargets.length > 0) {
      for (const f of indexedFiles) {
        const normFile = this.sqliteDb.normalizeLookupPath(f.path);
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
      const targetNorm = this.sqliteDb.normalizeLookupPath(target);
      const backlinks = this.findBacklinks(target, limitPerTarget);
      for (const link of backlinks) {
        if (this.sqliteDb.normalizeLookupPath(link.sourcePath) === targetNorm) {
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
          isMarkdownLink:
            link.kind === 'wikilink' || link.kind === 'mdlink' || link.kind === 'markdown_link',
        });
      }
    }

    return refs;
  }

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

    const db = this.sqliteDb.getDb();
    const { byKey, adj } = this.getOrBuildGraphSnapshot(db);

    const seedMap = new Map<string, number>();
    const canonicalSeeds: string[] = [];
    seedFilePaths.forEach((raw, idx) => {
      if (!raw) return;
      const canonical = byKey.get(this.sqliteDb.normalizeLookupPath(raw)) ?? raw;
      if (!seedMap.has(canonical)) {
        seedMap.set(canonical, 1 / Math.sqrt(idx + 1));
        canonicalSeeds.push(canonical);
      }
    });

    const totalSeedWeight = Array.from(seedMap.values()).reduce((s, w) => s + w, 0) || 1;
    const hop1Mass = new Map<string, number>();
    const viaMap = new Map<string, { viaPath: string; score: number }>();

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
    const db = this.sqliteDb.getDb();
    const snapshot = this.getOrBuildGraphSnapshot(db);
    const normalizedPrefix = rootPrefix
      ? this.sqliteDb.canonicalizeLookupPath(rootPrefix).replace(/[\\/]+$/, '')
      : null;

    let scopedFiles = snapshot.allFiles;
    let scopedEdges = snapshot.edges;
    let inDeg = snapshot.inDeg;
    let outDeg = snapshot.outDeg;

    if (normalizedPrefix !== null) {
      scopedFiles = snapshot.allFiles.filter((f) =>
        this.sqliteDb.isCanonicalWithinPrefix(f.canonicalPath, normalizedPrefix)
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
      .sort(
        (a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.name.localeCompare(b.name)
      )
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
    const db = this.sqliteDb.getDb();
    const snapshot = this.getOrBuildGraphSnapshot(db);
    const canonPrefixRaw = rootPrefix ? this.sqliteDb.canonicalizeLookupPath(rootPrefix) : null;
    const normalizedPrefix = canonPrefixRaw !== null ? canonPrefixRaw.replace(/[\\/]+$/, '') : null;

    const scopedFiles =
      normalizedPrefix !== null
        ? snapshot.allFiles.filter((f) =>
            this.sqliteDb.isCanonicalWithinPrefix(f.canonicalPath, normalizedPrefix)
          )
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
        files: g.files.sort(
          (a, b) => (linkScore.get(b.path) ?? 0) - (linkScore.get(a.path) ?? 0) || a.name.localeCompare(b.name)
        ),
      }))
      .sort((a, b) => b.files.length - a.files.length || a.label.localeCompare(b.label));
  }

  getFileConnections(filePath: string): FileConnectionsSummary {
    const db = this.sqliteDb.getDb();
    const { byKey } = this.getOrBuildGraphSnapshot(db);
    const canonical = byKey.get(this.sqliteDb.normalizeLookupPath(filePath)) ?? path.resolve(filePath);

    const symWhere =
      process.platform === 'win32' ? 'LOWER(file_path) = LOWER(?)' : 'file_path = ?';
    const linksWhere =
      process.platform === 'win32' ? 'LOWER(source_path) = LOWER(?)' : 'source_path = ?';

    const symRows = this.sqliteDb
      .prepareCached(
        db,
        `SELECT symbol_name, kind, line_number FROM symbols WHERE ${symWhere} ORDER BY line_number ASC LIMIT 60`
      )
      .all(canonical) as Array<{ symbol_name: string; kind: string; line_number: number }>;

    const outRows = this.sqliteDb
      .prepareCached(
        db,
        `SELECT target_ref, target_path, kind, line_number FROM links WHERE ${linksWhere} ORDER BY line_number ASC LIMIT 60`
      )
      .all(canonical) as Array<{
      target_ref: string;
      target_path: string | null;
      kind: string;
      line_number: number;
    }>;

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

  private classifyCollectionLabel(folderName: string, fileType: string): string {
    if (folderName && folderName !== 'Workspace Root' && !folderName.startsWith('.')) {
      return folderName.charAt(0).toUpperCase() + folderName.slice(1);
    }
    const ext = fileType.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c'].includes(ext)) {
      return 'Source Code & Modules';
    }
    if (['md', 'markdown', 'mdx', 'txt', 'rst'].includes(ext)) {
      return 'Notes & Knowledge Docs';
    }
    if (['pdf', 'docx'].includes(ext)) {
      return 'Reports & Documents';
    }
    if (['json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'sql'].includes(ext)) {
      return 'Structured Data & Config';
    }
    return 'General Workspace Files';
  }

  private getOrBuildGraphSnapshot(db: NodeSqliteDatabase): GraphAdjacencySnapshot {
    const dataVersion = this.sqliteDb.readDataVersion();
    const localWriteEpoch = this.sqliteDb.getWriteEpoch();
    if (
      this.cachedAdjacency &&
      this.cachedAdjacency.dataVersion === dataVersion &&
      this.cachedAdjacency.localWriteEpoch === localWriteEpoch
    ) {
      return this.cachedAdjacency;
    }

    const fileRows = this.sqliteDb
      .prepareCached(db, 'SELECT path, canonical_path, file_type, chunk_count FROM files ORDER BY path ASC')
      .all() as Array<{
      path: string;
      canonical_path: string | null;
      file_type: string;
      chunk_count: number;
    }>;

    const byKey = new Map<string, string>();
    const canonByKey = new Map<string, string>();
    const byBasename = new Map<string, string[]>();
    const byStem = new Map<string, string[]>();
    const allFiles: Array<{ path: string; canonicalPath: string; fileType: string; chunkCount: number }> = [];

    for (const row of fileRows) {
      const key = this.sqliteDb.normalizeLookupPath(row.path);
      const canon = row.canonical_path ?? this.sqliteDb.canonicalizeLookupPath(row.path);
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
        const hit = byKey.get(this.sqliteDb.normalizeLookupPath(targetPath));
        if (hit) return hit;
        for (let i = 1; i < RELATIVE_CANDIDATE_EXTS.length; i += 1) {
          const extHit = byKey.get(
            this.sqliteDb.normalizeLookupPath(`${targetPath}${RELATIVE_CANDIDATE_EXTS[i]}`)
          );
          if (extHit) return extHit;
        }
      }

      const trimmed = targetRef.split('|')[0].split('#')[0].split('?')[0].trim();
      if (!trimmed) return null;

      if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
        const baseCand = path.resolve(path.dirname(sourcePath), trimmed);
        for (const ext of RELATIVE_CANDIDATE_EXTS) {
          const hit = byKey.get(this.sqliteDb.normalizeLookupPath(ext ? `${baseCand}${ext}` : baseCand));
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

    const linkRows = this.sqliteDb
      .prepareCached(db, 'SELECT source_path, target_ref, target_path, kind, line_number FROM links')
      .all() as Array<{
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
      const canonicalSource =
        byKey.get(this.sqliteDb.normalizeLookupPath(row.source_path)) ?? row.source_path;
      const canonicalTarget = resolveEdgeTarget(
        canonicalSource,
        row.target_ref,
        row.target_path,
        row.kind
      );
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

    const symbolRows = this.sqliteDb
      .prepareCached(db, 'SELECT file_path, symbol_name FROM symbols ORDER BY line_number ASC')
      .all() as Array<{ file_path: string; symbol_name: string }>;
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
      localWriteEpoch,
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
}

/**
 * Lightweight SQLite-only move/delete link impact check requiring zero VectorStore,
 * LanceDB, or ONNX runtime initialization.
 */
export function checkGraphImpactSqlite(
  targetPaths: string[],
  dbPath?: string
): GraphImpactCheckResult {
  if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
    return { totalAffectedFiles: 0, markdownRepairableCount: 0, references: [] };
  }
  const targetDb = dbPath ?? resolveCanonicalGraphDbPath();
  if (!fsSync.existsSync(targetDb)) {
    return { totalAffectedFiles: 0, markdownRepairableCount: 0, references: [] };
  }

  const db = new VaultSqliteDb(targetDb);
  try {
    const store = new LinkSymbolGraphStore(db);
    const references = store.findImpactForPaths(targetPaths);
    const uniqueSourceFiles = new Set(references.map((r) => r.sourcePath));
    const markdownRepairableCount = references.filter((r) => r.isMarkdownLink).length;
    return {
      totalAffectedFiles: uniqueSourceFiles.size,
      markdownRepairableCount,
      references,
    };
  } finally {
    db.close();
  }
}
