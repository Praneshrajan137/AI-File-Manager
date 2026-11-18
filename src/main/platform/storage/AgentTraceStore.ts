/**
 * AgentTraceStore.ts - SecretGuard-redacted Copilot/Agent execution trace persistence.
 */

import {
  MAX_PERSISTED_TRACE_RECORDS,
  PersistedAgentTraceRecord,
} from '@shared/contracts';
import { redactSensitiveText } from '@shared/security/SecretGuard';
import { VaultSqliteDb } from './VaultSqliteDb';

export class AgentTraceStore {
  constructor(private readonly sqliteDb: VaultSqliteDb) {}

  recordAgentTrace(record: PersistedAgentTraceRecord): void {
    const db = this.sqliteDb.getDb();
    const safeQueryPreview = redactSensitiveText(record.queryPreview).sanitizedText.slice(0, 220);
    const safeError = record.errorSummary
      ? redactSensitiveText(record.errorSummary).sanitizedText.slice(0, 300)
      : null;
    const rawJson = JSON.stringify({
      steps: record.steps,
      sources: record.sources,
      verification: record.verification,
    });
    const safePayloadJson = redactSensitiveText(rawJson).sanitizedText;

    this.sqliteDb.withTransaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO agent_traces (
          trace_id, created_at, mode, model, provider, prompt_version,
          query_preview, status, duration_ms, step_count,
          duplicate_calls_prevented, verified_citations, ungrounded_citations_count,
          redactions_applied, prompt_tokens, completion_tokens, total_tokens,
          error_summary, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.traceId,
        record.createdAt,
        record.mode,
        record.model,
        record.provider,
        record.promptVersion,
        safeQueryPreview,
        record.status,
        record.durationMs,
        record.stepCount,
        record.duplicateCallsPrevented,
        record.verifiedCitations,
        record.ungroundedCitationsCount,
        record.redactionsApplied,
        record.promptTokens ?? null,
        record.completionTokens ?? null,
        record.totalTokens ?? null,
        safeError,
        safePayloadJson
      );

      db.prepare(`
        DELETE FROM agent_traces
        WHERE trace_id NOT IN (
          SELECT trace_id FROM agent_traces ORDER BY created_at DESC LIMIT ?
        )
      `).run(MAX_PERSISTED_TRACE_RECORDS);
    });
  }

  getRecentAgentTraces(limit: number = 25): PersistedAgentTraceRecord[] {
    const db = this.sqliteDb.getDb();
    const clamped = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = db
      .prepare(`
        SELECT trace_id, created_at, mode, model, provider, prompt_version,
               query_preview, status, duration_ms, step_count,
               duplicate_calls_prevented, verified_citations, ungrounded_citations_count,
               redactions_applied, prompt_tokens, completion_tokens, total_tokens,
               error_summary, payload_json
        FROM agent_traces
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(clamped) as Array<{
      trace_id: string;
      created_at: number;
      mode: string;
      model: string;
      provider: string;
      prompt_version: string;
      query_preview: string;
      status: string;
      duration_ms: number;
      step_count: number;
      duplicate_calls_prevented: number;
      verified_citations: number;
      ungrounded_citations_count: number;
      redactions_applied: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      error_summary: string | null;
      payload_json: string;
    }>;

    return rows.map((row) => {
      let parsedPayload: {
        steps?: PersistedAgentTraceRecord['steps'];
        sources?: PersistedAgentTraceRecord['sources'];
        verification?: PersistedAgentTraceRecord['verification'];
      } = {};
      try {
        parsedPayload = JSON.parse(row.payload_json) as typeof parsedPayload;
      } catch {
        parsedPayload = {};
      }
      return {
        traceId: row.trace_id,
        createdAt: Number(row.created_at),
        mode: row.mode === 'agent' ? 'agent' : 'rag',
        model: row.model,
        provider: row.provider,
        promptVersion: row.prompt_version,
        queryPreview: row.query_preview,
        status: row.status as PersistedAgentTraceRecord['status'],
        durationMs: Number(row.duration_ms),
        stepCount: Number(row.step_count),
        duplicateCallsPrevented: Number(row.duplicate_calls_prevented),
        verifiedCitations: Number(row.verified_citations),
        ungroundedCitationsCount: Number(row.ungrounded_citations_count),
        redactionsApplied: Number(row.redactions_applied),
        ...(row.prompt_tokens !== null ? { promptTokens: Number(row.prompt_tokens) } : {}),
        ...(row.completion_tokens !== null ? { completionTokens: Number(row.completion_tokens) } : {}),
        ...(row.total_tokens !== null ? { totalTokens: Number(row.total_tokens) } : {}),
        ...(row.error_summary ? { errorSummary: row.error_summary } : {}),
        steps: Array.isArray(parsedPayload.steps) ? parsedPayload.steps : [],
        sources: Array.isArray(parsedPayload.sources) ? parsedPayload.sources : [],
        ...(parsedPayload.verification ? { verification: parsedPayload.verification } : {}),
      };
    });
  }

  clearAgentTraces(): number {
    const db = this.sqliteDb.getDb();
    const res = db.prepare('DELETE FROM agent_traces').run();
    return Number(res.changes ?? 0);
  }
}
