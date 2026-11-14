/**
 * embeddingWorker.ts - Worker Thread for Embedding Operations
 *
 * Uses `@huggingface/transformers` v4 (`Xenova/bge-small-en-v1.5`, quantized `q8` on CPU
 * by default) inside an isolated worker thread to keep the main event loop responsive.
 */

import { parentPort } from 'worker_threads';
import { DEFAULT_EMBEDDING_MODEL } from '../../shared/contracts';
import { suppressSqliteExperimentalWarning } from '../../shared/utils/processWarnings';
import {
  loadFeatureExtractionPipeline,
  TransformersDevice,
  TransformersDtype,
} from '../models/transformersLoader';

suppressSqliteExperimentalWarning();

// Type for active feature extraction pipeline
let extractor:
  | ((input: string, options?: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>)
  | null = null;

let activeModelName = DEFAULT_EMBEDDING_MODEL;
let activeDtype: TransformersDtype = 'q8';
const DIMENSIONS = 384;

/**
 * Initialize the embedding model (`q8` quantized ONNX on CPU by default).
 */
async function initializeModel(options?: {
  modelName?: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
}): Promise<void> {
  const requestedModel = options?.modelName || activeModelName;
  const requestedDtype = options?.dtype ?? activeDtype;
  const requestedDevice = options?.device ?? 'cpu';

  if (extractor && requestedModel === activeModelName && requestedDtype === activeDtype) {
    parentPort?.postMessage({ type: 'initialized' });
    return;
  }

  try {
    extractor = await loadFeatureExtractionPipeline({
      modelName: requestedModel,
      dtype: requestedDtype,
      device: requestedDevice,
    });
    activeModelName = requestedModel;
    activeDtype = requestedDtype;

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
  if (!extractor) {
    throw new Error('Embedding extractor is not initialized');
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
    modelName?: string;
    dtype?: TransformersDtype;
    device?: TransformersDevice;
}) => {
    try {
        switch (message.type) {
            case 'init':
                await initializeModel({
                    modelName: message.modelName,
                    dtype: message.dtype,
                    device: message.device,
                });
                break;

            case 'embed':
                if (!extractor) {
                    await initializeModel({
                        modelName: message.modelName,
                        dtype: message.dtype,
                        device: message.device,
                    });
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
