/**
 * contracts/ai.ts - LLM, embedding, vector store, indexing, Copilot agent traces,
 * and bounded AI organizer contracts.
 */

import type { TextChunk, VectorRecord } from './core';
import type { OperationJournalState } from './fs';
import type { GraphImpactCheckResult } from './graph';

// ============================================================================
// LLM TYPES
// ============================================================================

/**
 * Structured source citation for clickable inspector navigation (#Lx-Ly).
 */
export interface RetrievalSource {
  filePath: string;
  startLine?: number;
  endLine?: number;
  heading?: string;
  score?: number;
  snippet?: string;
}

/**
 * Retrieval result from RAG pipeline.
 */
export interface RetrievalResult {
  /** Compressed context for LLM */
  context: string;

  /** Source file paths (for citation) */
  sources: string[];

  /** Total token count of context */
  tokenCount: number;

  /** Optional structured source citations with line ranges */
  structuredSources?: RetrievalSource[];
}

/**
 * LLM query options.
 */
export interface LLMQueryOptions {
  /** Model name (default: 'llama3.2') */
  model?: string;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Temperature (0-1, default: 0.7) */
  temperature?: number;

  /** Whether to stream response */
  stream?: boolean;
}

/**
 * Indexing progress status.
 */
export interface IndexingStatus {
  /** Number of files indexed so far */
  indexed: number;

  /** Total files to index */
  total: number;

  /** Whether indexing is currently running */
  inProgress: boolean;

  /** Current file being indexed (if inProgress) */
  currentFile?: string;
}

/**
 * LLM Service Interface.
 * Handles chat queries and file indexing.
 */
export interface ILLMService {
  /**
   * Query LLM with user question.
   */
  query(query: string, options?: LLMQueryOptions): AsyncGenerator<string, void, unknown>;

  /**
   * Index a file for semantic search.
   */
  indexFile(filePath: string): Promise<{ success: boolean }>;

  /**
   * Get current indexing status.
   */
  getIndexingStatus(): Promise<IndexingStatus>;

  /**
   * Start background indexing of directory.
   */
  startIndexing(directoryPath: string): Promise<{ success: boolean }>;

  /**
   * Stop background indexing.
   */
  stopIndexing(): Promise<{ success: boolean }>;
}

// ============================================================================
// EMBEDDING MODEL INTERFACES
// ============================================================================

/**
 * Default local AI embedding and reranking model identifiers.
 */
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const FALLBACK_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_RERANKER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

/**
 * Embedding vector (384 dimensions for bge-small-en-v1.5 / all-MiniLM-L6-v2)
 */
export type Embedding = number[];

/**
 * Embedding generation options
 */
export interface EmbeddingOptions {
  /** Model name (default: 'Xenova/bge-small-en-v1.5') */
  model?: string;

  /** Normalize embeddings (default: true) */
  normalize?: boolean;

  /** Batch size for processing (default: 32) */
  batchSize?: number;
}

/**
 * Embedding model interface for text-to-vector conversion.
 * Implementations must use local models only (privacy-first).
 */
export interface IEmbeddingModel {
  initialize(): Promise<void>;
  embed(text: string): Promise<Embedding>;
  embedBatch(texts: string[]): Promise<Embedding[]>;
  getDimensions(): number;
  similarity(a: Embedding, b: Embedding): number;
  rerank?(query: string, passages: string[]): Promise<number[]>;
}

// ============================================================================
// INDEXING SERVICE & VECTOR STORE INTERFACES
// ============================================================================

/**
 * Result of indexing operation
 */
export interface IndexingResult {
  filePath: string;
  chunksCreated: number;
  totalTokens: number;
  indexedAt: number;
  success: boolean;
  error?: string;
}

/**
 * Index statistics
 */
export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  totalTokens: number;
  indexSize: number;
  lastIndexed: number;
}

/**
 * Indexing service interface.
 */
export interface IIndexingService {
  indexFile(filePath: string): Promise<IndexingResult>;
  indexFiles(filePaths: string[]): Promise<IndexingResult[]>;
  removeFile(filePath: string): Promise<{ success: boolean }>;
  getStats(): Promise<IndexStats>;
}

/**
 * Vector store interface for semantic search.
 */
export interface IVectorStore {
  initialize(dbPath: string): Promise<void>;
  addChunks(chunks: TextChunk[], embeddings: Embedding[], filePath: string): Promise<void>;
  search(queryEmbedding: Embedding, topK?: number): Promise<VectorRecord[]>;
  deleteFile(filePath: string): Promise<number>;
  getStats(): Promise<IndexStats>;
  clear(): Promise<{ success: boolean }>;
}

