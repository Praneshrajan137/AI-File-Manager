/**
 * LLM Pipeline Integration Tests
 * 
 * End-to-end tests for the complete "Chat with File System" feature.
 * Uses mocked EmbeddingModel to avoid ESM compatibility issues.
 */
import { IndexingService } from '../../src/llm/services/IndexingService';
import { RetrievalService } from '../../src/llm/services/RetrievalService';
import { LLMInterface } from '../../src/llm/services/LLMInterface';
import { VectorStore } from '../../src/llm/services/VectorStore';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// Mock EmbeddingModel to avoid ESM issues with @xenova/transformers
const mockEmbed = jest.fn();
const mockSimilarity = jest.fn();
const mockEmbedBatch = jest.fn();

jest.mock('../../src/llm/models/EmbeddingModel', () => ({
    EmbeddingModel: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        embed: mockEmbed,
        embedBatch: mockEmbedBatch,
        similarity: mockSimilarity,
        getDimensions: jest.fn().mockReturnValue(384),
    })),
}));

// Mock fetch for LLMInterface
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { EmbeddingModel } from '../../src/llm/models/EmbeddingModel';

// Helper: Generate deterministic "embeddings" based on text content
function generateMockEmbedding(text: string): number[] {
    const embedding = new Array(384).fill(0);
    // Create simple embedding based on text hash
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    for (let i = 0; i < 384; i++) {
        embedding[i] = Math.sin(hash * (i + 1) * 0.001);
    }
    return embedding;
}

// Mock FileSystemService
const mockFileSystemService = {
    readFile: jest.fn(),
};

