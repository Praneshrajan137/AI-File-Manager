import path from 'path';
import type { WorkspaceCollectionGroup } from '../../shared/contracts';

export interface VectorClusterDocument {
  filePath: string;
  name: string;
  fileType: string;
  chunkCount: number;
  vector: number[];
  topSymbols: string[];
  textSample?: string;
}

export interface SemanticVectorCluster extends WorkspaceCollectionGroup {
  clusteringMode: 'vector_embeddings';
  cohesionScore: number;
  memberCosineByPath: Map<string, number>;
}

const TOPIC_STOPWORDS = new Set([
  'about', 'after', 'all', 'also', 'and', 'any', 'are', 'because', 'been', 'before',
  'being', 'between', 'both', 'build', 'code', 'config', 'const', 'data', 'default',
  'docs', 'document', 'documents', 'each', 'else', 'export', 'exports', 'false', 'file',
  'files', 'first', 'for', 'from', 'function', 'have', 'here', 'http', 'https', 'import',
  'index', 'into', 'just', 'like', 'line', 'lines', 'list', 'local', 'main', 'make',
  'more', 'most', 'must', 'name', 'need', 'none', 'note', 'notes', 'null', 'only',
  'other', 'over', 'page', 'part', 'path', 'paths', 'private', 'public', 'read',
  'return', 'returns', 'root', 'same', 'section', 'some', 'spec', 'src', 'state',
  'such', 'system', 'test', 'tests', 'text', 'that', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'true', 'type', 'types', 'under', 'used',
  'using', 'utils', 'value', 'values', 'void', 'when', 'where', 'which', 'while',
  'with', 'without', 'work', 'workspace', 'your',
]);

export function l2NormalizeVector(raw: readonly number[]): number[] {
  let sqSum = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (Number.isFinite(v)) {
      sqSum += v * v;
    }
  }
  if (sqSum <= 1e-12) {
    return raw.map(() => 0);
  }
  const inv = 1 / Math.sqrt(sqSum);
  return raw.map((v) => (Number.isFinite(v) ? v * inv : 0));
}

export function cosineSimilarityNormalized(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function isNonZeroVector(vec: readonly number[]): boolean {
  for (let i = 0; i < vec.length; i += 1) {
    if (Math.abs(vec[i]) > 1e-6) {
      return true;
    }
  }
  return false;
}

function extractTopicTerms(doc: VectorClusterDocument): string[] {
  const stem = path.basename(doc.name, path.extname(doc.name));
  const rawSource = [
    ...doc.topSymbols.slice(0, 6),
    stem,
    doc.textSample ?? '',
  ].join(' ');
  const tokens = rawSource.match(/[A-Za-z][A-Za-z0-9_-]{2,28}/g) ?? [];
  const results: string[] = [];
  for (const tok of tokens) {
    // Split camelCase / snake_case identifiers carefully so `rotateOAuthJwt` yields readable terms
    const parts = tok
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[\s_-]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3 && !TOPIC_STOPWORDS.has(p.toLowerCase()));
    for (const part of parts) {
      results.push(part);
    }
  }
  return results;
}

function formatTopicTerm(term: string): string {
  if (/^[A-Z0-9]{2,6}$/.test(term)) {
    return term;
  }
  const lower = term.toLowerCase();
  if (lower === 'oauth') return 'OAuth';
  if (lower === 'jwt') return 'JWT';
  if (lower === 'sqlite') return 'SQLite';
  if (lower === 'lancedb') return 'LanceDB';
  if (lower === 'onnx') return 'ONNX';
  if (lower === 'mcp') return 'MCP';
  if (lower === 'api') return 'API';
  if (lower === 'ci') return 'CI';
  return term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
}

