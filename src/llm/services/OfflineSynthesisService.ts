/**
 * OfflineSynthesisService - Grounded extractive cited brief when local LLM daemons
 * (Ollama / LM Studio / llama.cpp) are not running or offline.
 *
 * Ensures the user never hits a dead-end error wall when local vector/FTS5/graph
 * evidence is available on disk.
 */

import * as path from 'path';
import { RetrievalResult, RetrievalSource } from '../../shared/contracts';
import type { IGraphAssociativePort } from '../ports/IntelligencePorts';

export interface OfflineSynthesisInput {
  query: string;
  retrievalResult: RetrievalResult;
  knowledgeGraph?: IGraphAssociativePort | null;
  maxSources?: number;
}

export interface OfflineSynthesisOutput {
  answer: string;
  sources: RetrievalSource[];
}

export class OfflineSynthesisService {
  synthesize(input: OfflineSynthesisInput): OfflineSynthesisOutput {
    const maxSources = Math.max(1, input.maxSources ?? 5);
    const structured = input.retrievalResult.structuredSources ?? [];
    const topSources = structured.slice(0, maxSources);

    if (topSources.length === 0 && input.retrievalResult.sources.length === 0) {
      return {
        answer: [
          `*(Offline Retrieval Mode — no local LLM runtime active, and no indexed chunks matched "${input.query}".)*`,
          '',
          'No matching files were found in the current workspace scope. Index your workspace folder first or broaden your query.',
        ].join('\n'),
        sources: [],
      };
    }

    const lines: string[] = [
      '*(Offline Retrieval Synthesis — local LLM daemon inactive; grounded directly from hybrid vector + FTS5 + graph index)*',
      '',
      `Found **${input.retrievalResult.sources.length}** matching workspace file(s) for **"${input.query}"**:`,
      '',
    ];

    topSources.forEach((src, idx) => {
      const baseName = path.basename(src.filePath);
      const lineTag =
        src.startLine !== undefined
          ? `#L${src.startLine}${src.endLine && src.endLine !== src.startLine ? `-L${src.endLine}` : ''}`
          : '';
      const headingBadge = src.heading ? ` — _${src.heading}_` : '';
      const cleanSnippet = (src.snippet ?? '')
        .replace(/^\[File:[^\]]+\]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      lines.push(`${idx + 1}. **[${baseName}${lineTag}]**${headingBadge}`);
      if (cleanSnippet) {
        lines.push(`   > ${cleanSnippet.slice(0, 240)}${cleanSnippet.length > 240 ? '...' : ''}`);
      }
    });

    // Append 1-hop / 2-hop Knowledge Graph associative links if available
    if (input.knowledgeGraph && topSources.length > 0) {
      try {
        const boosts = input.knowledgeGraph.computeAssociativeBoosts(
          topSources.map((s) => s.filePath),
          { maxHops: 2, maxBoosts: 4, excludeSeeds: true }
        );
        if (boosts.length > 0) {
          lines.push('');
          lines.push('**Connected Workspace Files (Knowledge Graph):**');
          for (const b of boosts) {
            const via = b.viaPath ? ` via ${path.basename(b.viaPath)}` : '';
            lines.push(`- \`${path.basename(b.filePath)}\` (${b.hopDistance}-hop link${via})`);
          }
        }
      } catch {
        // Ignore graph errors cleanly during synthesis fallback
      }
    }

    lines.push('');
    lines.push('Start Ollama or an OpenAI-compatible local runtime to unlock full generative synthesis over these citations.');

    return {
      answer: lines.join('\n'),
      sources: topSources,
    };
  }
}
