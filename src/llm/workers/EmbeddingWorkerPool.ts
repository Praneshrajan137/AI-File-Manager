/**
 * EmbeddingWorkerPool - Worker Thread Manager for Embeddings
 * 
 * Implements IEmbeddingModel interface using a worker thread for actual
 * embedding generation. This keeps the main process responsive during
 * CPU-intensive ML operations.
 * 
 * Architecture:
 * - Main thread creates Worker and sends embed requests
 * - Worker thread runs EmbeddingModel and returns results
 * - Promise-based request/response via message passing
 * 
 * Features:
 * - Lazy initialization (worker starts on first use)
 * - Automatic error handling and worker restart
 * - Request queuing with unique IDs
 * - Graceful shutdown
 * 
 * @implements IEmbeddingModel
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import {
    DEFAULT_EMBEDDING_MODEL,
    IEmbeddingModel,
    Embedding,
} from '../../shared/contracts';
import { ConfigManager } from '../../shared/config';
import { LLMLogger } from '../../shared/logging';
import {
    DEFAULT_RERANKER_MODEL,
    TransformersDevice,
    TransformersDtype,
} from '../models/transformersLoader';

export type EmbeddingPriority = 'high' | 'low';

export interface EmbeddingWorkerPoolOptions {
    modelName?: string;
    dtype?: TransformersDtype;
    device?: TransformersDevice;
    rerankerModel?: string;
    microBatchSize?: number;
}

export interface EmbeddingRequestOptions {
    priority?: EmbeddingPriority;
    signal?: AbortSignal;
    rerankerModel?: string;
}

/**
 * Message types for worker communication
 */
interface WorkerRequest {
    type: 'init' | 'embed' | 'rerank' | 'terminate';
    id?: number;
    texts?: string[];
    query?: string;
    passages?: string[];
    modelName?: string;
    rerankerModel?: string;
    dtype?: TransformersDtype;
    device?: TransformersDevice;
}

interface WorkerResponse {
    type: 'ready' | 'initialized' | 'result' | 'rerankResult' | 'error' | 'progress';
    id?: number;
    embeddings?: number[][];
    scores?: number[];
    message?: string;
    current?: number;
    total?: number;
}

interface QueuedEmbedSlice {
    kind: 'embed';
    id: number;
    priority: EmbeddingPriority;
    texts: string[];
    signal?: AbortSignal;
    onProgress?: (current: number, total: number) => void;
    resolve: (embeddings: Embedding[]) => void;
    reject: (error: Error) => void;
}

interface QueuedRerankTask {
    kind: 'rerank';
    id: number;
    priority: 'high';
    query: string;
    passages: string[];
    rerankerModel?: string;
    signal?: AbortSignal;
    resolve: (scores: number[]) => void;
    reject: (error: Error) => void;
}

type QueuedTask = QueuedEmbedSlice | QueuedRerankTask;

export class EmbeddingWorkerPool implements IEmbeddingModel {
    private worker: Worker | null = null;
    private workerReady = false;
    private initPromise: Promise<void> | null = null;
    private requestId = 0;
    private highQueue: QueuedTask[] = [];
    private lowQueue: QueuedTask[] = [];
    private activeTask: QueuedTask | null = null;
    private pendingRequests = new Map<number, QueuedTask>();

    private readonly dimensions = 384;
    private readonly modelName: string;
    private readonly dtype: TransformersDtype;
    private readonly device: TransformersDevice;
    private readonly rerankerModel: string;
    private readonly microBatchSize: number;

    /** Track memory pressure for adaptive behavior */
    private lastMemoryCheck = 0;
    private memoryPressure = false;

    constructor(options: EmbeddingWorkerPoolOptions = {}) {
        let configuredModel = DEFAULT_EMBEDDING_MODEL;
        try {
            configuredModel =
                ConfigManager.getInstance().getAll()?.llm?.embeddingModel || DEFAULT_EMBEDDING_MODEL;
        } catch {
            // Optional when instantiated standalone in unit tests
        }
        this.modelName = options.modelName || configuredModel;
        this.dtype = options.dtype ?? 'q8';
        this.device = options.device ?? 'cpu';
        this.rerankerModel = options.rerankerModel || DEFAULT_RERANKER_MODEL;
        this.microBatchSize = Math.max(1, options.microBatchSize ?? 8);
    }

    /**
     * Check system memory pressure and update state.
     * Called periodically to adapt batch behavior.
     */
    private checkMemoryPressure(): boolean {
        const now = Date.now();
        // Only check every 5 seconds to avoid overhead
        if (now - this.lastMemoryCheck < 5000) {
            return this.memoryPressure;
        }

        this.lastMemoryCheck = now;
        const memoryUsage = process.memoryUsage();
        const heapUsedRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;

        // Consider high pressure if heap is >80% used
        this.memoryPressure = heapUsedRatio > 0.8;

        return this.memoryPressure;
    }

