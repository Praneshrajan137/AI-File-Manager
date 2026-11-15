/**
 * TraceLedger.ts - SecretGuard-Redacted Orchestration Trace Serializer & Replay
 *
 * Ensures every persisted Copilot/Agent decision step, argument, source snippet,
 * and verification audit passes SecretGuard redaction before hitting SQLite or IPC.
 */

import * as crypto from 'crypto';
import {
  AgentRunResult,
  AgentTerminationReason,
  AgentTraceStep,
  CopilotQueryMode,
  PersistedAgentTraceRecord,
  RetrievalSource,
} from '../../shared/contracts';
import { redactSensitiveText } from '../../shared/security/SecretGuard';

export const AGENT_ORCHESTRATOR_PROMPT_VERSION = 'copilot-orchestrator-v2';
export const MAX_PERSISTED_TRACE_RECORDS = 200;

function redactUnknownArgs(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      sanitized[k] = redactSensitiveText(v).sanitizedText.slice(0, 300);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      sanitized[k] = v;
    } else if (Array.isArray(v)) {
      sanitized[k] = v.slice(0, 10).map((item) =>
        typeof item === 'string' ? redactSensitiveText(item).sanitizedText.slice(0, 120) : String(item)
      );
    } else if (v !== undefined) {
      sanitized[k] = '[object]';
    }
  }
  return sanitized;
}

function redactTraceSteps(steps: AgentTraceStep[]): AgentTraceStep[] {
  return steps.map((step) => ({
    ...step,
    thought: step.thought ? redactSensitiveText(step.thought).sanitizedText.slice(0, 300) : undefined,
    arguments: redactUnknownArgs(step.arguments ?? {}),
    observationSummary: redactSensitiveText(step.observationSummary ?? '').sanitizedText.slice(0, 360),
  }));
}

function redactSources(sources: RetrievalSource[]): RetrievalSource[] {
  return sources.slice(0, 25).map((src) => ({
    ...src,
    heading: src.heading ? redactSensitiveText(src.heading).sanitizedText.slice(0, 140) : undefined,
    snippet: src.snippet ? redactSensitiveText(src.snippet).sanitizedText.slice(0, 240) : undefined,
  }));
}

export interface BuildTraceRecordInput {
  traceId?: string;
  mode: CopilotQueryMode;
  model: string;
  provider: string;
  query: string;
  runResult: AgentRunResult;
  statusOverride?: AgentTerminationReason;
  durationMs: number;
  errorSummary?: string;
}

export function buildRedactedTraceRecord(input: BuildTraceRecordInput): PersistedAgentTraceRecord {
  const cleanQuery = redactSensitiveText(input.query).sanitizedText.replace(/\s+/g, ' ').trim();
  const status: AgentTerminationReason =
    input.statusOverride ??
    input.runResult.terminationReason ??
    (input.runResult.aborted
      ? 'aborted'
      : input.runResult.stepLimitReached
        ? 'step_limit'
        : 'answered');

  const safeSteps = redactTraceSteps(input.runResult.steps ?? []);
  const safeSources = redactSources(input.runResult.sources ?? []);
  const verification = input.runResult.verification
    ? {
        ...input.runResult.verification,
        audits: input.runResult.verification.audits.map((a) => ({
          ...a,
          citedText: redactSensitiveText(a.citedText).sanitizedText,
          reason: redactSensitiveText(a.reason).sanitizedText,
        })),
        ungroundedCitations: input.runResult.verification.ungroundedCitations.map(
          (c) => redactSensitiveText(c).sanitizedText
        ),
      }
    : undefined;

  return {
    traceId: input.traceId || input.runResult.traceId || crypto.randomUUID(),
    createdAt: Date.now(),
    mode: input.mode,
    model: input.model,
    provider: input.provider,
    promptVersion: input.runResult.promptVersion || AGENT_ORCHESTRATOR_PROMPT_VERSION,
    queryPreview: cleanQuery.slice(0, 220),
    status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    stepCount: safeSteps.length,
    duplicateCallsPrevented:
      input.runResult.duplicateCallsPrevented ??
      safeSteps.filter((s) => s.duplicatePrevented).length,
    verifiedCitations: verification?.verifiedCitations ?? 0,
    ungroundedCitationsCount: verification?.ungroundedCitations.length ?? 0,
    redactionsApplied: verification?.redactionsApplied ?? 0,
    promptTokens: input.runResult.usage?.promptTokens,
    completionTokens: input.runResult.usage?.completionTokens,
    totalTokens: input.runResult.usage?.totalTokens,
    errorSummary: input.errorSummary
      ? redactSensitiveText(input.errorSummary).sanitizedText.slice(0, 300)
      : undefined,
    steps: safeSteps,
    sources: safeSources,
    verification,
  };
}

export interface ReplayedTimelineEntry {
  index: number;
  phase: string;
  label: string;
  durationMs: number;
  allowed: boolean;
  duplicatePrevented: boolean;
}

export interface ReplayedTraceTimeline {
  traceId: string;
  status: AgentTerminationReason;
  promptVersion: string;
  totalDurationMs: number;
  timeline: ReplayedTimelineEntry[];
  grounded: boolean;
}

export function replayTraceTimeline(record: PersistedAgentTraceRecord): ReplayedTraceTimeline {
  const timeline: ReplayedTimelineEntry[] = record.steps.map((st, idx) => ({
    index: idx + 1,
    phase: st.phase ?? 'act',
    label: `${st.tool}: ${st.observationSummary}`,
    durationMs: st.durationMs,
    allowed: st.allowed,
    duplicatePrevented: Boolean(st.duplicatePrevented),
  }));

  if (record.verification) {
    timeline.push({
      index: timeline.length + 1,
      phase: 'verify',
      label: `Grounding audit (${record.verifiedCitations} verified, ${record.ungroundedCitationsCount} ungrounded, ${record.redactionsApplied} redacted)`,
      durationMs: 0,
      allowed: true,
      duplicatePrevented: false,
    });
  }

  return {
    traceId: record.traceId,
    status: record.status,
    promptVersion: record.promptVersion,
    totalDurationMs: record.durationMs,
    timeline,
    grounded: record.ungroundedCitationsCount === 0,
  };
}
