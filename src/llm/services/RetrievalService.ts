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
    RetrievalSource,
    VectorRecord,
    Embedding,
    IEmbeddingModel,
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';
import { LexicalSearchMatch } from './HybridLexicalIndex';
import { ContextManager } from './ContextManager';
import { LLMMetrics, MetricOperation } from './LLMMetrics';

const RRF_K = 60;

export interface RankedChunk {
    record: VectorRecord;
    score: number;
}

export class RetrievalService {
    /** Maximum tokens in context (fits most LLM context windows) */
    private readonly MAX_CONTEXT_TOKENS = 4000;

    /** Number of candidates to retrieve from each signal before fusion */
    private readonly TOP_K = 25;

    /** Number of top RRF candidates refined by the Cross-Encoder reranker */
    private readonly CROSS_ENCODER_TOP_N = 12;

    private readonly contextManager: ContextManager;

    constructor(
        private vectorStore: VectorStore,
        private embeddingModel: IEmbeddingModel,
        contextManager?: ContextManager
    ) {
        this.contextManager = contextManager ?? new ContextManager();
    }

    /**
     * Retrieve relevant context for user query using Hybrid Dense + SQLite FTS5 BM25
     * RRF + optional Cross-Encoder reranking (`Xenova/ms-marco-MiniLM-L-6-v2`).
     */
    async retrieve(query: string): Promise<RetrievalResult> {
        const timer = LLMMetrics.getInstance().startTimer(MetricOperation.RETRIEVAL);

        try {
            // 1. Embed query on HIGH priority lane
            const queryEmbedding = await this.embeddingModel.embed(query);

            // 2. Dense vector candidates + SQLite FTS5 BM25 lexical candidates
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
                    structuredSources: [],
                    tokenCount: 0,
                };
            }

            // 3. Re-rank using RRF fusion + semantic similarity + Cross-Encoder reranker
            const baseRanked = this.rerankHybridScored(
                queryEmbedding,
                denseCandidates,
                lexicalMatches
            );
            const ranked = await this.applyCrossEncoderRerank(query, baseRanked);
            const rerankedRecords = ranked.map((r) => r.record);

            // 4. Format context with untrusted_workspace_data isolation fences & #Lx-Ly citations
            let context = this.formatContext(rerankedRecords);
            let tokenCount = this.estimateTokens(context);

            // 5. Fast extractive ContextManager budgeting if exceeds token budget
            if (tokenCount > this.MAX_CONTEXT_TOKENS) {
                context = await this.contextManager.compress(rerankedRecords, {
                    maxTokens: this.MAX_CONTEXT_TOKENS,
                    verbatimCount: 3,
                    query,
                });
                tokenCount = this.estimateTokens(context);
                if (tokenCount > this.MAX_CONTEXT_TOKENS) {
                    const maxChars = this.MAX_CONTEXT_TOKENS * 4;
                    context = context.slice(0, maxChars);
                    tokenCount = this.estimateTokens(context);
                }
            }

            // 6. Extract unique file sources & structured line-range sources
            const sources = [...new Set(rerankedRecords.map((r) => r.file_path))];
            const seenCitations = new Set<string>();
            const structuredSources: RetrievalSource[] = [];
            for (const item of ranked) {
                const key = `${item.record.file_path}:${item.record.start_line ?? 0}:${item.record.end_line ?? 0}`;
                if (seenCitations.has(key)) continue;
                seenCitations.add(key);
                structuredSources.push({
                    filePath: item.record.file_path,
                    startLine: item.record.start_line,
                    endLine: item.record.end_line,
                    heading: item.record.heading,
                    score: Number(item.score.toFixed(4)),
                    snippet: item.record.chunk_text.slice(0, 200),
                });
            }

