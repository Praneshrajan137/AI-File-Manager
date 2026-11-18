/**
 * contracts/graph.ts - Workspace Knowledge Graph, structural chunks, links, symbols,
 * duplicate clusters, impact analysis, and spatial map contracts.
 */

import type { TextChunk } from './core';

export interface GraphInsightDuplicateCluster {
  sha256: string;
  files: string[];
  fileSize: number;
  wastedBytes: number;
}

export interface GraphInsightHubTarget {
  targetRef: string;
  backlinkCount: number;
}

export interface GraphInsightRecentFile {
  path: string;
  fileType: string;
  chunkCount: number;
  indexedAt: number;
}

export interface GraphImpactReference {
  targetPath: string;
  sourcePath: string;
  targetRef: string;
  kind: string;
  lineNumber: number;
  isMarkdownLink: boolean;
}

export interface GraphImpactCheckResult {
  totalAffectedFiles: number;
  markdownRepairableCount: number;
  references: GraphImpactReference[];
}

export interface GraphInsightsResponse {
  stats: {
    totalFiles: number;
    totalChunks: number;
    totalTokens: number;
    lastIndexed: number;
    duplicateClusters: GraphInsightDuplicateCluster[];
    totalWastedBytes: number;
    topHubs: GraphInsightHubTarget[];
    recentFiles: GraphInsightRecentFile[];
  };
  symbolMatches?: Array<{
    filePath: string;
    symbolName: string;
    kind: string;
    lineNumber: number;
  }>;
  backlinks?: Array<{
    sourcePath: string;
    targetRef: string;
    kind: string;
    lineNumber: number;
    targetPath?: string;
  }>;
}

export interface AssociativeBoostResult {
  filePath: string;
  score: number;
  hopDistance: 1 | 2;
  viaPath?: string;
}

export interface WorkspaceGraphNode {
  path: string;
  name: string;
  fileType: string;
  chunkCount: number;
  inDegree: number;
  outDegree: number;
  topSymbols: string[];
  folder: string;
}

export interface WorkspaceGraphEdge {
  source: string;
  target: string;
  targetRef: string;
  kind: string;
  lineNumber: number;
}

export interface WorkspaceGraphMap {
  rootPrefix: string | null;
  nodes: WorkspaceGraphNode[];
  edges: WorkspaceGraphEdge[];
  totalFilesIndexed: number;
}

export interface WorkspaceCollectionGroup {
  id: string;
  label: string;
  reason: string;
  clusteringMode?: 'vector_embeddings' | 'structural_heuristic';
  files: Array<{
    path: string;
    name: string;
    fileType: string;
    chunkCount: number;
    topSymbol?: string;
  }>;
  dominantSymbols: string[];
}

export interface FileConnectionsSummary {
  filePath: string;
  symbols: Array<{ name: string; kind: string; lineNumber: number }>;
  outgoingLinks: Array<{ targetRef: string; targetPath?: string; kind: string; lineNumber: number }>;
  backlinks: Array<{ sourcePath: string; targetRef: string; kind: string; lineNumber: number }>;
  associativeNeighbors: AssociativeBoostResult[];
}

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'heading';
  lineNumber: number;
}

export interface ExtractedLink {
  targetRef: string;
  kind: 'wikilink' | 'mdlink' | 'import';
  lineNumber: number;
}

export interface StructuralChunk extends TextChunk {
  startLine: number;
  endLine: number;
  heading: string;
  contextHeader?: string;
}

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
