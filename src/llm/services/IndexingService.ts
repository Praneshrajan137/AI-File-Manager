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
import * as crypto from 'crypto';
import fs from 'fs/promises';
import {
    IIndexingService,
    IEmbeddingModel,
    IndexingResult,
    IndexStats,
    TextChunk,
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';
import { FileContentExtractor } from './FileContentExtractor';
import { StructuralChunker } from './StructuralChunker';
import { LLMMetrics, MetricOperation } from './LLMMetrics';
import { isSensitiveSecretFile } from '../../shared/security/SecretGuard';

function computeBufferSha256(content: string | Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

export interface IndexFileOptions {
    forceReindex?: boolean;
    signal?: AbortSignal;
    skipMetadataStubs?: boolean;
}

export class IndexingService implements IIndexingService {
    /** Target chunk size in tokens (fits BGE-small-en-v1.5 512-token window cleanly with headers) */
    private readonly CHUNK_SIZE = 420;

    /** Overlap between chunks in tokens */
    private readonly CHUNK_OVERLAP = 48;

    /** Approximate characters per token for English */
    private readonly CHARS_PER_TOKEN = 4;

    /** Content extractor for various file types */
    private readonly contentExtractor: FileContentExtractor;

    /** Structure-aware contextual chunker preserving line numbers & headings */
    private readonly structuralChunker: StructuralChunker;

    constructor(
        private embeddingModel: IEmbeddingModel,
        private vectorStore: VectorStore
    ) {
        this.contentExtractor = new FileContentExtractor({
            maxFileSize: 50 * 1024 * 1024, // 50MB
            maxCharacters: 500000,
        });
        this.structuralChunker = new StructuralChunker({
            maxTokens: this.CHUNK_SIZE,
            overlapTokens: this.CHUNK_OVERLAP,
            charsPerToken: this.CHARS_PER_TOKEN,
            prependContextHeader: true,
        });
    }

    /**
     * Index a single file.
     *
     * Uses FileContentExtractor + StructuralChunker + SHA-256/stat change detection.
     */
    async indexFile(
        filePath: string,
        flushImmediately: boolean = true,
        options?: IndexFileOptions
    ): Promise<IndexingResult> {
        const timer = LLMMetrics.getInstance().startTimer(MetricOperation.INDEX_FILE);
        try {
            if (options?.signal?.aborted) {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: 'Indexing cancelled',
                };
            }

            const secretCheck = isSensitiveSecretFile(filePath);
            if (secretCheck.blocked) {
                // Purge any legacy chunks if an older index ingested this secret path
                await this.vectorStore.deleteFile(filePath).catch(() => 0);
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: secretCheck.reason ?? 'Blocked by SecretGuard',
                };
            }

            const fileStat = await fs.stat(filePath).catch(() => null);
            if (
                !options?.forceReindex &&
                fileStat &&
                typeof this.vectorStore.needsReindex === 'function' &&
                !this.vectorStore.needsReindex(filePath, fileStat.mtimeMs, fileStat.size)
            ) {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: true,
                };
            }

            // Extract content using specialized extractor
            const extraction = await this.contentExtractor.extract(filePath);

            if (!extraction.success && !extraction.content) {
                const isPermanentExclusion =
                    Boolean(extraction.metadata?.securityBlocked) ||
                    (typeof extraction.error === 'string' &&
                        (extraction.error.startsWith('File too large') || extraction.error.includes('ENOENT')));
                if (isPermanentExclusion) {
                    await this.vectorStore.deleteFile(filePath).catch(() => 0);
                }
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: extraction.error || 'Extraction failed',
                };
            }

            if (options?.skipMetadataStubs && extraction.contentType === 'metadata') {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: false,
                    error: extraction.error || 'Skipped non-text metadata stub',
                };
            }

            const content = extraction.content || '';
            const sha256 = computeBufferSha256(content);

            if (
                !options?.forceReindex &&
                fileStat &&
                content.length > 0 &&
                typeof this.vectorStore.needsReindex === 'function' &&
                !this.vectorStore.needsReindex(filePath, fileStat.mtimeMs, fileStat.size, sha256)
            ) {
                return {
                    filePath,
                    chunksCreated: 0,
                    totalTokens: 0,
                    indexedAt: Date.now(),
                    success: true,
                };
            }

            // Structure-aware contextual chunking with single-pass symbol/link extraction
            const { chunks, symbols, links } = this.structuralChunker.chunkWithMetadata(content, filePath);

            if (chunks.length === 0) {
                await this.vectorStore.deleteFile(filePath).catch(() => 0);
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

            // Store in vector database & knowledge graph
            await this.vectorStore.addChunks(chunks, embeddings, filePath, {
                sha256,
                size: fileStat?.size ?? content.length,
                mtimeMs: fileStat?.mtimeMs ?? Date.now(),
                fileType: extraction.fileType,
                symbols,
                links,
            });

            // Flush immediately for single-file/small-batch writes unless batching
            if (
                flushImmediately &&
                typeof this.vectorStore.flushPendingRecords === 'function'
            ) {
                await this.vectorStore.flushPendingRecords();
            }

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
        } finally {
            timer.stop();
        }
    }

    /**
     * Index multiple files in batch.
     * 
     * @param filePaths - Array of paths
     * @returns Array of results
     */
    async indexFiles(filePaths: string[], options?: IndexFileOptions): Promise<IndexingResult[]> {
        const results: IndexingResult[] = [];

        try {
            for (let i = 0; i < filePaths.length; i++) {
                if (options?.signal?.aborted) {
                    break;
                }
                const result = await this.indexFile(filePaths[i], false, options);
                results.push(result);

                // Yield periodically without stalling single-file throughput
                if ((i & 3) === 3) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        } finally {
            if (typeof this.vectorStore.flushPendingRecords === 'function') {
                await this.vectorStore.flushPendingRecords();
            }
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
     * Chunk text into structure-aware overlapping segments.
     */
    private chunkText(text: string, filePath: string = 'document.txt'): TextChunk[] {
        return this.structuralChunker.chunk(text, filePath);
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

