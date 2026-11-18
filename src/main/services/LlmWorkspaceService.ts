/**
 * LlmWorkspaceService.ts - Extracted Intelligence & Orchestration Runtime Container
 *
 * Manages lazy service initialization, Knowledge Graph session reuse (eliminating
 * per-tool SQLite open/close churn while avoiding Windows teardown file locks),
 * WorkspaceReActAgent / RAG / offline synthesis execution, grounding verification,
 * and SecretGuard-redacted trace persistence.
 */

import * as crypto from 'crypto';
import { IpcMainInvokeEvent } from 'electron';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { monitorEventLoopDelay } from 'perf_hooks';
import { AppConfig, ConfigManager, resolveCanonicalVectorDbDir, resolveDefaultModelCacheDir } from '@shared/config';
import {
  AgentRunResult,
  AgentTraceStep,
  ContentSearchMatch,
  CopilotContextScope,
  CopilotQueryMode,
  FileConnectionsSummary,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  IndexingStatus,
  LLMModelsSnapshot,
  MAX_INDEXABLE_FILE_SIZE,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  PersistedAgentTraceRecord,
  RetrievalSource,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '@shared/contracts';
import { IPCResponseMap } from '@shared/ipc/contracts';
import { LLMLogger } from '@shared/logging';
import { createStreamingSecretRedactor, isSensitiveSecretFile, redactFileRangeLines } from '@shared/security/SecretGuard';
import { WorkspaceReActAgent } from '../../llm/agent/WorkspaceReActAgent';
import { verifyGroundedResponse } from '../../llm/orchestration/GroundingVerifier';
import {
  AGENT_ORCHESTRATOR_PROMPT_VERSION,
  buildRedactedTraceRecord,
} from '../../llm/orchestration/TraceLedger';
import { ContextManager, formatUntrustedWorkspaceData } from '../../llm/services/ContextManager';
import { IndexingService } from '../../llm/services/IndexingService';
import { LLMInterface } from '../../llm/services/LLMInterface';
import { LLMMetrics, MetricOperation } from '../../llm/services/LLMMetrics';
import { LocalLLMProvider, assertLoopbackLocalUrl } from '../../llm/services/LocalModelTransport';
import { OfflineSynthesisService } from '../../llm/services/OfflineSynthesisService';
import { RetrievalService } from '../../llm/services/RetrievalService';
import { clusterDocumentsByVector } from '../../llm/services/SemanticClustering';
import { DocumentVectorCentroid, VectorStore } from '../../llm/services/VectorStore';
import {
  DEFAULT_RERANKER_MODEL,
  detectSupportedTransformersDevices,
  inspectLocalModelCache,
  loadCrossEncoderReranker,
  loadFeatureExtractionPipeline,
} from '../../llm/models/transformersLoader';
import { EmbeddingWorkerPool } from '../../llm/workers/EmbeddingWorkerPool';
import { resolveAllowedRoots, validateCanonicalPathOrThrow } from '../handlers/securityMiddleware';
import { searchWorkspacePaths } from '../handlers/searchHandlers';
import { ErrorSerializer } from '../middleware/ErrorSerializer';
import { AIOrganizerService } from './AIOrganizerService';
import { DirectoryScanner } from './DirectoryScanner';
import { FileSystemService } from './FileSystemService';
import { getOperationJournal } from './OperationJournal';
import { PathValidator } from './PathValidator';
import { getReactiveWorkspaceKernel } from './ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { WorkspaceKnowledgeGraph } from './WorkspaceKnowledgeGraph';

const INDEXABLE_WATCH_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.json', '.yaml', '.yml', '.toml',
  '.xml', '.html', '.htm', '.css', '.sh', '.sql', '.log', '.csv', '.tsv',
  '.pdf', '.docx', '.ipynb',
]);

const MAX_PREINIT_MUTATIONS = 250;
const AGENT_DEFAULT_TIMEOUT_MS = 45_000;
const AGENT_MAX_CONSECUTIVE_DUPLICATES = 2;

let vectorStore: VectorStore | null = null;
let embeddingModel: EmbeddingWorkerPool | null = null;
let indexingService: IndexingService | null = null;
let retrievalService: RetrievalService | null = null;
let llmInterface: LLMInterface | null = null;
let fileSystemService: FileSystemService | null = null;
let initPromise: Promise<void> | null = null;

// Session-scoped lightweight Knowledge Graph handle prevents per-call open/close churn
// during multi-step agent runs while closing synchronously before teardown / test cleanup.
let sessionKg: WorkspaceKnowledgeGraph | null = null;
let sessionKgPath: string | null = null;
let sessionDepth = 0;

let indexingInProgress = false;
let indexedCount = 0;
let totalToIndex = 0;
let currentFile = '';
let abortIndexing = false;
let activeIndexingPromise: Promise<void> | null = null;
const activeQueryAbortControllers = new Map<string, AbortController>();
const offlineSynthesis = new OfflineSynthesisService();
const preInitMutationQueue = new Map<
  string,
  { eventType: 'create' | 'change' | 'unlink'; filePath: string }
>();

function readLlmConfig(): AppConfig['llm'] | undefined {
  try {
    return ConfigManager.getInstance().get('llm');
  } catch {
    return undefined;
  }
}

function resolveOllamaUrl(): string | undefined {
  if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.trim().length > 0) {
    return process.env.OLLAMA_URL.trim();
  }
  try {
    return ConfigManager.getInstance().get('llm')?.ollamaUrl;
  } catch {
    return undefined;
  }
}

function resolveActiveTransportSettings(): {
  provider: LocalLLMProvider;
  baseUrl: string;
  model: string;
} {
  const llmCfg = readLlmConfig();
  const provider: LocalLLMProvider = llmCfg?.provider ?? 'ollama';
  const baseUrl =
    provider === 'openai_compatible'
      ? (llmCfg?.openAiBaseUrl?.trim() || 'http://127.0.0.1:1234')
      : (resolveOllamaUrl() || 'http://localhost:11434');
  const model = llmCfg?.model?.trim() || 'llama3.2';
  return { provider, baseUrl, model };
}

export function resolveVectorDbPath(): string {
  return resolveCanonicalVectorDbDir();
}

function closeSessionKnowledgeGraph(): void {
  if (sessionKg) {
    try {
      sessionKg.close();
    } finally {
      sessionKg = null;
      sessionKgPath = null;
    }
  }
}

export async function withKnowledgeGraphSession<T>(fn: () => Promise<T>): Promise<T> {
  sessionDepth += 1;
  try {
    return await fn();
  } finally {
    sessionDepth = Math.max(0, sessionDepth - 1);
    if (sessionDepth === 0) {
      closeSessionKnowledgeGraph();
    }
  }
}

function withKnowledgeGraph<T>(fn: (kg: WorkspaceKnowledgeGraph) => T): T {
  const existingKg = vectorStore?.getKnowledgeGraph();
  if (existingKg) {
    closeSessionKnowledgeGraph();
    return fn(existingKg);
  }

  const kgFile = path.join(resolveVectorDbPath(), 'knowledge-graph.sqlite');
  if (sessionDepth > 0) {
    if (sessionKg && sessionKgPath !== kgFile) {
      closeSessionKnowledgeGraph();
    }
    if (!sessionKg) {
      sessionKg = new WorkspaceKnowledgeGraph(kgFile);
      sessionKgPath = kgFile;
    }
    return fn(sessionKg);
  }

  const ephemeralKg = new WorkspaceKnowledgeGraph(kgFile);
  try {
    return fn(ephemeralKg);
  } finally {
    ephemeralKg.close();
  }
}

