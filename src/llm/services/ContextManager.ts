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

    /** Model to use for summarization (kept for API compatibility) */
    summarizationModel?: string;

    /** Optional user query for extractive sentence scoring */
    query?: string;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
    maxTokens: 4000,
    verbatimCount: 3,
    summarizationModel: 'llama3.2',
    query: '',
};

/**
 * Format passive workspace content inside explicit untrusted_workspace_data isolation
 * fences so embedded instructions cannot override system or tool boundaries.
 */
/**
 * Neutralize XML boundary injection tokens inside untrusted workspace content
 * so attacker-controlled files cannot break out of `<untrusted_workspace_data>`.
 */
export function escapePromptFenceText(value: string): string {
    return value
        .replace(/<(\/?\s*(?:untrusted_workspace_data|workspace_context|system)\b)/gi, '&lt;$1')
        .replace(/<\|([A-Za-z0-9_/-]{1,40})\|>/g, '&lt;|$1|&gt;');
}

export function neutralizeOuterContextTags(value: string): string {
    return value
        .replace(/<(\/?\s*(?:workspace_context|system)\b)/gi, '&lt;$1')
        .replace(/<\|([A-Za-z0-9_/-]{1,40})\|>/g, '&lt;|$1|&gt;');
}

function escapePromptFenceAttr(value: string): string {
    return value.replace(/"/g, '&quot;').replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'));
}

export function formatUntrustedWorkspaceData(
    source: string,
    citation: string,
    content: string,
    heading?: string
): string {
    const safeSource = escapePromptFenceAttr(source);
    const safeCitation = escapePromptFenceAttr(citation);
    const safeHeading = heading ? ` (${escapePromptFenceText(heading)})` : '';
    const safeBody = escapePromptFenceText(content);
    return `<untrusted_workspace_data source="${safeSource}" citation="${safeCitation}">
📄 **FILE: ${safeCitation}**${safeHeading}
📍 PATH: ${safeSource}
---
${safeBody}
---
</untrusted_workspace_data>`;
}

export class ContextManager {
    private llmInterface: LLMInterface | null = null;

    /**
     * Initialize with optional LLM interface.
     */
    constructor(llmInterface?: LLMInterface) {
        this.llmInterface = llmInterface || null;
    }

    /**
     * Retained for API compatibility.
     */
    setLLMInterface(llmInterface: LLMInterface): void {
        this.llmInterface = llmInterface;
    }

    getLLMInterface(): LLMInterface | null {
        return this.llmInterface;
    }

    /**
     * Fast deterministic extractive context budgeting & injection-fence formatting.
     * Eliminates blocking secondary Ollama summarization calls during RAG retrieval.
     */
    async compress(
        records: VectorRecord[],
        options?: Partial<CompressionOptions>
    ): Promise<string> {
        const opts = { ...DEFAULT_OPTIONS, ...options };

        if (records.length === 0) {
            return '';
        }

        // Split into verbatim (top) and extractively compressed tail
        const verbatimRecords = records.slice(0, opts.verbatimCount);
        const remainingRecords = records.slice(opts.verbatimCount);

        const verbatimContext = this.formatVerbatimContext(verbatimRecords);
        const verbatimTokens = this.estimateTokens(verbatimContext);

        if (remainingRecords.length === 0 || verbatimTokens >= opts.maxTokens) {
            return this.truncateToTokenLimit(verbatimContext, opts.maxTokens);
        }

        const remainingTokenBudget = Math.max(0, opts.maxTokens - verbatimTokens - 40);
        if (remainingTokenBudget < 30) {
            return this.truncateToTokenLimit(verbatimContext, opts.maxTokens);
        }

        const summaryContent = this.createExtractiveSummary(
            remainingRecords,
            remainingTokenBudget * 4,
            opts.query
        );

        const combined = summaryContent
            ? `${verbatimContext}\n\n---\n📝 **Additional Extractive Context:**\n${summaryContent}`
            : verbatimContext;
        return this.truncateToTokenLimit(combined, opts.maxTokens);
    }

    /**
     * Format top chunks inside explicit untrusted_workspace_data isolation fences
     * with [basename#Lx-Ly] line-range headers.
     */
    private formatVerbatimContext(records: VectorRecord[]): string {
        return records
            .map((record) => {
                const fileName = path.basename(record.file_path) || record.file_path;
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
            })
            .join('\n\n');
    }

    /**
     * Fast extractive line/sentence summarization weighted by query term overlap.
     */
    private createExtractiveSummary(
        records: VectorRecord[],
        maxChars: number,
        query: string = ''
    ): string {
        if (maxChars <= 20) {
            return '';
        }

        const queryTerms = new Set(
            (query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []).slice(0, 12)
        );

        const extracts: string[] = [];
        let usedChars = 0;

        for (const r of records) {
            const fileName = path.basename(r.file_path) || r.file_path;
            const lineTag = r.start_line ? `#L${r.start_line}` : '';
            const rawLines = r.chunk_text
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.length > 0);

            let bestLine = rawLines[0] ?? '';
            if (queryTerms.size > 0 && rawLines.length > 1) {
                let bestScore = -1;
                for (const line of rawLines) {
                    const lower = line.toLowerCase();
                    let hits = 0;
                    for (const term of queryTerms) {
                        if (lower.includes(term)) hits++;
                    }
                    if (hits > bestScore) {
                        bestScore = hits;
                        bestLine = line;
                    }
                }
            }

            const snippet = escapePromptFenceText(bestLine.slice(0, 180).replace(/\s+/g, ' '));
            const safeSource = escapePromptFenceAttr(r.file_path);
            const safeCitation = escapePromptFenceAttr(`${fileName}${lineTag}`);
            const entry = `<untrusted_workspace_data source="${safeSource}" citation="${safeCitation}">• ${safeCitation}: ${snippet}</untrusted_workspace_data>`;

            if (usedChars + entry.length + 1 > maxChars) {
                break;
            }
            extracts.push(entry);
            usedChars += entry.length + 1;
        }

        return extracts.join('\n');
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
