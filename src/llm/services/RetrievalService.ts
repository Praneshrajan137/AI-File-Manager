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
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';
import { EmbeddingModel } from '../models/EmbeddingModel';

export class RetrievalService {
    /** Maximum tokens in context (fits most LLM context windows) */
    private readonly MAX_CONTEXT_TOKENS = 4000;

    /** Number of candidates to retrieve before re-ranking */
    private readonly TOP_K = 10;

    constructor(
        private vectorStore: VectorStore,
        private embeddingModel: EmbeddingModel
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
     * Re-rank results by semantic similarity to query.
     * 
     * @param queryEmbedding - Query vector
     * @param candidates - Initial search results
     * @returns Sorted by similarity (highest first)
     */
    private rerank(
        queryEmbedding: Embedding,
        candidates: VectorRecord[]
    ): VectorRecord[] {
        // Calculate similarity scores
        const scored = candidates.map((candidate) => ({
            record: candidate,
            score: this.embeddingModel.similarity(
                queryEmbedding,
                candidate.embedding
            ),
        }));

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        return scored.map((s) => s.record);
    }

    /**
     * Format chunks into readable context for LLM.
     * 
     * @param records - Vector records
     * @returns Formatted context string
     */
    private formatContext(records: VectorRecord[]): string {
        const formatted = records.map((record) => {
            return `[Source: ${record.file_path}]\n${record.chunk_text}`;
        });

        return formatted.join('\n\n---\n\n');
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
            const chunkText = `[Source: ${record.file_path}]\n${record.chunk_text}`;
            const chunkTokens = this.estimateTokens(chunkText);

            // Stop if adding this chunk would exceed limit
            if (totalTokens + chunkTokens > maxTokens) {
                break;
            }

            chunks.push(chunkText);
            totalTokens += chunkTokens;
        }

        return chunks.join('\n\n---\n\n');
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
