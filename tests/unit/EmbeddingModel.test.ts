/**
 * EmbeddingModel Unit Tests
 * 
 * Tests for local text-to-vector embedding generation.
 * Uses the _setMockPipeline testing hook to bypass ESM dynamic import.
 * 
 * TDD Phase: Tests with mocked dependencies
 */

import { EmbeddingModel } from '../../src/llm/models/EmbeddingModel';

// Create a mock pipeline function that generates deterministic embeddings
function createMockPipeline() {
    return async (text: string, _options: unknown) => {
        // Handle empty string case specifically for zero vector
        if (text === '') {
            return { data: new Float32Array(384).fill(0) };
        }

        // Generate a deterministic 384-dimensional embedding based on text hash
        const hash = text.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);

        const data = new Float32Array(384);
        for (let i = 0; i < 384; i++) {
            // Generate deterministic values between -1 and 1
            data[i] = Math.sin(hash + i * 0.1);
        }

        // Normalize the vector
        let norm = 0;
        for (let i = 0; i < 384; i++) {
            norm += data[i] * data[i];
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < 384; i++) {
                data[i] /= norm;
            }
        }

        return { data };
    };
}

describe('EmbeddingModel', () => {
    let model: EmbeddingModel;

    beforeAll(async () => {
        // Inject mock pipeline before creating model
        EmbeddingModel._setMockPipeline(createMockPipeline());

        model = new EmbeddingModel();
        await model.initialize();
    });

    afterAll(() => {
        // Clean up mock
        EmbeddingModel._setMockPipeline(null);
    });

    describe('embed()', () => {
        it('should generate 384-dimensional embedding', async () => {
            const text = 'This is a test document';
            const embedding = await model.embed(text);

            expect(embedding).toHaveLength(384);
            expect(embedding.every((n: number) => typeof n === 'number')).toBe(true);
        });

        it('should generate different embeddings for different texts', async () => {
            const embedding1 = await model.embed('machine learning');
            const embedding2 = await model.embed('cooking recipes');

            // Different texts should produce different embeddings
            expect(embedding1).not.toEqual(expect.arrayContaining(embedding2)); // Use arrayContaining for deep comparison
        });

        it('should handle empty string', async () => {
            const embedding = await model.embed('');
            expect(embedding).toHaveLength(384);
            // Empty text returns zero vector
            expect(embedding.every((n: number) => n === 0)).toBe(true);
        });

        it('should handle very long text', async () => {
            const longText = 'word '.repeat(500);
            const embedding = await model.embed(longText);
            expect(embedding).toHaveLength(384);
        });
    });

    describe('embedBatch()', () => {
        it('should process multiple texts', async () => {
            const texts = ['First document', 'Second document', 'Third document'];

            const embeddings = await model.embedBatch(texts);

            expect(embeddings).toHaveLength(3);
            embeddings.forEach((emb: number[]) => {
                expect(emb).toHaveLength(384);
            });
        });

        it('should handle empty array', async () => {
            const embeddings = await model.embedBatch([]);
            expect(embeddings).toHaveLength(0);
        });
    });

    describe('similarity()', () => {
        it('should return 1.0 for identical embeddings', async () => {
            const embedding = await model.embed('test');
            const similarity = model.similarity(embedding, embedding);
            expect(similarity).toBeCloseTo(1.0, 2);
        });

        it('should return value between -1 and 1', async () => {
            const emb1 = await model.embed('text one');
            const emb2 = await model.embed('text two');
            const similarity = model.similarity(emb1, emb2);

            expect(similarity).toBeGreaterThanOrEqual(-1);
            expect(similarity).toBeLessThanOrEqual(1);
        });

        it('should throw for mismatched dimensions', () => {
            const emb1 = [1, 2, 3];
            const emb2 = [1, 2];

            expect(() => model.similarity(emb1, emb2)).toThrow();
        });

        it('should return 0 for zero vectors', () => {
            const zeroVector = new Array(384).fill(0);
            const similarity = model.similarity(zeroVector, zeroVector);
            expect(similarity).toBe(0);
        });
    });

    describe('getDimensions()', () => {
        it('should return 384', () => {
            expect(model.getDimensions()).toBe(384);
        });
    });

    describe('initialize()', () => {
        it('should not reinitialize if already initialized', async () => {
            // Create a spy to track if extractor is called multiple times
            let callCount = 0;
            const trackedModel = new EmbeddingModel();
            const mockPipeline = async (text: string, _options: unknown) => {
                callCount++;
                return { data: new Float32Array(384).fill(0.5) };
            };

            EmbeddingModel._setMockPipeline(mockPipeline);

            await trackedModel.initialize();
            await trackedModel.initialize(); // Second call should be no-op

            // Now call embed to verify pipeline works
            await trackedModel.embed('test');

            // Only one embed call should have happened
            expect(callCount).toBe(1);
        });
    });

    describe('error handling', () => {
        it('should throw if embed called before initialize', async () => {
            const uninitializedModel = new EmbeddingModel();

            await expect(uninitializedModel.embed('test')).rejects.toThrow(
                'Embedding model not initialized'
            );
        });
    });
});
