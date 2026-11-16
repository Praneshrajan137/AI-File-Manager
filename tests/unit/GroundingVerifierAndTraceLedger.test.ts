import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { verifyGroundedResponse } from '../../src/llm/orchestration/GroundingVerifier';
import {
  AGENT_ORCHESTRATOR_PROMPT_VERSION,
  buildRedactedTraceRecord,
  replayTraceTimeline,
} from '../../src/llm/orchestration/TraceLedger';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import { AgentRunResult } from '../../src/shared/contracts';

describe('GroundingVerifier & TraceLedger', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-grounding-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('verifyGroundedResponse', () => {
    it('passes verified citations matching observed file paths and line ranges', () => {
      const answer = 'Token rotation happens every 72 hours [auth.ts#L10-L18] and logs [audit.md#L1-L5].';
      const result = verifyGroundedResponse({
        answer,
        sources: [
          { filePath: '/vault/src/auth.ts', startLine: 8, endLine: 22, snippet: 'rotateTokens()' },
        ],
        observedPaths: ['/vault/docs/audit.md'],
        stripUngroundedBrackets: true,
      });

      expect(result.report.grounded).toBe(true);
      expect(result.report.totalCitations).toBe(2);
      expect(result.report.verifiedCitations).toBe(2);
      expect(result.report.ungroundedCitations).toEqual([]);
      expect(result.sanitizedAnswer).toContain('[auth.ts#L10-L18]');
      expect(result.sanitizedAnswer).toContain('[audit.md#L1-L5]');
    });

    it('neutralizes unobserved file citations and out-of-range line citations', () => {
      const answer =
        'Verified [auth.ts#L10-L15] but hallucinated [ghost.ts#L1-L9] and wrong line [auth.ts#L900].';
      const result = verifyGroundedResponse({
        answer,
        sources: [
          { filePath: '/vault/src/auth.ts', startLine: 10, endLine: 25, snippet: 'export const ok = true;' },
        ],
        stripUngroundedBrackets: true,
      });

      expect(result.report.grounded).toBe(false);
      expect(result.report.totalCitations).toBe(3);
      expect(result.report.verifiedCitations).toBe(1);
      expect(result.report.ungroundedCitations).toEqual([
        '[ghost.ts#L1-L9]',
        '[auth.ts#L900]',
      ]);
      expect(result.sanitizedAnswer).toContain('[auth.ts#L10-L15]');
      expect(result.sanitizedAnswer).not.toContain('[ghost.ts#L1-L9]');
      expect(result.sanitizedAnswer).toContain('(unverified: ghost.ts#L1-L9)');
      expect(result.sanitizedAnswer).toContain('(unverified: auth.ts#L900)');
    });

    it('blocks SecretGuard filenames and redacts inline secret tokens', () => {
      const secretToken = ['sk', 'proj', '1234567890ABCDEFGHIJKLMN'].join('-');
      const answer = `Do not expose [.env#L1-L3] or key ${secretToken}.`;
      const result = verifyGroundedResponse({
        answer,
        sources: [{ filePath: '/vault/.env', startLine: 1, endLine: 5 }],
        observedPaths: ['/vault/.env'],
        stripUngroundedBrackets: true,
      });

      expect(result.report.grounded).toBe(false);
      expect(result.report.redactionsApplied).toBeGreaterThan(0);
      expect(result.sanitizedAnswer).not.toContain('[.env#L1-L3]');
      expect(result.sanitizedAnswer).not.toContain(secretToken);
      expect(result.sanitizedAnswer).toContain('(unverified: .env#L1-L3)');
    });

    it('rejects oversized endLine ranges, prevents subdir basename collisions, and preserves markdown hyperlinks', () => {
      const result = verifyGroundedResponse({
        answer:
          'Check [a/index.ts#L10-L15] vs [a/index.ts#L10-L500] and read [index.ts](./index.ts).',
        sources: [
          { filePath: '/vault/b/index.ts', startLine: 1, endLine: 40 },
          { filePath: '/vault/a/index.ts', startLine: 10, endLine: 25 },
        ],
        stripUngroundedBrackets: true,
      });

      expect(result.report.totalCitations).toBe(2);
      expect(result.report.verifiedCitations).toBe(1);
      expect(result.report.ungroundedCitations).toEqual(['[a/index.ts#L10-L500]']);
      expect(result.sanitizedAnswer).toContain('[a/index.ts#L10-L15]');
      expect(result.sanitizedAnswer).toContain('(unverified: a/index.ts#L10-L500)');
      expect(result.sanitizedAnswer).toContain('[index.ts](./index.ts)');
    });
  });

  describe('TraceLedger & WorkspaceKnowledgeGraph persistence', () => {
    it('redacts sensitive tokens in trace persistence and replays deterministic timelines', () => {
      const secretBearer = `Bearer ${['ghp', 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4'].join('_')}`;
      const kg = new WorkspaceKnowledgeGraph(path.join(tmpDir, 'kg.sqlite'));
      try {
        const fakeRun: AgentRunResult = {
          answer: 'Clean summary',
          traceId: 'trace-redaction-1',
          terminationReason: 'answered',
          stepLimitReached: false,
          aborted: false,
          promptVersion: AGENT_ORCHESTRATOR_PROMPT_VERSION,
          duplicateCallsPrevented: 1,
          usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
          steps: [
            {
              step: 1,
              phase: 'act',
              thought: `Check header ${secretBearer}`,
              tool: 'search_content',
              arguments: { query: `token=${secretBearer}` },
              allowed: true,
              observationSummary: `Matched 1 file containing ${secretBearer}`,
              durationMs: 14,
              parallelGroupSize: 2,
            },
            {
              step: 2,
              phase: 'act',
              tool: 'search_content',
              arguments: { query: 'auth' },
              allowed: true,
              observationSummary: '[CACHED] search_content("auth")',
              durationMs: 0,
              duplicatePrevented: true,
            },
          ],
          sources: [
            {
              filePath: path.join(tmpDir, 'notes.md'),
              startLine: 1,
              endLine: 4,
              snippet: `Header: ${secretBearer}`,
            },
          ],
          verification: {
            grounded: true,
            totalCitations: 1,
            verifiedCitations: 1,
            ungroundedCitations: [],
            redactionsApplied: 1,
            audits: [],
            checkedAt: Date.now(),
          },
        };

        const record = buildRedactedTraceRecord({
          mode: 'agent',
          model: 'llama3.2',
          provider: 'ollama',
          query: `Inspect auth key ${secretBearer}`,
          runResult: fakeRun,
          durationMs: 42,
        });

        kg.recordAgentTrace(record);
        const fetched = kg.getRecentAgentTraces(10);
        expect(fetched).toHaveLength(1);
        const persisted = fetched[0];

        const serialized = JSON.stringify(persisted);
        expect(serialized).not.toContain('A1B2C3D4E5F6G7H8I9J0K1L2M3N4');
        expect(persisted.traceId).toBe('trace-redaction-1');
        expect(persisted.duplicateCallsPrevented).toBe(1);
        expect(persisted.totalTokens).toBe(165);

        const replayed = replayTraceTimeline(persisted);
        expect(replayed.status).toBe('answered');
        expect(replayed.grounded).toBe(true);
        expect(replayed.timeline.map((e) => e.phase)).toEqual(['act', 'act', 'verify']);

        const cleared = kg.clearAgentTraces();
        expect(cleared).toBe(1);
        expect(kg.getRecentAgentTraces(10)).toHaveLength(0);
      } finally {
        kg.close();
      }
    });
  });
});
