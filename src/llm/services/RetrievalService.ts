/**
 * RetrievalService - RAG Pipeline Coordinator
 * 
 * Retrieval-Augmented Generation Process:
 * 1. User asks question
 * 2. Convert question to embedding
 * 3. Search vector DB for similar chunks
 * 4. Re-rank by semantic similarity
 * 5. Compress if needed (context window limit)
 * 6. Return formatted context for LLM
 * 
 * This prevents hallucination by grounding LLM in actual file content.
 */
import {
    RetrievalResult,
    VectorRecord,
    Embedding,
    IEmbeddingModel,
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';

export class RetrievalService {
    /** Maximum tokens in context (fits most LLM context windows) */
    private readonly MAX_CONTEXT_TOKENS = 4000;

    /** Number of candidates to retrieve before re-ranking */
    private readonly TOP_K = 10;

    constructor(
        private vectorStore: VectorStore,
        private embeddingModel: IEmbeddingModel
    ) { }

    /**
     * Retrieve relevant context for user query.
     * 
     * @param query - User's question or prompt
     * @returns Retrieval result with context, sources, and token count
     */
    async retrieve(query: string): Promise<RetrievalResult> {
        // 1. Embed query
        const queryEmbedding = await this.embeddingModel.embed(query);

        // 2. Search vector database
        const candidates = await this.vectorStore.search(
            queryEmbedding,
            this.TOP_K
        );

        // Handle empty results
        if (candidates.length === 0) {
            return {
                context: '',
                sources: [],
                tokenCount: 0,
            };
        }

        // 3. Re-rank by semantic similarity
        const reranked = this.rerank(queryEmbedding, candidates);

        // 4. Format context
        let context = this.formatContext(reranked);
        let tokenCount = this.estimateTokens(context);

        // 5. Compress if exceeds limit
        if (tokenCount > this.MAX_CONTEXT_TOKENS) {
            context = this.compress(reranked, this.MAX_CONTEXT_TOKENS);
            tokenCount = this.estimateTokens(context);
        }

        // 6. Extract unique sources
        const sources = [...new Set(reranked.map((r) => r.file_path))];

        return {
            context,
            sources,
            tokenCount,
        };
    }

    /**
     * Re-rank results using multi-signal scoring.
     * 
     * Signals:
     * - Semantic similarity (primary)
     * - Content length boost (more detailed = higher score)
     * - Recency boost (recently indexed content)
     * 
     * @param queryEmbedding - Query vector
     * @param candidates - Initial search results
     * @returns Sorted by composite score (highest first)
     */
    private rerank(
        queryEmbedding: Embedding,
        candidates: VectorRecord[]
    ): VectorRecord[] {
        const scored = candidates.map((candidate) => {
            // Base similarity score (0-1)
            const similarityScore = this.embeddingModel.similarity(
                queryEmbedding,
                candidate.embedding
            );

            // Length boost: reward more detailed chunks (max 0.15)
            const lengthBoost = Math.min(candidate.chunk_text.length / 2000, 0.15);

            // Recency boost: reward recently indexed content (max 0.1)
            const recencyBoost = this.calculateRecencyBoost(candidate.indexed_at);

            return {
                record: candidate,
                score: similarityScore + lengthBoost + recencyBoost,
            };
        });

        // Sort by composite score descending
        scored.sort((a, b) => b.score - a.score);

        return scored.map((s) => s.record);
    }

    /**
     * Calculate recency boost based on when content was indexed.
     * Files indexed within the last day get maximum boost.
     */
    private calculateRecencyBoost(indexedAt: number): number {
        const daysSinceIndexed = (Date.now() - indexedAt) / (1000 * 60 * 60 * 24);
        // Max 0.1 boost for files indexed within last day, decreasing over time
        return Math.max(0, 0.1 - daysSinceIndexed * 0.01);
    }

    /**
     * Format chunks into readable context for LLM.
     * 
     * @param records - Vector records
     * @returns Formatted context string
     */
    private formatContext(records: VectorRecord[]): string {
        const formatted = records.map((record) => {
            // Extract filename from path for cleaner citation
            const fileName = record.file_path.split(/[\\/]/).pop() || record.file_path;

            return `📄 **FILE: ${fileName}**
📍 PATH: ${record.file_path}
---
${record.chunk_text}
---`;
        });

        return formatted.join('\n\n');
    }

    /**
     * Compress context to fit token limit.
     * 
     * Strategy: Include chunks in order until limit reached.
     * 
     * @param records - Vector records (already sorted by relevance)
     * @param maxTokens - Maximum tokens allowed
     * @returns Compressed context string
     */
    private compress(records: VectorRecord[], maxTokens: number): string {
        const chunks: string[] = [];
        let totalTokens = 0;

        for (const record of records) {
            // Use same format as formatContext for consistency
            const fileName = record.file_path.split(/[\\/]/).pop() || record.file_path;
            const chunkText = `📄 **FILE: ${fileName}**\n📍 PATH: ${record.file_path}\n---\n${record.chunk_text}\n---`;

            const chunkTokens = this.estimateTokens(chunkText);

            // Stop if adding this chunk would exceed limit
            if (totalTokens + chunkTokens > maxTokens) {
                break;
            }

            chunks.push(chunkText);
            totalTokens += chunkTokens;
        }

        return chunks.join('\n\n');
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
        return Math.ceil(text.length / 4);
    }
}
