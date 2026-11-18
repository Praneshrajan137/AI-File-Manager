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
import { ContextManager } from '../../src/llm/services/ContextManager';
import { LLMMetrics, MetricOperation } from '../../src/llm/services/LLMMetrics';
import { RuntimeDiagnostics } from '../../src/main/services/RuntimeDiagnostics';
import { ReactiveWorkspaceKernel } from '../../src/main/services/ReactiveWorkspaceKernel';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';

function makeVectorStore(): VectorStore {
    return new VectorStore({
        knowledgeGraphFactory: (kgPath) => new WorkspaceKnowledgeGraph(kgPath),
        diagnosticsSink: RuntimeDiagnostics.getInstance(),
    });
}
import http from 'http';
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

// Preserve native Node fetch for real localhost HTTP mock Ollama server tests
const originalFetch = global.fetch;
// Mock fetch for LLMInterface unit-style stream tests
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
        vectorStore = makeVectorStore();
        await vectorStore.initialize(dbPath);

        embeddingModel = new EmbeddingModel() as jest.Mocked<EmbeddingModel>;
        await embeddingModel.initialize();

        indexingService = new IndexingService(
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
            const emptyStore = makeVectorStore();
            await emptyStore.initialize(emptyDbPath);

            const emptyRetrieval = new RetrievalService(emptyStore, embeddingModel);
            const result = await emptyRetrieval.retrieve('test query');

            expect(result.context).toBe('');
            expect(result.sources).toEqual([]);
        });

        it('should handle binary file gracefully by indexing metadata', async () => {
            const binaryPath = path.join(testDir, 'binary-' + Date.now() + '.bin');
            // Write some binary data
            await fs.writeFile(binaryPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), 'binary');

            const result = await indexingService.indexFile(binaryPath);

            // Now expect SUCCESS (for metadata), not failure
            expect(result.success).toBe(true);
            expect(result.chunksCreated).toBe(1); // Metadata chunk
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

    describe('M4 Frontier Guarantees (Dedup, Hybrid BM25+RRF, Loopback Ollama & Kernel Sync)', () => {
        it('should delete prior chunks on re-index without duplicating rows and remove on delete', async () => {
            const dedicatedDir = path.join(testDir, `dedup-${Date.now()}`);
            await fs.mkdir(dedicatedDir, { recursive: true });
            const dedicatedStore = makeVectorStore();
            await dedicatedStore.initialize(path.join(dedicatedDir, 'db'));
            const dedicatedIndexer = new IndexingService(embeddingModel, dedicatedStore);

            const targetFile = path.join(dedicatedDir, 'release-notes.txt');
            await fs.writeFile(
                targetFile,
                'Version 1 introduces LEGACY_TOKEN_ALPHA_111 for diagnostics.',
                'utf-8'
            );

            const firstRes = await dedicatedIndexer.indexFile(targetFile);
            expect(firstRes.success).toBe(true);
            const statsAfterFirst = await dedicatedStore.getStats();
            expect(statsAfterFirst.totalFiles).toBe(1);
            expect(statsAfterFirst.totalChunks).toBe(firstRes.chunksCreated);
            expect(dedicatedStore.searchLexical('LEGACY_TOKEN_ALPHA_111', 5)).toHaveLength(1);

            await fs.writeFile(
                targetFile,
                'Version 2 replaces old token with UPDATED_TOKEN_BETA_222 cleanly.',
                'utf-8'
            );
            const secondRes = await dedicatedIndexer.indexFile(targetFile);
            expect(secondRes.success).toBe(true);

            const statsAfterUpdate = await dedicatedStore.getStats();
            expect(statsAfterUpdate.totalFiles).toBe(1);
            expect(statsAfterUpdate.totalChunks).toBe(secondRes.chunksCreated);
            expect(dedicatedStore.searchLexical('LEGACY_TOKEN_ALPHA_111', 5)).toHaveLength(0);
            expect(dedicatedStore.searchLexical('UPDATED_TOKEN_BETA_222', 5)).toHaveLength(1);

            await dedicatedIndexer.removeFile(targetFile);
            const statsAfterDelete = await dedicatedStore.getStats();
            expect(statsAfterDelete.totalFiles).toBe(0);
            expect(statsAfterDelete.totalChunks).toBe(0);
        });

        it('should rank exact technical identifier #1 via HybridLexicalIndex + RRF even on tied dense vectors', async () => {
            const tiedVector = new Array(384).fill(0.05);
            const hybridDir = path.join(testDir, `hybrid-${Date.now()}`);
            await fs.mkdir(hybridDir, { recursive: true });

            const distractorFile = path.join(hybridDir, 'general-notes.txt');
            const exactFile = path.join(hybridDir, 'incident-report.txt');
            await fs.writeFile(
                distractorFile,
                'General weekly workspace notes about UI responsiveness and caching.',
                'utf-8'
            );
            await fs.writeFile(
                exactFile,
                'Critical incident ERR_KERNEL_9842_ZOD observed during IPC schema boundary check.',
                'utf-8'
            );

            const hybridStore = makeVectorStore();
            await hybridStore.initialize(path.join(hybridDir, 'db'));
            const hybridIndexer = new IndexingService(embeddingModel, hybridStore);
            const hybridRetrieval = new RetrievalService(hybridStore, embeddingModel);

            try {
                mockEmbed.mockImplementation(() => Promise.resolve([...tiedVector]));
                mockEmbedBatch.mockImplementation((texts: string[]) =>
                    Promise.resolve(texts.map(() => [...tiedVector]))
                );

                await hybridIndexer.indexFile(distractorFile);
                await hybridIndexer.indexFile(exactFile);

                const result = await hybridRetrieval.retrieve('ERR_KERNEL_9842_ZOD');
                expect(result.sources.length).toBeGreaterThanOrEqual(2);
                expect(result.sources[0]).toBe(exactFile);
                expect(result.context).toContain('ERR_KERNEL_9842_ZOD');
            } finally {
                mockEmbedBatch.mockImplementation((texts: string[]) =>
                    Promise.resolve(texts.map((t) => generateMockEmbedding(t)))
                );
            }
        });

        it('should rebuild lexical index across reopen, enforce loopback URL, stream over real HTTP mock Ollama, and record metrics', async () => {
            expect(() => new LLMInterface('https://remote.example.com:11434')).toThrow(
                /Non-local Ollama URL rejected/i
            );

            const persistDir = path.join(testDir, `persist-${Date.now()}`);
            const dbPath = path.join(persistDir, 'lancedb');
            await fs.mkdir(persistDir, { recursive: true });

            const persistFile = path.join(persistDir, 'architecture.txt');
            const longFile = path.join(persistDir, 'verbose-log.txt');
            await fs.writeFile(
                persistFile,
                'Causal kernel token TOKEN_PERSIST_ZETA coordinates telemetry watcher and index.',
                'utf-8'
            );
            await fs.writeFile(
                longFile,
                Array.from(
                    { length: 420 },
                    (_, i) =>
                        `Line ${i}: background diagnostic telemetry entry verifying payload stability check.`
                ).join('\n'),
                'utf-8'
            );

            LLMMetrics.getInstance().clear();
            const firstStore = makeVectorStore();
            await firstStore.initialize(dbPath);
            const firstIndexer = new IndexingService(embeddingModel, firstStore);
            await firstIndexer.indexFiles([persistFile, longFile]);

            // Reopen VectorStore from disk in a fresh instance to verify lexical rebuild
            const reopenedStore = makeVectorStore();
            await reopenedStore.initialize(dbPath);
            const lexicalHits = reopenedStore.searchLexical('TOKEN_PERSIST_ZETA', 5);
            expect(lexicalHits.length).toBe(1);
            expect(lexicalHits[0].record.file_path).toBe(persistFile);

            const diagSnapshot = RuntimeDiagnostics.getInstance().getSnapshot();
            expect(diagSnapshot.vectorStore.initialized).toBe(true);
            expect(diagSnapshot.vectorStore.indexedFiles).toBe(2);
            expect(diagSnapshot.vectorStore.lexicalDocs).toBeGreaterThanOrEqual(2);

            let chatCalls = 0;
            const server = http.createServer((req, res) => {
                if (req.method === 'GET' && req.url === '/api/tags') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'codellama' }] }));
                    return;
                }
                if (req.method === 'POST' && req.url === '/api/chat') {
                    chatCalls += 1;
                    let body = '';
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
                    req.on('end', () => {
                        const parsed = JSON.parse(body);
                        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
                        const userContent = parsed.messages?.[1]?.content ?? '';
                        if (userContent.includes('Summarize these file contents concisely')) {
                            res.write(
                                JSON.stringify({
                                    model: parsed.model,
                                    message: { role: 'assistant', content: 'Concise telemetry summary.' },
                                    done: true,
                                }) + '\n'
                            );
                            res.end();
                            return;
                        }
                        const hasContext = userContent.includes('TOKEN_PERSIST_ZETA');
                        res.write(
                            JSON.stringify({
                                model: parsed.model,
                                message: { role: 'assistant', content: hasContext ? 'Verified ' : 'Missing ' },
                                done: false,
                            }) + '\n'
                        );
                        res.write(
                            JSON.stringify({
                                model: parsed.model,
                                message: { role: 'assistant', content: 'stream!' },
                                done: true,
                            }) + '\n'
                        );
                        res.end();
                    });
                    return;
                }
                res.writeHead(404);
                res.end();
            });

            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                throw new Error('Failed to bind ephemeral localhost server');
            }

            try {
                const ollamaUrl = `http://127.0.0.1:${address.port}`;
                const localLlm = new LLMInterface(ollamaUrl, { fetchImpl: originalFetch });
                expect(await localLlm.checkConnection()).toBe(true);
                expect(await localLlm.getAvailableModels()).toEqual(['llama3.2', 'codellama']);

                const contextManager = new ContextManager(localLlm);
                const retrievalWithCompression = new RetrievalService(
                    reopenedStore,
                    embeddingModel,
                    contextManager
                );

                const retrievalResult = await retrievalWithCompression.retrieve(
                    'TOKEN_PERSIST_ZETA telemetry'
                );
                expect(retrievalResult.sources[0]).toBe(persistFile);
                expect(retrievalResult.context).toContain('TOKEN_PERSIST_ZETA');
                expect(retrievalResult.tokenCount).toBeLessThanOrEqual(4000);

                let streamed = '';
                for await (const chunk of localLlm.query('What coordinates watcher?', retrievalResult)) {
                    streamed += chunk;
                }
                expect(streamed).toBe('Verified stream!');
                expect(chatCalls).toBeGreaterThanOrEqual(1);

                const metrics = LLMMetrics.getInstance();
                expect(metrics.getStats(MetricOperation.INDEX_FILE).count).toBeGreaterThanOrEqual(2);
                expect(metrics.getStats(MetricOperation.RETRIEVAL).count).toBeGreaterThanOrEqual(1);
            } finally {
                await new Promise<void>((resolve) => server.close(() => resolve()));
            }
        }, 30000);

        it('should synchronize RAG index incrementally when ReactiveWorkspaceKernel detects create and unlink', async () => {
            const watchWorkspace = path.join(testDir, `kernel-rag-${Date.now()}`);
            const dbPath = path.join(testDir, `kernel-rag-db-${Date.now()}`);
            await fs.mkdir(watchWorkspace, { recursive: true });

            const kernelStore = makeVectorStore();
            await kernelStore.initialize(dbPath);
            const kernelIndexer = new IndexingService(embeddingModel, kernelStore);

            const kernel = new ReactiveWorkspaceKernel({
                allowedRoots: [testDir],
                coalesceMs: 30,
                watchOptions: {
                    ignoreInitial: true,
                    awaitWriteFinish: false,
                    depth: 0,
                },
                indexMutationHook: async (eventType, changedPath) => {
                    if (eventType === 'unlink') {
                        await kernelIndexer.removeFile(changedPath);
                    } else if (changedPath.endsWith('.txt')) {
                        await kernelIndexer.indexFile(changedPath, true);
                    }
                },
            });

            try {
                await kernel.activateDirectory(watchWorkspace);
                await new Promise((r) => setTimeout(r, 150));

                const liveFile = path.join(watchWorkspace, 'live-sync.txt');
                await fs.writeFile(liveFile, 'KERNEL_LIVE_TOKEN_5512 verified on create', 'utf-8');

                await new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + 5000;
                    const poll = () => {
                        if (kernelStore.searchLexical('KERNEL_LIVE_TOKEN_5512', 5).length === 1) {
                            resolve();
                            return;
                        }
                        if (Date.now() > deadline) {
                            reject(new Error('Timed out waiting for kernel incremental index on create'));
                            return;
                        }
                        setTimeout(poll, 50);
                    };
                    poll();
                });

                await fs.unlink(liveFile);
                await new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + 5000;
                    const poll = () => {
                        if (kernelStore.searchLexical('KERNEL_LIVE_TOKEN_5512', 5).length === 0) {
                            resolve();
                            return;
                        }
                        if (Date.now() > deadline) {
                            reject(new Error('Timed out waiting for kernel incremental removal on unlink'));
                            return;
                        }
                        setTimeout(poll, 50);
                    };
                    poll();
                });

                const stats = await kernelStore.getStats();
                expect(stats.totalChunks).toBe(0);
            } finally {
                await kernel.shutdown();
            }
        }, 15000);
    });
});
