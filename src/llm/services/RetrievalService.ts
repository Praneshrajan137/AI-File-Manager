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
import * as path from 'path';
import {
    AssociativeBoostResult,
    CopilotContextScope,
    RetrievalResult,
    RetrievalSource,
    SearchScopeFilter,
    VectorRecord,
    Embedding,
    IEmbeddingModel,
} from '../../shared/contracts';
import { VectorStore } from './VectorStore';
import { LexicalSearchMatch } from './HybridLexicalIndex';
import { ContextManager, formatUntrustedWorkspaceData } from './ContextManager';
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
    async retrieve(query: string, scope?: CopilotContextScope): Promise<RetrievalResult> {
        const timer = LLMMetrics.getInstance().startTimer(MetricOperation.RETRIEVAL);

        try {
            // 1. Embed query on HIGH priority lane
            const queryEmbedding = await this.embeddingModel.embed(query);

            const scopeFilter = this.buildScopeFilter(scope);

            // 2. Pre-filtered Dense vector candidates + SQLite FTS5 BM25 lexical candidates
            const rawDense = await this.vectorStore.search(
                queryEmbedding,
                this.TOP_K,
                scopeFilter
            );
            const rawLexical: LexicalSearchMatch[] =
                typeof (this.vectorStore as Partial<VectorStore>).searchLexical === 'function'
                    ? this.vectorStore.searchLexical(query, this.TOP_K, scopeFilter)
                    : [];

            const matchesScope = this.createScopeMatcher(scope);

            const denseCandidates = rawDense.filter((c) => matchesScope(c.file_path));
            const lexicalMatches = rawLexical.filter((m) => matchesScope(m.record.file_path));

            // Handle empty results
            if (denseCandidates.length === 0 && lexicalMatches.length === 0) {
                return {
                    context: '',
                    sources: [],
                    structuredSources: [],
                    tokenCount: 0,
                };
            }

            // 3. RRF Fusion + 2-hop Knowledge-Graph Personalized PageRank Expansion + Cross-Encoder + MMR Diversity
            const baseRanked = this.rerankHybridScored(
                queryEmbedding,
                denseCandidates,
                lexicalMatches
            );
            const graphExpanded = this.expandWithAssociativeGraph(baseRanked, matchesScope);
            const crossRanked = await this.applyCrossEncoderRerank(query, graphExpanded);
            const ranked = this.applyMmrDiversityRerank(crossRanked);
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

    private buildScopeFilter(scope?: CopilotContextScope): SearchScopeFilter | undefined {
        if (!scope) return undefined;
        if (scope.useSelection && Array.isArray(scope.selectedPaths) && scope.selectedPaths.length > 0) {
            return { filePaths: scope.selectedPaths };
        }
        if (scope.useFolder && scope.currentPath) {
            return { folderPath: scope.currentPath };
        }
        return undefined;
    }

    private createScopeMatcher(scope?: CopilotContextScope): (filePath: string) => boolean {
        const normalizeCmp = (p: string): string => {
            const resolved = path.resolve(p);
            return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        };

        if (scope?.useSelection && Array.isArray(scope.selectedPaths) && scope.selectedPaths.length > 0) {
            const selectedSet = new Set(scope.selectedPaths.map(normalizeCmp));
            return (filePath: string): boolean => selectedSet.has(normalizeCmp(filePath));
        }

        const folderPrefix =
            scope?.useFolder && scope.currentPath
                ? `${normalizeCmp(scope.currentPath).replace(/[\\/]+$/, '')}${path.sep}`
                : null;
        const folderExact =
            scope?.useFolder && scope.currentPath ? normalizeCmp(scope.currentPath) : null;

        return (filePath: string): boolean => {
            if (!folderPrefix || !folderExact) return true;
            const norm = normalizeCmp(filePath);
            return norm === folderExact || norm.startsWith(folderPrefix);
        };
    }

    /**
     * Expand top retrieval seeds through 2-hop damped Personalized PageRank in WorkspaceKnowledgeGraph
     * so structurally connected files (e.g. specs -> key vault configs) enter retrieval context cleanly.
     */
    private expandWithAssociativeGraph(
        baseRanked: RankedChunk[],
        matchesScope: (filePath: string) => boolean
    ): RankedChunk[] {
        const storePartial = this.vectorStore as Partial<VectorStore>;
        const kg = typeof storePartial.getKnowledgeGraph === 'function' ? storePartial.getKnowledgeGraph() : null;
        if (!kg || baseRanked.length === 0) {
            return baseRanked;
        }

        const seedPaths: string[] = [];
        const seenSeeds = new Set<string>();
        for (const item of baseRanked) {
            if (!seenSeeds.has(item.record.file_path)) {
                seenSeeds.add(item.record.file_path);
                seedPaths.push(item.record.file_path);
                if (seedPaths.length >= 6) break;
            }
        }

        const boosts: AssociativeBoostResult[] = kg.computeAssociativeBoosts(seedPaths, {
            maxHops: 2,
            damping: 0.65,
            maxBoosts: 8,
            excludeSeeds: true,
        });
        if (boosts.length === 0) {
            return baseRanked;
        }

        const canonKey = (p: string): string =>
            process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

        const boostMap = new Map<string, AssociativeBoostResult>();
        for (const b of boosts) {
            boostMap.set(canonKey(b.filePath), b);
        }

        const presentFiles = new Set(baseRanked.map((item) => canonKey(item.record.file_path)));
        const merged = baseRanked.map((item) => {
            const b = boostMap.get(canonKey(item.record.file_path));
            if (!b) return item;
            return {
                record: item.record,
                score: item.score + Math.min(0.6, b.score * 2.2),
            };
        });

        // Inject missed 1-hop / 2-hop graph-associated files if within active scope
        const maxExisting = Math.max(...merged.map((m) => m.score), 0.1);
        const canFetchChunks = typeof storePartial.getChunksForFile === 'function';
        if (canFetchChunks) {
            for (const b of boosts) {
                const resolved = canonKey(b.filePath);
                if (presentFiles.has(resolved) || !matchesScope(b.filePath)) {
                    continue;
                }
                const chunks = storePartial.getChunksForFile!(b.filePath, 1);
                if (chunks.length > 0) {
                    const viaLabel = b.viaPath ? ` (via ${path.basename(b.viaPath)})` : '';
                    merged.push({
                        record: {
                            ...chunks[0],
                            heading: chunks[0].heading
                                ? `${chunks[0].heading} [Graph ${b.hopDistance}-hop${viaLabel}]`
                                : `Graph ${b.hopDistance}-hop${viaLabel}`,
                        },
                        score: Math.min(maxExisting * 0.92, Math.max(0.2, b.score * 2.5)),
                    });
                    presentFiles.add(resolved);
                }
            }
        }

        merged.sort((a, b) => b.score - a.score);
        return merged;
    }

    /**
     * Maximal Marginal Relevance (MMR) diversity reranking: prevents a single dense
     * document from monopolizing the top context window when distinct sources exist.
     */
    private applyMmrDiversityRerank(
        ranked: RankedChunk[],
        maxPerFileInTop: number = 2,
        lambda: number = 0.65
    ): RankedChunk[] {
        if (ranked.length <= 2) {
            return ranked;
        }

        const maxScore = Math.max(...ranked.map((r) => r.score), 1e-6);
        const remaining = [...ranked];
        const selected: RankedChunk[] = [];
        const fileCounts = new Map<string, number>();

        const targetHead = Math.min(ranked.length, 16);
        while (selected.length < targetHead && remaining.length > 0) {
            const hasUncappedCandidate = remaining.some(
                (item) => (fileCounts.get(item.record.file_path) ?? 0) < maxPerFileInTop
            );
            let bestIdx = 0;
            let bestMmr = -Infinity;

            for (let i = 0; i < remaining.length; i++) {
                const candidate = remaining[i];
                const fileKey = candidate.record.file_path;
                const sameFileCount = fileCounts.get(fileKey) ?? 0;
                if (hasUncappedCandidate && sameFileCount >= maxPerFileInTop) {
                    continue;
                }
                const redundancyPenalty =
                    sameFileCount >= maxPerFileInTop ? 1.5 : sameFileCount * 0.55;
                const normRel = Math.max(0, candidate.score / maxScore);
                const mmr = lambda * normRel - (1 - lambda) * redundancyPenalty;
                if (mmr > bestMmr) {
                    bestMmr = mmr;
                    bestIdx = i;
                }
            }

            const picked = remaining.splice(bestIdx, 1)[0];
            selected.push(picked);
            fileCounts.set(picked.record.file_path, (fileCounts.get(picked.record.file_path) ?? 0) + 1);
        }

        return [...selected, ...remaining];
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

            return formatUntrustedWorkspaceData(
                record.file_path,
                citation,
                record.chunk_text,
                record.heading
            );
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