export interface LLMModelsSnapshot {
  available: boolean;
  models: string[];
  activeModel: string;
  embeddingModel: string;
  rerankerModel: string;
  temperature: number;
  maxTokens: number;
  provider?: 'ollama' | 'openai_compatible';
  ollamaUrl?: string;
  openAiBaseUrl?: string;
  embeddingDevice?: 'auto' | 'cpu' | 'dml' | 'webgpu';
  activeExecutionProvider?: string;
  supportedEmbeddingDevices?: string[];
  allowRemoteModels?: boolean;
  modelCacheDir?: string;
  embeddingCached?: boolean;
  embeddingCacheBytes?: number;
  rerankerCached?: boolean;
  rerankerCacheBytes?: number;
}

// ============================================================================
// COPILOT AGENT & AI ORGANIZER CONTRACTS
// ============================================================================

export type CopilotQueryMode = 'rag' | 'agent';

export interface CopilotContextScope {
  currentPath?: string;
  selectedPaths?: string[];
  useFolder?: boolean;
  useSelection?: boolean;
}

export type AgentToolName =
  | 'search_files'
  | 'search_content'
  | 'read_file_range'
  | 'graph_lookup'
  | 'propose_organize_plan';

export type AgentStatePhase =
  | 'init'
  | 'route'
  | 'act'
  | 'observe'
  | 'verify'
  | 'synthesize'
  | 'completed'
  | 'aborted'
  | 'fallback';

export type AgentTerminationReason =
  | 'answered'
  | 'step_limit'
  | 'wall_clock_budget'
  | 'cycle_broken'
  | 'aborted'
  | 'offline_fallback'
  | 'model_error';

export interface AgentCitationAudit {
  citedText: string;
  resolvedPath?: string;
  verified: boolean;
  reason: string;
}

export interface AgentVerificationReport {
  grounded: boolean;
  totalCitations: number;
  verifiedCitations: number;
  ungroundedCitations: string[];
  redactionsApplied: number;
  audits: AgentCitationAudit[];
  checkedAt: number;
}

export interface AgentTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AgentTraceStep {
  step: number;
  thought?: string;
  tool: string;
  arguments: Record<string, unknown>;
  allowed: boolean;
  observationSummary: string;
  durationMs: number;
  phase?: AgentStatePhase;
  callId?: string;
  duplicatePrevented?: boolean;
  parallelGroupSize?: number;
}

export interface AgentRunResult {
  answer: string;
  steps: AgentTraceStep[];
  sources: RetrievalSource[];
  stepLimitReached: boolean;
  aborted: boolean;
  proposedPlan?: OrganizePlanResult;
  traceId?: string;
  terminationReason?: AgentTerminationReason;
  verification?: AgentVerificationReport;
  durationMs?: number;
  usage?: AgentTokenUsage;
  duplicateCallsPrevented?: number;
  promptVersion?: string;
}

export interface PersistedAgentTraceRecord {
  traceId: string;
  createdAt: number;
  mode: CopilotQueryMode;
  model: string;
  provider: string;
  promptVersion: string;
  queryPreview: string;
  status: AgentTerminationReason;
  durationMs: number;
  stepCount: number;
  duplicateCallsPrevented: number;
  verifiedCitations: number;
  ungroundedCitationsCount: number;
  redactionsApplied: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorSummary?: string;
  steps: AgentTraceStep[];
  sources: RetrievalSource[];
  verification?: AgentVerificationReport;
}

export const MAX_PERSISTED_TRACE_RECORDS = 200;

export type OrganizeStrategy =
  | 'auto'
  | 'smart_category'
  | 'by_type'
  | 'by_date'
  | 'ai_suggested'
  | 'deduplicate'
  | 'semantic_cluster';

export interface OrganizePlanOperation {
  id: string;
  action: 'move' | 'rename';
  sourcePath: string;
  destinationPath: string;
  sourceSha256: string;
  size: number;
  category: string;
  reason: string;
  confidence?: number;
  classificationSource?: 'llm' | 'semantic' | 'deterministic' | 'deduplicate';
}

export interface OrganizePlanResult {
  planId: string;
  targetDir: string;
  strategy: OrganizeStrategy;
  usedLLM: boolean;
  createdAt: number;
  operations: OrganizePlanOperation[];
  skippedFiles: number;
  summary: string;
  linkImpact?: GraphImpactCheckResult;
  repairedLinksCount?: number;
  batchCount?: number;
  degradedReason?: string;
}

export interface OrganizeApplyResult {
  success: boolean;
  planId: string;
  appliedCount: number;
  operationId: string;
  journalState: OperationJournalState;
  repairedLinksCount?: number;
}
