/**
 * EmbeddingModel - Local Text-to-Vector Conversion
 *
 * Uses `@huggingface/transformers` v4 with quantized INT8 (`q8`) CPU execution.
 * Defaults to `Xenova/bge-small-en-v1.5` (384 dimensions, 512-token context)
 * with optional fallback to `Xenova/all-MiniLM-L6-v2` (384 dimensions, 256 tokens).
 *
 * @implements IEmbeddingModel
 */
import {
  DEFAULT_EMBEDDING_MODEL,
  Embedding,
  IEmbeddingModel,
} from '../../shared/contracts';
import {
  loadFeatureExtractionPipeline,
  TransformersDevice,
  TransformersDtype,
} from './transformersLoader';
import { resolveDefaultModelCacheDir } from '../../shared/config/appPaths';

// Type for the feature extraction pipeline
type FeatureExtractionPipeline = (
  text: string,
  options?: Record<string, unknown>
) => Promise<{ data: ArrayLike<number> }>;

export interface EmbeddingModelOptions {
  modelName?: string;
  dtype?: TransformersDtype;
  device?: TransformersDevice;
  dimensions?: number;
  allowRemoteModels?: boolean;
  cacheDir?: string;
}

export class EmbeddingModel implements IEmbeddingModel {
  private extractor: FeatureExtractionPipeline | null = null;
  private readonly dimensions: number;
  private readonly modelName: string;
  private readonly dtype: TransformersDtype;
  private readonly device: TransformersDevice;
  private readonly allowRemoteModels: boolean | undefined;
  private readonly cacheDir: string;

  /** Testing hook: allows injecting a mock pipeline for tests */
  private static mockPipeline: FeatureExtractionPipeline | null = null;

  constructor(options: EmbeddingModelOptions = {}) {
    this.modelName = options.modelName || DEFAULT_EMBEDDING_MODEL;
    this.dtype = options.dtype ?? 'q8';
    this.device = options.device ?? 'cpu';
    this.dimensions = options.dimensions ?? 384;
    this.allowRemoteModels = options.allowRemoteModels;
    this.cacheDir = options.cacheDir || resolveDefaultModelCacheDir();
  }

  /**
   * Set a mock pipeline for testing (bypasses transformers runtime loading).
   * @internal Only for testing purposes
   */
  static _setMockPipeline(pipeline: FeatureExtractionPipeline | null): void {
    EmbeddingModel.mockPipeline = pipeline;
  }

  getModelName(): string {
    return this.modelName;
  }

  getMaxContextTokens(): number {
    return this.modelName.toLowerCase().includes('minilm') ? 256 : 512;
  }

  /**
   * Initialize the embedding model.
   * Downloads quantized ONNX weights on first run (~33-45MB, cached locally thereafter).
   */
  async initialize(): Promise<void> {
    if (this.extractor) {
      return; // Already initialized
    }

    // Check for test mock first
    if (EmbeddingModel.mockPipeline) {
      this.extractor = EmbeddingModel.mockPipeline;
      return;
    }

    try {
      this.extractor = (await loadFeatureExtractionPipeline({
        modelName: this.modelName,
        dtype: this.dtype,
        device: this.device,
        allowRemoteModels: this.allowRemoteModels,
        cacheDir: this.cacheDir,
      })) as unknown as FeatureExtractionPipeline;
    } catch (error) {
      throw new Error(
        `Failed to initialize embedding model: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

    /**
     * Generate embedding for single text.
     * 
     * @param text - Input text to embed
     * @returns 384-dimensional embedding vector
     * 
     * @throws Error if model not initialized
     */
    async embed(text: string): Promise<Embedding> {
        this.ensureInitialized();

        // Handle empty text
        if (!text || text.trim() === '') {
            return new Array(this.dimensions).fill(0);
        }

        try {
            // Generate embedding with mean pooling and normalization
            const output = await this.extractor!(text, {
                pooling: 'mean',
                normalize: true,
            });

            // Extract array from tensor - output.data is a TypedArray
            const embedding = Array.from(output.data as Float32Array) as Embedding;

            // Verify dimensions
            if (embedding.length !== this.dimensions) {
                throw new Error(
                    `Unexpected embedding dimension: ${embedding.length} (expected ${this.dimensions})`
                );
            }

            return embedding;
        } catch (error) {
            throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Generate embeddings for multiple texts (batched).
     * 
     * Optimized for responsiveness:
     * - Sequential processing to prevent CPU overload
     * - Smaller batch sizes with yields between batches
     * - Micro-yields between individual embeddings
     * 
     * @param texts - Array of input texts
     * @returns Array of embedding vectors
     */
    async embedBatch(texts: string[]): Promise<Embedding[]> {
        this.ensureInitialized();

        if (texts.length === 0) {
            return [];
        }

        // Process sequentially with smaller batches for better responsiveness
        const BATCH_SIZE = 4;
        const embeddings: Embedding[] = [];

        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);

            // Process batch sequentially (NOT parallel) to reduce CPU contention
            for (const text of batch) {
                const embedding = await this.embed(text);
                embeddings.push(embedding);

                // Micro-yield between embeddings
                await new Promise(resolve => setImmediate(resolve));
            }

            // Cooperative event-loop yield between batches without artificial wall-clock delay
            await new Promise(resolve => setImmediate(resolve));
        }

        return embeddings;
    }

    /**
     * Get embedding dimensionality.
     * 
     * @returns 384 (all-MiniLM-L6-v2 standard)
     */
    getDimensions(): number {
        return this.dimensions;
    }

    /**
     * Calculate cosine similarity between embeddings.
     * 
     * Formula: similarity = (A · B) / (||A|| * ||B||)
     * 
     * @param a - First embedding
     * @param b - Second embedding
     * @returns Similarity score (-1 to 1, where 1 = identical)
     * 
     * @throws Error if dimensions don't match
     */
    similarity(a: Embedding, b: Embedding): number {
        if (a.length !== b.length) {
            throw new Error(
                `Embedding dimensions don't match: ${a.length} vs ${b.length}`
            );
        }

        // Calculate dot product and norms
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        // Avoid division by zero
        if (normA === 0 || normB === 0) {
            return 0;
        }

        // Cosine similarity (ranges from -1 to 1)
        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

        // Clamp to handle floating point errors
        return Math.max(-1, Math.min(1, similarity));
    }

    /**
     * Ensure model is initialized before use.
     * 
     * @throws Error if not initialized
     */
    private ensureInitialized(): void {
        if (!this.extractor) {
            throw new Error(
                'Embedding model not initialized. Call initialize() first.'
            );
        }
    }
}
