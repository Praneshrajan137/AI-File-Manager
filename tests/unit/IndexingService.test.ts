/**
 * IndexingService Unit Tests
 * 
 * Tests for file chunking and embedding generation.
 * Mocks external dependencies (FileContentExtractor, EmbeddingModel, VectorStore).
 */

// 1. Mock VectorStore
const mockAddChunks = jest.fn().mockResolvedValue(undefined);
const mockDeleteFile = jest.fn().mockResolvedValue(undefined);
const mockGetStats = jest.fn().mockResolvedValue({
    totalFiles: 10,
    totalChunks: 50,
    totalTokens: 25000,
    indexSize: 1024000,
    lastIndexed: Date.now(),
});

jest.mock('../../src/llm/services/VectorStore', () => ({
    VectorStore: jest.fn().mockImplementation(() => ({
        addChunks: mockAddChunks,
        deleteFile: mockDeleteFile,
        getStats: mockGetStats,
    })),
}));

// 2. Mock EmbeddingModel
jest.mock('../../src/llm/models/EmbeddingModel', () => ({
    EmbeddingModel: jest.fn().mockImplementation(() => ({
        embedBatch: jest.fn().mockResolvedValue([new Array(384).fill(0.1)]),
        getDimensions: jest.fn().mockReturnValue(384),
    })),
}));

// 3. Mock FileContentExtractor
const mockExtract = jest.fn();

jest.mock('../../src/llm/services/FileContentExtractor', () => ({
    FileContentExtractor: jest.fn().mockImplementation(() => ({
        extract: mockExtract
    })),
}));

import { IndexingService } from '../../src/llm/services/IndexingService';
import { EmbeddingModel } from '../../src/llm/models/EmbeddingModel';
import { VectorStore } from '../../src/llm/services/VectorStore';

// We don't import FileContentExtractor class directly since it's mocked,
// but we need to control the mock behavior via mockExtract

describe('IndexingService', () => {
    let indexer: IndexingService;
    let mockEmbedding: jest.Mocked<EmbeddingModel>;
    let mockVectorStore: jest.Mocked<VectorStore>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockEmbedding = new EmbeddingModel() as jest.Mocked<EmbeddingModel>;
        mockVectorStore = new VectorStore() as jest.Mocked<VectorStore>;

        indexer = new IndexingService(
            mockEmbedding,
            mockVectorStore
        );
    });

    describe('chunking logic', () => {
        it('should create multiple chunks for large text', async () => {
            // Mock successful text extraction
            const mockContent = 'a'.repeat(5000);
            mockExtract.mockResolvedValue({
                success: true,
                content: mockContent,
                contentType: 'full',
                fileType: 'txt'
            });

            // Mock embeddings
            mockEmbedding.embedBatch.mockResolvedValue([
                new Array(384).fill(0.1),
                new Array(384).fill(0.2),
                new Array(384).fill(0.3),
            ]);

            const result = await indexer.indexFile('/test/file.txt');

            expect(result.success).toBe(true);
            expect(result.chunksCreated).toBeGreaterThanOrEqual(2);
        });

        it('should handle file smaller than chunk size', async () => {
            mockExtract.mockResolvedValue({
                success: true,
                content: 'Short file content',
                contentType: 'full',
                fileType: 'txt'
            });
            mockEmbedding.embedBatch.mockResolvedValue([new Array(384).fill(0.1)]);

            const result = await indexer.indexFile('/test/short.txt');

            expect(result.success).toBe(true);
            expect(result.chunksCreated).toBe(1);
        });
    });

    describe('indexFile()', () => {
        it('should index file and store in vector database', async () => {
            mockExtract.mockResolvedValue({
                success: true,
                content: 'Test content',
                contentType: 'full',
                fileType: 'txt'
            });
            mockEmbedding.embedBatch.mockResolvedValue([new Array(384).fill(0.5)]);

            const result = await indexer.indexFile('/test/file.txt');

            expect(result.success).toBe(true);
            expect(result.filePath).toBe('/test/file.txt');
            expect(mockAddChunks).toHaveBeenCalled();
        });

        it('should handle extraction errors gracefully', async () => {
            // Mock extraction failure (e.g. file not found)
            mockExtract.mockResolvedValue({
                success: false,
                content: null,
                contentType: 'metadata',
                fileType: 'unknown',
                error: 'File not found'
            });

            const result = await indexer.indexFile('/test/missing.txt');

            expect(result.success).toBe(false);
            expect(result.error).toContain('File not found');
        });

        it('should handle binary/large files via metadata fallback', async () => {
            // FileContentExtractor returns metadata only for binary
            const metadataContent = 'File: image.png\nType: PNG file';
            mockExtract.mockResolvedValue({
                success: true,
                content: metadataContent,
                contentType: 'metadata',
                fileType: 'png',
                error: 'Binary content detected'
            });

            const result = await indexer.indexFile('/test/image.png');

            expect(result.success).toBe(true);
            // Should index the metadata content
            expect(mockAddChunks).toHaveBeenCalled();
            expect(result.chunksCreated).toBe(1);
        });
    });

    describe('indexFiles() batch', () => {
        it('should process multiple files', async () => {
            mockExtract.mockResolvedValue({
                success: true,
                content: 'Content',
                contentType: 'full',
                fileType: 'txt'
            });
            mockEmbedding.embedBatch.mockResolvedValue([new Array(384).fill(0.1)]);

            const results = await indexer.indexFiles([
                '/test/file1.txt',
                '/test/file2.txt',
                '/test/file3.txt',
            ]);

            expect(results).toHaveLength(3);
            expect(results.every((r) => r.success)).toBe(true);
        });

        it('should continue processing on individual file errors', async () => {
            mockExtract
                .mockResolvedValueOnce({ success: true, content: 'C1', contentType: 'full', fileType: 'txt' })
                .mockResolvedValueOnce({ success: false, content: null, contentType: 'metadata', fileType: 'txt', error: 'Failed' })
                .mockResolvedValueOnce({ success: true, content: 'C3', contentType: 'full', fileType: 'txt' });

            mockEmbedding.embedBatch.mockResolvedValue([new Array(384).fill(0.1)]);

            const results = await indexer.indexFiles([
                '/test/file1.txt',
                '/test/file2.txt', // This fails
                '/test/file3.txt',
            ]);

            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(false);
            expect(results[2].success).toBe(true);
        });
    });

    describe('removeFile()', () => {
        it('should remove file chunks from vector store', async () => {
            const result = await indexer.removeFile('/test/file.txt');

            expect(result.success).toBe(true);
            expect(mockDeleteFile).toHaveBeenCalledWith('/test/file.txt');
        });
    });
});
