/**
 * IntelligencePorts.ts - Clean hexagonal ports inverting `llm -> main` and `llm -> electron`
 * dependencies. All runtime adapters are supplied at `main/entry` (`WorkspaceRuntime`).
 */

import type {
  AssociativeBoostResult,
  FileConnectionsSummary,
  FileLineRangeResult,
  GraphImpactReference,
  KnowledgeGraphChunkRecord,
  KnowledgeGraphInsights,
  KnowledgeGraphUpsertInput,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  PersistedAgentTraceRecord,
  SearchScopeFilter,
  ValidationResult,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '../../shared/contracts';
import type { VectorStoreDiagnostics } from '../../shared/diagnostics';
import type { AppConfig } from '../../shared/config';

export interface IDiagnosticsSink {
  setVectorStoreStats(update: Partial<VectorStoreDiagnostics>): void;
  recordWorkerRestart?(): void;
  recordSecretGuardBlock?(): void;
  recordLlmQuery?(params: {
    success: boolean;
    retrievalMs: number;
    generationMs: number;
    error?: string;
    provider?: string;
    model?: string;
  }): void;
  recordOrchestratorOutcome?(params: {
    isAgentMode?: boolean;
    parallelBatches?: number;
    cyclesPrevented?: number;
    ungroundedBlocked?: number;
    tokensConsumed?: number;
  }): void;
  setVectorOutboxPending?(count: number): void;
}

export const NOOP_DIAGNOSTICS_SINK: IDiagnosticsSink = {
  setVectorStoreStats: () => undefined,
};

export interface IGraphAssociativePort {
  computeAssociativeBoosts(
    seedPaths: string[],
    options?: {
      maxHops?: 1 | 2;
      damping?: number;
      maxBoosts?: number;
      excludeSeeds?: boolean;
    }
  ): AssociativeBoostResult[];
}

export interface IGraphIndexPort extends IGraphAssociativePort {
  getStats(): {
    totalFiles: number;
    totalChunks: number;
    totalTokens: number;
    lastIndexed: number;
  };
  getInsights(allowedRoots?: string[]): KnowledgeGraphInsights;
  upsertDocument(input: KnowledgeGraphUpsertInput): void;
  needsReindex(filePath: string, mtimeMs?: number, size?: number, sha256?: string): boolean;
  getIndexedFiles(limit?: number): string[];
  getPendingSyncCount(): number;
  getFilesWithPendingSync(limit?: number): string[];
  markFilesVectorSynced(filePaths: string[]): void;
  getFilesInScope(scopeFilter?: SearchScopeFilter, limit?: number): string[];
  getChunkLocation(chunkId: string): { startLine: number; endLine: number; heading: string } | null;
  getChunkLocationsBatch?(
    chunkIds: string[]
  ): Map<string, { startLine: number; endLine: number; heading: string }>;
  searchLexical(
    query: string,
    topK?: number,
    scopeFilter?: SearchScopeFilter
  ): KnowledgeGraphChunkRecord[];
  getChunksForFile(filePath: string, limit?: number): KnowledgeGraphChunkRecord[];
  findBySymbol(
    symbolQuery: string,
    limit?: number
  ): Array<{ filePath: string; symbolName: string; kind: string; lineNumber: number }>;
  findBacklinks(
    targetRef: string,
    limit?: number
  ): Array<{
    sourcePath: string;
    targetRef: string;
    kind: string;
    lineNumber: number;
    targetPath?: string;
  }>;
  findImpactForPaths(paths: string[]): GraphImpactReference[];
  getWorkspaceGraphMap(rootPrefix?: string, maxNodes?: number): WorkspaceGraphMap;
  getSemanticCollections(rootPrefix?: string): WorkspaceCollectionGroup[];
  getFileConnections(filePath: string): FileConnectionsSummary;
  recordAgentTrace(record: PersistedAgentTraceRecord): void;
  getRecentAgentTraces(limit?: number): PersistedAgentTraceRecord[];
  clearAgentTraces(): number;
  removeFile(filePath: string): void;
  clear(): void;
  close(): void;
}

export interface IPathValidationPort {
  validateCanonicalPathOrThrow(targetPath: string): Promise<string>;
  validateCanonical(candidatePath: string): Promise<ValidationResult>;
  resolveAllowedRoots(): string[];
}

export interface ISecureFileReaderPort {
  readFileRange(
    filePath: string,
    startLine: number,
    endLine?: number,
    contextLines?: number
  ): Promise<FileLineRangeResult>;
}

export interface IWorkspaceSearchPort {
  searchPaths(query: string, rootPath?: string): Promise<string[]>;
}

export interface IWorkspaceOrganizerPort {
  proposeOrganizationPlan(input: {
    targetDir: string;
    strategy?: OrganizeStrategy;
    useLLM?: boolean;
    recursive?: boolean;
    signal?: AbortSignal;
  }): Promise<OrganizePlanResult>;
  applyOrganizationPlan(input: {
    planId: string;
    targetDir: string;
    operations: OrganizePlanOperation[];
    repairMarkdownLinks?: boolean;
  }): Promise<OrganizeApplyResult>;
}

export interface IWorkspaceKernelPort {
  watchIndexedRoot(root: string): Promise<void>;
  reconcileIndexedFiles(
    indexedPaths: string[],
    onDelete: (stalePath: string) => Promise<void>
  ): Promise<number>;
  getFileReader(): ISecureFileReaderPort;
  scanIndexableFiles(canonicalDir: string): Promise<string[]>;
}

export interface ILlmConfigPort {
  readLlmConfig(): AppConfig['llm'] | undefined;
  readIndexedRoots(): string[];
  addIndexedRootIfMissing(canonicalDir: string): void;
  updateLlmConfig(entries: Array<[string, unknown]>): void;
}

export interface IStreamTarget {
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, payload: unknown) => void;
  readonly onceDestroyed?: (listener: () => void) => void;
  readonly removeDestroyedListener?: (listener: () => void) => void;
}

export type TierHealthStatus = 'uninitialized' | 'ready' | 'degraded' | 'unavailable';