            return {
                context,
                sources,
                structuredSources,
                tokenCount,
            };
        } finally {
            timer.stop();
        }
    }

    private async applyCrossEncoderRerank(
        query: string,
        baseRanked: RankedChunk[]
    ): Promise<RankedChunk[]> {
        if (
            baseRanked.length <= 1 ||
            typeof this.embeddingModel.rerank !== 'function'
        ) {
            return baseRanked;
        }

        const topCount = Math.min(this.CROSS_ENCODER_TOP_N, baseRanked.length);
        const head = baseRanked.slice(0, topCount);
        const tail = baseRanked.slice(topCount);

        try {
            const passages = head.map((item) => item.record.chunk_text);
            const logits = await this.embeddingModel.rerank(query, passages);
            if (!Array.isArray(logits) || logits.length !== head.length) {
                return baseRanked;
            }

            const maxBaseScore = Math.max(...head.map((h) => h.score), 1e-6);
            const rescored = head.map((item, idx) => {
                const rawLogit = Number(logits[idx]);
                const crossProb = Number.isFinite(rawLogit)
                    ? 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, rawLogit))))
                    : 0;
                const normBase = Math.max(0, item.score / maxBaseScore);
                return {
                    record: item.record,
                    score: crossProb * 0.72 + normBase * 0.28,
                };
            });

            rescored.sort((a, b) => b.score - a.score);
            return [...rescored, ...tail];
        } catch {
            // Graceful offline/missing-model fallback preserves base hybrid RRF ranking
            return baseRanked;
        }
    }

    private rerankHybridScored(
        queryEmbedding: Embedding,
        denseCandidates: VectorRecord[],
        lexicalMatches: LexicalSearchMatch[]
    ): RankedChunk[] {
        interface CandidateEntry {
            record: VectorRecord;
            rrfScore: number;
            similarityScore: number;
            lexicalBoost: number;
        }

        const merged = new Map<string, CandidateEntry>();

        // Preserve exact dense order calls to similarity() for unit mock determinism
        denseCandidates.forEach((candidate, rank) => {
            const rawSimilarity = this.safeSimilarity(queryEmbedding, candidate.embedding);
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
                if (!existing.record.start_line && match.record.start_line) {
                    existing.record = {
                        ...existing.record,
                        start_line: match.record.start_line,
                        end_line: match.record.end_line,
                        heading: match.record.heading,
                    };
                }
            } else {
                const rawSimilarity = this.safeSimilarity(queryEmbedding, match.record.embedding);
                const similarityScore = Number.isFinite(rawSimilarity) ? rawSimilarity : 0;
                merged.set(match.record.id, {
                    record: match.record,
                    rrfScore: lexicalRrf,
                    similarityScore,
                    lexicalBoost: normalizedLexicalBoost,
                });
            }
        });

        const scored: RankedChunk[] = Array.from(merged.values()).map((entry) => {
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
        return scored;
    }

    /**
     * Calculate recency boost based on when content was indexed.
     */
    private calculateRecencyBoost(indexedAt: number): number {
        const daysSinceIndexed = (Date.now() - indexedAt) / (1000 * 60 * 60 * 24);
        return Math.max(0, 0.1 - daysSinceIndexed * 0.01);
    }

    /**
     * Format chunks inside `<untrusted_workspace_data>` fences with line-range citations.
     */
    private formatContext(records: VectorRecord[]): string {
        const formatted = records.map((record) => {
            const fileName = record.file_path.split(/[\\/]/).pop() || record.file_path;
            const lineTag = record.start_line
                ? `#L${record.start_line}${record.end_line && record.end_line !== record.start_line ? `-L${record.end_line}` : ''}`
                : '';
            const citation = `${fileName}${lineTag}`;

            return `<untrusted_workspace_data source="${record.file_path}" citation="${citation}">
📄 **FILE: ${citation}**${record.heading ? ` (${record.heading})` : ''}
📍 PATH: ${record.file_path}
---
${record.chunk_text}
---
</untrusted_workspace_data>`;
        });

        return formatted.join('\n\n');
    }

    /**
     * Estimate token count from text (1 token ~= 4 characters).
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    private safeSimilarity(a: Embedding, b: Embedding): number {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
            return 0;
        }
        try {
            return this.embeddingModel.similarity(a, b);
        } catch {
            return 0;
        }
    }
}
