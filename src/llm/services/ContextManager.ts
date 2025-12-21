/**
 * ContextManager - Intelligent Context Window Management
 * 
 * When RAG context exceeds token limits, this service compresses
 * intelligently by keeping top chunks verbatim and summarizing rest.
 * 
 * Strategies:
 * 1. Priority preservation: Top 3 most relevant chunks kept verbatim
 * 2. LLM summarization: Remaining chunks summarized for key info
 * 3. Token budgeting: Ensures output fits within limits
 */

import * as path from 'path';
import { VectorRecord } from '../../shared/contracts';
import { LLMInterface } from './LLMInterface';

export interface CompressionOptions {
    /** Maximum tokens for compressed context */
    maxTokens: number;

    /** Number of top chunks to keep verbatim */
    verbatimCount?: number;

    /** Model to use for summarization */
    summarizationModel?: string;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
    maxTokens: 4000,
    verbatimCount: 3,
    summarizationModel: 'llama3.2',
};

export class ContextManager {
    private llmInterface: LLMInterface | null = null;

    /**
     * Initialize with optional LLM interface for summarization.
     * If not provided, falls back to truncation-based compression.
     */
    constructor(llmInterface?: LLMInterface) {
        this.llmInterface = llmInterface || null;
    }

    /**
     * Set LLM interface for summarization.
     */
    setLLMInterface(llmInterface: LLMInterface): void {
        this.llmInterface = llmInterface;
    }

    /**
     * Compress context intelligently.
     * 
     * Keeps top N chunks verbatim (most relevant), summarizes rest.
     * Falls back to truncation if LLM not available.
     * 
     * @param records - Vector records sorted by relevance
     * @param options - Compression options
     * @returns Compressed context string
     */
    async compress(
        records: VectorRecord[],
        options?: Partial<CompressionOptions>
    ): Promise<string> {
        const opts = { ...DEFAULT_OPTIONS, ...options };

        if (records.length === 0) {
            return '';
        }

        // Split into verbatim (top) and summarizable (rest)
        const verbatimRecords = records.slice(0, opts.verbatimCount);
        const remainingRecords = records.slice(opts.verbatimCount);

        // Format verbatim chunks with full content
        const verbatimContext = this.formatVerbatimContext(verbatimRecords);
        const verbatimTokens = this.estimateTokens(verbatimContext);

        // If no remaining or verbatim already exceeds limit
        if (remainingRecords.length === 0 || verbatimTokens >= opts.maxTokens) {
            return this.truncateToTokenLimit(verbatimContext, opts.maxTokens);
        }

        // Calculate remaining token budget for summary
        const remainingBudget = opts.maxTokens - verbatimTokens - 100; // Reserve 100 for formatting

        // Summarize remaining chunks
        let summaryContent: string;

        if (this.llmInterface && remainingBudget > 200) {
            try {
                summaryContent = await this.summarizeWithLLM(
                    remainingRecords,
                    Math.min(remainingBudget, 500),
                    opts.summarizationModel
                );
            } catch {
                // Fallback to simple truncation on LLM error
                summaryContent = this.createSimpleSummary(remainingRecords, remainingBudget);
            }
        } else {
            summaryContent = this.createSimpleSummary(remainingRecords, remainingBudget);
        }

        // Combine verbatim and summary
        return `${verbatimContext}\n\n---\n📝 **Additional Context Summary:**\n${summaryContent}`;
    }

    /**
     * Format top chunks with full content for verbatim inclusion.
     */
    private formatVerbatimContext(records: VectorRecord[]): string {
        return records.map((record) => {
            const fileName = path.basename(record.file_path);
            return `📄 **FILE: ${fileName}**
📍 PATH: ${record.file_path}
---
${record.chunk_text}
---`;
        }).join('\n\n');
    }

    /**
     * Summarize chunks using LLM.
     */
    private async summarizeWithLLM(
        records: VectorRecord[],
        maxTokens: number,
        model: string
    ): Promise<string> {
        if (!this.llmInterface) {
            throw new Error('LLM interface not available');
        }

        // Create summary prompt from chunks
        const chunkSummaries = records.map(r =>
            `[${path.basename(r.file_path)}]: ${r.chunk_text.substring(0, 300)}...`
        ).join('\n\n');

        const prompt = `Summarize these file contents concisely, preserving key information:

${chunkSummaries}

Provide a brief summary focusing on the most important points.`;

        // Use queryFull for non-streaming summary
        const retrievalResult = {
            context: '',
            sources: [],
            tokenCount: 0,
        };

        // Get summary (this is a simplified call - in production use dedicated summarize endpoint)
        let summary = '';
        for await (const chunk of this.llmInterface.query(prompt, retrievalResult, {
            maxTokens,
            model,
            temperature: 0.3, // Lower temperature for factual summary
        })) {
            summary += chunk;
        }

        return summary.trim();
    }

    /**
     * Create simple summary without LLM (truncation-based).
     */
    private createSimpleSummary(records: VectorRecord[], maxChars: number): string {
        const summaries = records.map(r => {
            const fileName = path.basename(r.file_path);
            const preview = r.chunk_text.substring(0, 100).replace(/\n/g, ' ');
            return `• ${fileName}: ${preview}...`;
        });

        const combined = summaries.join('\n');
        return combined.length > maxChars
            ? combined.substring(0, maxChars - 3) + '...'
            : combined;
    }

    /**
     * Truncate text to fit token limit.
     */
    private truncateToTokenLimit(text: string, maxTokens: number): string {
        const maxChars = maxTokens * 4; // Approximate 4 chars per token
        if (text.length <= maxChars) {
            return text;
        }
        return text.substring(0, maxChars - 50) + '\n\n[Content truncated - exceeded token limit]';
    }

    /**
     * Estimate token count (rough approximation).
     * 1 token ≈ 4 characters for English text.
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }
}
