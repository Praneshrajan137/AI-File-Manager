/**
 * diagnostics.ts - Shared runtime observability contract types
 *
 * Defines zero-dependency telemetry snapshot types exchanged between Main
 * (RuntimeDiagnostics collector) and Renderer (DiagnosticsModal & status pill).
 */

export type WatcherHealthStatus = 'idle' | 'watching' | 'error';

export interface WatcherDiagnostics {
  status: WatcherHealthStatus;
  watchedPath: string | null;
  eventsReceived: number;
  lastEventAt: number | null;
  lastError: string | null;
}

export interface EventQueueDiagnostics {
  pending: number;
  processed: number;
  coalesced: number;
  dropped: number;
  lastFlushAt: number | null;
  lastFlushDurationMs: number;
}

export interface PathTrieDiagnostics {
  entryCount: number;
  indexedRoots: string[];
  lastIndexDurationMs: number;
}

export interface CacheDiagnostics {
  entries: number;
  capacity: number;
  currentBytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  hitRate: number;
  invalidations: number;
}

export interface RingBufferPreviewDiagnostics {
  capacityPerFile: number;
  previewsServed: number;
  cacheHits: number;
}

export interface VectorStoreDiagnostics {
  initialized: boolean;
  totalChunks: number;
  indexedFiles: number;
  lexicalDocs: number;
  pendingBuffer: number;
  modelId?: string;
  needsReindex?: boolean;
  migrationReason?: string;
  activeExecutionProvider?: string;
  supportedDevices?: string[];
}

export interface LlmPipelineDiagnostics {
  queriesExecuted: number;
  successfulQueries: number;
  failedQueries: number;
  avgRetrievalMs: number;
  avgGenerationMs: number;
  lastError: string | null;
  activeProvider?: string;
  activeModel?: string;
  agentRuns?: number;
  parallelToolBatches?: number;
  cyclesPrevented?: number;
  ungroundedCitationsBlocked?: number;
  totalTokensConsumed?: number;
}

export interface IpcChannelMetric {
  channel: string;
  calls: number;
  errors: number;
  avgDurationMs: number;
  p95DurationMs?: number;
  maxDurationMs?: number;
  lastCalledAt: number | null;
}

export interface ResilienceDiagnostics {
  walRecoveries: number;
  walRollbackFailures: number;
  vectorOutboxPending: number;
  secretGuardBlocks: number;
  workerRestarts: number;
  retryRenameCount: number;
}

export interface RuntimeDiagnosticsSnapshot {
  capturedAt: number;
  uptimeMs: number;
  allowedRoots: string[];
  mcpEntryPath?: string;
  modelCacheDir?: string;
  watcher: WatcherDiagnostics;
  eventQueue: EventQueueDiagnostics;
  pathTrie: PathTrieDiagnostics;
  cache: CacheDiagnostics;
  preview: RingBufferPreviewDiagnostics;
  vectorStore: VectorStoreDiagnostics;
  llm: LlmPipelineDiagnostics;
  resilience?: ResilienceDiagnostics;
  ipc: {
    registeredChannels: number;
    totalCalls: number;
    totalErrors: number;
    channels: IpcChannelMetric[];
  };
}