function buildClusterLabels(
  clusters: Array<{ members: VectorClusterDocument[] }>
): string[] {
  const docFreq = new Map<string, number>();
  const docTermsList = clusters.map((cluster) =>
    cluster.members.map((member) => {
      const terms = extractTopicTerms(member);
      const unique = new Set(terms.map((t) => t.toLowerCase()));
      for (const term of unique) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
      return terms;
    })
  );

  const totalDocs = Math.max(
    1,
    clusters.reduce((sum, c) => sum + c.members.length, 0)
  );
  const usedLabels = new Set<string>();

  return clusters.map((cluster, idx) => {
    const memberTermLists = docTermsList[idx];
    const scoreByLower = new Map<string, { score: number; display: string }>();

    cluster.members.forEach((member, mIdx) => {
      const symSet = new Set(member.topSymbols.map((s) => s.toLowerCase()));
      const seenInMember = new Map<string, number>();
      for (const term of memberTermLists[mIdx]) {
        const key = term.toLowerCase();
        seenInMember.set(key, (seenInMember.get(key) ?? 0) + 1);
      }
      for (const [key, tf] of seenInMember.entries()) {
        const df = docFreq.get(key) ?? 1;
        const idf = Math.log(1 + totalDocs / df);
        const symbolBoost = symSet.has(key) ? 1.45 : 1.0;
        const weight = (1 + Math.log(tf)) * idf * symbolBoost;
        const prev = scoreByLower.get(key);
        const display = formatTopicTerm(
          memberTermLists[mIdx].find((t) => t.toLowerCase() === key) ?? key
        );
        scoreByLower.set(key, {
          score: (prev?.score ?? 0) + weight,
          display: prev?.display ?? display,
        });
      }
    });

    const rankedTerms = Array.from(scoreByLower.values())
      .sort((a, b) => b.score - a.score || a.display.localeCompare(b.display))
      .map((entry) => entry.display);

    let baseLabel = 'Topic Cluster';
    if (rankedTerms.length >= 2) {
      baseLabel = `${rankedTerms[0]} & ${rankedTerms[1]}`;
    } else if (rankedTerms.length === 1) {
      baseLabel = `${rankedTerms[0]} Docs`;
    } else if (cluster.members[0]) {
      const stem = path.basename(cluster.members[0].name, path.extname(cluster.members[0].name));
      baseLabel = formatTopicTerm(stem);
    }

    baseLabel = baseLabel.slice(0, 32).trim();
    let finalLabel = baseLabel;
    let suffix = 2;
    while (usedLabels.has(finalLabel.toLowerCase())) {
      finalLabel = `${baseLabel.slice(0, 27).trim()} ${suffix}`;
      suffix += 1;
    }
    usedLabels.add(finalLabel.toLowerCase());
    return finalLabel;
  });
}

function chooseInitialCentroids(vectors: number[][], k: number): number[][] {
  const centroids: number[][] = [[...vectors[0]]];
  while (centroids.length < k) {
    let farthestIdx = -1;
    let lowestMaxSim = Infinity;
    for (let i = 0; i < vectors.length; i += 1) {
      let maxSimToChosen = -Infinity;
      for (const centroid of centroids) {
        const sim = cosineSimilarityNormalized(vectors[i], centroid);
        if (sim > maxSimToChosen) {
          maxSimToChosen = sim;
        }
      }
      if (maxSimToChosen < lowestMaxSim) {
        lowestMaxSim = maxSimToChosen;
        farthestIdx = i;
      }
    }
    if (farthestIdx < 0) {
      break;
    }
    centroids.push([...vectors[farthestIdx]]);
  }
  return centroids;
}

/**
 * Deterministic spherical k-means semantic clustering over real dense document centroids.
 * Used across both Spatial Smart Collections and Organizer `semantic_cluster`.
 */