async function readSecretGuardedRange(
  fsService: Pick<FileSystemService, 'readFileRange'>,
  filePath: string,
  startLine: number,
  endLine?: number
): ReturnType<FileSystemService['readFileRange']> {
  const secretCheck = isSensitiveSecretFile(filePath);
  if (secretCheck.blocked) {
    RuntimeDiagnostics.getInstance().recordSecretGuardBlock();
    const err = new Error(
      `[SECURITY_BLOCKED] SecretGuard blocked "${path.basename(filePath)}": ${secretCheck.reason || 'sensitive credential file'}`
    ) as Error & { code?: string };
    err.code = 'UNAUTHORIZED_ACCESS';
    throw err;
  }
  const result = await fsService.readFileRange(filePath, startLine, endLine);
  const { lines: sanitizedLines, redactionsCount } = redactFileRangeLines(result.lines);
  if (redactionsCount > 0) {
    RuntimeDiagnostics.getInstance().recordSecretGuardBlock();
  }
  return {
    ...result,
    lines: sanitizedLines,
  };
}

function normalizePathForRootMatch(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function stripContextualHeader(text: string): string {
  return text.replace(/^\[File:[^\]]+\]\s*\n?/i, '').trim();
}

export function searchWorkspaceContent(
  query: string,
  topK: number = 20,
  searchRoot?: string
): ContentSearchMatch[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const normalizedRoot = searchRoot ? normalizePathForRootMatch(searchRoot) : null;
  const rootPrefix = normalizedRoot
    ? normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : `${normalizedRoot}${path.sep}`
    : null;
  const fetchLimit = normalizedRoot ? Math.min(200, Math.max(topK * 4, 40)) : topK;

  return withKnowledgeGraph((kg) => {
    const scopeFilter = searchRoot ? { folderPath: searchRoot } : undefined;
    const hits = kg.searchLexical(trimmed, fetchLimit, scopeFilter);
    const results: ContentSearchMatch[] = [];
    for (const hit of hits) {
      if (normalizedRoot && rootPrefix) {
        const hitNorm = normalizePathForRootMatch(hit.filePath);
        if (hitNorm !== normalizedRoot && !hitNorm.startsWith(rootPrefix)) {
          continue;
        }
      }
      const cleanText = stripContextualHeader(hit.chunkText);
      const snippet = cleanText.length > 220 ? `${cleanText.slice(0, 217)}...` : cleanText;
      results.push({
        chunkId: hit.id,
        filePath: hit.filePath,
        fileName: path.basename(hit.filePath),
        chunkIndex: hit.chunkIndex,
        startLine: hit.startLine,
        endLine: hit.endLine,
        heading: hit.heading,
        snippet,
        score: hit.bm25Score,
      });
      if (results.length >= topK) {
        break;
      }
    }
    return results;
  });
}

export function queryWorkspaceGraphInsights(input: {
  symbolQuery?: string;
  backlinkTarget?: string;
}): GraphInsightsResponse {
  const allowedRoots = resolveAllowedRoots();
  return withKnowledgeGraph((kg) => {
    const stats = kg.getInsights(allowedRoots);
    const symbolMatches =
      input.symbolQuery && input.symbolQuery.trim().length > 0
        ? kg
            .findBySymbol(input.symbolQuery.trim(), 25)
            .filter((m) => !isSensitiveSecretFile(m.filePath).blocked)
        : undefined;
    const backlinks =
      input.backlinkTarget && input.backlinkTarget.trim().length > 0
        ? kg
            .findBacklinks(input.backlinkTarget.trim(), 50)
            .filter((b) => !isSensitiveSecretFile(b.sourcePath).blocked)
        : undefined;

    return {
      stats,
      symbolMatches,
      backlinks,
    };
  });
}

export function checkWorkspaceGraphImpact(targetPaths: string[]): GraphImpactCheckResult {
  return withKnowledgeGraph((kg) => {
    const references = kg.findImpactForPaths(targetPaths);
    const uniqueSourceFiles = new Set(references.map((r) => r.sourcePath));
    const markdownRepairableCount = references.filter((r) => r.isMarkdownLink).length;
    return {
      totalAffectedFiles: uniqueSourceFiles.size,
      markdownRepairableCount,
      references,
    };
  });
}

export function getWorkspaceGraphMapData(input?: {
  rootPrefix?: string;
  maxNodes?: number;
}): WorkspaceGraphMap {
  return withKnowledgeGraph((kg) =>
    kg.getWorkspaceGraphMap(input?.rootPrefix, input?.maxNodes ?? 240)
  );
}

async function withVectorStoreCentroids(
  filePaths?: string[]
): Promise<Map<string, DocumentVectorCentroid>> {
  if (vectorStore) {
    try {
      return await vectorStore.getDocumentCentroids(filePaths);
    } catch {
      return new Map();
    }
  }

  const dbDir = resolveVectorDbPath();
  if (!fsSync.existsSync(path.join(dbDir, 'file_chunks.lance'))) {
    return new Map();
  }

  const ephemeralStore = new VectorStore({ enableKnowledgeGraph: false });
  try {
    await ephemeralStore.initialize(dbDir);
    return await ephemeralStore.getDocumentCentroids(filePaths);
  } catch {
    return new Map();
  } finally {
    await ephemeralStore.close().catch(() => undefined);
  }
}

