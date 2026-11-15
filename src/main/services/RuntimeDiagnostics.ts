import {
  CacheDiagnostics,
  EventQueueDiagnostics,
  IpcChannelMetric,
  LlmPipelineDiagnostics,
  PathTrieDiagnostics,
  RingBufferPreviewDiagnostics,
  RuntimeDiagnosticsSnapshot,
  VectorStoreDiagnostics,
  WatcherDiagnostics,
} from '@shared/diagnostics';
import { CACHE_CAPACITY, MAX_CACHE_MEMORY, RING_BUFFER_CAPACITY } from '@shared/contracts';

interface MutableChannelCounter {
  calls: number;
  errors: number;
  totalDurationMs: number;
  lastCalledAt: number | null;
}

/**
 * RuntimeDiagnostics - Central lightweight telemetry registry for Main process.
 *
 * Lets the system observe its own live invariants (watcher path, queue backpressure,
 * trie coverage, LRU cache hit ratio, vector store row state, and IPC health).
 */
export class RuntimeDiagnostics {
  private static instance: RuntimeDiagnostics | null = null;

  private readonly startedAt = Date.now();
  private allowedRoots: string[] = [];
  private registeredChannels = 0;

  private watcher: WatcherDiagnostics = {
    status: 'idle',
    watchedPath: null,
    eventsReceived: 0,
    lastEventAt: null,
    lastError: null,
  };

  private eventQueue: EventQueueDiagnostics = {
    pending: 0,
    processed: 0,
    coalesced: 0,
    dropped: 0,
    lastFlushAt: null,
    lastFlushDurationMs: 0,
  };

  private pathTrie: PathTrieDiagnostics = {
    entryCount: 0,
    indexedRoots: [],
    lastIndexDurationMs: 0,
  };

  private cache: CacheDiagnostics = {
    entries: 0,
    capacity: CACHE_CAPACITY,
    currentBytes: 0,
    maxBytes: MAX_CACHE_MEMORY,
    hits: 0,
    misses: 0,
    hitRate: 0,
    invalidations: 0,
  };

  private preview: RingBufferPreviewDiagnostics = {
    capacityPerFile: RING_BUFFER_CAPACITY,
    previewsServed: 0,
    cacheHits: 0,
  };

  private vectorStore: VectorStoreDiagnostics = {
    initialized: false,
    totalChunks: 0,
    indexedFiles: 0,
    lexicalDocs: 0,
    pendingBuffer: 0,
  };

  private llm: LlmPipelineDiagnostics = {
    queriesExecuted: 0,
    successfulQueries: 0,
    failedQueries: 0,
    avgRetrievalMs: 0,
    avgGenerationMs: 0,
    lastError: null,
  };

  private totalRetrievalMs = 0;
  private totalGenerationMs = 0;
  private ipcCounters = new Map<string, MutableChannelCounter>();

  static getInstance(): RuntimeDiagnostics {
    if (!RuntimeDiagnostics.instance) {
      RuntimeDiagnostics.instance = new RuntimeDiagnostics();
    }
    return RuntimeDiagnostics.instance;
  }

  static resetForTesting(): void {
    RuntimeDiagnostics.instance = new RuntimeDiagnostics();
  }

  setAllowedRoots(roots: string[]): void {
    this.allowedRoots = [...roots];
  }

  setRegisteredChannels(count: number): void {
    this.registeredChannels = count;
  }

  setWatcherState(update: Partial<WatcherDiagnostics>): void {
    this.watcher = { ...this.watcher, ...update };
  }

  recordWatcherEvent(): void {
    this.watcher.eventsReceived += 1;
    this.watcher.lastEventAt = Date.now();
  }

  recordEventQueueStats(update: Partial<EventQueueDiagnostics>): void {
    this.eventQueue = { ...this.eventQueue, ...update };
  }

  setPathTrieStats(update: Partial<PathTrieDiagnostics>): void {
    this.pathTrie = { ...this.pathTrie, ...update };
  }

  setCacheStats(update: Partial<CacheDiagnostics>): void {
    this.cache = { ...this.cache, ...update };
    const total = this.cache.hits + this.cache.misses;
    this.cache.hitRate = total > 0 ? Number((this.cache.hits / total).toFixed(4)) : 0;
  }

  recordPreviewServed(fromCache: boolean): void {
    this.preview.previewsServed += 1;
    if (fromCache) {
      this.preview.cacheHits += 1;
    }
  }

  setVectorStoreStats(update: Partial<VectorStoreDiagnostics>): void {
    this.vectorStore = { ...this.vectorStore, ...update };
  }

  recordLlmQuery(params: {
    success: boolean;
    retrievalMs: number;
    generationMs: number;
    error?: string;
    provider?: string;
    model?: string;
  }): void {
    this.llm.queriesExecuted += 1;
    if (params.provider) {
      this.llm.activeProvider = params.provider;
    }
    if (params.model) {
      this.llm.activeModel = params.model;
    }
    if (params.success) {
      this.llm.successfulQueries += 1;
      this.llm.lastError = null;
    } else {
      this.llm.failedQueries += 1;
      this.llm.lastError = params.error ?? 'Unknown error';
    }
    this.totalRetrievalMs += params.retrievalMs;
    this.totalGenerationMs += params.generationMs;
    this.llm.avgRetrievalMs = Math.round(this.totalRetrievalMs / this.llm.queriesExecuted);
    this.llm.avgGenerationMs = Math.round(this.totalGenerationMs / this.llm.queriesExecuted);
  }

  recordIpcCall(channel: string, durationMs: number, succeeded: boolean): void {
    const existing = this.ipcCounters.get(channel) ?? {
      calls: 0,
      errors: 0,
      totalDurationMs: 0,
      lastCalledAt: null,
    };
    existing.calls += 1;
    if (!succeeded) {
      existing.errors += 1;
    }
    existing.totalDurationMs += durationMs;
    existing.lastCalledAt = Date.now();
    this.ipcCounters.set(channel, existing);
  }

  getSnapshot(): RuntimeDiagnosticsSnapshot {
    let totalCalls = 0;
    let totalErrors = 0;
    const channels: IpcChannelMetric[] = [];

    for (const [channel, counter] of this.ipcCounters.entries()) {
      totalCalls += counter.calls;
      totalErrors += counter.errors;
      channels.push({
        channel,
        calls: counter.calls,
        errors: counter.errors,
        avgDurationMs:
          counter.calls > 0 ? Number((counter.totalDurationMs / counter.calls).toFixed(2)) : 0,
        lastCalledAt: counter.lastCalledAt,
      });
    }

    channels.sort((a, b) => a.channel.localeCompare(b.channel));

    return {
      capturedAt: Date.now(),
      uptimeMs: Date.now() - this.startedAt,
      allowedRoots: [...this.allowedRoots],
      watcher: { ...this.watcher },
      eventQueue: { ...this.eventQueue },
      pathTrie: {
        ...this.pathTrie,
        indexedRoots: [...this.pathTrie.indexedRoots],
      },
      cache: { ...this.cache },
      preview: { ...this.preview },
      vectorStore: { ...this.vectorStore },
      llm: { ...this.llm },
      ipc: {
        registeredChannels: this.registeredChannels,
        totalCalls,
        totalErrors,
        channels,
      },
    };
  }
}
