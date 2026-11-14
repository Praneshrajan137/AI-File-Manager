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
}

export interface LlmPipelineDiagnostics {
  queriesExecuted: number;
  successfulQueries: number;
  failedQueries: number;
  avgRetrievalMs: number;
  avgGenerationMs: number;
  lastError: string | null;
}

export interface IpcChannelMetric {
  channel: string;
  calls: number;
  errors: number;
  avgDurationMs: number;
  lastCalledAt: number | null;
}

export interface RuntimeDiagnosticsSnapshot {
  capturedAt: number;
  uptimeMs: number;
  allowedRoots: string[];
  watcher: WatcherDiagnostics;
  eventQueue: EventQueueDiagnostics;
  pathTrie: PathTrieDiagnostics;
  cache: CacheDiagnostics;
  preview: RingBufferPreviewDiagnostics;
  vectorStore: VectorStoreDiagnostics;
  llm: LlmPipelineDiagnostics;
  ipc: {
    registeredChannels: number;
    totalCalls: number;
    totalErrors: number;
    channels: IpcChannelMetric[];
  };
}