    /**
     * Get current memory pressure state.
     * Useful for callers to adjust their behavior.
     */
    isUnderMemoryPressure(): boolean {
        return this.checkMemoryPressure();
    }

    /**
     * Initialize the embedding model.
     * 
     * Creates worker thread and waits for model to load.
     * Downloads model on first run (~100MB, cached thereafter).
     */
    async initialize(): Promise<void> {
        if (this.worker && this.workerReady) {
            return; // Already initialized
        }

        // Prevent multiple simultaneous initializations
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._initialize();

        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    /**
     * Internal initialization logic.
     */
    private async _initialize(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const settleResolve = (): void => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const settleReject = (err: Error): void => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };

            try {
                // Determine worker script path
                // In development: src/llm/workers/embeddingWorker.ts
                // In production: dist/main/embeddingWorker.js
                const workerPath = this.getWorkerPath();

                this.worker = new Worker(workerPath);

                // Set up message handler
                this.worker.on('message', (response: WorkerResponse) => {
                    this.handleWorkerMessage(response, settleResolve, settleReject);
                });

                // Handle worker errors
                this.worker.on('error', (error) => {
                    LLMLogger.error('[EmbeddingWorkerPool] Worker error', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    this.handleWorkerError(error);
                    if (!this.workerReady) {
                        settleReject(error);
                    }
                });

                // Handle worker exit
                this.worker.on('exit', (code) => {
                    if (code !== 0) {
                        LLMLogger.error('[EmbeddingWorkerPool] Worker exited unexpectedly', { code });
                    }
                    const wasReady = this.workerReady;
                    this.workerReady = false;
                    this.worker = null;

                    if (!wasReady) {
                        settleReject(new Error(`Worker exited before initialization with code ${code}`));
                    }

                    // Reject all active + queued requests cleanly
                    this.rejectAllTasks(new Error(`Worker exited with code ${code}`));
                });

                // Send init message with active config
                this.worker.postMessage({
                    type: 'init',
                    modelName: this.modelName,
                    dtype: this.dtype,
                    device: this.device,
                    rerankerModel: this.rerankerModel,
                } as WorkerRequest);

            } catch (error) {
                settleReject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /**
     * Get the path to the worker script.
     */
    private getWorkerPath(): string {
        // Check if we're in development or production
        // __dirname in webpack bundle points to dist/main/
        const isDev = process.env.NODE_ENV === 'development';

        if (isDev) {
            // Development: use ts-node or compiled version
            // Webpack will compile to dist/main/embeddingWorker.js
            return path.join(__dirname, 'embeddingWorker.js');
        } else {
            // Production: bundled worker
            return path.join(__dirname, 'embeddingWorker.js');
        }
    }

    /**
     * Handle messages from worker thread.
     */
    private handleWorkerMessage(
        response: WorkerResponse,
        initResolve?: (value: void) => void,
        initReject?: (error: Error) => void
    ): void {
        switch (response.type) {
            case 'ready':
                // Worker script loaded, waiting for model init
                break;

            case 'initialized':
                this.workerReady = true;
                if (initResolve) {
                    initResolve();
                }
                break;

            case 'result':
                if (response.id !== undefined) {
                    const request = this.pendingRequests.get(response.id);
                    if (request && request.kind === 'embed' && response.embeddings) {
                        this.pendingRequests.delete(response.id);
                        if (this.activeTask?.id === response.id) {
                            this.activeTask = null;
                        }
                        request.resolve(response.embeddings as Embedding[]);
                        this.pumpQueue();
                    }
                }
                break;

            case 'rerankResult':
                if (response.id !== undefined) {
                    const request = this.pendingRequests.get(response.id);
                    if (request && request.kind === 'rerank' && response.scores) {
                        this.pendingRequests.delete(response.id);
                        if (this.activeTask?.id === response.id) {
                            this.activeTask = null;
                        }
                        request.resolve(response.scores);
                        this.pumpQueue();
                    }
                }
                break;

            case 'progress':
                if (response.id !== undefined) {
                    const request = this.pendingRequests.get(response.id);
                    if (
                        request &&
                        request.kind === 'embed' &&
                        request.onProgress &&
                        response.current !== undefined &&
                        response.total !== undefined
                    ) {
                        request.onProgress(response.current, response.total);
                    }
                }
                break;

            case 'error':
                LLMLogger.error('[EmbeddingWorkerPool] Worker error', { message: response.message });
                if (response.id === -1 && initReject) {
                    initReject(new Error(response.message || 'Worker initialization failed'));
                } else if (response.id !== undefined && response.id >= 0) {
                    const request = this.pendingRequests.get(response.id);
                    if (request) {
                        this.pendingRequests.delete(response.id);
                        if (this.activeTask?.id === response.id) {
                            this.activeTask = null;
                        }
                        request.reject(new Error(response.message || 'Unknown worker error'));
                        this.pumpQueue();
                    }
                }
                break;
        }
    }

    private rejectAllTasks(error: Error): void {
        if (this.activeTask) {
            const active = this.activeTask;
            this.activeTask = null;
            this.pendingRequests.delete(active.id);
            active.reject(error);
        }
        while (this.highQueue.length > 0) {
            const task = this.highQueue.shift()!;
            this.pendingRequests.delete(task.id);
            task.reject(error);
        }
        while (this.lowQueue.length > 0) {
            const task = this.lowQueue.shift()!;
            this.pendingRequests.delete(task.id);
            task.reject(error);
        }
        for (const [id, request] of this.pendingRequests) {
            request.reject(error);
            this.pendingRequests.delete(id);
        }
    }

    /**
     * Handle worker errors.
     */
    private handleWorkerError(error: Error): void {
        this.rejectAllTasks(error);
    }

    private pumpQueue(): void {
        if (this.activeTask || !this.worker || !this.workerReady) {
            return;
        }

        while (this.highQueue.length > 0 || this.lowQueue.length > 0) {
            const next = this.highQueue.shift() ?? this.lowQueue.shift();
            if (!next) {
                return;
            }
            if (next.signal?.aborted) {
                this.pendingRequests.delete(next.id);
                next.reject(new Error('Embedding task cancelled'));
                continue;
            }

            this.activeTask = next;
            this.pendingRequests.set(next.id, next);

            if (next.kind === 'embed') {
                this.worker.postMessage({
                    type: 'embed',
                    id: next.id,
                    texts: next.texts,
                    modelName: this.modelName,
                    dtype: this.dtype,
                    device: this.device,
                } as WorkerRequest);
            } else {
                this.worker.postMessage({
                    type: 'rerank',
                    id: next.id,
                    query: next.query,
                    passages: next.passages,
                    rerankerModel: next.rerankerModel ?? this.rerankerModel,
                    dtype: this.dtype,
                    device: this.device,
                } as WorkerRequest);
            }
            return;
        }
    }

    private enqueueEmbedSlice(
        texts: string[],
        priority: EmbeddingPriority,
        onProgress?: (current: number, total: number) => void,
        signal?: AbortSignal
    ): Promise<Embedding[]> {
        if (signal?.aborted) {
            return Promise.reject(new Error('Embedding task cancelled'));
        }
        if (!this.worker) {
            return Promise.reject(new Error('Worker not available'));
        }

        const id = ++this.requestId;
        return new Promise<Embedding[]>((resolve, reject) => {
            const task: QueuedEmbedSlice = {
                kind: 'embed',
                id,
                priority,
                texts,
                signal,
                onProgress,
                resolve,
                reject,
            };

            const onAbort = (): void => {
                this.highQueue = this.highQueue.filter((t) => t.id !== id);
                this.lowQueue = this.lowQueue.filter((t) => t.id !== id);
                this.pendingRequests.delete(id);
                if (this.activeTask?.id === id) {
                    this.activeTask = null;
                }
                reject(new Error('Embedding task cancelled'));
                this.pumpQueue();
            };

            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
            }

            const cleanupResolve = (res: Embedding[]): void => {
                signal?.removeEventListener('abort', onAbort);
                resolve(res);
            };
            const cleanupReject = (err: Error): void => {
                signal?.removeEventListener('abort', onAbort);
                reject(err);
            };

            task.resolve = cleanupResolve;
            task.reject = cleanupReject;

            if (priority === 'high') {
                this.highQueue.push(task);
            } else {
                this.lowQueue.push(task);
            }
            this.pumpQueue();
        });
    }

    /**
     * Cancel all queued background low-priority indexing slices cleanly.
     */
    cancelLowPriority(reason: string = 'Low-priority indexing cancelled'): number {
        const dropped = this.lowQueue.length;
        while (this.lowQueue.length > 0) {
            const task = this.lowQueue.shift()!;
            this.pendingRequests.delete(task.id);
            task.reject(new Error(reason));
        }
        return dropped;
    }

    getQueueDepth(): { high: number; low: number; active: boolean } {
        return {
            high: this.highQueue.length,
            low: this.lowQueue.length,
            active: this.activeTask !== null,
        };
    }

    /**
     * Generate embedding for single text (HIGH priority lane - preempts indexing).
     */
    async embed(text: string, options?: EmbeddingRequestOptions): Promise<Embedding> {
        const results = await this.embedBatch([text], undefined, {
            ...options,
            priority: options?.priority ?? 'high',
        });
        return results[0];
    }

    /**
     * Generate embeddings for multiple texts via dual-lane priority scheduling.
     * Large LOW-priority batches are sliced into micro-batches so HIGH-priority
     * interactive queries preempt them between slices without starving.
     */
    async embedBatch(
        texts: string[],
        onProgress?: (current: number, total: number) => void,
        options?: EmbeddingRequestOptions
    ): Promise<Embedding[]> {
        await this.initialize();

        if (!this.worker) {
            throw new Error('Worker not available');
        }

        if (texts.length === 0) {
            return [];
        }

        const priority: EmbeddingPriority =
            options?.priority ?? (texts.length <= 1 ? 'high' : 'low');

        if (priority === 'high' || texts.length <= this.microBatchSize) {
            return this.enqueueEmbedSlice(texts, priority, onProgress, options?.signal);
        }

        const total = texts.length;
        const aggregated: Embedding[] = [];
        let completedBase = 0;

        for (let offset = 0; offset < total; offset += this.microBatchSize) {
            if (options?.signal?.aborted) {
                throw new Error('Embedding task cancelled');
            }
            const slice = texts.slice(offset, offset + this.microBatchSize);
            const sliceResult = await this.enqueueEmbedSlice(
                slice,
                'low',
                onProgress
                    ? (curr: number): void => onProgress(Math.min(total, completedBase + curr), total)
                    : undefined,
                options?.signal
            );
            aggregated.push(...sliceResult);
            completedBase += slice.length;
        }

        return aggregated;
    }

    /**
     * Cross-Encoder reranking (`Xenova/ms-marco-MiniLM-L-6-v2` `q8`) on HIGH lane.
     */
    async rerank(
        query: string,
        passages: string[],
        options?: EmbeddingRequestOptions
    ): Promise<number[]> {
        if (passages.length === 0) {
            return [];
        }
        await this.initialize();
        if (!this.worker) {
            throw new Error('Worker not available');
        }
        if (options?.signal?.aborted) {
            throw new Error('Rerank cancelled');
        }

        const id = ++this.requestId;
        return new Promise<number[]>((resolve, reject) => {
            const onAbort = (): void => {
                this.highQueue = this.highQueue.filter((t) => t.id !== id);
                this.pendingRequests.delete(id);
                if (this.activeTask?.id === id) {
                    this.activeTask = null;
                }
                reject(new Error('Rerank cancelled'));
                this.pumpQueue();
            };
            if (options?.signal) {
                options.signal.addEventListener('abort', onAbort, { once: true });
            }

            const task: QueuedRerankTask = {
                kind: 'rerank',
                id,
                priority: 'high',
                query,
                passages,
                rerankerModel: options?.rerankerModel ?? this.rerankerModel,
                signal: options?.signal,
                resolve: (scores) => {
                    options?.signal?.removeEventListener('abort', onAbort);
                    resolve(scores);
                },
                reject: (err) => {
                    options?.signal?.removeEventListener('abort', onAbort);
                    reject(err);
                },
            };

            this.highQueue.push(task);
            this.pumpQueue();
        });
    }

    /**
     * Get embedding dimensionality.
     */
    getDimensions(): number {
        return this.dimensions;
    }

    /**
     * Calculate cosine similarity between embeddings.
     * 
     * This runs on main thread (fast, no ML involved).
     */
    similarity(a: Embedding, b: Embedding): number {
        if (a.length !== b.length) {
            throw new Error(
                `Embedding dimensions don't match: ${a.length} vs ${b.length}`
            );
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) {
            return 0;
        }

        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        return Math.max(-1, Math.min(1, similarity));
    }

    /**
     * Terminate the worker thread.
     * 
     * Call this on app shutdown to clean up resources.
     */
    async terminate(): Promise<void> {
        if (this.worker) {
            // Send terminate message
            this.worker.postMessage({ type: 'terminate' } as WorkerRequest);

            // Wait for worker to exit
            await new Promise<void>((resolve) => {
                if (!this.worker) {
                    resolve();
                    return;
                }
                let done = false;
                const forceTimer = setTimeout(async () => {
                    if (done) return;
                    done = true;
                    if (this.worker) {
                        await this.worker.terminate();
                    }
                    resolve();
                }, 5000);
                if (typeof forceTimer.unref === 'function') {
                    forceTimer.unref();
                }

                this.worker.once('exit', () => {
                    if (done) return;
                    done = true;
                    clearTimeout(forceTimer);
                    resolve();
                });
            });

            this.worker = null;
            this.workerReady = false;
        }
    }

    /**
     * Check if worker is ready for requests.
     */
    isReady(): boolean {
        return this.workerReady;
    }
}
