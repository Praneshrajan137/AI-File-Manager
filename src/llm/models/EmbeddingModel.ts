/**
 * EmbeddingModel - Local Text-to-Vector Conversion
 * 
 * Uses @xenova/transformers with all-MiniLM-L6-v2 model.
 * Runs entirely locally - no API calls (privacy-first).
 * 
 * Model specs:
 * - Dimensions: 384
 * - Size: ~100MB (cached after first download)
 * - Speed: ~20ms per embedding on modern CPU
 * 
 * @implements IEmbeddingModel
 */
// Dynamic import required for @xenova/transformers (ESM-only module)
// We use Function constructor to prevent webpack from transforming the import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transformersModule: any = null;

// Helper to dynamically import ESM modules without webpack transformation
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('modulePath', 'return import(modulePath)');

import { IEmbeddingModel, Embedding } from '../../shared/contracts';

// Type for the feature extraction pipeline
type FeatureExtractionPipeline = any; // Dynamic import loses type inference

export class EmbeddingModel implements IEmbeddingModel {
    private extractor: FeatureExtractionPipeline | null = null;
    private readonly dimensions = 384;
    private readonly modelName = 'Xenova/all-MiniLM-L6-v2';

    /** Testing hook: allows injecting a mock pipeline for tests */
    private static mockPipeline: FeatureExtractionPipeline | null = null;

    /**
     * Set a mock pipeline for testing (bypasses ESM dynamic import).
     * @internal Only for testing purposes
     */
    static _setMockPipeline(pipeline: FeatureExtractionPipeline | null): void {
        EmbeddingModel.mockPipeline = pipeline;
    }

    /**
     * Initialize the embedding model.
     * 
     * Downloads model on first run (~100MB, cached thereafter).
     * Must be called before first use.
     * 
     * @throws Error if initialization fails
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
            // Dynamic import for ESM-only @xenova/transformers
            // Using dynamicImport helper to avoid webpack transformation
            if (!transformersModule) {
                transformersModule = await dynamicImport('@xenova/transformers');
                // Configure transformers.js for Node.js environment
                transformersModule.env.useBrowserCache = false;
            }

            // Load feature-extraction pipeline
            this.extractor = await transformersModule.pipeline('feature-extraction', this.modelName, {
                // Progress callback can be added for UI feedback
                progress_callback: undefined,
            });
        } catch (error) {
            throw new Error(`Failed to initialize embedding model: ${error instanceof Error ? error.message : String(error)}`);
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

            // Longer yield between batches
            await new Promise(resolve => setTimeout(resolve, 50));
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
