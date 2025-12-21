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
import { IEmbeddingModel, Embedding } from '../../shared/contracts';

/**
 * Message types for worker communication
 */
interface WorkerRequest {
    type: 'init' | 'embed' | 'terminate';
    id?: number;
    texts?: string[];
}

interface WorkerResponse {
    type: 'ready' | 'initialized' | 'result' | 'error' | 'progress';
    id?: number;
    embeddings?: number[][];
    message?: string;
    current?: number;
    total?: number;
}

/**
 * Pending request tracking
 */
interface PendingRequest {
    resolve: (embeddings: Embedding[]) => void;
    reject: (error: Error) => void;
    onProgress?: (current: number, total: number) => void;
}

export class EmbeddingWorkerPool implements IEmbeddingModel {
    private worker: Worker | null = null;
    private workerReady = false;
    private initPromise: Promise<void> | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, PendingRequest>();

    private readonly dimensions = 384;

    /** Track memory pressure for adaptive behavior */
    private lastMemoryCheck = 0;
    private memoryPressure = false;

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
            try {
                // Determine worker script path
                // In development: src/llm/workers/embeddingWorker.ts
                // In production: dist/main/embeddingWorker.js
                const workerPath = this.getWorkerPath();

                this.worker = new Worker(workerPath);

                // Set up message handler
                this.worker.on('message', (response: WorkerResponse) => {
                    this.handleWorkerMessage(response, resolve);
                });

                // Handle worker errors
                this.worker.on('error', (error) => {
                    console.error('[EmbeddingWorkerPool] Worker error:', error);
                    this.handleWorkerError(error);
                    if (!this.workerReady) {
                        reject(error);
                    }
                });

                // Handle worker exit
                this.worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(`[EmbeddingWorkerPool] Worker exited with code ${code}`);
                    }
                    this.workerReady = false;
                    this.worker = null;

                    // Reject all pending requests
                    for (const [id, request] of this.pendingRequests) {
                        request.reject(new Error(`Worker exited with code ${code}`));
                        this.pendingRequests.delete(id);
                    }
                });

                // Send init message
                this.worker.postMessage({ type: 'init' } as WorkerRequest);

            } catch (error) {
                reject(error);
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
        initResolve?: (value: void) => void
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
                    if (request && response.embeddings) {
                        request.resolve(response.embeddings as Embedding[]);
                        this.pendingRequests.delete(response.id);
                    }
                }
                break;

            case 'progress':
                if (response.id !== undefined) {
                    const request = this.pendingRequests.get(response.id);
                    if (request?.onProgress && response.current !== undefined && response.total !== undefined) {
                        request.onProgress(response.current, response.total);
                    }
                }
                break;

            case 'error':
                console.error('[EmbeddingWorkerPool] Worker error:', response.message);
                if (response.id !== undefined && response.id >= 0) {
                    const request = this.pendingRequests.get(response.id);
                    if (request) {
                        request.reject(new Error(response.message || 'Unknown worker error'));
                        this.pendingRequests.delete(response.id);
                    }
                }
                break;
        }
    }

    /**
     * Handle worker errors.
     */
    private handleWorkerError(error: Error): void {
        // Reject all pending requests
        for (const [id, request] of this.pendingRequests) {
            request.reject(error);
            this.pendingRequests.delete(id);
        }
    }

    /**
     * Generate embedding for single text.
     */
    async embed(text: string): Promise<Embedding> {
        const results = await this.embedBatch([text]);
        return results[0];
    }

    /**
     * Generate embeddings for multiple texts (batched).
     * 
     * Sends texts to worker thread for processing.
     * Returns promise that resolves when all embeddings are ready.
     * 
     * @param texts - Array of input texts
     * @param onProgress - Optional callback for progress updates
     */
    async embedBatch(
        texts: string[],
        onProgress?: (current: number, total: number) => void
    ): Promise<Embedding[]> {
        // Ensure worker is ready
        await this.initialize();

        if (!this.worker) {
            throw new Error('Worker not available');
        }

        if (texts.length === 0) {
            return [];
        }

        // Create unique request ID
        const id = ++this.requestId;

        return new Promise<Embedding[]>((resolve, reject) => {
            // Store pending request
            this.pendingRequests.set(id, { resolve, reject, onProgress });

            // Send request to worker
            this.worker!.postMessage({
                type: 'embed',
                id,
                texts,
            } as WorkerRequest);
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
                if (this.worker) {
                    this.worker.on('exit', () => {
                        resolve();
                    });

                    // Force terminate after 5 seconds
                    setTimeout(async () => {
                        if (this.worker) {
                            await this.worker.terminate();
                        }
                        resolve();
                    }, 5000);
                } else {
                    resolve();
                }
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
