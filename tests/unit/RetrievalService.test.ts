/**
 * RetrievalService Unit Tests
 * 
 * Tests for RAG pipeline: embedding, search, re-rank, compress.
 * Mocks VectorStore and EmbeddingModel dependencies.
 */

const mockEmbed = jest.fn();
const mockSimilarity = jest.fn();
const mockSearch = jest.fn();

// Mock dependencies before imports
jest.mock('../../src/llm/services/VectorStore', () => ({
    VectorStore: jest.fn().mockImplementation(() => ({
        search: mockSearch,
    })),
}));

jest.mock('../../src/llm/models/EmbeddingModel', () => ({
    EmbeddingModel: jest.fn().mockImplementation(() => ({
        embed: mockEmbed,
        similarity: mockSimilarity,
    })),
}));

import { RetrievalService } from '../../src/llm/services/RetrievalService';
import { VectorStore } from '../../src/llm/services/VectorStore';
import { EmbeddingModel } from '../../src/llm/models/EmbeddingModel';
import { VectorRecord } from '../../src/shared/contracts';

describe('RetrievalService', () => {
    let service: RetrievalService;
    let mockVectorStore: jest.Mocked<VectorStore>;
    let mockEmbeddingModel: jest.Mocked<EmbeddingModel>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockVectorStore = new VectorStore() as jest.Mocked<VectorStore>;
        mockEmbeddingModel = new EmbeddingModel() as jest.Mocked<EmbeddingModel>;

        service = new RetrievalService(mockVectorStore, mockEmbeddingModel);
    });

    describe('retrieve()', () => {
        it('should retrieve relevant context for query', async () => {
            const mockRecords: VectorRecord[] = [
                {
                    id: '1',
                    chunk_text: 'Machine learning is a subset of AI',
                    embedding: new Array(384).fill(0.8),
                    file_path: '/docs/ml.txt',
                    chunk_index: 0,
                    indexed_at: Date.now(),
                },
            ];

            mockEmbed.mockResolvedValue(new Array(384).fill(0.8));
            mockSimilarity.mockReturnValue(0.95);
            mockSearch.mockResolvedValue(mockRecords);

            const result = await service.retrieve('What is machine learning?');

            expect(result.context).toContain('Machine learning is a subset of AI');
            expect(result.sources).toContain('/docs/ml.txt');
            expect(result.tokenCount).toBeGreaterThan(0);
            expect(mockEmbed).toHaveBeenCalledWith('What is machine learning?');
            expect(mockSearch).toHaveBeenCalled();
        });

        it('should return empty result if no matches', async () => {
            mockEmbed.mockResolvedValue(new Array(384).fill(0.5));
            mockSearch.mockResolvedValue([]);

            const result = await service.retrieve('nonexistent topic');

            expect(result.context).toBe('');
            expect(result.sources).toEqual([]);
            expect(result.tokenCount).toBe(0);
        });

        it('should re-rank results by similarity', async () => {
            const mockRecords: VectorRecord[] = [
                {
                    id: '1',
                    chunk_text: 'Low relevance content',
                    embedding: new Array(384).fill(0.3),
                    file_path: '/docs/low.txt',
                    chunk_index: 0,
                    indexed_at: Date.now(),
                },
                {
                    id: '2',
                    chunk_text: 'High relevance content',
                    embedding: new Array(384).fill(0.9),
                    file_path: '/docs/high.txt',
                    chunk_index: 0,
                    indexed_at: Date.now(),
                },
            ];

            mockEmbed.mockResolvedValue(new Array(384).fill(0.9));
            // Return higher similarity for second record
            mockSimilarity
                .mockReturnValueOnce(0.3)  // Low
                .mockReturnValueOnce(0.95); // High
            mockSearch.mockResolvedValue(mockRecords);

            const result = await service.retrieve('test query');

            // High relevance should appear first after re-ranking
            const firstSourceIndex = result.context.indexOf('/docs/high.txt');
            const secondSourceIndex = result.context.indexOf('/docs/low.txt');
            expect(firstSourceIndex).toBeLessThan(secondSourceIndex);
        });

        it('should compress context if exceeds token limit', async () => {
            // Create many large chunks that exceed 4000 tokens
            const mockRecords: VectorRecord[] = Array(20)
                .fill(null)
                .map((_, i) => ({
                    id: `${i}`,
                    chunk_text: 'a'.repeat(1000), // ~250 tokens each
                    embedding: new Array(384).fill(0.7),
                    file_path: `/docs/file${i}.txt`,
                    chunk_index: 0,
                    indexed_at: Date.now(),
                }));

            mockEmbed.mockResolvedValue(new Array(384).fill(0.7));
            mockSimilarity.mockReturnValue(0.8);
            mockSearch.mockResolvedValue(mockRecords);

            const result = await service.retrieve('test query');

            // Should compress to fit 4000 tokens
            expect(result.tokenCount).toBeLessThanOrEqual(4000);
        });

        it('should include multiple unique sources', async () => {
            const mockRecords: VectorRecord[] = [
                {
                    id: '1',
                    chunk_text: 'Content from file A',
                    embedding: new Array(384).fill(0.8),
                    file_path: '/docs/fileA.txt',
                    chunk_index: 0,
                    indexed_at: Date.now(),
                },
                {
                    id: '2',
                    chunk_text: 'Content from file B',
                    embedding: new Array(384).fill(0.7),
                    file_path: '/docs/fileB.txt',
                    chunk_index: 0,
                    indexed_at: Date.now(),
                },
                {
                    id: '3',
                    chunk_text: 'More content from file A',
                    embedding: new Array(384).fill(0.6),
                    file_path: '/docs/fileA.txt', // Duplicate source
                    chunk_index: 1,
                    indexed_at: Date.now(),
                },
            ];

            mockEmbed.mockResolvedValue(new Array(384).fill(0.8));
            mockSimilarity.mockReturnValue(0.8);
            mockSearch.mockResolvedValue(mockRecords);

            const result = await service.retrieve('test query');

            // Should have unique sources only
            expect(result.sources).toContain('/docs/fileA.txt');
            expect(result.sources).toContain('/docs/fileB.txt');
            expect(result.sources.length).toBe(2); // Deduplicated
        });
    });
});
