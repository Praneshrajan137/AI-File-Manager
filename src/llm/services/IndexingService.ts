/**
 * IndexingService - File chunking and embedding generation
 * 
 * Process:
 * 1. Extract file content via FileContentExtractor (supports PDF, text, code)
 * 2. Chunk into 500-token segments with 50-token overlap
 * 3. Generate embeddings using EmbeddingModel
 * 4. Store in VectorStore
 * 
 * Chunking strategy prevents losing context at boundaries.
 * 
 * @implements IIndexingService
 */
import {
    IIndexingService,
    IEmbeddingModel,
    IndexingResult,
    IndexStats,
    TextChunk,
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';
import { FileContentExtractor } from './FileContentExtractor';

import * as path from 'path';

export class IndexingService implements IIndexingService {
    /** Chunk size in tokens */
    private readonly CHUNK_SIZE = 500;

    /** Overlap between chunks in tokens */
    private readonly CHUNK_OVERLAP = 50;

    /** Approximate characters per token for English */
    private readonly CHARS_PER_TOKEN = 4;

    /** Content extractor for various file types */
    private readonly contentExtractor: FileContentExtractor;

    constructor(
        private embeddingModel: IEmbeddingModel,
        private vectorStore: VectorStore
    ) {
        this.contentExtractor = new FileContentExtractor({
            maxFileSize: 50 * 1024 * 1024, // 50MB
            maxCharacters: 500000,
        });
    }

    /**
     * Index a single file.
     * 
     * Uses FileContentExtractor to handle PDFs, text files, and code.
     * Falls back to metadata-only indexing for unsupported formats.
     * 
     * @param filePath - Absolute path to file
     * @returns Indexing result
     */
    async indexFile(filePath: string): Promise<IndexingResult> {
        try {
            // Extract content using specialized extractor
            const extraction = await this.contentExtractor.extract(filePath);

            if (!extraction.success && !extraction.content) {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: extraction.error || 'Extraction failed',
                };
            }

            const content = extraction.content || '';

            // Chunk content
            const chunks = this.chunkText(content);

            if (chunks.length === 0) {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: 'No content to index',
                };
            }

            // Generate embeddings (batch for efficiency)
            const chunkTexts = chunks.map((c) => c.text);
            const embeddings = await this.embeddingModel.embedBatch(chunkTexts);

            // Yield to event loop after embeddings
            await new Promise(resolve => setImmediate(resolve));

            // Store in vector database
            await this.vectorStore.addChunks(chunks, embeddings, filePath);

            // Calculate total tokens
            const totalTokens = chunks.reduce(
                (sum, chunk) => sum + this.estimateTokens(chunk.text),
                0
            );

            return {
                filePath,
                chunksCreated: chunks.length,
                totalTokens,
                indexedAt: Date.now(),
                success: true,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                filePath,
                chunksCreated: 0,
                totalTokens: 0,
                indexedAt: Date.now(),
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Index multiple files in batch.
     * 
     * @param filePaths - Array of paths
     * @returns Array of results
     */
    async indexFiles(filePaths: string[]): Promise<IndexingResult[]> {
        const results: IndexingResult[] = [];

        // Process sequentially to avoid overwhelming system
        for (const filePath of filePaths) {
            const result = await this.indexFile(filePath);
            results.push(result);

            // Yield between files
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return results;
    }

    /**
     * Remove file from index.
     * 
     * @param filePath - Path to remove
     * @returns Success status
     */
    async removeFile(filePath: string): Promise<{ success: boolean }> {
        try {
            await this.vectorStore.deleteFile(filePath);
            return { success: true };
        } catch {
            return { success: false };
        }
    }

    /**
     * Get index statistics.
     * 
     * @returns Index stats
     */
    async getStats(): Promise<IndexStats> {
        return await this.vectorStore.getStats();
    }

    /**
     * Chunk text into overlapping segments.
     * 
     * Strategy:
     * - Fixed size chunks (500 tokens ≈ 2000 chars)
     * - Overlap prevents context loss (50 tokens ≈ 200 chars)
     * - Prefer sentence boundaries when possible
     * 
     * @param text - Input text
     * @returns Array of text chunks
     */
    private chunkText(text: string): TextChunk[] {
        const chunks: TextChunk[] = [];

        if (!text || text.trim().length === 0) {
            return chunks;
        }

        // Calculate characters per chunk
        const charsPerChunk = this.CHUNK_SIZE * this.CHARS_PER_TOKEN;
        const overlapChars = this.CHUNK_OVERLAP * this.CHARS_PER_TOKEN;
        const stride = charsPerChunk - overlapChars;

        let startChar = 0;
        let chunkIndex = 0;

        while (startChar < text.length) {
            let endChar = Math.min(startChar + charsPerChunk, text.length);

            // Try to find sentence boundary for cleaner chunks
            if (endChar < text.length) {
                const sentenceEnd = this.findSentenceBoundary(text, endChar, endChar + 100);
                if (sentenceEnd > endChar) {
                    endChar = sentenceEnd;
                }
            }

            // Extract chunk
            const chunkText = text.slice(startChar, endChar).trim();

            if (chunkText.length > 0) {
                chunks.push({
                    text: chunkText,
                    startChar,
                    endChar,
                    chunkIndex,
                });
                chunkIndex++;
            }

            // Move to next chunk with overlap
            startChar += stride;

            // Safety check to prevent infinite loop
            if (stride <= 0) {
                break;
            }
        }

        return chunks;
    }

    /**
     * Find sentence boundary near target position.
     * 
     * @param text - Full text
     * @param start - Start search position
     * @param end - End search position
     * @returns Position of sentence boundary or start if not found
     */
    private findSentenceBoundary(
        text: string,
        start: number,
        end: number
    ): number {
        const searchText = text.slice(start, Math.min(end, text.length));

        // Look for sentence-ending punctuation followed by space or newline
        const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];

        for (const ender of sentenceEnders) {
            const index = searchText.indexOf(ender);
            if (index !== -1) {
                return start + index + ender.length;
            }
        }

        return start;
    }

    /**
     * Estimate token count from text.
     * 
     * Approximation: 1 token ≈ 4 characters for English.
     * 
     * @param text - Input text
     * @returns Estimated tokens
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / this.CHARS_PER_TOKEN);
    }
}