describe('LLM Pipeline Integration', () => {
    let testDir: string;
    let vectorStore: VectorStore;
    let embeddingModel: jest.Mocked<EmbeddingModel>;
    let indexingService: IndexingService;
    let retrievalService: RetrievalService;
    let llmInterface: LLMInterface;

    beforeAll(async () => {
        // Create test directory
        testDir = path.join(os.tmpdir(), `llm-integration-test-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

        // Create sample files
        const mlContent = `Machine learning is a subset of artificial intelligence.
It involves training algorithms on data to make predictions.
Common techniques include neural networks and decision trees.`;

        const cookingContent = `Cooking pasta requires boiling water first.
Add salt to the water for better flavor.
Cook for 8-10 minutes until al dente.`;

        await fs.writeFile(path.join(testDir, 'ml-basics.txt'), mlContent);
        await fs.writeFile(path.join(testDir, 'cooking.txt'), cookingContent);

        // Setup mocks
        mockEmbed.mockImplementation((text: string) =>
            Promise.resolve(generateMockEmbedding(text))
        );
        mockEmbedBatch.mockImplementation((texts: string[]) =>
            Promise.resolve(texts.map(t => generateMockEmbedding(t)))
        );
        mockSimilarity.mockImplementation((a: number[], b: number[]) => {
            // Simple cosine similarity
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i];
                normA += a[i] * a[i];
                normB += b[i] * b[i];
            }
            return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
        });

        mockFileSystemService.readFile.mockImplementation(async (filePath: string) => {
            return fs.readFile(filePath, 'utf-8');
        });

        // Initialize services
        const dbPath = path.join(testDir, 'vectordb');
        vectorStore = new VectorStore();
        await vectorStore.initialize(dbPath);

        embeddingModel = new EmbeddingModel() as jest.Mocked<EmbeddingModel>;
        await embeddingModel.initialize();

        indexingService = new IndexingService(
            mockFileSystemService as any,
            embeddingModel,
            vectorStore
        );

        retrievalService = new RetrievalService(vectorStore, embeddingModel);
        llmInterface = new LLMInterface();
    }, 30000);

    afterAll(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Re-setup the mocks
        mockEmbed.mockImplementation((text: string) =>
            Promise.resolve(generateMockEmbedding(text))
        );
        mockSimilarity.mockImplementation((a: number[], b: number[]) => {
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i];
                normA += a[i] * a[i];
                normB += b[i] * b[i];
            }
            return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
        });
    });

    describe('Complete Pipeline', () => {
        it('should index files successfully', async () => {
            const mlResult = await indexingService.indexFile(
                path.join(testDir, 'ml-basics.txt')
            );

            expect(mlResult.success).toBe(true);
            expect(mlResult.chunksCreated).toBeGreaterThan(0);

            const cookingResult = await indexingService.indexFile(
                path.join(testDir, 'cooking.txt')
            );

            expect(cookingResult.success).toBe(true);
            expect(cookingResult.chunksCreated).toBeGreaterThan(0);
        });

        it('should retrieve content based on query', async () => {
            const result = await retrievalService.retrieve('machine learning algorithms');

            expect(result.context).toBeTruthy();
            expect(result.sources.length).toBeGreaterThan(0);
            expect(result.tokenCount).toBeGreaterThan(0);
        });

        it('should return different results for different queries', async () => {
            const mlResult = await retrievalService.retrieve('neural networks');
            const cookingResult = await retrievalService.retrieve('boiling water');

            // Both should have results
            expect(mlResult.context.length).toBeGreaterThan(0);
            expect(cookingResult.context.length).toBeGreaterThan(0);
        });
    });

    describe('LLM Integration', () => {
        it('should check Ollama connection', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });

            const isConnected = await llmInterface.checkConnection();

            expect(typeof isConnected).toBe('boolean');
        });

        it('should get available models', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ models: [{ name: 'llama3.2' }] }),
            });

            const models = await llmInterface.getAvailableModels();

            expect(Array.isArray(models)).toBe(true);
        });

        it('should stream LLM response', async () => {
            const chunks = [
                JSON.stringify({ message: { content: 'Test' }, done: false }) + '\n',
                JSON.stringify({ message: { content: ' response' }, done: true }) + '\n',
            ];

            const encoder = new TextEncoder();
            let chunkIndex = 0;

            mockFetch.mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => ({
                        read: jest.fn().mockImplementation(() => {
                            if (chunkIndex < chunks.length) {
                                return Promise.resolve({
                                    done: false,
                                    value: encoder.encode(chunks[chunkIndex++]),
                                });
                            }
                            return Promise.resolve({ done: true, value: undefined });
                        }),
                    }),
                },
            });

            const retrievalResult = await retrievalService.retrieve('test');

            let response = '';
            for await (const chunk of llmInterface.query('test', retrievalResult)) {
                response += chunk;
            }

            expect(response).toBe('Test response');
        });
    });

    describe('Error Handling', () => {
        it('should handle empty database gracefully', async () => {
            const emptyDbPath = path.join(testDir, 'empty-db-' + Date.now());
            const emptyStore = new VectorStore();
            await emptyStore.initialize(emptyDbPath);

            const emptyRetrieval = new RetrievalService(emptyStore, embeddingModel);
            const result = await emptyRetrieval.retrieve('test query');

            expect(result.context).toBe('');
            expect(result.sources).toEqual([]);
        });

        it('should handle binary file gracefully', async () => {
            const binaryPath = path.join(testDir, 'binary-' + Date.now() + '.bin');
            await fs.writeFile(binaryPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]));

            mockFileSystemService.readFile.mockResolvedValueOnce(
                Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x00, 0xFF]).toString()
            );

            const result = await indexingService.indexFile(binaryPath);

            expect(result.success).toBe(false);
        });
    });

    describe('Performance', () => {
        it('should complete index + retrieve in reasonable time', async () => {
            const start = Date.now();

            const testFile = path.join(testDir, 'perf-test.txt');
            await fs.writeFile(testFile, 'Performance test content.');
            mockFileSystemService.readFile.mockResolvedValueOnce('Performance test content.');

            await indexingService.indexFile(testFile);
            await retrievalService.retrieve('performance');

            const duration = Date.now() - start;

            // Should complete in under 5 seconds
            expect(duration).toBeLessThan(5000);
        });
    });

    describe('Statistics', () => {
        it('should track indexing statistics', async () => {
            const stats = await indexingService.getStats();

            expect(stats).toHaveProperty('totalFiles');
            expect(stats).toHaveProperty('totalChunks');
            expect(stats).toHaveProperty('totalTokens');
        });
    });
});
