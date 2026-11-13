/**
 * RetrievalService - Hybrid RAG Pipeline Coordinator
 *
 * Combines:
 * 1. Dense semantic search via LanceDB VectorStore
 * 2. Pure-TS BM25 lexical exact-token search via HybridLexicalIndex
 * 3. Reciprocal Rank Fusion (RRF) + multi-signal re-ranking
 * 4. ContextManager token-budget preservation / summarization
 * 5. LLMMetrics latency recording
 */
import {
    RetrievalResult,
    VectorRecord,
    Embedding,
    IEmbeddingModel,
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';
import { LexicalSearchMatch } from './HybridLexicalIndex';
import { ContextManager } from './ContextManager';
import { LLMMetrics, MetricOperation } from './LLMMetrics';

const RRF_K = 60;

export class RetrievalService {
    /** Maximum tokens in context (fits most LLM context windows) */
    private readonly MAX_CONTEXT_TOKENS = 4000;

    /** Number of candidates to retrieve from each signal before fusion */
    private readonly TOP_K = 10;

    private readonly contextManager: ContextManager;

    constructor(
        private vectorStore: VectorStore,
        private embeddingModel: IEmbeddingModel,
        contextManager?: ContextManager
    ) {
        this.contextManager = contextManager ?? new ContextManager();
    }

    /**
     * Retrieve relevant context for user query using Hybrid Dense + BM25 RRF.
     */
    async retrieve(query: string): Promise<RetrievalResult> {
        const timer = LLMMetrics.getInstance().startTimer(MetricOperation.RETRIEVAL);

        try {
            // 1. Embed query
            const queryEmbedding = await this.embeddingModel.embed(query);

            // 2. Dense vector candidates + optional lexical BM25 candidates
            const denseCandidates = await this.vectorStore.search(
                queryEmbedding,
                this.TOP_K
            );
            const lexicalMatches: LexicalSearchMatch[] =
                typeof (this.vectorStore as Partial<VectorStore>).searchLexical === 'function'
                    ? this.vectorStore.searchLexical(query, this.TOP_K)
                    : [];

            // Handle empty results
            if (denseCandidates.length === 0 && lexicalMatches.length === 0) {
                return {
                    context: '',
                    sources: [],
                    tokenCount: 0,
                };
            }

            // 3. Re-rank using RRF fusion + semantic similarity + metadata signals
            const reranked = this.rerankHybrid(
                queryEmbedding,
                denseCandidates,
                lexicalMatches
            );

            // 4. Format context
            let context = this.formatContext(reranked);
            let tokenCount = this.estimateTokens(context);

            // 5. Intelligent ContextManager compression if exceeds token budget
            if (tokenCount > this.MAX_CONTEXT_TOKENS) {
                context = await this.contextManager.compress(reranked, {
                    maxTokens: this.MAX_CONTEXT_TOKENS,
                    verbatimCount: 3,
                });
                tokenCount = this.estimateTokens(context);
                if (tokenCount > this.MAX_CONTEXT_TOKENS) {
                    const maxChars = this.MAX_CONTEXT_TOKENS * 4;
                    context = context.slice(0, maxChars);
                    tokenCount = this.estimateTokens(context);
                }
            }

            // 6. Extract unique sources
            const sources = [...new Set(reranked.map((r) => r.file_path))];

            return {
                context,
                sources,
                tokenCount,
            };
        } finally {
            timer.stop();
        }
    }

    private rerankHybrid(
        queryEmbedding: Embedding,
        denseCandidates: VectorRecord[],
        lexicalMatches: LexicalSearchMatch[]
    ): VectorRecord[] {
        interface CandidateEntry {
            record: VectorRecord;
            rrfScore: number;
            similarityScore: number;
            lexicalBoost: number;
        }

        const merged = new Map<string, CandidateEntry>();

        // Preserve exact dense order calls to similarity() for unit mock determinism
        denseCandidates.forEach((candidate, rank) => {
            const rawSimilarity = this.embeddingModel.similarity(
                queryEmbedding,
                candidate.embedding
            );
            const similarityScore = Number.isFinite(rawSimilarity) ? rawSimilarity : 0;
            const denseRrf = 1 / (RRF_K + rank + 1);
            merged.set(candidate.id, {
                record: candidate,
                rrfScore: denseRrf,
                similarityScore,
                lexicalBoost: 0,
            });
        });

        lexicalMatches.forEach((match, rank) => {
            const lexicalRrf = 1 / (RRF_K + rank + 1);
            const existing = merged.get(match.record.id);
            const normalizedLexicalBoost = Math.min(match.bm25Score / 10, 0.4);
            if (existing) {
                existing.rrfScore += lexicalRrf;
                existing.lexicalBoost = normalizedLexicalBoost;
            } else {
                const rawSimilarity = this.embeddingModel.similarity(
                    queryEmbedding,
                    match.record.embedding
                );
                const similarityScore = Number.isFinite(rawSimilarity) ? rawSimilarity : 0;
                merged.set(match.record.id, {
                    record: match.record,
                    rrfScore: lexicalRrf,
                    similarityScore,
                    lexicalBoost: normalizedLexicalBoost,
                });
            }
        });

        const scored = Array.from(merged.values()).map((entry) => {
            const lengthBoost = Math.min(entry.record.chunk_text.length / 2000, 0.15);
            const recencyBoost = this.calculateRecencyBoost(entry.record.indexed_at);
            const hasLexical = lexicalMatches.length > 0;
            const totalScore = hasLexical
                ? entry.rrfScore * 20 +
                  entry.lexicalBoost +
                  entry.similarityScore * 0.5 +
                  lengthBoost * 0.25 +
                  recencyBoost * 0.25
                : entry.similarityScore + lengthBoost + recencyBoost;

            return {
                record: entry.record,
                score: totalScore,
            };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map((s) => s.record);
    }

    /**
     * Calculate recency boost based on when content was indexed.
     */
    private calculateRecencyBoost(indexedAt: number): number {
        const daysSinceIndexed = (Date.now() - indexedAt) / (1000 * 60 * 60 * 24);
        return Math.max(0, 0.1 - daysSinceIndexed * 0.01);
    }

    /**
     * Format chunks into readable context for LLM.
     */
    private formatContext(records: VectorRecord[]): string {
        const formatted = records.map((record) => {
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
     * Estimate token count from text (1 token ~= 4 characters).
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }
}
