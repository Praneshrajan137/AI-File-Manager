export type TransformersDtype = 'q8' | 'fp32';
export type TransformersDevice = 'cpu' | 'webgpu';
export const DEFAULT_RERANKER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

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
  };
  pipeline: (
    task: string,
    model: string,
    options?: {
      dtype?: TransformersDtype;
      device?: TransformersDevice;
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
        device?: TransformersDevice;
        local_files_only?: boolean;
      }
    ) => Promise<(inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>>;
  };
}

let cachedTransformers: TransformersPipelineModule | null = null;

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
 * Shared loader for Transformers.js `feature-extraction` pipelines with
 * automatic fallback to `fp32` when a Hugging Face repo lacks quantized weights.
 */
export async function loadFeatureExtractionPipeline(options: {
  modelName: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
  allowRemoteModels?: boolean;
}): Promise<FeatureExtractorFn> {
  const transformers = await loadTransformers({
    allowRemoteModels: options.allowRemoteModels,
  });
  const requestedDtype: TransformersDtype = options.dtype ?? 'q8';
  const requestedDevice: TransformersDevice = options.device ?? 'cpu';

  try {
    return await transformers.pipeline('feature-extraction', options.modelName, {
      dtype: requestedDtype,
      device: requestedDevice,
    });
  } catch (error) {
    if (requestedDtype !== 'fp32' && isMissingQuantizedFileError(error)) {
      return await transformers.pipeline('feature-extraction', options.modelName, {
        dtype: 'fp32',
        device: requestedDevice,
      });
    }
    throw error;
  }
}

/**
 * Shared loader for Transformers.js Cross-Encoder reranking (`Xenova/ms-marco-MiniLM-L-6-v2`
 * `q8` quantized ONNX by default, falling back to `fp32` on missing quantized weights).
 */
export async function loadCrossEncoderReranker(options: {
  modelName?: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
  allowRemoteModels?: boolean;
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

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelName);
  let model: (inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>;

  try {
    model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelName, {
      dtype: requestedDtype,
      device: requestedDevice,
    });
  } catch (error) {
    if (requestedDtype !== 'fp32' && isMissingQuantizedFileError(error)) {
      model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelName, {
        dtype: 'fp32',
        device: requestedDevice,
      });
    } else {
      throw error;
    }
  }

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
    const output = await model(features);
    const raw = Array.from(output.logits.data, Number);
    if (raw.length === passages.length * 2) {
      return passages.map((_, idx) => raw[idx * 2 + 1]);
    }
    return raw.slice(0, passages.length);
  };
}

/** @internal Reset cached module reference cleanly for unit tests. */
export function _resetTransformersCacheForTesting(): void {
  cachedTransformers = null;
}
