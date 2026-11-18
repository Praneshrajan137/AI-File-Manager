import type {
  AgentTerminationReason,
  AgentTokenUsage,
  AgentTraceStep,
  AgentVerificationReport,
  CopilotContextScope,
  CopilotQueryMode,
  IndexingStatus,
  OrganizePlanResult,
  RetrievalSource,
} from '@shared/contracts';

export type { IndexingStatus };

export interface SendQueryOptions {
  mode?: CopilotQueryMode;
  contextScope?: CopilotContextScope;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  retryQuery?: string;
  retryOptions?: SendQueryOptions;
  sources?: string[];
  structuredSources?: RetrievalSource[];
  agentSteps?: AgentTraceStep[];
  offlineSynthesis?: boolean;
  proposedPlan?: OrganizePlanResult;
  traceId?: string;
  terminationReason?: AgentTerminationReason;
  verification?: AgentVerificationReport;
  usage?: AgentTokenUsage;
  retrievalMs?: number;
  generationMs?: number;
  timestamp: number;
}
