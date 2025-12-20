/**
 * IndexingService - File chunking and embedding generation
 * 
 * Process:
 * 1. Read file content via FileSystemService
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
    IndexingResult,
    IndexStats,
    TextChunk,
} from '../../shared/contracts';
import { FileSystemService } from '../../main/services/FileSystemService';
import { EmbeddingModel } from '../models/EmbeddingModel';
import { VectorStore } from './VectorStore';

export class IndexingService implements IIndexingService {
    /** Chunk size in tokens */
    private readonly CHUNK_SIZE = 500;

    /** Overlap between chunks in tokens */
    private readonly CHUNK_OVERLAP = 50;

    /** Maximum file size to index (10MB) */
    private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;

    /** Approximate characters per token for English */
    private readonly CHARS_PER_TOKEN = 4;

    constructor(
        private fileSystem: FileSystemService,
        private embeddingModel: EmbeddingModel,
        private vectorStore: VectorStore
    ) { }

    /**
     * Index a single file.
     * 
     * @param filePath - Absolute path to file
     * @returns Indexing result
     */
    async indexFile(filePath: string): Promise<IndexingResult> {
        try {
            // Read file content
            const content = await this.fileSystem.readFile(filePath);

            // Validate file
            const validation = this.validateFile(filePath, content);
            if (!validation.valid) {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: validation.error,
                };
            }

            // Chunk content
            const chunks = this.chunkText(content);

            // Generate embeddings (batch for efficiency)
            const chunkTexts = chunks.map((c) => c.text);
            const embeddings = await this.embeddingModel.embedBatch(chunkTexts);

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
     * Validate file before indexing.
     * 
     * @param filePath - File path
     * @param content - File content
     * @returns Validation result
     */
    private validateFile(
        filePath: string,
        content: string
    ): { valid: boolean; error?: string } {
        // Check file size
        const sizeBytes = Buffer.byteLength(content, 'utf-8');
        if (sizeBytes > this.MAX_FILE_SIZE) {
            return {
                valid: false,
                error: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB > 10MB limit)`,
            };
        }

        // Check if binary (simple heuristic)
        if (this.isBinary(content)) {
            return {
                valid: false,
                error: 'Binary files not supported',
            };
        }

        return { valid: true };
    }

    /**
     * Check if content is binary.
     * 
     * Heuristic: If >5% of sample characters are non-printable, treat as binary.
     * 
     * @param content - File content
     * @returns True if likely binary
     */
    private isBinary(content: string): boolean {
        let nonPrintable = 0;
        const sampleSize = Math.min(1000, content.length);

        for (let i = 0; i < sampleSize; i++) {
            const code = content.charCodeAt(i);
            // Non-printable range (excluding tab, newline, carriage return)
            if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
                nonPrintable++;
            }
        }

        return nonPrintable / sampleSize > 0.05;
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
