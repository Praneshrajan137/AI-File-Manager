export type TransformersDtype = 'q8' | 'fp32';
export type ResolvedExecutionDevice = 'cpu' | 'dml' | 'webgpu' | 'cuda' | 'gpu';
export type TransformersDevice = 'auto' | ResolvedExecutionDevice;
export const DEFAULT_RERANKER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

export interface ExecutionProviderResolution {
  device: ResolvedExecutionDevice;
  dtype: TransformersDtype;
  fallbackReason?: string;
}

export type FeatureExtractorFn = (
  input: string | string[],
  options?: Record<string, unknown>
) => Promise<{ data: ArrayLike<number> }>;

export type CrossEncoderRerankerFn = (query: string, passages: string[]) => Promise<number[]>;

export interface TransformersPipelineModule {
  env: {
    useBrowserCache: boolean;
    useFSCache?: boolean;
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
    cacheDir?: string | null;
    backends?: {
      onnx?: {
        supportedDevices?: string[];
      };
    };
  };
  backends?: {
    onnx?: {
      supportedDevices?: string[];
    };
  };
  pipeline: (
    task: string,
    model: string,
    options?: {
      dtype?: TransformersDtype;
      device?: ResolvedExecutionDevice;
      local_files_only?: boolean;
      progress_callback?: unknown;
    }
  ) => Promise<FeatureExtractorFn>;
  AutoTokenizer?: {
    from_pretrained: (
      model: string,
      options?: Record<string, unknown>
    ) => Promise<
      (
        text: string | string[],
        options?: Record<string, unknown>
      ) => Promise<Record<string, unknown>>
    >;
  };
  AutoModelForSequenceClassification?: {
    from_pretrained: (
      model: string,
      options?: {
        dtype?: TransformersDtype;
        device?: ResolvedExecutionDevice;
        local_files_only?: boolean;
      }
    ) => Promise<(inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>>;
  };
}

let cachedTransformers: TransformersPipelineModule | null = null;
let cachedResolvedDevice: ResolvedExecutionDevice | null = null;

function isMissingQuantizedFileError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    msg.includes('Could not locate file') ||
    msg.includes('ModelFileNotFoundError') ||
    msg.includes('404')
  );
}

/**
 * Loads `@huggingface/transformers` via CommonJS (`transformers.node.cjs`) and
 * configures Node-safe filesystem caching cleanly across Main, Worker, and Jest.
 */
export async function loadTransformers(options?: {
  allowRemoteModels?: boolean;
}): Promise<TransformersPipelineModule> {
  if (!cachedTransformers) {
    // Webpack externalizes `@huggingface/transformers` to Node's CommonJS entry cleanly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('@huggingface/transformers') as TransformersPipelineModule;
    if (loaded?.env) {
      loaded.env.useBrowserCache = false;
      loaded.env.useFSCache = true;
    }
    cachedTransformers = loaded;
  }

  if (options?.allowRemoteModels !== undefined && cachedTransformers?.env) {
    cachedTransformers.env.allowRemoteModels = options.allowRemoteModels;
  }

  return cachedTransformers;
}

/**
 * Detect hardware execution providers supported by `@huggingface/transformers`.
 */
export async function detectSupportedTransformersDevices(): Promise<string[]> {
  try {
    const mod = await loadTransformers();
    const list =
      mod.env?.backends?.onnx?.supportedDevices ??
      mod.backends?.onnx?.supportedDevices;
    if (Array.isArray(list) && list.length > 0) {
      return list.map(String);
    }
  } catch {
    // Fallback cleanly in minimal mock environments
  }
  return ['cpu'];
}

export function getCachedExecutionProvider(): ResolvedExecutionDevice {
  return cachedResolvedDevice ?? 'cpu';
}

export function resolveExecutionDeviceCandidates(
  requestedDevice: TransformersDevice = 'cpu',
  platform: NodeJS.Platform = process.platform,
  forceProbe: boolean = process.env.FORCE_EP_PROBE === '1'
): ResolvedExecutionDevice[] {
  if (requestedDevice !== 'auto') {
    return requestedDevice === 'cpu' ? ['cpu'] : [requestedDevice, 'cpu'];
  }

  if (cachedResolvedDevice) {
    return cachedResolvedDevice === 'cpu' ? ['cpu'] : [cachedResolvedDevice, 'cpu'];
  }

  if (process.env.NODE_ENV === 'test' && !forceProbe) {
    return ['cpu'];
  }

  const ordered: ResolvedExecutionDevice[] =
    platform === 'win32'
      ? ['dml', 'webgpu', 'cpu']
      : ['webgpu', 'cpu'];
  return ordered;
}

/**
 * Shared loader for `@huggingface/transformers` `feature-extraction` pipelines with:
 * 1) Hardware EP probing (`dml`/`webgpu` -> cached `'cpu'` fallback when `device: 'auto'`)
 * 2) Automatic fallback to `fp32` when a Hugging Face repo lacks quantized weights.
 */