export function clusterDocumentsByVector(
  rawDocs: VectorClusterDocument[],
  options: { maxClusters?: number; minSimilarityToSplit?: number } = {}
): {
  groups: SemanticVectorCluster[];
  averageCohesion: number;
} {
  const validDocs = [...rawDocs]
    .filter((doc) => doc.vector.length > 0 && isNonZeroVector(doc.vector))
    .map((doc) => ({ ...doc, vector: l2NormalizeVector(doc.vector) }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  if (validDocs.length === 0) {
    return { groups: [], averageCohesion: 0 };
  }

  if (validDocs.length === 1) {
    const only = validDocs[0];
    const label = buildClusterLabels([{ members: [only] }])[0];
    const cosMap = new Map<string, number>([[only.filePath, 1]]);
    return {
      averageCohesion: 1,
      groups: [
        {
          id: `vec-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          label,
          clusteringMode: 'vector_embeddings',
          cohesionScore: 1,
          memberCosineByPath: cosMap,
          reason: 'Single vectorized document indexed in workspace.',
          files: [
            {
              path: only.filePath,
              name: only.name,
              fileType: only.fileType,
              chunkCount: only.chunkCount,
              topSymbol: only.topSymbols[0],
            },
          ],
          dominantSymbols: only.topSymbols.slice(0, 5),
        },
      ],
    };
  }

  const maxK = Math.min(options.maxClusters ?? 7, validDocs.length);
  const targetK = Math.max(
    2,
    Math.min(maxK, Math.round(Math.sqrt(validDocs.length / 1.4)))
  );

  const vectors = validDocs.map((d) => d.vector);
  const centroids = chooseInitialCentroids(vectors, targetK);
  const assignments = new Array<number>(validDocs.length).fill(0);

  for (let iter = 0; iter < 15; iter += 1) {
    let changed = false;
    for (let i = 0; i < validDocs.length; i += 1) {
      let bestCluster = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const sim = cosineSimilarityNormalized(vectors[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    const dim = vectors[0].length;
    const sums = centroids.map(() => new Array<number>(dim).fill(0));
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < validDocs.length; i += 1) {
      const c = assignments[i];
      counts[c] += 1;
      for (let d = 0; d < dim; d += 1) {
        sums[c][d] += vectors[i][d];
      }
    }

    for (let c = 0; c < centroids.length; c += 1) {
      if (counts[c] > 0) {
        centroids[c] = l2NormalizeVector(sums[c]);
      }
    }

    if (!changed) {
      break;
    }
  }

  // Gather non-empty clusters
  const buckets = new Map<number, { docs: VectorClusterDocument[]; centroid: number[] }>();
  for (let i = 0; i < validDocs.length; i += 1) {
    const c = assignments[i];
    const existing = buckets.get(c);
    if (existing) {
      existing.docs.push(validDocs[i]);
    } else {
      buckets.set(c, { docs: [validDocs[i]], centroid: centroids[c] });
    }
  }

  // Merge nearly identical singleton/overlapping clusters when centroids exceed threshold
  const mergeThreshold = options.minSimilarityToSplit ?? 0.9;
  const clusterList = Array.from(buckets.values());
  let merged = true;
  while (merged && clusterList.length > 2) {
    merged = false;
    for (let i = 0; i < clusterList.length && !merged; i += 1) {
      for (let j = i + 1; j < clusterList.length; j += 1) {
        const sim = cosineSimilarityNormalized(clusterList[i].centroid, clusterList[j].centroid);
        if (sim >= mergeThreshold) {
          clusterList[i].docs.push(...clusterList[j].docs);
          const dim = clusterList[i].centroid.length;
          const combined = new Array<number>(dim).fill(0);
          for (const doc of clusterList[i].docs) {
            for (let d = 0; d < dim; d += 1) {
              combined[d] += doc.vector[d];
            }
          }
          clusterList[i].centroid = l2NormalizeVector(combined);
          clusterList.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }

  const labels = buildClusterLabels(clusterList.map((c) => ({ members: c.docs })));
  const groups: SemanticVectorCluster[] = [];
  let cohesionWeightedSum = 0;

  for (let idx = 0; idx < clusterList.length; idx += 1) {
    const entry = clusterList[idx];
    const label = labels[idx];
    const memberCosineByPath = new Map<string, number>();
    let clusterSimSum = 0;
    const dominantSymbols: string[] = [];

    for (const member of entry.docs) {
      const sim = Math.max(
        0,
        Math.min(1, cosineSimilarityNormalized(member.vector, entry.centroid))
      );
      memberCosineByPath.set(member.filePath, sim);
      clusterSimSum += sim;
      for (const sym of member.topSymbols) {
        if (dominantSymbols.length < 5 && !dominantSymbols.includes(sym)) {
          dominantSymbols.push(sym);
        }
      }
    }

    const cohesionScore = Number((clusterSimSum / entry.docs.length).toFixed(2));
    cohesionWeightedSum += clusterSimSum;

    const sortedFiles = [...entry.docs]
      .sort(
        (a, b) =>
          (memberCosineByPath.get(b.filePath) ?? 0) -
            (memberCosineByPath.get(a.filePath) ?? 0) ||
          a.name.localeCompare(b.name)
      )
      .map((member) => ({
        path: member.filePath,
        name: member.name,
        fileType: member.fileType,
        chunkCount: member.chunkCount,
        topSymbol: member.topSymbols[0],
      }));

    groups.push({
      id: `vec-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label,
      clusteringMode: 'vector_embeddings',
      cohesionScore,
      memberCosineByPath,
      reason: `Vector similarity cluster (cosine cohesion ${cohesionScore.toFixed(2)}) across ${entry.docs.length} file(s)`,
      files: sortedFiles,
      dominantSymbols,
    });
  }

  groups.sort((a, b) => b.files.length - a.files.length || a.label.localeCompare(b.label));
  const averageCohesion = Number((cohesionWeightedSum / validDocs.length).toFixed(2));
  return { groups, averageCohesion };
}
