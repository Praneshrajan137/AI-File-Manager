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
  CrossEncoderRerankerFn,
  DEFAULT_RERANKER_MODEL,
  detectSupportedTransformersDevices,
  loadCrossEncoderReranker,
  loadFeatureExtractionPipeline,
  ResolvedExecutionDevice,
  TransformersDevice,
  TransformersDtype,
} from '../models/transformersLoader';

suppressSqliteExperimentalWarning();

// Type for active feature extraction & cross-encoder reranker pipelines
let extractor:
  | ((input: string, options?: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>)
  | null = null;
let reranker: CrossEncoderRerankerFn | null = null;

let activeModelName = DEFAULT_EMBEDDING_MODEL;
let activeRerankerModel = DEFAULT_RERANKER_MODEL;
let activeDtype: TransformersDtype = 'q8';
let activeDevice: ResolvedExecutionDevice = 'cpu';
let requestedDevicePreference: TransformersDevice = 'auto';
let activeAllowRemoteModels: boolean | undefined;
let activeCacheDir: string | undefined;
const DIMENSIONS = 384;

/**
 * Initialize the embedding model (probing hardware EPs down to quantized `q8` on CPU).
 */
async function initializeModel(options?: {
  modelName?: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
  rerankerModel?: string;
  allowRemoteModels?: boolean;
  cacheDir?: string;
}): Promise<void> {
  const requestedModel = options?.modelName || activeModelName;
  const requestedDtype = options?.dtype ?? activeDtype;
  const requestedDevice = options?.device ?? requestedDevicePreference;
  const requestedAllowRemoteModels =
    options?.allowRemoteModels !== undefined ? options.allowRemoteModels : activeAllowRemoteModels;
  const requestedCacheDir = options?.cacheDir || activeCacheDir;
  if (options?.rerankerModel) {
    activeRerankerModel = options.rerankerModel;
  }

  if (
    extractor &&
    requestedModel === activeModelName &&
    requestedDtype === activeDtype &&
    requestedDevice === requestedDevicePreference &&
    requestedAllowRemoteModels === activeAllowRemoteModels &&
    requestedCacheDir === activeCacheDir
  ) {
    const supportedDevices = await detectSupportedTransformersDevices();
    parentPort?.postMessage({
      type: 'initialized',
      device: activeDevice,
      dtype: activeDtype,
      supportedDevices,
    });
    return;
  }

  try {
    let resolvedInfo: {
      device: ResolvedExecutionDevice;
      dtype: TransformersDtype;
      fallbackReason?: string;
    } = {
      device: 'cpu',
      dtype: requestedDtype,
    };

    extractor = await loadFeatureExtractionPipeline({
      modelName: requestedModel,
      dtype: requestedDtype,
      device: requestedDevice,
      allowRemoteModels: requestedAllowRemoteModels,
      cacheDir: requestedCacheDir,
      onResolved: (info) => {
        resolvedInfo = info;
      },
    });
    activeModelName = requestedModel;
    activeDtype = resolvedInfo.dtype;
    activeDevice = resolvedInfo.device;
    requestedDevicePreference = requestedDevice;
    activeAllowRemoteModels = requestedAllowRemoteModels;
    activeCacheDir = requestedCacheDir;
    const supportedDevices = await detectSupportedTransformersDevices();

    parentPort?.postMessage({
      type: 'initialized',
      device: activeDevice,
      dtype: activeDtype,
      supportedDevices,
      fallbackReason: resolvedInfo.fallbackReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort?.postMessage({ type: 'error', id: -1, message: `Model init failed: ${message}` });
  }
}

async function ensureRerankerLoaded(
  modelName?: string,
  allowRemoteModels?: boolean,
  cacheDir?: string
): Promise<CrossEncoderRerankerFn> {
  const targetModel = modelName || activeRerankerModel || DEFAULT_RERANKER_MODEL;
  const effectiveAllowRemoteModels =
    allowRemoteModels !== undefined ? allowRemoteModels : activeAllowRemoteModels;
  const effectiveCacheDir = cacheDir || activeCacheDir;
  if (
    reranker &&
    targetModel === activeRerankerModel &&
    effectiveAllowRemoteModels === activeAllowRemoteModels &&
    effectiveCacheDir === activeCacheDir
  ) {
    return reranker;
  }
  reranker = await loadCrossEncoderReranker({
    modelName: targetModel,
    dtype: activeDtype,
    device: activeDevice,
    allowRemoteModels: effectiveAllowRemoteModels,
    cacheDir: effectiveCacheDir,
  });
  activeRerankerModel = targetModel;
  activeAllowRemoteModels = effectiveAllowRemoteModels;
  activeCacheDir = effectiveCacheDir;
  return reranker;
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
const WORKER_MICRO_BATCH_SIZE = 8;

async function embedBatch(
    id: number,
    texts: string[]
): Promise<number[][]> {
    const total = texts.length;
    if (total === 0) {
        return [];
    }

    const embeddings = new Array<number[]>(total);
    const nonEmptyIndices: number[] = [];
    const nonEmptyTexts: string[] = [];

    for (let i = 0; i < total; i++) {
        const text = texts[i];
        if (!text || text.trim() === '') {
            embeddings[i] = new Array(DIMENSIONS).fill(0);
        } else {
            nonEmptyIndices.push(i);
            nonEmptyTexts.push(text);
        }
    }

    if (nonEmptyTexts.length === 0) {
        parentPort?.postMessage({ type: 'progress', id, current: total, total });
        return embeddings;
    }

    if (!extractor) {
        throw new Error('Embedding extractor is not initialized');
    }

    let processedNonEmpty = 0;
    for (let start = 0; start < nonEmptyTexts.length; start += WORKER_MICRO_BATCH_SIZE) {
        const sliceTexts = nonEmptyTexts.slice(start, start + WORKER_MICRO_BATCH_SIZE);
        const sliceIndices = nonEmptyIndices.slice(start, start + WORKER_MICRO_BATCH_SIZE);
        let handledBatched = false;

        if (sliceTexts.length > 1) {
            const output = await extractor(sliceTexts as unknown as string, {
                pooling: 'mean',
                normalize: true,
            });
            const dims = (output as { dims?: number[] }).dims;
            const rawData = output?.data as Float32Array | undefined;
            if (Array.isArray(dims) && dims.length >= 2 && dims[0] === sliceTexts.length && rawData) {
                const dim = dims[1] > 0 ? dims[1] : DIMENSIONS;
                for (let k = 0; k < sliceTexts.length; k++) {
                    embeddings[sliceIndices[k]] = Array.from(rawData.subarray(k * dim, (k + 1) * dim));
                }
                handledBatched = true;
            }
        }

        if (!handledBatched) {
            for (let k = 0; k < sliceTexts.length; k++) {
                embeddings[sliceIndices[k]] = await embedText(sliceTexts[k]);
            }
        }

        processedNonEmpty += sliceTexts.length;
        embeddingCount += sliceTexts.length;

        const currentProgress =
            start + WORKER_MICRO_BATCH_SIZE >= nonEmptyTexts.length ? total : processedNonEmpty;
        parentPort?.postMessage({
            type: 'progress',
            id,
            current: currentProgress,
            total,
        });

        if (embeddingCount % GC_THRESHOLD < sliceTexts.length && typeof global.gc === 'function') {
            global.gc();
        }

        await new Promise((resolve) => setImmediate(resolve));
    }

    return embeddings;
}

/**
 * Handle incoming messages from main thread.
 */
parentPort?.on('message', async (message: {
    type: 'init' | 'embed' | 'rerank' | 'terminate';
    id?: number;
    texts?: string[];
    query?: string;
    passages?: string[];
    modelName?: string;
    rerankerModel?: string;
    dtype?: TransformersDtype;
    device?: TransformersDevice;
    allowRemoteModels?: boolean;
    cacheDir?: string;
}) => {
    try {
        switch (message.type) {
            case 'init':
                await initializeModel({
                    modelName: message.modelName,
                    dtype: message.dtype,
                    device: message.device,
                    rerankerModel: message.rerankerModel,
                    allowRemoteModels: message.allowRemoteModels,
                    cacheDir: message.cacheDir,
                });
                break;

            case 'embed':
                if (!extractor) {
                    await initializeModel({
                        modelName: message.modelName,
                        dtype: message.dtype,
                        device: message.device,
                        rerankerModel: message.rerankerModel,
                        allowRemoteModels: message.allowRemoteModels,
                        cacheDir: message.cacheDir,
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

            case 'rerank':
                if (message.query !== undefined && message.passages && message.id !== undefined) {
                    const model = await ensureRerankerLoaded(
                        message.rerankerModel,
                        message.allowRemoteModels,
                        message.cacheDir
                    );
                    const scores = await model(message.query, message.passages);
                    parentPort?.postMessage({
                        type: 'rerankResult',
                        id: message.id,
                        scores,
                    });
                }
                break;

            case 'terminate':
                // Cleanup and exit
                extractor = null;
                reranker = null;
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
