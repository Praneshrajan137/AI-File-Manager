export type TransformersDtype = 'q8' | 'fp32';
export type TransformersDevice = 'cpu' | 'webgpu';

export type FeatureExtractorFn = (
  input: string | string[],
  options?: Record<string, unknown>
) => Promise<{ data: ArrayLike<number> }>;

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

/** @internal Reset cached module reference cleanly for unit tests. */
export function _resetTransformersCacheForTesting(): void {
  cachedTransformers = null;
}