export async function getWorkspaceCollectionsData(input?: {
  rootPrefix?: string;
}): Promise<WorkspaceCollectionGroup[]> {
  const map = withKnowledgeGraph((kg) => kg.getWorkspaceGraphMap(input?.rootPrefix, 500));

  if (map.nodes.length >= 2) {
    const centroids = await withVectorStoreCentroids(map.nodes.map((n) => n.path));
    if (centroids.size >= 2) {
      const centroidByNorm = new Map<string, DocumentVectorCentroid>();
      for (const [k, c] of centroids.entries()) {
        centroidByNorm.set(normalizePathForRootMatch(k), c);
      }
      const docs = map.nodes
        .map((node) => {
          const centroid = centroidByNorm.get(normalizePathForRootMatch(node.path));
          if (!centroid || centroid.vector.length === 0) {
            return null;
          }
          return {
            filePath: node.path,
            name: node.name,
            fileType: node.fileType,
            chunkCount: node.chunkCount,
            vector: centroid.vector,
            topSymbols: node.topSymbols,
            textSample: centroid.sampleText,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);

      if (docs.length >= 2) {
        const { groups } = clusterDocumentsByVector(docs);
        if (groups.length > 0) {
          return groups.map(({ clusteringMode, id, label, reason, files, dominantSymbols }) => ({
            id,
            label,
            clusteringMode,
            reason,
            files,
            dominantSymbols,
          }));
        }
      }
    }
  }

  return withKnowledgeGraph((kg) => kg.getSemanticCollections(input?.rootPrefix));
}

export function getWorkspaceFileConnectionsData(filePath: string): FileConnectionsSummary {
  return withKnowledgeGraph((kg) => kg.getFileConnections(filePath));
}

function countUniqueParallelBatches(steps: AgentTraceStep[]): number {
  return new Set(
    steps
      .filter((s) => !s.duplicatePrevented && (s.parallelGroupSize ?? 1) > 1)
      .map((s) => s.step)
  ).size;
}

function persistAgentTraceSafely(record: PersistedAgentTraceRecord): void {
  try {
    withKnowledgeGraph((kg) => {
      kg.recordAgentTrace(record);
    });
  } catch (err: unknown) {
    LLMLogger.warn('Failed to persist agent trace record', {
      traceId: record.traceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createOrganizerService(): AIOrganizerService {
  const kernel = getReactiveWorkspaceKernel();
  const fsService = kernel.getFileSystemService();
  const validator = new PathValidator(fsService.getAllowedRoots());
  const transportCfg = resolveActiveTransportSettings();
  const llmCfg = readLlmConfig();
  const configuredEmbModel = llmCfg?.embeddingModel ?? 'Xenova/bge-small-en-v1.5';

  return new AIOrganizerService({
    validator,
    operationJournal: getOperationJournal(),
    provider: transportCfg.provider,
    ollamaUrl: transportCfg.baseUrl,
    model: transportCfg.model,
    findImpactForPaths: (targetPaths) => withKnowledgeGraph((kg) => kg.findImpactForPaths(targetPaths)),
    getDocumentVectors: async (filePaths): Promise<Map<string, number[]>> => {
      const centroids = await withVectorStoreCentroids(filePaths);
      const map = new Map<string, number[]>();
      for (const [k, c] of centroids.entries()) {
        map.set(k, c.vector);
      }
      return map;
    },
    embedTexts: async (texts): Promise<number[][]> => {
      if (texts.length === 0) return [];
      const cacheInspection = inspectLocalModelCache([configuredEmbModel], resolveDefaultModelCacheDir());
      const modelCachedOnDisk = cacheInspection.models[0]?.cached === true;
      if (!embeddingModel && !modelCachedOnDisk) {
        return [];
      }
      const pool =
        embeddingModel ??
        new EmbeddingWorkerPool({
          modelName: configuredEmbModel,
          device: llmCfg?.embeddingDevice ?? 'auto',
          allowRemoteModels: false,
        });
      const ownsPool = !embeddingModel;
      try {
        await pool.initialize();
        return await pool.embedBatch(texts);
      } catch {
        return [];
      } finally {
        if (ownsPool) {
          await pool.terminate().catch(() => undefined);
        }
      }
    },
  });
}

async function ensureServicesInitialized(): Promise<void> {
  if (vectorStore && embeddingModel) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async (): Promise<void> => {
    LLMLogger.info('Initializing LLM services...');
    let localVectorStore: VectorStore | null = null;
    let localEmbeddingModel: EmbeddingWorkerPool | null = null;

    try {
      closeSessionKnowledgeGraph();

      const llmConfig = readLlmConfig();
      const configuredEmbeddingModel = llmConfig?.embeddingModel?.trim() || undefined;
      localVectorStore = new VectorStore({
        modelId: configuredEmbeddingModel,
      });
      const dbPath = resolveVectorDbPath();
      await localVectorStore.initialize(dbPath);
      LLMLogger.info('VectorStore initialized', { dbPath });

      localEmbeddingModel = new EmbeddingWorkerPool({
        modelName: configuredEmbeddingModel,
        allowRemoteModels: llmConfig?.allowRemoteModels,
      });
      await localEmbeddingModel.initialize();
      LLMLogger.info('EmbeddingWorkerPool initialized (worker thread)');

      const kernel = getReactiveWorkspaceKernel();
      fileSystemService = kernel.getFileSystemService();

      const storeRef = localVectorStore;
      const indexedPaths = storeRef.getKnowledgeGraph()?.getIndexedFiles() ?? [];
      if (indexedPaths.length > 0) {
        const purged = await kernel.reconcileIndexedFiles(indexedPaths, async (stalePath) => {
          await storeRef.deleteFile(stalePath);
        });
        if (purged > 0) {
          LLMLogger.info('Purged stale or SecretGuard-blocked index entries', { purged });
        }
      }

      if (!process.env.JEST_WORKER_ID) {
        try {
          const roots = ConfigManager.getInstance().getAll()?.fileSystem?.indexedRoots ?? [];
          for (const root of roots.slice(0, 4)) {
            void kernel.watchIndexedRoot(root).catch(() => undefined);
          }
        } catch {
          // Non-fatal in minimal environments
        }
      }

      const transportCfg = resolveActiveTransportSettings();
      const localLlm = new LLMInterface(transportCfg.baseUrl, {
        provider: transportCfg.provider,
        model: transportCfg.model,
      });
      const contextManager = new ContextManager(localLlm);

      vectorStore = localVectorStore;
      embeddingModel = localEmbeddingModel;
      llmInterface = localLlm;
      indexingService = new IndexingService(localEmbeddingModel, localVectorStore);
      retrievalService = new RetrievalService(localVectorStore, localEmbeddingModel, contextManager);
      await localVectorStore.getStats();

      if (!process.env.JEST_WORKER_ID) {
        const idxRef = indexingService;
        void replayPendingVectorOutbox({
          vectorStore: storeRef,
          indexingService: idxRef,
          validatePath: async (p) => {
            try {
              await validateCanonicalPathOrThrow(p);
              return true;
            } catch {
              return false;
            }
          },
        }).catch((outboxErr: unknown) => {
          LLMLogger.warn('Failed to replay pending vector outbox entries', {
            error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr),
          });
        });
      }

      if (preInitMutationQueue.size > 0) {
        void drainPreInitKernelMutations().catch((drainErr: unknown) => {
          LLMLogger.warn('Failed to drain pre-init kernel mutations', {
            error: drainErr instanceof Error ? drainErr.message : String(drainErr),
          });
        });
      }

      LLMLogger.info('All LLM services initialized');
    } catch (error: unknown) {
      if (localEmbeddingModel) {
        await localEmbeddingModel.terminate().catch(() => undefined);
      }
      vectorStore = null;
      embeddingModel = null;
      indexingService = null;
      retrievalService = null;
      llmInterface = null;
      fileSystemService = null;
      const msg = error instanceof Error ? error.message : String(error);
      LLMLogger.error('Failed to initialize LLM services', { error: msg });
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function executeCopilotQuery(
  event: IpcMainInvokeEvent,
  input: {
    query: string;
    channel: string;
    mode?: CopilotQueryMode;
    contextScope?: CopilotContextScope;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }
): Promise<IPCResponseMap['LLM:QUERY']> {
  const { query, channel, mode = 'rag', contextScope, history } = input;
  LLMLogger.info('LLM query received', { query: query.substring(0, 100), mode });

  const safeSend = (streamChannel: string, payload: unknown): void => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(streamChannel, payload);
    }
  };

  let retrievalMs = 0;
  let generationMs = 0;
  const startedAt = Date.now();
  const queryAbort = new AbortController();
  activeQueryAbortControllers.set(channel, queryAbort);
  const abortOnDestroy = (): void => {
    queryAbort.abort();
  };
  if (event.sender && typeof event.sender.once === 'function') {
    event.sender.once('destroyed', abortOnDestroy);
  }

  return withKnowledgeGraphSession(async (): Promise<IPCResponseMap['LLM:QUERY']> => {
    const llmConfig = readLlmConfig();
    const transportCfg = resolveActiveTransportSettings();

    try {
      if (mode === 'agent') {
        const activeClient =
          llmInterface ??
          new LLMInterface(transportCfg.baseUrl, {
            provider: transportCfg.provider,
            model: transportCfg.model,
          });
        const agentModel = llmConfig?.model || activeClient.getModel();
        const runtimeAvailable = await activeClient.checkConnection();

        if (!runtimeAvailable) {
          await ensureServicesInitialized();
          const retrievalStart = Date.now();
          const retrievalResult = await retrievalService!.retrieve(query, contextScope);
          retrievalMs = Date.now() - retrievalStart;

          const rootScope =
            contextScope?.useFolder && contextScope.currentPath ? contextScope.currentPath : undefined;
          const matchedFiles = await searchWorkspacePaths(query, rootScope).catch(() => []);
          const contentHits = searchWorkspaceContent(query, 6, rootScope);
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
              observationSummary: `Matched ${contentHits.length} lexical & ${retrievalResult.sources.length} semantic sources`,
              durationMs: 1,
              phase: 'act',
            },
          ];
          for (const step of offlineSteps) {
            safeSend(`${channel}:step`, step);
          }

          const synth = offlineSynthesis.synthesize({
            query,
            retrievalResult,
            knowledgeGraph: vectorStore?.getKnowledgeGraph(),
          });
          const verificationOutcome = verifyGroundedResponse({
            answer: synth.answer,
            sources: synth.sources,
            observedPaths: [
              ...matchedFiles,
              ...contentHits.map((h) => h.filePath),
              ...synth.sources.map((s) => s.filePath),
            ],
            stripUngroundedBrackets: true,
          });
          const traceId = crypto.randomUUID();
          const offlineRunResult: AgentRunResult = {
            answer: verificationOutcome.sanitizedAnswer,
            steps: offlineSteps,
            sources: synth.sources,
            stepLimitReached: false,
            aborted: false,
            traceId,
            terminationReason: 'offline_fallback',
            verification: verificationOutcome.report,
            durationMs: retrievalMs,
            promptVersion: AGENT_ORCHESTRATOR_PROMPT_VERSION,
          };

          safeSend(channel, verificationOutcome.sanitizedAnswer);
          safeSend(`${channel}:end`, {
            ok: true,
            sanitizedAnswer: verificationOutcome.sanitizedAnswer,
            offlineSynthesis: true,
            sources: synth.sources,
            agentSteps: offlineSteps,
            traceId,
            terminationReason: 'offline_fallback',
            verification: verificationOutcome.report,
            retrievalMs,
            generationMs: 0,
          });

          persistAgentTraceSafely(
            buildRedactedTraceRecord({
              traceId,
              mode: 'agent',
              model: agentModel,
              provider: 'offline_graph',
              query,
              runResult: offlineRunResult,
              statusOverride: 'offline_fallback',
              durationMs: retrievalMs,
            })
          );
          RuntimeDiagnostics.getInstance().recordLlmQuery({
            success: true,
            retrievalMs,
            generationMs: 0,
            provider: 'offline_graph',
            model: agentModel,
          });
          RuntimeDiagnostics.getInstance().recordOrchestratorOutcome({
            isAgentMode: true,
            ungroundedBlocked: verificationOutcome.report.ungroundedCitations.length,
          });

          return {
            success: true,
            sanitizedAnswer: verificationOutcome.sanitizedAnswer,
            offlineSynthesis: true,
            sources: synth.sources,
            agentSteps: offlineSteps,
            traceId,
            terminationReason: 'offline_fallback',
            verification: verificationOutcome.report,
            retrievalMs,
            generationMs: 0,
          };
        }

        const kernel = getReactiveWorkspaceKernel();
        const fsService = kernel.getFileSystemService();
        const validator = new PathValidator(fsService.getAllowedRoots());

        const agent = new WorkspaceReActAgent({
          provider: transportCfg.provider,
          ollamaUrl: transportCfg.baseUrl,
          model: agentModel,
          temperature: llmConfig?.temperature,
          maxTokens: llmConfig?.maxTokens,
          searchFiles: (q, root) => searchWorkspacePaths(q, root),
          searchContent: (q, topK, root) => searchWorkspaceContent(q, topK ?? 8, root),
          readFileRange: (filePath, startLine, endLine) =>
            readSecretGuardedRange(fsService, filePath, startLine, endLine),
          queryGraph: (graphInput) => queryWorkspaceGraphInsights(graphInput),
          proposeOrganizePlan: (targetDir, strategy, signal) =>
            createOrganizerService().proposeOrganizationPlan({
              targetDir,
              strategy,
              useLLM: true,
              signal,
            }),
          validatePath: (candidate) => validator.validateCanonical(candidate),
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

        if (agentResult.answer && !event.sender.isDestroyed()) {
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

        persistAgentTraceSafely(
          buildRedactedTraceRecord({
            traceId: agentResult.traceId,
            mode: 'agent',
            model: agentModel,
            provider: transportCfg.provider,
            query,
            runResult: agentResult,
            durationMs: totalAgentMs,
          })
        );
        RuntimeDiagnostics.getInstance().recordLlmQuery({
          success: true,
          retrievalMs,
          generationMs,
          provider: llmConfig?.provider ?? 'ollama',
          model: agentModel,
        });
        RuntimeDiagnostics.getInstance().recordOrchestratorOutcome({
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

      await ensureServicesInitialized();

      const retrievalStart = Date.now();
      const retrievalResult = await retrievalService!.retrieve(query, contextScope);
      retrievalMs = Date.now() - retrievalStart;

      if (
        contextScope?.useSelection &&
        Array.isArray(contextScope.selectedPaths) &&
        contextScope.selectedPaths.length > 0
      ) {
        const kernelFs = getReactiveWorkspaceKernel().getFileSystemService();
        const validator = new PathValidator(kernelFs.getAllowedRoots());
        const pinnedBlocks: string[] = [];
        const pinnedSources: RetrievalSource[] = [];

        for (const candidate of contextScope.selectedPaths.slice(0, 3)) {
          const check = await validator.validateCanonical(candidate);
          if (!check.valid || !check.canonicalPath) continue;
          try {
            const range = await readSecretGuardedRange(kernelFs, check.canonicalPath, 1, 50);
            if (range.lines.length === 0) continue;
            const citation = `${path.basename(range.path)}#L${range.startLine}-L${range.endLine}`;
            const body = range.lines.map((l) => `${l.lineNumber}: ${l.text}`).join('\n');
            pinnedBlocks.push(formatUntrustedWorkspaceData(range.path, citation, body));
            pinnedSources.push({
              filePath: range.path,
              startLine: range.startLine,
              endLine: range.endLine,
              snippet: body.slice(0, 200),
            });
          } catch {
            // Ignore non-file or unreadable selection items
          }
        }

        if (pinnedBlocks.length > 0) {
          const pinnedPrefix = pinnedBlocks.join('\n\n');
          retrievalResult.context = retrievalResult.context
            ? `${pinnedPrefix}\n\n${retrievalResult.context}`
            : pinnedPrefix;
          retrievalResult.sources = Array.from(
            new Set([...pinnedSources.map((s) => s.filePath), ...retrievalResult.sources])
          );
          retrievalResult.structuredSources = [
            ...pinnedSources,
            ...(retrievalResult.structuredSources ?? []),
          ];
        }
      }

      LLMLogger.info('Context retrieved', {
        sources: retrievalResult.sources.length,
        tokens: retrievalResult.tokenCount,
      });

      const structuredSources: RetrievalSource[] =
        retrievalResult.structuredSources ??
        retrievalResult.sources.map((filePath) => ({ filePath }));

      const activeModel = llmConfig?.model || llmInterface!.getModel();
      const runtimeAvailable = await llmInterface!.checkConnection();
      if (!runtimeAvailable) {
        const synth = offlineSynthesis.synthesize({
          query,
          retrievalResult,
          knowledgeGraph: vectorStore?.getKnowledgeGraph(),
        });
        const verificationOutcome = verifyGroundedResponse({
          answer: synth.answer,
          sources: structuredSources,
          stripUngroundedBrackets: true,
        });
        const traceId = crypto.randomUUID();
        const ragOfflineResult: AgentRunResult = {
          answer: verificationOutcome.sanitizedAnswer,
          steps: [],
          sources: structuredSources,
          stepLimitReached: false,
          aborted: false,
          traceId,
          terminationReason: 'offline_fallback',
          verification: verificationOutcome.report,
          durationMs: retrievalMs,
          promptVersion: AGENT_ORCHESTRATOR_PROMPT_VERSION,
        };

        safeSend(channel, verificationOutcome.sanitizedAnswer);
        safeSend(`${channel}:end`, {
          ok: true,
          sanitizedAnswer: verificationOutcome.sanitizedAnswer,
          offlineSynthesis: true,
          sources: structuredSources,
          traceId,
          terminationReason: 'offline_fallback',
          verification: verificationOutcome.report,
          retrievalMs,
          generationMs: 0,
        });

        persistAgentTraceSafely(
          buildRedactedTraceRecord({
            traceId,
            mode: 'rag',
            model: activeModel,
            provider: 'offline_graph',
            query,
            runResult: ragOfflineResult,
            statusOverride: 'offline_fallback',
            durationMs: retrievalMs,
          })
        );
        RuntimeDiagnostics.getInstance().recordLlmQuery({
          success: true,
          retrievalMs,
          generationMs: 0,
          provider: 'offline_graph',
          model: llmConfig?.model,
        });
        RuntimeDiagnostics.getInstance().recordOrchestratorOutcome({
          isAgentMode: false,
          ungroundedBlocked: verificationOutcome.report.ungroundedCitations.length,
        });
        return {
          success: true,
          sanitizedAnswer: verificationOutcome.sanitizedAnswer,
          offlineSynthesis: true,
          sources: structuredSources,
          traceId,
          terminationReason: 'offline_fallback',
          verification: verificationOutcome.report,
          retrievalMs,
          generationMs: 0,
        };
      }

      const genStart = Date.now();
      let streamedAnswer = '';
      const streamRedactor = createStreamingSecretRedactor();
      for await (const chunk of llmInterface!.query(query, retrievalResult, {
        model: llmConfig?.model,
        temperature: llmConfig?.temperature,
        maxTokens: llmConfig?.maxTokens,
        signal: queryAbort.signal,
        history,
      })) {
        if (event.sender.isDestroyed() || queryAbort.signal.aborted) {
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
      if (streamTail && !event.sender.isDestroyed() && !queryAbort.signal.aborted) {
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

      persistAgentTraceSafely(
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
      RuntimeDiagnostics.getInstance().recordLlmQuery({
        success: true,
        retrievalMs,
        generationMs,
        provider: llmConfig?.provider ?? 'ollama',
        model: llmConfig?.model,
      });
      RuntimeDiagnostics.getInstance().recordOrchestratorOutcome({
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
        persistAgentTraceSafely(
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
        safeSend(`${channel}:end`, { ok: true, aborted: true, traceId, terminationReason: 'aborted' });
        return { success: true, traceId, terminationReason: 'aborted' };
      }

      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = ErrorSerializer.sanitizeText(rawMsg);
      const traceId = crypto.randomUUID();
      safeSend(channel, `Error: ${msg}`);
      safeSend(`${channel}:end`, {
        ok: false,
        error: msg,
        traceId,
        terminationReason: 'model_error',
      });

      persistAgentTraceSafely(
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
      RuntimeDiagnostics.getInstance().recordLlmQuery({
        success: false,
        retrievalMs,
        generationMs,
        error: msg,
        provider: readLlmConfig()?.provider ?? 'ollama',
        model: readLlmConfig()?.model,
      });
      return { success: false, error: msg, traceId, terminationReason: 'model_error' };
    } finally {
      activeQueryAbortControllers.delete(channel);
      if (event.sender && typeof event.sender.removeListener === 'function') {
        event.sender.removeListener('destroyed', abortOnDestroy);
      }
    }
  });
}

export async function abortCopilotQuery(
  _event: IpcMainInvokeEvent,
  input: { channel: string }
): Promise<{ aborted: boolean }> {
  const controller = activeQueryAbortControllers.get(input.channel);
  if (!controller) {
    return { aborted: false };
  }
  controller.abort();
  activeQueryAbortControllers.delete(input.channel);
  return { aborted: true };
}

export async function getIndexingStatus(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<IndexingStatus> {
  try {
    if (indexingInProgress) {
      return {
        indexed: indexedCount,
        total: totalToIndex,
        inProgress: true,
        currentFile: currentFile || undefined,
      };
    }

    const activeKg = vectorStore?.getKnowledgeGraph();
    if (activeKg) {
      const stats = activeKg.getStats();
      return {
        indexed: stats.totalFiles > 0 ? stats.totalFiles : indexedCount,
        total: Math.max(totalToIndex, stats.totalFiles),
        inProgress: false,
        currentFile: undefined,
      };
    }

    const kgPath = path.join(resolveVectorDbPath(), 'knowledge-graph.sqlite');
    if (fsSync.existsSync(kgPath)) {
      const persistedFiles = withKnowledgeGraph((kg) => kg.getStats().totalFiles);
      return {
        indexed: persistedFiles,
        total: Math.max(totalToIndex, persistedFiles),
        inProgress: false,
        currentFile: undefined,
      };
    }

    return {
      indexed: indexedCount,
      total: totalToIndex,
      inProgress: false,
      currentFile: currentFile || undefined,
    };
  } catch {
    return {
      indexed: 0,
      total: 0,
      inProgress: false,
      currentFile: undefined,
    };
  }
}

function resolveEventLoopAdaptiveYieldMs(
  p95LagMs: number,
  activeQueriesCount: number
): number {
  if (activeQueriesCount > 0) {
    return 40;
  }
  if (p95LagMs > 24) {
    return Math.min(40, Math.round(p95LagMs * 0.5));
  }
  return 0;
}

async function indexFilesBackground(
  filePaths: string[],
  event: IpcMainInvokeEvent
): Promise<void> {
  const BATCH_PROGRESS_INTERVAL = 5;
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();

  try {
    for (let idx = 0; idx < filePaths.length; idx++) {
      const filePath = filePaths[idx];
      if (abortIndexing) {
        LLMLogger.info('Indexing aborted by user');
        break;
      }

      try {
        currentFile = filePath;

        const canonicalPath = await validateCanonicalPathOrThrow(filePath);
        if (isSensitiveSecretFile(canonicalPath).blocked) {
          continue;
        }

        const indexResult = await indexingService!.indexFile(canonicalPath, false, {
          skipMetadataStubs: true,
        });
        const didEmbedWork = indexResult.success && indexResult.chunksCreated > 0;
        if (didEmbedWork) {
          indexedCount++;
        }

        if (
          !event.sender.isDestroyed() &&
          (didEmbedWork || idx === filePaths.length - 1 || idx % BATCH_PROGRESS_INTERVAL === 0)
        ) {
          event.sender.send('LLM:INDEXING_PROGRESS', {
            indexed: indexedCount,
            total: totalToIndex,
            currentFile: filePath,
          });
        }

        if (didEmbedWork) {
          const p95LagMs = eld.percentile(95) / 1e6;
          eld.reset();
          const yieldMs = resolveEventLoopAdaptiveYieldMs(
            Number.isFinite(p95LagMs) ? p95LagMs : 0,
            activeQueryAbortControllers.size
          );
          if (yieldMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, yieldMs));
          } else {
            await new Promise((resolve) => setImmediate(resolve));
          }
        } else if ((idx & 3) === 3) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        LLMLogger.warn('Failed to index file', { filePath, error: msg });
      }
    }
  } finally {
    eld.disable();
  }

  try {
    await vectorStore?.flushPendingRecords();
  } catch (flushError) {
    LLMLogger.warn('Failed to flush pending records', {
      error: flushError instanceof Error ? flushError.message : String(flushError),
    });
  }

  indexingInProgress = false;
  currentFile = '';

  if (!event.sender.isDestroyed()) {
    event.sender.send('LLM:INDEXING_COMPLETE', {
      indexed: indexedCount,
      total: totalToIndex,
    });
  }

  LLMLogger.info('Indexing complete', { indexed: indexedCount, total: totalToIndex });
}

export async function startDirectoryIndexing(
  event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<{ success: boolean; message?: string; total?: number; error?: string }> {
  const dirPath = input.path;

  if (indexingInProgress) {
    return { success: false, message: 'Indexing already in progress' };
  }

  LLMLogger.info('Starting indexing', { path: dirPath });

  try {
    await ensureServicesInitialized();

    indexingInProgress = true;
    indexedCount = 0;
    abortIndexing = false;

    const canonicalDir = await validateCanonicalPathOrThrow(dirPath);
    const scanner = new DirectoryScanner(fileSystemService!);
    const files = await scanner.scan(canonicalDir, {
      recursive: true,
      skipErrors: true,
      skipSensitiveFiles: true,
      extensions: [
        'txt', 'md', 'markdown', 'mdx', 'rst',
        'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'hpp',
        'cs', 'go', 'rs', 'rb', 'php', 'json', 'yaml', 'yml', 'toml',
        'xml', 'html', 'htm', 'css', 'sh', 'ps1', 'sql', 'log',
        'pdf', 'docx', 'csv', 'tsv', 'ipynb',
      ],
      maxSize: 10 * 1024 * 1024,
    });

    try {
      const cm = ConfigManager.getInstance();
      const existing = cm.getAll()?.fileSystem?.indexedRoots ?? [];
      const cmp = (p: string): string =>
        process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
      const dirKey = cmp(canonicalDir);
      const alreadyCovered = existing.some((r) => {
        const rk = cmp(r);
        return dirKey === rk || dirKey.startsWith(rk.endsWith(path.sep) ? rk : `${rk}${path.sep}`);
      });
      if (!alreadyCovered) {
        cm.set('fileSystem.indexedRoots', [...existing, canonicalDir], true);
      }
      void getReactiveWorkspaceKernel().watchIndexedRoot(canonicalDir).catch(() => undefined);
    } catch {
      // Non-fatal in minimal test environments
    }

    totalToIndex = files.length;
    LLMLogger.info('Files to index', { count: totalToIndex });

    if (!event.sender.isDestroyed()) {
      event.sender.send('LLM:INDEXING_PROGRESS', {
        indexed: 0,
        total: totalToIndex,
        currentFile: '',
      });
    }

    activeIndexingPromise = indexFilesBackground(
      files.map((f) => f.path),
      event
    ).finally(() => {
      activeIndexingPromise = null;
    });

    return { success: true, total: totalToIndex };
  } catch (error: unknown) {
    indexingInProgress = false;
    const rawMsg = error instanceof Error ? error.message : String(error);
    const msg = ErrorSerializer.sanitizeText(rawMsg);
    LLMLogger.error('Failed to start indexing', { error: rawMsg });
    return { success: false, message: msg, error: msg };
  }
}

export async function stopDirectoryIndexing(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ success: boolean }> {
  if (!indexingInProgress) {
    return { success: true };
  }

  LLMLogger.info('Stopping indexing');
  abortIndexing = true;
  return { success: true };
}

export async function indexSingleFile(
  _event: IpcMainInvokeEvent,
  input: { filePath: string }
): Promise<{ success: boolean; chunksCreated?: number; error?: string }> {
  try {
    await ensureServicesInitialized();
    const canonicalPath = await validateCanonicalPathOrThrow(input.filePath);
    const secretCheck = isSensitiveSecretFile(canonicalPath);
    if (secretCheck.blocked) {
      return { success: false, chunksCreated: 0, error: secretCheck.reason };
    }
    const result = await indexingService!.indexFile(canonicalPath, true);

    return {
      success: result.success,
      chunksCreated: result.chunksCreated,
      error: result.error,
    };
  } catch (error: unknown) {
    const msg = ErrorSerializer.sanitizeText(
      error instanceof Error ? error.message : String(error)
    );
    return { success: false, error: msg };
  }
}

function queuePreInitKernelMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): void {
  const key =
    process.platform === 'win32'
      ? path.resolve(filePath).toLowerCase()
      : path.resolve(filePath);
  if (preInitMutationQueue.has(key)) {
    preInitMutationQueue.delete(key);
  } else if (preInitMutationQueue.size >= MAX_PREINIT_MUTATIONS) {
    const oldestKey = preInitMutationQueue.keys().next().value;
    if (oldestKey) {
      preInitMutationQueue.delete(oldestKey);
    }
  }
  preInitMutationQueue.set(key, { eventType, filePath });
}

async function drainPreInitKernelMutations(): Promise<void> {
  if (!vectorStore || !indexingService || preInitMutationQueue.size === 0) {
    return;
  }
  const pending = Array.from(preInitMutationQueue.values());
  preInitMutationQueue.clear();
  for (const item of pending) {
    if (!vectorStore || !indexingService) {
      break;
    }
    await handleKernelIndexMutation(item.eventType, item.filePath);
  }
}

export async function replayPendingVectorOutbox(deps: {
  vectorStore: Pick<VectorStore, 'getKnowledgeGraph' | 'deleteFile' | 'flushPendingRecords'>;
  indexingService: Pick<IndexingService, 'indexFile'>;
  validatePath: (filePath: string) => Promise<boolean>;
  maxFiles?: number;
}): Promise<{ replayed: number; purged: number }> {
  const pendingPaths = deps.vectorStore.getKnowledgeGraph()?.getFilesWithPendingSync(deps.maxFiles ?? 200) ?? [];
  if (pendingPaths.length === 0) {
    return { replayed: 0, purged: 0 };
  }

  let replayed = 0;
  let purged = 0;
  for (const pendingPath of pendingPaths) {
    if (isSensitiveSecretFile(pendingPath).blocked || !(await deps.validatePath(pendingPath))) {
      await deps.vectorStore.deleteFile(pendingPath).catch(() => 0);
      purged += 1;
      continue;
    }
    try {
      const stat = await fs.stat(pendingPath);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INDEXABLE_FILE_SIZE) {
        await deps.vectorStore.deleteFile(pendingPath).catch(() => 0);
        purged += 1;
        continue;
      }
    } catch {
      await deps.vectorStore.deleteFile(pendingPath).catch(() => 0);
      purged += 1;
      continue;
    }

    const res = await deps.indexingService.indexFile(pendingPath, false, { forceReindex: true });
    if (res.success) {
      replayed += 1;
    }
  }

  if (replayed > 0) {
    await deps.vectorStore.flushPendingRecords().catch(() => undefined);
  }

  return { replayed, purged };
}

export async function handleKernelIndexMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): Promise<void> {
  if (!vectorStore || !indexingService) {
    queuePreInitKernelMutation(eventType, filePath);
    return;
  }

  try {
    if (eventType === 'unlink') {
      await indexingService.removeFile(filePath);
      return;
    }

    const canonicalPath = await validateCanonicalPathOrThrow(filePath);
    if (isSensitiveSecretFile(canonicalPath).blocked) {
      await indexingService.removeFile(canonicalPath).catch(() => undefined);
      return;
    }

    try {
      const indexedRoots = ConfigManager.getInstance().getAll()?.fileSystem?.indexedRoots ?? [];
      if (indexedRoots.length === 0) {
        return;
      }
      const cmp = (p: string): string =>
        process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
      const targetKey = cmp(canonicalPath);
      const insideOptInRoot = indexedRoots.some((root) => {
        const rootKey = cmp(root);
        return (
          targetKey === rootKey ||
          targetKey.startsWith(rootKey.endsWith(path.sep) ? rootKey : `${rootKey}${path.sep}`)
        );
      });
      if (!insideOptInRoot) {
        return;
      }
    } catch {
      return;
    }

    const ext = path.extname(canonicalPath).toLowerCase();
    if (!INDEXABLE_WATCH_EXTENSIONS.has(ext)) {
      return;
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(canonicalPath);
    } catch {
      await indexingService.removeFile(canonicalPath).catch(() => undefined);
      return;
    }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INDEXABLE_FILE_SIZE) {
      await indexingService.removeFile(canonicalPath).catch(() => undefined);
      return;
    }

    await indexingService.indexFile(canonicalPath, true);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    LLMLogger.warn('Incremental kernel index sync skipped file', {
      eventType,
      filePath,
      error: msg,
    });
  }
}

export async function checkOllamaStatus(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ available: boolean; models: string[] }> {
  try {
    const transportCfg = resolveActiveTransportSettings();
    const client =
      llmInterface ??
      new LLMInterface(transportCfg.baseUrl, {
        provider: transportCfg.provider,
        model: transportCfg.model,
      });
    const available = await client.checkConnection();
    const models = available ? await client.getAvailableModels() : [];
    return { available, models };
  } catch {
    return { available: false, models: [] };
  }
}

async function buildModelsSnapshot(): Promise<LLMModelsSnapshot> {
  const llmCfg = readLlmConfig();
  const transportCfg = resolveActiveTransportSettings();
  const embModel = llmCfg?.embeddingModel ?? 'Xenova/bge-small-en-v1.5';
  const rerankModel = llmCfg?.rerankerModel ?? DEFAULT_RERANKER_MODEL;

  let available = false;
  let models: string[] = [];
  try {
    const client =
      llmInterface ??
      new LLMInterface(transportCfg.baseUrl, {
        provider: transportCfg.provider,
        model: transportCfg.model,
      });
    available = await client.checkConnection();
    models = available ? await client.getAvailableModels() : [];
  } catch {
    available = false;
    models = [];
  }

  const cacheInfo = inspectLocalModelCache([embModel, rerankModel]);
  const embCache = cacheInfo.models[0];
  const rerankCache = cacheInfo.models[1];
  const supportedEmbeddingDevices =
    embeddingModel?.getSupportedDevices() ??
    (await detectSupportedTransformersDevices().catch(() => ['cpu']));

  return {
    available,
    models,
    activeModel: llmCfg?.model ?? llmInterface?.getModel() ?? 'llama3.2',
    embeddingModel: embModel,
    rerankerModel: rerankModel,
    temperature: llmCfg?.temperature ?? 0.7,
    maxTokens: llmCfg?.maxTokens ?? 2048,
    provider: transportCfg.provider,
    ollamaUrl: resolveOllamaUrl() || 'http://localhost:11434',
    openAiBaseUrl: llmCfg?.openAiBaseUrl ?? 'http://127.0.0.1:1234',
    embeddingDevice: llmCfg?.embeddingDevice ?? 'auto',
    activeExecutionProvider: embeddingModel?.getExecutionProvider() ?? 'cpu',
    supportedEmbeddingDevices,
    allowRemoteModels: llmCfg?.allowRemoteModels ?? true,
    modelCacheDir: cacheInfo.cacheDir,
    embeddingCached: embCache?.cached ?? false,
    embeddingCacheBytes: embCache?.bytes ?? 0,
    rerankerCached: rerankCache?.cached ?? false,
    rerankerCacheBytes: rerankCache?.bytes ?? 0,
  };
}

export async function listLlmModels(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<LLMModelsSnapshot> {
  return buildModelsSnapshot();
}

export async function setLlmModelConfig(
  _event: IpcMainInvokeEvent,
  input: {
    provider?: LocalLLMProvider;
    ollamaUrl?: string;
    openAiBaseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    embeddingModel?: string;
    rerankerModel?: string;
    embeddingDevice?: 'auto' | 'cpu' | 'dml' | 'webgpu';
    allowRemoteModels?: boolean;
  }
): Promise<{ success: boolean; config: LLMModelsSnapshot }> {
  const updates: Array<[string, unknown]> = [];
  if (input.provider !== undefined) updates.push(['llm.provider', input.provider]);
  if (input.ollamaUrl !== undefined) {
    updates.push(['llm.ollamaUrl', assertLoopbackLocalUrl(input.ollamaUrl)]);
  }
  if (input.openAiBaseUrl !== undefined) {
    updates.push(['llm.openAiBaseUrl', assertLoopbackLocalUrl(input.openAiBaseUrl)]);
  }
  if (input.model !== undefined) updates.push(['llm.model', input.model.trim()]);
  if (input.temperature !== undefined) updates.push(['llm.temperature', input.temperature]);
  if (input.maxTokens !== undefined) updates.push(['llm.maxTokens', input.maxTokens]);
  if (input.embeddingModel !== undefined) updates.push(['llm.embeddingModel', input.embeddingModel.trim()]);
  if (input.rerankerModel !== undefined) updates.push(['llm.rerankerModel', input.rerankerModel.trim()]);
  if (input.embeddingDevice !== undefined) updates.push(['llm.embeddingDevice', input.embeddingDevice]);
  if (input.allowRemoteModels !== undefined) updates.push(['llm.allowRemoteModels', input.allowRemoteModels]);

  if (updates.length > 0) {
    const cm = ConfigManager.getInstance();
    for (let i = 0; i < updates.length; i++) {
      const [key, val] = updates[i];
      cm.set(key, val, i === updates.length - 1);
    }
  }

  if (llmInterface) {
    const nextTransport = resolveActiveTransportSettings();
    llmInterface.setTransportConfig({
      provider: nextTransport.provider,
      baseUrl: nextTransport.baseUrl,
      model: input.model?.trim() || nextTransport.model,
    });
  }

  const embeddingPipelineDirty =
    input.embeddingModel !== undefined ||
    input.rerankerModel !== undefined ||
    input.embeddingDevice !== undefined ||
    input.allowRemoteModels !== undefined;

  if (embeddingPipelineDirty && (embeddingModel || vectorStore)) {
    if (embeddingModel) {
      await embeddingModel.terminate().catch(() => undefined);
      embeddingModel = null;
    }
    if (vectorStore) {
      await vectorStore.close().catch(() => undefined);
      vectorStore = null;
    }
    indexingService = null;
    retrievalService = null;
  }

  LLMLogger.info('Updated LLM configuration', {
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  });

  return {
    success: true,
    config: await buildModelsSnapshot(),
  };
}

export async function downloadLlmModels(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ success: boolean; snapshot: LLMModelsSnapshot; error?: string }> {
  const llmCfg = readLlmConfig();
  const embModel = llmCfg?.embeddingModel ?? 'Xenova/bge-small-en-v1.5';
  const rerankModel = llmCfg?.rerankerModel ?? DEFAULT_RERANKER_MODEL;
  const device = llmCfg?.embeddingDevice ?? 'auto';
  const cacheDir = resolveDefaultModelCacheDir();

  try {
    if (llmCfg?.allowRemoteModels === false) {
      ConfigManager.getInstance().set('llm.allowRemoteModels', true, true);
    }

    let resolvedEp = 'cpu';
    await loadFeatureExtractionPipeline({
      modelName: embModel,
      dtype: 'q8',
      device,
      allowRemoteModels: true,
      cacheDir,
      onResolved: (info) => {
        resolvedEp = info.device;
      },
    });
    await loadCrossEncoderReranker({
      modelName: rerankModel,
      dtype: 'q8',
      device,
      allowRemoteModels: true,
      cacheDir,
    });

    const supportedDevices = await detectSupportedTransformersDevices().catch(() => ['cpu']);
    RuntimeDiagnostics.getInstance().setVectorStoreStats({
      activeExecutionProvider: resolvedEp,
      supportedDevices,
    });

    return {
      success: true,
      snapshot: await buildModelsSnapshot(),
    };
  } catch (error: unknown) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const sanitized = ErrorSerializer.sanitizeText(rawMsg);
    LLMLogger.warn('Failed downloading ONNX models into cacheDir', { cacheDir, error: rawMsg });
    return {
      success: false,
      snapshot: await buildModelsSnapshot(),
      error: sanitized,
    };
  }
}

export async function clearVectorIndex(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (indexingInProgress || activeIndexingPromise) {
      abortIndexing = true;
      await activeIndexingPromise?.catch(() => undefined);
    }

    let success = true;
    if (vectorStore) {
      const result = await vectorStore.clear();
      success = result.success;
    } else {
      const dbDir = resolveVectorDbPath();
      const kgPath = path.join(dbDir, 'knowledge-graph.sqlite');
      if (fsSync.existsSync(kgPath)) {
        withKnowledgeGraph((kg) => kg.clear());
      }
      const lanceTableDir = path.join(dbDir, 'file_chunks.lance');
      if (fsSync.existsSync(lanceTableDir)) {
        await fs.rm(lanceTableDir, { recursive: true, force: true });
      }
    }

    indexedCount = 0;
    totalToIndex = 0;
    currentFile = '';
    LLMLogger.info('Vector index cleared');

    return { success };
  } catch (error: unknown) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const msg = ErrorSerializer.sanitizeText(rawMsg);
    LLMLogger.error('Failed to clear index', { error: rawMsg });
    return { success: false, error: msg };
  }
}

export async function getRecentAgentTraces(
  _event: IpcMainInvokeEvent,
  input?: { limit?: number }
): Promise<IPCResponseMap['LLM:GET_TRACES']> {
  const traces = withKnowledgeGraph((kg) => kg.getRecentAgentTraces(input?.limit ?? 25));
  return { traces };
}

export async function clearAgentTracesHistory(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<IPCResponseMap['LLM:CLEAR_TRACES']> {
  const cleared = withKnowledgeGraph((kg) => kg.clearAgentTraces());
  return { cleared };
}

export async function planWorkspaceOrganize(
  _event: IpcMainInvokeEvent,
  input: { targetDir: string; strategy?: OrganizeStrategy; useLLM?: boolean; recursive?: boolean }
): Promise<OrganizePlanResult> {
  const canonicalTarget = await validateCanonicalPathOrThrow(input.targetDir);
  return createOrganizerService().proposeOrganizationPlan({
    targetDir: canonicalTarget,
    strategy: input.strategy,
    useLLM: input.useLLM,
    recursive: input.recursive,
  });
}

export async function applyWorkspaceOrganize(
  _event: IpcMainInvokeEvent,
  input: {
    planId: string;
    targetDir: string;
    operations: OrganizePlanOperation[];
    repairMarkdownLinks?: boolean;
  }
): Promise<OrganizeApplyResult> {
  const canonicalTarget = await validateCanonicalPathOrThrow(input.targetDir);
  return createOrganizerService().applyOrganizationPlan({
    planId: input.planId,
    targetDir: canonicalTarget,
    operations: input.operations,
    repairMarkdownLinks: input.repairMarkdownLinks,
  });
}

async function awaitBounded(promise: Promise<unknown> | null, timeoutMs: number): Promise<void> {
  if (!promise) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
  try {
    await Promise.race([promise.catch(() => undefined), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function cleanupLLMServices(): Promise<void> {
  LLMLogger.info('Cleaning up LLM services...');
  abortIndexing = true;
  preInitMutationQueue.clear();
  for (const ctrl of activeQueryAbortControllers.values()) {
    ctrl.abort();
  }
  activeQueryAbortControllers.clear();

  await awaitBounded(initPromise, 1000);
  await awaitBounded(activeIndexingPromise, 1000);

  if (embeddingModel) {
    try {
      await embeddingModel.terminate();
      LLMLogger.info('EmbeddingWorkerPool terminated');
    } catch (error) {
      LLMLogger.warn('Error terminating embedding worker', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    embeddingModel = null;
  }

  closeSessionKnowledgeGraph();
  sessionDepth = 0;

  if (vectorStore) {
    await vectorStore.close().catch(() => undefined);
    vectorStore = null;
    LLMLogger.info('VectorStore closed');
  }

  indexingService = null;
  retrievalService = null;
  llmInterface = null;
  fileSystemService = null;
  indexingInProgress = false;
  indexedCount = 0;
  totalToIndex = 0;
  currentFile = '';
  abortIndexing = false;

  RuntimeDiagnostics.getInstance().setVectorStoreStats({
    initialized: false,
    totalChunks: 0,
    indexedFiles: 0,
    lexicalDocs: 0,
    pendingBuffer: 0,
  });

  LLMLogger.info('LLM services cleanup complete');
}
