/**
 * WorkspaceKnowledgeGraph.ts - Cohesive facade over split SQLite storage repositories:
 *   VaultSqliteDb, DocumentFtsOutboxStore, LinkSymbolGraphStore,
 *   DuplicateClusterStore, and AgentTraceStore.
 */

import {
  AssociativeBoostResult,
  DuplicateCluster,
  FileConnectionsSummary,
  GraphImpactReference,
  KnowledgeGraphChunkRecord,
  KnowledgeGraphInsights,
  KnowledgeGraphUpsertInput,
  PersistedAgentTraceRecord,
  SearchScopeFilter,
  StructuralChunk,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '@shared/contracts';
import { VaultSqliteDb } from '@main/platform/storage/VaultSqliteDb';
import {
  buildSafeFtsQuery,
  computeBufferSha256,
  DocumentFtsOutboxStore,
} from '@main/platform/storage/DocumentFtsOutboxStore';
import { LinkSymbolGraphStore } from '@main/platform/storage/LinkSymbolGraphStore';
import { DuplicateClusterStore } from '@main/platform/storage/DuplicateClusterStore';
import { AgentTraceStore } from '@main/platform/storage/AgentTraceStore';

export { buildSafeFtsQuery, computeBufferSha256 };
export type {
  DuplicateCluster,
  KnowledgeGraphChunkRecord,
  KnowledgeGraphInsights,
  KnowledgeGraphUpsertInput,
  StructuralChunk,
};

export class WorkspaceKnowledgeGraph {
  readonly sqliteDb: VaultSqliteDb;
  readonly documents: DocumentFtsOutboxStore;
  readonly links: LinkSymbolGraphStore;
  readonly duplicates: DuplicateClusterStore;
  readonly traces: AgentTraceStore;

  constructor(dbPath: string = ':memory:') {
    this.sqliteDb = new VaultSqliteDb(dbPath);
    this.documents = new DocumentFtsOutboxStore(this.sqliteDb);
    this.links = new LinkSymbolGraphStore(this.sqliteDb);
    this.duplicates = new DuplicateClusterStore(this.sqliteDb, this.documents);
    this.traces = new AgentTraceStore(this.sqliteDb);
  }

  needsReindex(filePath: string, mtimeMs: number, size: number, sha256?: string): boolean {
    return this.documents.needsReindex(filePath, mtimeMs, size, sha256);
  }

  markFilesVectorSynced(filePaths: string[]): number {
    return this.documents.markFilesVectorSynced(filePaths);
  }

  getFilesWithPendingSync(limit: number = 1000): string[] {
    return this.documents.getFilesWithPendingSync(limit);
  }

  getPendingSyncCount(): number {
    return this.documents.getPendingSyncCount();
  }

  upsertDocument(input: KnowledgeGraphUpsertInput): void {
    this.documents.upsertDocument(input);
  }

  upsertDocumentsBatch(inputs: KnowledgeGraphUpsertInput[]): void {
    this.documents.upsertDocumentsBatch(inputs);
  }

  removeFile(filePath: string): number {
    return this.documents.removeFile(filePath);
  }

  clear(): void {
    this.documents.clear();
  }

  getFilesInScope(scopeFilter?: SearchScopeFilter, limit: number = 10000): string[] {
    return this.documents.getFilesInScope(scopeFilter, limit);
  }

  getChunksForFile(filePath: string, limit: number = 8): KnowledgeGraphChunkRecord[] {
    return this.documents.getChunksForFile(filePath, limit);
  }

  searchLexical(
    query: string,
    topK: number = 10,
    scopeFilter?: SearchScopeFilter
  ): KnowledgeGraphChunkRecord[] {
    return this.documents.searchLexical(query, topK, scopeFilter);
  }

  getChunkLocation(chunkId: string): { startLine: number; endLine: number; heading: string } | null {
    return this.documents.getChunkLocation(chunkId);
  }

  getChunkLocationsBatch(
    chunkIds: string[]
  ): Map<string, { startLine: number; endLine: number; heading: string }> {
    return this.documents.getChunkLocationsBatch(chunkIds);
  }

  getStats(): {
    totalFiles: number;
    totalChunks: number;
    totalTokens: number;
    lastIndexed: number;
  } {
    return this.documents.getStats();
  }

  getIndexedFiles(limit: number = 10000): string[] {
    return this.documents.getIndexedFiles(limit);
  }

  getDuplicateClusters(): DuplicateCluster[] {
    return this.duplicates.getDuplicateClusters();
  }

  findBySymbol(
    symbolName: string,
    limit: number = 25
  ): Array<{ filePath: string; symbolName: string; kind: string; lineNumber: number }> {
    return this.links.findBySymbol(symbolName, limit);
  }

  findBacklinks(
    targetRef: string,
    limit: number = 50
  ): Array<{ sourcePath: string; targetRef: string; kind: string; lineNumber: number; targetPath?: string }> {
    return this.links.findBacklinks(targetRef, limit);
  }

  findImpactForPaths(targetPaths: string[], limitPerTarget: number = 50): GraphImpactReference[] {
    return this.links.findImpactForPaths(targetPaths, limitPerTarget);
  }

  getInsights(allowedRoots?: readonly string[]): KnowledgeGraphInsights {
    return this.duplicates.getInsights(allowedRoots);
  }

  computeAssociativeBoosts(
    seedFilePaths: string[],
    options?: { maxHops?: 1 | 2; damping?: number; maxBoosts?: number; excludeSeeds?: boolean }
  ): AssociativeBoostResult[] {
    return this.links.computeAssociativeBoosts(seedFilePaths, options);
  }

  getWorkspaceGraphMap(rootPrefix?: string, maxNodes: number = 120): WorkspaceGraphMap {
    return this.links.getWorkspaceGraphMap(rootPrefix, maxNodes);
  }

  getSemanticCollections(rootPrefix?: string): WorkspaceCollectionGroup[] {
    return this.links.getSemanticCollections(rootPrefix);
  }

  getFileConnections(filePath: string): FileConnectionsSummary {
    return this.links.getFileConnections(filePath);
  }

  recordAgentTrace(record: PersistedAgentTraceRecord): void {
    this.traces.recordAgentTrace(record);
  }

  getRecentAgentTraces(limit: number = 25): PersistedAgentTraceRecord[] {
    return this.traces.getRecentAgentTraces(limit);
  }

  clearAgentTraces(): number {
    return this.traces.clearAgentTraces();
  }

  listIndexedFilePaths(query?: string, rootPrefix?: string, limit: number = 100): string[] {
    return this.documents.listIndexedFilePaths(query, rootPrefix, limit);
  }

  close(): void {
    this.links.invalidateSnapshot();
    this.sqliteDb.close();
  }
}
