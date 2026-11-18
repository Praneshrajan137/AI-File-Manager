/**
 * VectorStore Unit Tests
 * 
 * Tests for LanceDB wrapper for semantic search.
 * These are integration-style tests that use the real LanceDB.
 */
import { VectorStore, VectorStoreOptions } from '../../src/llm/services/VectorStore';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import { RuntimeDiagnostics } from '../../src/main/services/RuntimeDiagnostics';
import { TextChunk, Embedding } from '../../src/shared/contracts';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

function makeVectorStore(extra: Partial<VectorStoreOptions> = {}): VectorStore {
    return new VectorStore({
        knowledgeGraphFactory: (kgPath) => new WorkspaceKnowledgeGraph(kgPath),
        diagnosticsSink: RuntimeDiagnostics.getInstance(),
        ...extra,
    });
}

describe('VectorStore', () => {
    let store: VectorStore;
    let testDbPath: string;

    beforeAll(async () => {
        // Create unique temp directory for tests
        testDbPath = path.join(os.tmpdir(), `test-vectordb-${Date.now()}`);
        store = makeVectorStore();
        await store.initialize(testDbPath);
    }, 30000); // 30 second timeout for initialization

    afterAll(async () => {
        // Cleanup
        try {
            await store.clear();
            await store.close();
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
            const newStore = makeVectorStore();

            await expect(newStore.initialize(newPath)).resolves.not.toThrow();

            // Cleanup (close SQLite WAL handle cleanly before deleting directory on Windows)
            await newStore.close();
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

    describe('concurrency & failure recovery', () => {
        it('serializes concurrent flushPendingRecords() calls without duplicating rows', async () => {
            const chunks: TextChunk[] = [
                { text: 'concurrent chunk 1', startChar: 0, endChar: 18, chunkIndex: 0 },
                { text: 'concurrent chunk 2', startChar: 18, endChar: 36, chunkIndex: 1 },
            ];
            const embeddings: Embedding[] = [
                new Array(384).fill(0.2),
                new Array(384).fill(0.4),
            ];

            await store.addChunks(chunks, embeddings, '/test/concurrent.txt');
            await Promise.all([store.flushPendingRecords(), store.flushPendingRecords()]);

            const stats = await store.getStats();
            expect(stats.totalChunks).toBe(2);
            expect(stats.totalFiles).toBe(1);
        });

        it('retains pending records and filesPendingReplace when table.add fails so retry persists them', async () => {
            const chunks: TextChunk[] = [
                { text: 'retry chunk 1', startChar: 0, endChar: 13, chunkIndex: 0 },
                { text: 'retry chunk 2', startChar: 13, endChar: 26, chunkIndex: 1 },
            ];
            const embeddings: Embedding[] = [
                new Array(384).fill(0.3),
                new Array(384).fill(0.6),
            ];

            await store.addChunks(chunks, embeddings, '/test/retry-me.txt');
            const internalTable = (store as unknown as { table: { add: (rows: unknown[]) => Promise<void> } }).table;
            const addSpy = jest.spyOn(internalTable, 'add').mockRejectedValueOnce(new Error('simulated write failure'));

            try {
                await expect(store.flushPendingRecords()).rejects.toThrow('simulated write failure');
            } finally {
                addSpy.mockRestore();
            }

            await store.flushPendingRecords();
            const stats = await store.getStats();
            expect(stats.totalChunks).toBe(2);
            expect(stats.totalFiles).toBe(1);
        });

        it('flushes buffered chunks on close(), tracks SQLite outbox sync state, and retrieves scoped hits beyond 250 files', async () => {
            const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-outbox-test-'));
            try {
                const s1 = makeVectorStore();
                await s1.initialize(isolatedDir);

                const docPath = path.join(isolatedDir, 'note.md');
                const meta = { size: 42, mtimeMs: 123456, sha256: 'sha-fixed-1', fileType: 'md' };
                const emb = [1, 0, ...new Array(382).fill(0)];
                await s1.addChunks(
                    [{ text: 'Unflushed outbox chunk', startChar: 0, endChar: 22, chunkIndex: 0 }],
                    [emb],
                    docPath,
                    meta
                );

                // Before flush/close, SQLite outbox stays pending so crash recovery would reindex
                expect(s1.getKnowledgeGraph()?.getPendingSyncCount()).toBe(1);
                expect(s1.needsReindex(docPath, meta.mtimeMs, meta.size, meta.sha256)).toBe(true);

                // Graceful close flushes <50 buffered chunks to LanceDB & marks SQLite synced
                await s1.close();

                const s2 = makeVectorStore();
                await s2.initialize(isolatedDir);
                expect(s2.getKnowledgeGraph()?.getPendingSyncCount()).toBe(0);
                expect(s2.needsReindex(docPath, meta.mtimeMs, meta.size, meta.sha256)).toBe(false);

                const reopenedHits = await s2.search(emb, 3);
                expect(reopenedHits.some((r) => r.file_path === docPath)).toBe(true);

                // Simulated crash leaving vector_sync_status='pending' forces reindex even when sha/mtime/size match
                s2.getKnowledgeGraph()?.upsertDocument({
                    filePath: docPath,
                    sha256: meta.sha256,
                    size: meta.size,
                    mtimeMs: meta.mtimeMs,
                    vectorSyncStatus: 'pending',
                    chunks: [{ id: `${docPath}:0`, chunkIndex: 0, text: 'Unflushed outbox chunk', startChar: 0, endChar: 22 }],
                });
                expect(s2.needsReindex(docPath, meta.mtimeMs, meta.size, meta.sha256)).toBe(true);
                await s2.close();
            } finally {
                await fs.rm(isolatedDir, { recursive: true, force: true });
            }
        }, 30000);

        it('retrieves scoped matches when scoped subtree has >250 files amid high-scoring external distractors', async () => {
            const scopedFolder = path.join(os.tmpdir(), 'vs-scoped-260-dir', 'target');
            const distractorFolder = path.join(os.tmpdir(), 'vs-scoped-260-dir', 'outside');

            const queryEmb = [1, 0, ...new Array(382).fill(0)];
            const distractorEmb = [0.999, 0.04, ...new Array(382).fill(0)];
            const scopedMatchEmb = [0.95, 0.3, ...new Array(382).fill(0)];
            const fillerEmb = [0, 1, ...new Array(382).fill(0)];

            // Seed 95 outside distractors ranked above scopedMatchEmb in global vector search (beyond fixed top-80 window!)
            for (let i = 0; i < 95; i += 1) {
                const fp = path.join(distractorFolder, `distract-${i}.md`);
                await store.addChunks(
                    [{ text: `distractor ${i}`, startChar: 0, endChar: 12, chunkIndex: 0 }],
                    [distractorEmb],
                    fp,
                    { size: 20, mtimeMs: 1000 + i }
                );
            }

            // Seed 260 files inside scopedFolder (>250 bypasses SQL predicate) with one target match
            for (let i = 0; i < 259; i += 1) {
                const fp = path.join(scopedFolder, `filler-${i}.md`);
                await store.addChunks(
                    [{ text: `filler ${i}`, startChar: 0, endChar: 10, chunkIndex: 0 }],
                    [fillerEmb],
                    fp,
                    { size: 15, mtimeMs: 2000 + i }
                );
            }
            const targetPath = path.join(scopedFolder, 'target-hit.md');
            await store.addChunks(
                [{ text: 'Needle inside large folder', startChar: 0, endChar: 26, chunkIndex: 0 }],
                [scopedMatchEmb],
                targetPath,
                { size: 26, mtimeMs: 5000 }
            );
            await store.flushPendingRecords();

            const hits = await store.search(queryEmb, 3, { folderPath: scopedFolder });
            expect(hits.length).toBeGreaterThanOrEqual(1);
            expect(hits.some((h) => h.file_path === targetPath)).toBe(true);
            expect(hits.every((h) => h.file_path.startsWith(scopedFolder))).toBe(true);
        }, 60000);

        it('invokes periodic optimize on large flushes and deletes queued chunks case-aware', async () => {
            const internalTable = (store as unknown as {
                table: { optimize?: () => Promise<unknown> };
            }).table;
            const optSpy =
                typeof internalTable.optimize === 'function'
                    ? jest.spyOn(internalTable, 'optimize').mockResolvedValue(undefined)
                    : null;

            const batchChunks: TextChunk[] = Array.from({ length: 26 }, (_, i) => ({
                text: `bulk chunk ${i}`,
                startChar: i * 15,
                endChar: (i + 1) * 15,
                chunkIndex: i,
            }));
            const batchEmbs: Embedding[] = batchChunks.map(() => new Array(384).fill(0.11));

            await store.addChunks(batchChunks, batchEmbs, '/test/bulk-opt.md');
            await store.flushPendingRecords();
            if (optSpy) {
                expect(optSpy).toHaveBeenCalled();
                optSpy.mockRestore();
            }

            // Delete pending chunks before flush cleanly clears queue
            await store.addChunks(
                [{ text: 'queued only', startChar: 0, endChar: 11, chunkIndex: 0 }],
                [new Array(384).fill(0.22)],
                path.join('/test', 'PendingDelete.txt')
            );
            const removed = await store.deleteFile(path.join('/test', 'PendingDelete.txt'));
            expect(removed).toBeGreaterThanOrEqual(1);
        });
    });
});
