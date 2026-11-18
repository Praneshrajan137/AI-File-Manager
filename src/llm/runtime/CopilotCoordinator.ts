/**
 * CopilotCoordinator.ts - Orchestrates streamed RAG and multi-step WorkspaceReActAgent queries,
 * automatic Tier A offline retrieval fallback when Tier B / local LLM daemon is unavailable,
 * SecretGuard output redaction, citation grounding verification, and redacted trace storage.
 */

import * as crypto from 'crypto';
import path from 'path';
import {
  AgentRunResult,
  AgentTraceStep,
  CopilotContextScope,
  CopilotQueryMode,
  PersistedAgentTraceRecord,
  RetrievalResult,
  RetrievalSource,
} from '../../shared/contracts';
import { IPCResponseMap } from '../../shared/ipc/contracts';
import { LLMLogger } from '../../shared/logging';
import { formatUntrustedWorkspaceData } from '../../shared/pure/promptFence';
import { createStreamingSecretRedactor } from '../../shared/security/SecretGuard';
import { WorkspaceReActAgent } from '../agent/WorkspaceReActAgent';
import { verifyGroundedResponse } from '../orchestration/GroundingVerifier';
import {
  AGENT_ORCHESTRATOR_PROMPT_VERSION,
  buildRedactedTraceRecord,
} from '../orchestration/TraceLedger';
import {
  IStreamTarget,
  IWorkspaceOrganizerPort,
  IWorkspaceSearchPort,
} from '../ports/IntelligencePorts';
import { LLMMetrics, MetricOperation } from '../services/LLMMetrics';
import { IntelligenceRuntime } from './IntelligenceRuntime';

const AGENT_DEFAULT_TIMEOUT_MS = 45_000;
const AGENT_MAX_CONSECUTIVE_DUPLICATES = 2;

export interface CopilotQueryInput {
  query: string;
  channel: string;
  mode?: CopilotQueryMode;
  contextScope?: CopilotContextScope;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface CopilotCoordinatorDeps {
  runtime: IntelligenceRuntime;
  searchPort: IWorkspaceSearchPort;
  createOrganizer: () => IWorkspaceOrganizerPort;
}

function countUniqueParallelBatches(steps: AgentTraceStep[]): number {
  return new Set(
    steps
      .filter((s) => !s.duplicatePrevented && (s.parallelGroupSize ?? 1) > 1)
      .map((s) => s.step)
  ).size;
}

export class CopilotCoordinator {
  private readonly activeQueryAbortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: CopilotCoordinatorDeps) {}

  getActiveQueriesCount(): number {
    return this.activeQueryAbortControllers.size;
  }

  abortQuery(channel: string): { aborted: boolean } {
    const controller = this.activeQueryAbortControllers.get(channel);
    if (!controller) {
      return { aborted: false };
    }
    controller.abort();
    this.activeQueryAbortControllers.delete(channel);
    return { aborted: true };
  }

  abortAll(): void {
    for (const ctrl of this.activeQueryAbortControllers.values()) {
      ctrl.abort();
    }
    this.activeQueryAbortControllers.clear();
  }

  getRecentAgentTraces(limit?: number): { traces: PersistedAgentTraceRecord[] } {
    const traces = this.deps.runtime.withKnowledgeGraph((kg) =>
      kg.getRecentAgentTraces(limit ?? 25)
    );
    return { traces };
  }

  clearAgentTracesHistory(): { cleared: number } {
    const cleared = this.deps.runtime.withKnowledgeGraph((kg) => kg.clearAgentTraces());
    return { cleared };
  }