export async function loadFeatureExtractionPipeline(options: {
  modelName: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
  platform?: NodeJS.Platform;
  allowRemoteModels?: boolean;
  onResolved?: (info: ExecutionProviderResolution) => void;
}): Promise<FeatureExtractorFn> {
  const transformers = await loadTransformers({
    allowRemoteModels: options.allowRemoteModels,
  });
  const requestedDtype: TransformersDtype = options.dtype ?? 'q8';
  const requestedDevice: TransformersDevice = options.device ?? 'cpu';
  const localFilesOnly = options.allowRemoteModels === false ? true : undefined;
  const candidates = resolveExecutionDeviceCandidates(requestedDevice, options.platform);

  let fallbackReason: string | undefined;
  let lastError: unknown;

  for (const candidateDevice of candidates) {
    try {
      const fn = await transformers.pipeline('feature-extraction', options.modelName, {
        dtype: requestedDtype,
        device: candidateDevice,
        ...(localFilesOnly !== undefined ? { local_files_only: localFilesOnly } : {}),
      });
      if (requestedDevice === 'auto') {
        cachedResolvedDevice = candidateDevice;
      }
      options.onResolved?.({ device: candidateDevice, dtype: requestedDtype, fallbackReason });
      return fn;
    } catch (error) {
      if (requestedDtype !== 'fp32' && isMissingQuantizedFileError(error)) {
        try {
          const fnFp32 = await transformers.pipeline('feature-extraction', options.modelName, {
            dtype: 'fp32',
            device: candidateDevice,
            ...(localFilesOnly !== undefined ? { local_files_only: localFilesOnly } : {}),
          });
          if (requestedDevice === 'auto') {
            cachedResolvedDevice = candidateDevice;
          }
          options.onResolved?.({ device: candidateDevice, dtype: 'fp32', fallbackReason });
          return fnFp32;
        } catch (fp32Error) {
          lastError = fp32Error;
          if (candidateDevice !== 'cpu') {
            fallbackReason = fp32Error instanceof Error ? fp32Error.message : String(fp32Error);
            continue;
          }
          throw fp32Error;
        }
      }

      lastError = error;
      if (candidateDevice !== 'cpu') {
        fallbackReason = error instanceof Error ? error.message : String(error);
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to load feature-extraction pipeline');
}

/**
 * Shared loader for Transformers.js Cross-Encoder reranking (`Xenova/ms-marco-MiniLM-L-6-v2`
 * `q8` quantized ONNX by default, falling back to `fp32` on missing quantized weights
 * and safely probing hardware execution providers down to CPU).
 */
export async function loadCrossEncoderReranker(options: {
  modelName?: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
  allowRemoteModels?: boolean;
  onResolved?: (info: ExecutionProviderResolution) => void;
} = {}): Promise<CrossEncoderRerankerFn> {
  const transformers = await loadTransformers({
    allowRemoteModels: options.allowRemoteModels,
  });

  if (!transformers.AutoTokenizer || !transformers.AutoModelForSequenceClassification) {
    throw new Error('Transformers module does not expose AutoTokenizer/AutoModelForSequenceClassification');
  }

  const modelName = options.modelName || DEFAULT_RERANKER_MODEL;
  const requestedDtype: TransformersDtype = options.dtype ?? 'q8';
  const requestedDevice: TransformersDevice = options.device ?? 'cpu';
  const localFilesOnly = options.allowRemoteModels === false ? true : undefined;
  const candidates = resolveExecutionDeviceCandidates(requestedDevice);

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(
    modelName,
    localFilesOnly !== undefined ? { local_files_only: localFilesOnly } : undefined
  );
  let model: ((inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>) | null = null;
  let fallbackReason: string | undefined;
  let lastError: unknown;

  for (const candidateDevice of candidates) {
    try {
      model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelName, {
        dtype: requestedDtype,
        device: candidateDevice,
        ...(localFilesOnly !== undefined ? { local_files_only: localFilesOnly } : {}),
      });
      options.onResolved?.({ device: candidateDevice, dtype: requestedDtype, fallbackReason });
      break;
    } catch (error) {
      if (requestedDtype !== 'fp32' && isMissingQuantizedFileError(error)) {
        try {
          model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelName, {
            dtype: 'fp32',
            device: candidateDevice,
            ...(localFilesOnly !== undefined ? { local_files_only: localFilesOnly } : {}),
          });
          options.onResolved?.({ device: candidateDevice, dtype: 'fp32', fallbackReason });
          break;
        } catch (fp32Error) {
          lastError = fp32Error;
          if (candidateDevice !== 'cpu') {
            fallbackReason = fp32Error instanceof Error ? fp32Error.message : String(fp32Error);
            continue;
          }
          throw fp32Error;
        }
      }

      lastError = error;
      if (candidateDevice !== 'cpu') {
        fallbackReason = error instanceof Error ? error.message : String(error);
        continue;
      }
      throw error;
    }
  }

  if (!model) {
    throw lastError instanceof Error ? lastError : new Error('Failed to load Cross-Encoder reranker');
  }

  const resolvedModel = model;
  return async (query: string, passages: string[]): Promise<number[]> => {
    if (passages.length === 0) {
      return [];
    }
    const queries = new Array<string>(passages.length).fill(query);
    const features = await tokenizer(queries, {
      text_pair: passages,
      padding: true,
      truncation: true,
    });
    const output = await resolvedModel(features);
    const raw = Array.from(output.logits.data, Number);
    if (raw.length === passages.length * 2) {
      return passages.map((_, idx) => raw[idx * 2 + 1]);
    }
    return raw.slice(0, passages.length);
  };
}

/** @internal Reset cached module reference and EP cache cleanly for unit tests. */
export function _resetTransformersCacheForTesting(): void {
  cachedTransformers = null;
  cachedResolvedDevice = null;
}
