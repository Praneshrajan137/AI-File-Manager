/**
 * IndexingService Unit Tests
 * 
 * Tests for file chunking and embedding generation.
 * Mocks external dependencies (FileSystemService, EmbeddingModel, VectorStore).
 */

// Define mock types for VectorStore (not yet implemented)
const mockAddChunks = jest.fn().mockResolvedValue(undefined);
const mockDeleteFile = jest.fn().mockResolvedValue(undefined);
const mockGetStats = jest.fn().mockResolvedValue({
    totalFiles: 10,
    totalChunks: 50,
    totalTokens: 25000,
    indexSize: 1024000,
    lastIndexed: Date.now(),
});

// Mock dependencies
jest.mock('../../src/main/services/FileSystemService', () => ({
    FileSystemService: jest.fn().mockImplementation(() => ({
        readFile: jest.fn(),
    })),
}));

jest.mock('../../src/llm/models/EmbeddingModel', () => ({
    EmbeddingModel: jest.fn().mockImplementation(() => ({
        embedBatch: jest.fn().mockResolvedValue([new Array(384).fill(0.1)]),
        getDimensions: jest.fn().mockReturnValue(384),
    })),
}));

// Mock VectorStore
jest.mock('../../src/llm/services/VectorStore', () => ({
    VectorStore: jest.fn().mockImplementation(() => ({
        addChunks: mockAddChunks,
        deleteFile: mockDeleteFile,
        getStats: mockGetStats,
    })),
}));

import { IndexingService } from '../../src/llm/services/IndexingService';
import { FileSystemService } from '../../src/main/services/FileSystemService';
import { EmbeddingModel } from '../../src/llm/models/EmbeddingModel';
import { VectorStore } from '../../src/llm/services/VectorStore';

describe('IndexingService', () => {
    let indexer: IndexingService;
    let mockFileSystem: jest.Mocked<FileSystemService>;
    let mockEmbedding: jest.Mocked<EmbeddingModel>;
    let mockVectorStore: jest.Mocked<VectorStore>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockFileSystem = new FileSystemService('/test') as jest.Mocked<FileSystemService>;
        mockEmbedding = new EmbeddingModel() as jest.Mocked<EmbeddingModel>;
        mockVectorStore = new VectorStore() as jest.Mocked<VectorStore>;

        indexer = new IndexingService(
            mockFileSystem,
            mockEmbedding,
            mockVectorStore
        );
    });

    describe('chunking logic', () => {
        it('should create multiple chunks for large text', async () => {
            // Create text that will produce multiple chunks
            // CHUNK_SIZE=500 tokens, CHARS_PER_TOKEN=4 => 2000 chars per chunk
            // 5000 chars should produce ~3 chunks with overlap
            const mockContent = 'a'.repeat(5000);
            mockFileSystem.readFile.mockResolvedValue(mockContent);
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
            const mockContent = 'Short file content';
            mockFileSystem.readFile.mockResolvedValue(mockContent);
            mockEmbedding.embedBatch.mockResolvedValue([new Array(384).fill(0.1)]);

            const result = await indexer.indexFile('/test/short.txt');

            expect(result.success).toBe(true);
            expect(result.chunksCreated).toBe(1);
        });
    });

    describe('indexFile()', () => {
        it('should index file and store in vector database', async () => {
            const mockContent = 'Test file content for indexing';
            mockFileSystem.readFile.mockResolvedValue(mockContent);
            mockEmbedding.embedBatch.mockResolvedValue([new Array(384).fill(0.5)]);

            const result = await indexer.indexFile('/test/file.txt');

            expect(result.success).toBe(true);
            expect(result.chunksCreated).toBeGreaterThan(0);
            expect(result.filePath).toBe('/test/file.txt');
            expect(mockAddChunks).toHaveBeenCalled();
        });

        it('should handle file read errors gracefully', async () => {
            mockFileSystem.readFile.mockRejectedValue(new Error('Permission denied'));

            const result = await indexer.indexFile('/test/forbidden.txt');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Permission denied');
        });

        it('should skip binary files', async () => {
            // Create content with lots of non-printable characters
            const binaryContent = String.fromCharCode(0, 1, 2, 3, 4, 5).repeat(200);
            mockFileSystem.readFile.mockResolvedValue(binaryContent);

            const result = await indexer.indexFile('/test/binary.bin');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Binary');
        });

        it('should skip files larger than MAX_SIZE (10MB)', async () => {
            const largeContent = 'a'.repeat(11 * 1024 * 1024); // 11MB
            mockFileSystem.readFile.mockResolvedValue(largeContent);

            const result = await indexer.indexFile('/test/huge.txt');

            expect(result.success).toBe(false);
            expect(result.error).toContain('too large');
        });
    });

    describe('indexFiles() batch', () => {
        it('should process multiple files', async () => {
            mockFileSystem.readFile.mockResolvedValue('Content');
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
            mockFileSystem.readFile
                .mockResolvedValueOnce('Content 1')
                .mockRejectedValueOnce(new Error('Failed'))
                .mockResolvedValueOnce('Content 3');
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

    describe('getStats()', () => {
        it('should return index statistics', async () => {
            const stats = await indexer.getStats();

            expect(stats.totalFiles).toBe(10);
            expect(stats.totalChunks).toBe(50);
            expect(mockGetStats).toHaveBeenCalled();
        });
    });
});
