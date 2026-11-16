import type {
  AgentTerminationReason,
  AgentTokenUsage,
  AgentTraceStep,
  AgentVerificationReport,
  OrganizePlanResult,
  RetrievalSource,
} from '@shared/contracts';
import type { Message, SendQueryOptions } from './useLLM';

export interface LLMQueryResultShape {
  success?: boolean;
  error?: string;
  sanitizedAnswer?: string;
  sources?: RetrievalSource[];
  agentSteps?: AgentTraceStep[];
  offlineSynthesis?: boolean;
  proposedPlan?: OrganizePlanResult;
  traceId?: string;
  terminationReason?: AgentTerminationReason;
  verification?: AgentVerificationReport;
  usage?: AgentTokenUsage;
  retrievalMs?: number;
  generationMs?: number;
}

/** Builds an incremental assistant message metadata patch when the backend returns structured fields. */
export function buildLlmMetadataPatch(
  result: LLMQueryResultShape | undefined,
  existing?: Message
): Partial<Message> | null {
  if (!result) return null;
  const hasMetadata =
    typeof result.sanitizedAnswer === 'string' ||
    (result.sources && result.sources.length > 0) ||
    (result.agentSteps && result.agentSteps.length > 0) ||
    result.offlineSynthesis !== undefined ||
    Boolean(result.proposedPlan) ||
    Boolean(result.verification) ||
    Boolean(result.traceId) ||
    Boolean(result.terminationReason) ||
    Boolean(result.usage) ||
    result.retrievalMs !== undefined ||
    result.generationMs !== undefined;

  if (!hasMetadata) return null;

  const structuredSources = result.sources ?? [];
  const uniquePaths = Array.from(new Set(structuredSources.map((s) => s.filePath)));
  return {
    ...(typeof result.sanitizedAnswer === 'string' && result.sanitizedAnswer.length > 0
      ? { content: result.sanitizedAnswer }
      : {}),
    sources: uniquePaths.length > 0 ? uniquePaths : existing?.sources,
    structuredSources: structuredSources.length > 0 ? structuredSources : existing?.structuredSources,
    agentSteps: result.agentSteps ?? existing?.agentSteps,
    offlineSynthesis: result.offlineSynthesis ?? existing?.offlineSynthesis,
    proposedPlan: result.proposedPlan ?? existing?.proposedPlan,
    traceId: result.traceId ?? existing?.traceId,
    terminationReason: result.terminationReason ?? existing?.terminationReason,
    verification: result.verification ?? existing?.verification,
    usage: result.usage ?? existing?.usage,
    retrievalMs: result.retrievalMs ?? existing?.retrievalMs,
    generationMs: result.generationMs ?? existing?.generationMs,
  };
}

/** Formats an exception thrown during LLM query execution into a retryable assistant error message. */
export function applyQueryErrorToMessages(
  prev: Message[],
  assistantMessageId: number,
  err: unknown,
  query: string,
  options?: SendQueryOptions
): Message[] {
  const errMessage =
    err instanceof Error && err.message
      ? `Request failed: ${err.message}`
      : 'Sorry, I encountered an error processing your request. Please try again.';

  const idx = prev.findIndex((msg) => msg.id === assistantMessageId);
  if (idx >= 0) {
    return prev.map((msg, i) =>
      i === idx
        ? {
            ...msg,
            content: msg.content ? `${msg.content}\n\n${errMessage}` : errMessage,
            isError: true,
            retryQuery: query,
            retryOptions: options,
          }
        : msg
    );
  }

  return [
    ...prev,
    {
      id: assistantMessageId,
      role: 'assistant',
      content: errMessage,
      isError: true,
      retryQuery: query,
      retryOptions: options,
      timestamp: Date.now(),
    },
  ];
}
