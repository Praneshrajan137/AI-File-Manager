/**
 * embeddingWorker.ts - Worker Thread for Embedding Operations
 * 
 * This worker runs in a separate thread to prevent blocking the main process.
 * The EmbeddingModel runs here, performing CPU-intensive ML inference without
 * freezing the UI.
 * 
 * Message Protocol:
 * 
 * Incoming:
 * - { type: 'init' } - Initialize the model
 * - { type: 'embed', id: number, texts: string[] } - Generate embeddings
 * - { type: 'terminate' } - Shutdown worker
 * 
 * Outgoing:
 * - { type: 'initialized' } - Model ready
 * - { type: 'result', id: number, embeddings: number[][] } - Embeddings result
 * - { type: 'error', id: number, message: string } - Error occurred
 * - { type: 'progress', id: number, current: number, total: number } - Progress update
 */

import { parentPort } from 'worker_threads';

// Dynamic import for ESM-only @xenova/transformers
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('modulePath', 'return import(modulePath)');

// Type for transformers module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transformersModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

/**
 * Initialize the embedding model.
 * Downloads model on first run (~100MB, cached thereafter).
 */
async function initializeModel(): Promise<void> {
    if (extractor) {
        return; // Already initialized
    }

    try {
        // Dynamic import for ESM-only @xenova/transformers
        if (!transformersModule) {
            transformersModule = await dynamicImport('@xenova/transformers');
            // Configure for Node.js environment
            transformersModule.env.useBrowserCache = false;
        }

        // Load feature-extraction pipeline
        extractor = await transformersModule.pipeline('feature-extraction', MODEL_NAME, {
            progress_callback: undefined,
        });

        parentPort?.postMessage({ type: 'initialized' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        parentPort?.postMessage({ type: 'error', id: -1, message: `Model init failed: ${message}` });
    }
}

/**
 * Embed a single text.
 */
async function embedText(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
        return new Array(DIMENSIONS).fill(0);
    }

    const output = await extractor(text, {
        pooling: 'mean',
        normalize: true,
    });

    return Array.from(output.data as Float32Array);
}

/**
 * Embed multiple texts with progress updates.
 * Processes sequentially to avoid overwhelming the worker.
 * Includes memory management via periodic GC hints.
 */
let embeddingCount = 0;
const GC_THRESHOLD = 100; // Hint GC every 100 embeddings

async function embedBatch(
    id: number,
    texts: string[]
): Promise<number[][]> {
    const embeddings: number[][] = [];
    const total = texts.length;

    for (let i = 0; i < texts.length; i++) {
        const embedding = await embedText(texts[i]);
        embeddings.push(embedding);
        embeddingCount++;

        // Send progress every 5 items or on last item
        if (i % 5 === 0 || i === total - 1) {
            parentPort?.postMessage({
                type: 'progress',
                id,
                current: i + 1,
                total,
            });
        }

        // Hint GC periodically to prevent memory accumulation
        if (embeddingCount % GC_THRESHOLD === 0) {
            if (typeof global.gc === 'function') {
                global.gc();
            }
        }

        // Yield to prevent blocking worker's event loop
        await new Promise(resolve => setImmediate(resolve));
    }

    return embeddings;
}

/**
 * Handle incoming messages from main thread.
 */
parentPort?.on('message', async (message: {
    type: 'init' | 'embed' | 'terminate';
    id?: number;
    texts?: string[];
}) => {
    try {
        switch (message.type) {
            case 'init':
                await initializeModel();
                break;

            case 'embed':
                if (!extractor) {
                    await initializeModel();
                }

                if (message.texts && message.id !== undefined) {
                    const embeddings = await embedBatch(message.id, message.texts);
                    parentPort?.postMessage({
                        type: 'result',
                        id: message.id,
                        embeddings,
                    });
                }
                break;

            case 'terminate':
                // Cleanup and exit
                extractor = null;
                transformersModule = null;
                process.exit(0);
                break;

            default:
                parentPort?.postMessage({
                    type: 'error',
                    id: message.id ?? -1,
                    message: `Unknown message type: ${(message as { type: string }).type}`,
                });
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        parentPort?.postMessage({
            type: 'error',
            id: message.id ?? -1,
            message: errorMsg,
        });
    }
});

// Signal that worker is ready to receive messages
parentPort?.postMessage({ type: 'ready' });
