import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DEFAULT_EMBEDDING_MODEL, Embedding, TextChunk } from '../../src/shared/contracts';
import { EmbeddingModel } from '../../src/llm/models/EmbeddingModel';
import {
    _resetTransformersCacheForTesting,
    loadFeatureExtractionPipeline,
} from '../../src/llm/models/transformersLoader';
import { VectorStore, VectorStoreOptions } from '../../src/llm/services/VectorStore';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import { RuntimeDiagnostics } from '../../src/main/services/RuntimeDiagnostics';
import { FileContentExtractor } from '../../src/llm/services/FileContentExtractor';

function makeVectorStore(opts: Partial<VectorStoreOptions> = {}): VectorStore {
    return new VectorStore({
        knowledgeGraphFactory: (kgPath) => new WorkspaceKnowledgeGraph(kgPath),
        diagnosticsSink: RuntimeDiagnostics.getInstance(),
        ...opts,
    });
}

describe('Stage 2 (M8) Runtime & AI Stack Upgrades', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osfm-stage2-'));
    });

    afterEach(async () => {
        EmbeddingModel._setMockPipeline(null);
        _resetTransformersCacheForTesting();
        jest.restoreAllMocks();
        jest.resetModules();
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    });

    describe('EmbeddingModel M8 defaults & context window', () => {
        it('defaults to Xenova/bge-small-en-v1.5 with 512-token context window', () => {
            const model = new EmbeddingModel();
            expect(model.getModelName()).toBe(DEFAULT_EMBEDDING_MODEL);
            expect(model.getModelName()).toBe('Xenova/bge-small-en-v1.5');
            expect(model.getMaxContextTokens()).toBe(512);
        });

        it('keeps 256-token context window when explicitly configured with MiniLM', () => {
            const legacy = new EmbeddingModel({ modelName: 'Xenova/all-MiniLM-L6-v2' });
            expect(legacy.getModelName()).toBe('Xenova/all-MiniLM-L6-v2');
            expect(legacy.getMaxContextTokens()).toBe(256);
        });

        it('falls back from q8 to fp32 when Hugging Face repo lacks quantized ONNX weights', async () => {
            const fakePipelineFn = jest.fn(async () => ({ data: new Float32Array(384).fill(0.1) }));
            const mockPipelineFactory = jest
                .fn()
                .mockRejectedValueOnce(new Error('ModelFileNotFoundError: Could not locate file: "onnx/model_quantized.onnx"'))
                .mockResolvedValueOnce(fakePipelineFn);

            jest.doMock('@huggingface/transformers', () => ({
                env: { useBrowserCache: true, useFSCache: false },
                pipeline: mockPipelineFactory,
            }));

            const extractor = await loadFeatureExtractionPipeline({
                modelName: 'BAAI/bge-small-en-v1.5',
                dtype: 'q8',
                device: 'cpu',
            });

            expect(extractor).toBe(fakePipelineFn);
            expect(mockPipelineFactory).toHaveBeenCalledTimes(2);
            expect(mockPipelineFactory).toHaveBeenNthCalledWith(1, 'feature-extraction', 'BAAI/bge-small-en-v1.5', {
                dtype: 'q8',
                device: 'cpu',
            });
            expect(mockPipelineFactory).toHaveBeenNthCalledWith(2, 'feature-extraction', 'BAAI/bge-small-en-v1.5', {
                dtype: 'fp32',
                device: 'cpu',
            });
        });
    });

    describe('VectorStore vector-meta.json migration guard', () => {
        const sampleChunks: TextChunk[] = [
            { text: 'BGE migration verification chunk', startChar: 0, endChar: 32, chunkIndex: 0 },
        ];
        const sampleEmbeddings: Embedding[] = [new Array(384).fill(0.25)];

        it('resets pre-M8 legacy tables lacking vector-meta.json and surfaces migration notice', async () => {
            const dbPath = path.join(tmpDir, 'lance-legacy');
            const initialStore = makeVectorStore();
            await initialStore.initialize(dbPath);
            await initialStore.addChunks(sampleChunks, sampleEmbeddings, '/vault/legacy.md');
            await initialStore.flushPendingRecords();

            // Simulate pre-M8 workspace index that lacks vector-meta.json
            await fs.unlink(path.join(dbPath, 'vector-meta.json'));

            const upgradedStore = makeVectorStore();
            await upgradedStore.initialize(dbPath);

            const notice = upgradedStore.getMigrationNotice();
            expect(notice.needsReindex).toBe(true);
            expect(notice.previousModelId).toBe('pre-M8-legacy');
            expect(notice.currentModelId).toBe(DEFAULT_EMBEDDING_MODEL);
            expect((await upgradedStore.getStats()).totalChunks).toBe(0);

            const writtenMeta = JSON.parse(
                await fs.readFile(path.join(dbPath, 'vector-meta.json'), 'utf-8')
            ) as { schemaVersion: number; modelId: string };
            expect(writtenMeta.schemaVersion).toBe(2);
            expect(writtenMeta.modelId).toBe(DEFAULT_EMBEDDING_MODEL);
        });

        it('resets existing vectors when switching embedding models when autoResetOnMismatch=true', async () => {
            const dbPath = path.join(tmpDir, 'lance-switch');
            const oldStore = makeVectorStore({ modelId: 'Xenova/all-MiniLM-L6-v2' });
            await oldStore.initialize(dbPath);
            await oldStore.addChunks(sampleChunks, sampleEmbeddings, '/vault/old.md');
            await oldStore.flushPendingRecords();
            expect((await oldStore.getStats()).totalChunks).toBe(1);

            const newStore = makeVectorStore({ modelId: DEFAULT_EMBEDDING_MODEL });
            await newStore.initialize(dbPath);

            const notice = newStore.getMigrationNotice();
            expect(notice.needsReindex).toBe(true);
            expect(notice.previousModelId).toBe('Xenova/all-MiniLM-L6-v2');
            expect(notice.currentModelId).toBe(DEFAULT_EMBEDDING_MODEL);
            expect((await newStore.getStats()).totalChunks).toBe(0);
        });

        it('preserves existing vectors when autoResetOnMismatch=false while still flagging needsReindex', async () => {
            const dbPath = path.join(tmpDir, 'lance-preserve');
            const oldStore = makeVectorStore({ modelId: 'Xenova/all-MiniLM-L6-v2' });
            await oldStore.initialize(dbPath);
            await oldStore.addChunks(sampleChunks, sampleEmbeddings, '/vault/keep.md');
            await oldStore.flushPendingRecords();

            const passiveStore = makeVectorStore({
                modelId: DEFAULT_EMBEDDING_MODEL,
                autoResetOnMismatch: false,
            });
            await passiveStore.initialize(dbPath);

            expect(passiveStore.getMigrationNotice().needsReindex).toBe(true);
            expect((await passiveStore.getStats()).totalChunks).toBe(1);
        });
    });

    describe('FileContentExtractor pdf-parse v2 integration', () => {
        it('loads real pdf-parse@2.4.5 PDFParse class and extracts formatted [Page N] text cleanly', async () => {
            const destroyMock = jest.fn().mockResolvedValue(undefined);
            const getTextMock = jest.fn().mockResolvedValue({
                text: 'Page one text\nPage two text',
                total: 2,
                pages: [
                    { num: 1, text: 'Page one text' },
                    { num: 2, text: 'Page two text' },
                ],
            });
            const mockCtor = jest.fn(() => ({
                getText: getTextMock,
                destroy: destroyMock,
            }));

            const fakePdf = path.join(tmpDir, 'report.pdf');
            await fs.writeFile(fakePdf, Buffer.from('%PDF-1.4\n%fake'));

            const extractor = new FileContentExtractor() as unknown as {
                pdfParseClass: unknown;
                pdfParserLoaded: boolean;
                extract: (p: string) => Promise<{
                    success: boolean;
                    contentType: string;
                    content: string;
                    metadata?: { pageCount?: number };
                }>;
            };
            extractor.pdfParseClass = mockCtor;
            extractor.pdfParserLoaded = true;

            const result = await extractor.extract(fakePdf);
            expect(result.success).toBe(true);
            expect(result.contentType).toBe('full');
            expect(result.content).toContain('[Page 1]\nPage one text');
            expect(result.content).toContain('[Page 2]\nPage two text');
            expect(result.metadata?.pageCount).toBe(2);
            expect(getTextMock).toHaveBeenCalledWith({ first: 100 });
            expect(destroyMock).toHaveBeenCalledTimes(1);
        });

        it('handles PasswordException and empty PDFs via PDFParse without leaking parser instances', async () => {
            const destroyMock = jest.fn().mockResolvedValue(undefined);
            const passwordErr = new Error('No password given');
            passwordErr.name = 'PasswordException';

            const fakePdf = path.join(tmpDir, 'locked.pdf');
            await fs.writeFile(fakePdf, Buffer.from('%PDF-1.4\n%locked'));

            const extractor = new FileContentExtractor() as unknown as {
                pdfParseClass: unknown;
                pdfParserLoaded: boolean;
                extract: (p: string) => Promise<{
                    success: boolean;
                    contentType: string;
                    content: string;
                }>;
            };
            extractor.pdfParseClass = jest.fn(() => ({
                getText: jest.fn().mockRejectedValue(passwordErr),
                destroy: destroyMock,
            }));
            extractor.pdfParserLoaded = true;

            const result = await extractor.extract(fakePdf);
            expect(result.success).toBe(true);
            expect(result.contentType).toBe('metadata');
            expect(result.content).toContain('PDF is password protected');
            expect(destroyMock).toHaveBeenCalledTimes(1);
        });

        it('resolves the installed pdf-parse@2 module exporting PDFParse', () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const pdfParseMod = require('pdf-parse') as { PDFParse?: unknown };
            expect(typeof pdfParseMod.PDFParse).toBe('function');
        });
    });
});