  private persistAgentTraceSafely(record: PersistedAgentTraceRecord): void {
    try {
      this.deps.runtime.withKnowledgeGraph((kg) => {
        kg.recordAgentTrace(record);
      });
    } catch (err: unknown) {
      LLMLogger.warn('Failed to persist agent trace record', {
        traceId: record.traceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async collectPinnedSelectionContext(
    contextScope?: CopilotContextScope
  ): Promise<{ blocks: string[]; sources: RetrievalSource[] }> {
    const blocks: string[] = [];
    const sources: RetrievalSource[] = [];
    if (
      !contextScope?.useSelection ||
      !Array.isArray(contextScope.selectedPaths) ||
      contextScope.selectedPaths.length === 0
    ) {
      return { blocks, sources };
    }

    for (const candidate of contextScope.selectedPaths.slice(0, 3)) {
      const check = await this.deps.runtime.deps.pathPort.validateCanonical(candidate);
      if (!check.valid || !check.canonicalPath) continue;
      try {
        const range = await this.deps.runtime.readSecretGuardedRange(check.canonicalPath, 1, 50);
        if (range.lines.length === 0) continue;
        const citation = `${path.basename(range.path)}#L${range.startLine}-L${range.endLine}`;
        const body = range.lines.map((l) => `${l.lineNumber}: ${l.text}`).join('\n');
        blocks.push(formatUntrustedWorkspaceData(range.path, citation, body));
        sources.push({
          filePath: range.path,
          startLine: range.startLine,
          endLine: range.endLine,
          snippet: body.slice(0, 200),
        });
      } catch {
        // Ignore non-file or unreadable selection items
      }
    }
    return { blocks, sources };
  }

  private async buildRetrievalResultWithTierAFallback(
    query: string,
    contextScope?: CopilotContextScope
  ): Promise<{ retrievalResult: RetrievalResult; retrievalMs: number }> {
    const retrievalStart = Date.now();
    const tierBReady = await this.deps.runtime.tryEnsureTierBInitialized();

    let retrievalResult: RetrievalResult;
    if (tierBReady && this.deps.runtime.retrievalService) {
      retrievalResult = await this.deps.runtime.retrievalService.retrieve(query, contextScope);
    } else {
      const rootScope =
        contextScope?.useFolder && contextScope.currentPath ? contextScope.currentPath : undefined;
      const lexicalHits = this.deps.runtime.searchWorkspaceContent(query, 8, rootScope);
      const blocks = lexicalHits.map((hit) => {
        const lineTag =
          hit.startLine !== undefined
            ? `#L${hit.startLine}${hit.endLine && hit.endLine !== hit.startLine ? `-L${hit.endLine}` : ''}`
            : '';
        return formatUntrustedWorkspaceData(
          hit.filePath,
          `${hit.fileName}${lineTag}`,
          hit.snippet,
          hit.heading
        );
      });
      const sources = Array.from(new Set(lexicalHits.map((hit) => hit.filePath)));
      const structuredSources: RetrievalSource[] = lexicalHits.map((hit) => ({
        filePath: hit.filePath,
        startLine: hit.startLine,
        endLine: hit.endLine,
        heading: hit.heading,
        score: hit.score,
        snippet: hit.snippet,
      }));
      const context = blocks.join('\n\n');
      retrievalResult = {
        context,
        sources,
        tokenCount: Math.ceil(context.length / 4),
        structuredSources,
      };
    }

    const retrievalMs = Date.now() - retrievalStart;
    const pinned = await this.collectPinnedSelectionContext(contextScope);
    if (pinned.blocks.length > 0) {
      const pinnedPrefix = pinned.blocks.join('\n\n');
      retrievalResult.context = retrievalResult.context
        ? `${pinnedPrefix}\n\n${retrievalResult.context}`
        : pinnedPrefix;
      retrievalResult.sources = Array.from(
        new Set([...pinned.sources.map((s) => s.filePath), ...retrievalResult.sources])
      );
      retrievalResult.structuredSources = [
        ...pinned.sources,
        ...(retrievalResult.structuredSources ?? []),
      ];
    }

    return { retrievalResult, retrievalMs };
  }

  private completeOfflineResponse(params: {
    mode: CopilotQueryMode;
    model: string;
    query: string;
    retrievalResult: RetrievalResult;
    retrievalMs: number;
    channel: string;
    safeSend: (streamChannel: string, payload: unknown) => void;
    observedPaths?: string[];
    agentSteps?: AgentTraceStep[];
  }): IPCResponseMap['LLM:QUERY'] {
    const structuredSources: RetrievalSource[] =
      params.retrievalResult.structuredSources ??
      params.retrievalResult.sources.map((filePath) => ({ filePath }));

    const activeKg = this.deps.runtime.withKnowledgeGraph((kg) => {
      const synth = this.deps.runtime.offlineSynthesis.synthesize({
        query: params.query,
        retrievalResult: params.retrievalResult,
        knowledgeGraph: kg,
      });
      return synth;
    });

    const verificationOutcome = verifyGroundedResponse({
      answer: activeKg.answer,
      sources: structuredSources,
      observedPaths: params.observedPaths,
      stripUngroundedBrackets: true,
    });
    const traceId = crypto.randomUUID();
    const runResult: AgentRunResult = {
      answer: verificationOutcome.sanitizedAnswer,
      steps: params.agentSteps ?? [],
      sources: activeKg.sources.length > 0 ? activeKg.sources : structuredSources,
      stepLimitReached: false,
      aborted: false,
      traceId,
      terminationReason: 'offline_fallback',
      verification: verificationOutcome.report,
      durationMs: params.retrievalMs,
      promptVersion: AGENT_ORCHESTRATOR_PROMPT_VERSION,
    };

    params.safeSend(params.channel, verificationOutcome.sanitizedAnswer);
    params.safeSend(`${params.channel}:end`, {
      ok: true,
      sanitizedAnswer: verificationOutcome.sanitizedAnswer,
      offlineSynthesis: true,
      sources: runResult.sources,
      ...(params.agentSteps ? { agentSteps: params.agentSteps } : {}),
      traceId,
      terminationReason: 'offline_fallback',
      verification: verificationOutcome.report,
      retrievalMs: params.retrievalMs,
      generationMs: 0,
    });

    this.persistAgentTraceSafely(
      buildRedactedTraceRecord({
        traceId,
        mode: params.mode,
        model: params.model,
        provider: 'offline_graph',
        query: params.query,
        runResult,
        statusOverride: 'offline_fallback',
        durationMs: params.retrievalMs,
      })
    );
    this.deps.runtime.deps.diagnostics.recordLlmQuery?.({
      success: true,
      retrievalMs: params.retrievalMs,
      generationMs: 0,
      provider: 'offline_graph',
      model: params.model,
    });
    this.deps.runtime.deps.diagnostics.recordOrchestratorOutcome?.({
      isAgentMode: params.mode === 'agent',
      ungroundedBlocked: verificationOutcome.report.ungroundedCitations.length,
    });

    return {
      success: true,
      sanitizedAnswer: verificationOutcome.sanitizedAnswer,
      offlineSynthesis: true,
      sources: runResult.sources,
      ...(params.agentSteps ? { agentSteps: params.agentSteps } : {}),
      traceId,
      terminationReason: 'offline_fallback',
      verification: verificationOutcome.report,
      retrievalMs: params.retrievalMs,
      generationMs: 0,
    };
  }

  async executeQuery(
    streamTarget: IStreamTarget,
    input: CopilotQueryInput
  ): Promise<IPCResponseMap['LLM:QUERY']> {
    const { query, channel, mode = 'rag', contextScope, history } = input;
    LLMLogger.info('LLM query received', { query: query.substring(0, 100), mode });

    const safeSend = (streamChannel: string, payload: unknown): void => {
      if (!streamTarget.isDestroyed()) {
        streamTarget.send(streamChannel, payload);
      }
    };

    let retrievalMs = 0;
    let generationMs = 0;
    const startedAt = Date.now();
    const queryAbort = new AbortController();
    this.activeQueryAbortControllers.set(channel, queryAbort);
    const abortOnDestroy = (): void => {
      queryAbort.abort();
    };
    streamTarget.onceDestroyed?.(abortOnDestroy);

    return this.deps.runtime.withKnowledgeGraphSession(async (): Promise<IPCResponseMap['LLM:QUERY']> => {
      const { modelManager, configPort, diagnostics } = this.deps.runtime.deps;
      const llmConfig = configPort.readLlmConfig();
      const transportCfg = modelManager.resolveActiveTransportSettings();

      try {
        const activeClient =
          this.deps.runtime.llmInterface ?? modelManager.createTransientClient(transportCfg);
        const activeModel = llmConfig?.model || activeClient.getModel();

        if (mode === 'agent') {
          const runtimeAvailable = await activeClient.checkConnection();
          if (!runtimeAvailable) {
            const retrieved = await this.buildRetrievalResultWithTierAFallback(query, contextScope);
            retrievalMs = retrieved.retrievalMs;
            const rootScope =
              contextScope?.useFolder && contextScope.currentPath
                ? contextScope.currentPath
                : undefined;
            const matchedFiles = await this.deps.searchPort.searchPaths(query, rootScope).catch(() => []);
            const contentHits = this.deps.runtime.searchWorkspaceContent(query, 6, rootScope);
            const offlineSteps: AgentTraceStep[] = [
              {
                step: 1,
                thought: 'Local LLM runtime inactive; running deterministic local workspace inspection.',
                tool: 'search_files',
                arguments: { query, rootPath: rootScope },
                allowed: true,
                observationSummary: `Found ${matchedFiles.length} matching path(s)`,
                durationMs: Math.max(1, retrievalMs),
                phase: 'act',
              },
              {
                step: 2,
                thought: 'Gathering FTS5 lexical + hybrid RAG citations from Knowledge Graph.',
                tool: 'search_content',
                arguments: { query, topK: 6, rootPath: rootScope },
                allowed: true,
                observationSummary: `Matched ${contentHits.length} lexical & ${retrieved.retrievalResult.sources.length} semantic sources`,
                durationMs: 1,
                phase: 'act',
              },
            ];
            for (const step of offlineSteps) {
              safeSend(`${channel}:step`, step);
            }
            return this.completeOfflineResponse({
              mode: 'agent',
              model: activeModel,
              query,
              retrievalResult: retrieved.retrievalResult,
              retrievalMs,
              channel,
              safeSend,
              agentSteps: offlineSteps,
              observedPaths: [
                ...matchedFiles,
                ...contentHits.map((h) => h.filePath),
                ...(retrieved.retrievalResult.structuredSources?.map((s) => s.filePath) ?? []),
              ],
            });
          }

          const agent = new WorkspaceReActAgent({
            provider: transportCfg.provider,
            ollamaUrl: transportCfg.baseUrl,
            model: activeModel,
            temperature: llmConfig?.temperature,
            maxTokens: llmConfig?.maxTokens,
            searchFiles: (q, root) => this.deps.searchPort.searchPaths(q, root),
            searchContent: (q, topK, root) =>
              this.deps.runtime.searchWorkspaceContent(q, topK ?? 8, root),
            readFileRange: (filePath, startLine, endLine) =>
              this.deps.runtime.readSecretGuardedRange(filePath, startLine, endLine),
            queryGraph: (graphInput) => this.deps.runtime.queryWorkspaceGraphInsights(graphInput),
            proposeOrganizePlan: (targetDir, strategy, signal) =>
              this.deps.createOrganizer().proposeOrganizationPlan({
                targetDir,
                strategy,
                useLLM: true,
                signal,
              }),
            validatePath: (candidate) => this.deps.runtime.deps.pathPort.validateCanonical(candidate),
          });

          const agentStart = Date.now();
          const agentResult = await agent.run(query, {
            maxSteps: 4,
            maxConsecutiveDuplicates: AGENT_MAX_CONSECUTIVE_DUPLICATES,
            runTimeoutMs: AGENT_DEFAULT_TIMEOUT_MS,
            contextScope,
            history,
            signal: queryAbort.signal,
            onStep: (step): void => {
              safeSend(`${channel}:step`, step);
            },
          });
          const totalAgentMs = Date.now() - agentStart;
          retrievalMs = agentResult.steps.reduce(
            (sum, s) => sum + (s.duplicatePrevented ? 0 : s.durationMs),
            0
          );
          generationMs = Math.max(0, totalAgentMs - retrievalMs);
          LLMMetrics.getInstance().recordTiming(MetricOperation.LLM_QUERY, generationMs);

          if (agentResult.answer && !streamTarget.isDestroyed()) {
            safeSend(channel, agentResult.answer);
          }

          safeSend(`${channel}:end`, {
            ok: true,
            sanitizedAnswer: agentResult.answer,
            sources: agentResult.sources,
            agentSteps: agentResult.steps,
            proposedPlan: agentResult.proposedPlan,
            traceId: agentResult.traceId,
            terminationReason: agentResult.terminationReason,
            verification: agentResult.verification,
            usage: agentResult.usage,
            retrievalMs,
            generationMs,
          });

          this.persistAgentTraceSafely(
            buildRedactedTraceRecord({
              traceId: agentResult.traceId,
              mode: 'agent',
              model: activeModel,
              provider: transportCfg.provider,
              query,
              runResult: agentResult,
              durationMs: totalAgentMs,
            })
          );
          diagnostics.recordLlmQuery?.({
            success: true,
            retrievalMs,
            generationMs,
            provider: llmConfig?.provider ?? 'ollama',
            model: activeModel,
          });
          diagnostics.recordOrchestratorOutcome?.({
            isAgentMode: true,
            parallelBatches: countUniqueParallelBatches(agentResult.steps),
            cyclesPrevented: agentResult.duplicateCallsPrevented ?? 0,
            ungroundedBlocked: agentResult.verification?.ungroundedCitations.length ?? 0,
            tokensConsumed: agentResult.usage?.totalTokens ?? 0,
          });

          return {
            success: true,
            sanitizedAnswer: agentResult.answer,
            sources: agentResult.sources,
            agentSteps: agentResult.steps,
            proposedPlan: agentResult.proposedPlan,
            traceId: agentResult.traceId,
            terminationReason: agentResult.terminationReason,
            verification: agentResult.verification,
            usage: agentResult.usage,
            retrievalMs,
            generationMs,
          };
        }

        // RAG mode: works seamlessly via Tier B hybrid vector+FTS5 or Tier A FTS5 fallback
        const retrieved = await this.buildRetrievalResultWithTierAFallback(query, contextScope);
        retrievalMs = retrieved.retrievalMs;
        const retrievalResult = retrieved.retrievalResult;
        LLMLogger.info('Context retrieved', {
          sources: retrievalResult.sources.length,
          tokens: retrievalResult.tokenCount,
        });

        const runtimeAvailable = await activeClient.checkConnection();
        if (!runtimeAvailable) {
          return this.completeOfflineResponse({
            mode: 'rag',
            model: activeModel,
            query,
            retrievalResult,
            retrievalMs,
            channel,
            safeSend,
          });
        }

        const structuredSources: RetrievalSource[] =
          retrievalResult.structuredSources ??
          retrievalResult.sources.map((filePath) => ({ filePath }));

        const genStart = Date.now();
        let streamedAnswer = '';
        const streamRedactor = createStreamingSecretRedactor();
        for await (const chunk of activeClient.query(query, retrievalResult, {
          model: llmConfig?.model,
          temperature: llmConfig?.temperature,
          maxTokens: llmConfig?.maxTokens,
          signal: queryAbort.signal,
          history,
        })) {
          if (streamTarget.isDestroyed() || queryAbort.signal.aborted) {
            queryAbort.abort();
            break;
          }
          streamedAnswer += chunk;
          const safeDelta = streamRedactor.push(chunk);
          if (safeDelta) {
            safeSend(channel, safeDelta);
          }
        }
        const streamTail = streamRedactor.flush();
        if (streamTail && !streamTarget.isDestroyed() && !queryAbort.signal.aborted) {
          safeSend(channel, streamTail);
        }
        generationMs = Date.now() - genStart;
        LLMMetrics.getInstance().recordTiming(MetricOperation.LLM_QUERY, generationMs);

        const verificationOutcome = verifyGroundedResponse({
          answer: streamedAnswer,
          sources: structuredSources,
          stripUngroundedBrackets: true,
        });
        const traceId = crypto.randomUUID();
        const ragRunResult: AgentRunResult = {
          answer: verificationOutcome.sanitizedAnswer,
          steps: [],
          sources: structuredSources,
          stepLimitReached: false,
          aborted: queryAbort.signal.aborted,
          traceId,
          terminationReason: queryAbort.signal.aborted ? 'aborted' : 'answered',
          verification: verificationOutcome.report,
          durationMs: retrievalMs + generationMs,
          promptVersion: AGENT_ORCHESTRATOR_PROMPT_VERSION,
        };

        safeSend(`${channel}:end`, {
          ok: true,
          sanitizedAnswer: verificationOutcome.sanitizedAnswer,
          sources: structuredSources,
          traceId,
          terminationReason: ragRunResult.terminationReason,
          verification: verificationOutcome.report,
          retrievalMs,
          generationMs,
        });

        this.persistAgentTraceSafely(
          buildRedactedTraceRecord({
            traceId,
            mode: 'rag',
            model: activeModel,
            provider: transportCfg.provider,
            query,
            runResult: ragRunResult,
            durationMs: Date.now() - startedAt,
          })
        );
        diagnostics.recordLlmQuery?.({
          success: true,
          retrievalMs,
          generationMs,
          provider: llmConfig?.provider ?? 'ollama',
          model: llmConfig?.model,
        });
        diagnostics.recordOrchestratorOutcome?.({
          isAgentMode: false,
          ungroundedBlocked: verificationOutcome.report.ungroundedCitations.length,
        });

        return {
          success: true,
          sanitizedAnswer: verificationOutcome.sanitizedAnswer,
          sources: structuredSources,
          traceId,
          terminationReason: ragRunResult.terminationReason,
          verification: verificationOutcome.report,
          retrievalMs,
          generationMs,
        };
      } catch (error: unknown) {
        if (queryAbort.signal.aborted) {
          const traceId = crypto.randomUUID();
          this.persistAgentTraceSafely(
            buildRedactedTraceRecord({
              traceId,
              mode,
              model: transportCfg.model,
              provider: transportCfg.provider,
              query,
              runResult: {
                answer: '',
                steps: [],
                sources: [],
                stepLimitReached: false,
                aborted: true,
                traceId,
                terminationReason: 'aborted',
              },
              statusOverride: 'aborted',
              durationMs: Date.now() - startedAt,
            })
          );
          safeSend(`${channel}:end`, {
            ok: true,
            aborted: true,
            traceId,
            terminationReason: 'aborted',
          });
          return { success: true, traceId, terminationReason: 'aborted' };
        }

        const rawMsg = error instanceof Error ? error.message : String(error);
        const msg = this.deps.runtime.deps.sanitizeError(rawMsg);
        const traceId = crypto.randomUUID();
        safeSend(channel, `Error: ${msg}`);
        safeSend(`${channel}:end`, {
          ok: false,
          error: msg,
          traceId,
          terminationReason: 'model_error',
        });

        this.persistAgentTraceSafely(
          buildRedactedTraceRecord({
            traceId,
            mode,
            model: transportCfg.model,
            provider: transportCfg.provider,
            query,
            runResult: {
              answer: '',
              steps: [],
              sources: [],
              stepLimitReached: false,
              aborted: false,
              traceId,
              terminationReason: 'model_error',
            },
            statusOverride: 'model_error',
            durationMs: Date.now() - startedAt,
            errorSummary: msg,
          })
        );
        diagnostics.recordLlmQuery?.({
          success: false,
          retrievalMs,
          generationMs,
          error: msg,
          provider: llmConfig?.provider ?? 'ollama',
          model: llmConfig?.model,
        });
        return { success: false, error: msg, traceId, terminationReason: 'model_error' };
      } finally {
        this.activeQueryAbortControllers.delete(channel);
        streamTarget.removeDestroyedListener?.(abortOnDestroy);
      }
    });
  }
}
