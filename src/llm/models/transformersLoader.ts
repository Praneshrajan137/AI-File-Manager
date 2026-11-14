export type TransformersDtype = 'q8' | 'fp32';
export type TransformersDevice = 'cpu' | 'webgpu';

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
  ) => Promise<(input: string | string[], options?: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>>;
}

let cachedTransformers: TransformersPipelineModule | null = null;

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
