/**
 * VectorStore Unit Tests
 * 
 * Tests for LanceDB wrapper for semantic search.
 * These are integration-style tests that use the real LanceDB.
 */
import { VectorStore } from '../../src/llm/services/VectorStore';
import { TextChunk, Embedding } from '../../src/shared/contracts';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('VectorStore', () => {
    let store: VectorStore;
    let testDbPath: string;

    beforeAll(async () => {
        // Create unique temp directory for tests
        testDbPath = path.join(os.tmpdir(), `test-vectordb-${Date.now()}`);
        store = new VectorStore();
        await store.initialize(testDbPath);
    }, 30000); // 30 second timeout for initialization

    afterAll(async () => {
        // Cleanup
        try {
            await store.clear();
            await fs.rm(testDbPath, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    beforeEach(async () => {
        // Clear between tests for isolation
        await store.clear();
    });

    describe('initialize()', () => {
        it('should create database at specified path', async () => {
            const newPath = path.join(os.tmpdir(), `test-vectordb-init-${Date.now()}`);
            const newStore = new VectorStore();

            await expect(newStore.initialize(newPath)).resolves.not.toThrow();

            // Cleanup
            await fs.rm(newPath, { recursive: true, force: true });
        }, 30000);

        it('should be idempotent (can initialize twice)', async () => {
            await expect(store.initialize(testDbPath)).resolves.not.toThrow();
        });
    });

    describe('addChunks()', () => {
        it('should store chunks with embeddings', async () => {
            const chunks: TextChunk[] = [
                { text: 'First chunk', startChar: 0, endChar: 11, chunkIndex: 0 },
                { text: 'Second chunk', startChar: 11, endChar: 23, chunkIndex: 1 },
            ];

            const embeddings: Embedding[] = [
                new Array(384).fill(0.1),
                new Array(384).fill(0.2),
            ];

            await expect(
                store.addChunks(chunks, embeddings, '/test/file.txt')
            ).resolves.not.toThrow();

            // Flush pending records for batch write optimization
            await store.flushPendingRecords();

            // Verify by checking stats
            const stats = await store.getStats();
            expect(stats.totalChunks).toBe(2);
        });

        it('should throw if chunks and embeddings length mismatch', async () => {
            const chunks: TextChunk[] = [
                { text: 'chunk', startChar: 0, endChar: 5, chunkIndex: 0 },
            ];
            const embeddings: Embedding[] = [
                new Array(384).fill(0.1),
                new Array(384).fill(0.2), // Extra embedding
            ];

            await expect(
                store.addChunks(chunks, embeddings, '/test/file.txt')
            ).rejects.toThrow('mismatch');
        });
    });

    describe('search()', () => {
        beforeEach(async () => {
            // Add test data
            const chunks: TextChunk[] = [
                { text: 'Machine learning document', startChar: 0, endChar: 25, chunkIndex: 0 },
                { text: 'Cooking recipe content', startChar: 0, endChar: 22, chunkIndex: 0 },
                { text: 'Neural network tutorial', startChar: 0, endChar: 23, chunkIndex: 0 },
            ];

            // Create embeddings that simulate similarity
            // ML-related topics get similar vectors
            const embeddings: Embedding[] = [
                new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.8),  // ML
                new Array(384).fill(0).map((_, i) => Math.cos(i * 0.3) * 0.3),  // Cooking
                new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.75), // Neural
            ];

            await store.addChunks(chunks, embeddings, '/test/search.txt');
            await store.flushPendingRecords();
        });

        it('should find similar chunks', async () => {
            // Query with ML-like embedding
            const queryEmbedding = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.8);

            const results = await store.search(queryEmbedding, 3);

            expect(results.length).toBeLessThanOrEqual(3);
            expect(results.length).toBeGreaterThan(0);
        });

        it('should respect topK parameter', async () => {
            const queryEmbedding = new Array(384).fill(0.5);

            const results = await store.search(queryEmbedding, 2);

            expect(results.length).toBeLessThanOrEqual(2);
        });

        it('should return empty array if database is empty', async () => {
            await store.clear();

            const queryEmbedding = new Array(384).fill(0.5);
            const results = await store.search(queryEmbedding, 10);

            expect(results).toEqual([]);
        });
    });

    describe('deleteFile()', () => {
        it('should delete all chunks for a file', async () => {
            const chunks: TextChunk[] = [
                { text: 'chunk 1', startChar: 0, endChar: 7, chunkIndex: 0 },
                { text: 'chunk 2', startChar: 7, endChar: 14, chunkIndex: 1 },
            ];
            const embeddings: Embedding[] = [
                new Array(384).fill(0.1),
                new Array(384).fill(0.2),
            ];

            await store.addChunks(chunks, embeddings, '/test/delete-me.txt');
            await store.flushPendingRecords();

            const deletedCount = await store.deleteFile('/test/delete-me.txt');

            expect(deletedCount).toBe(2);
        });

        it('should return 0 if file not found', async () => {
            const deletedCount = await store.deleteFile('/nonexistent.txt');

            expect(deletedCount).toBe(0);
        });
    });

    describe('getStats()', () => {
        it('should return database statistics', async () => {
            // Add some data
            const chunks: TextChunk[] = [
                { text: 'test chunk', startChar: 0, endChar: 10, chunkIndex: 0 },
            ];
            const embeddings: Embedding[] = [new Array(384).fill(0.5)];

            await store.addChunks(chunks, embeddings, '/test/stats.txt');
            await store.flushPendingRecords();

            const stats = await store.getStats();

            expect(stats).toHaveProperty('totalFiles');
            expect(stats).toHaveProperty('totalChunks');
            expect(stats).toHaveProperty('indexSize');
            expect(stats.totalChunks).toBe(1);
            expect(stats.totalFiles).toBe(1);
        });

        it('should return zeros for empty database', async () => {
            const stats = await store.getStats();

            expect(stats.totalChunks).toBe(0);
            expect(stats.totalFiles).toBe(0);
        });
    });

    describe('clear()', () => {
        it('should clear entire database', async () => {
            const chunks: TextChunk[] = [
                { text: 'test', startChar: 0, endChar: 4, chunkIndex: 0 },
            ];
            const embeddings: Embedding[] = [new Array(384).fill(0.5)];

            await store.addChunks(chunks, embeddings, '/test/clear-test.txt');
            await store.flushPendingRecords();

            const result = await store.clear();

            expect(result.success).toBe(true);

            const stats = await store.getStats();
            expect(stats.totalChunks).toBe(0);
        });
    });
});
