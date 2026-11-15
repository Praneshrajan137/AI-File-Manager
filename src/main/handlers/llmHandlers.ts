/**
 * llmHandlers.ts - IPC handlers for LLM operations
 * 
 * Full implementation of Intelligence Layer IPC handlers.
 * Connects UI to IndexingService, RetrievalService, and LLMInterface.
 * 
 * Handlers:
 * - LLM:QUERY - Query LLM with streaming response
 * - LLM:INDEX_STATUS - Get indexing status
 * - LLM:START_INDEXING - Start indexing directory
 * - LLM:STOP_INDEXING - Stop background indexing
 * - LLM:INDEX_FILE - Index single file
 * - LLM:CHECK_OLLAMA - Check if Ollama is running
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import { withContract, validateCanonicalPathOrThrow } from './securityMiddleware';
import { ErrorSerializer } from '@main/middleware/ErrorSerializer';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import {
  configureKernelHooks,
  getReactiveWorkspaceKernel,
} from '@main/services/ReactiveWorkspaceKernel';
import { AppConfig, ConfigManager } from '@shared/config';

function readLlmConfig(): AppConfig['llm'] | undefined {
  try {
    return ConfigManager.getInstance().get('llm');
  } catch {
    return undefined;
  }
}
import {
  AgentTraceStep,
  ContentSearchMatch,
  CopilotContextScope,
  CopilotQueryMode,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  IndexingStatus,
  LLMModelsSnapshot,
  MAX_INDEXABLE_FILE_SIZE,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  RetrievalSource,
} from '../../shared/contracts';
import { IPCChannel } from '@shared/ipc/contracts';
import { IPCLogger, LLMLogger } from '../../shared/logging';
import { isSensitiveSecretFile } from '../../shared/security/SecretGuard';
import { VectorStore } from '../../llm/services/VectorStore';
import { WorkspaceKnowledgeGraph } from '../services/WorkspaceKnowledgeGraph';
import { EmbeddingWorkerPool } from '../../llm/workers/EmbeddingWorkerPool';
import { IndexingService } from '../../llm/services/IndexingService';
import { RetrievalService } from '../../llm/services/RetrievalService';
import { ContextManager, formatUntrustedWorkspaceData } from '../../llm/services/ContextManager';
import { WorkspaceReActAgent } from '../../llm/agent/WorkspaceReActAgent';
import { LLMMetrics, MetricOperation } from '../../llm/services/LLMMetrics';
import { LLMInterface } from '../../llm/services/LLMInterface';
import { LocalLLMProvider } from '../../llm/services/LocalModelTransport';
import { OfflineSynthesisService } from '../../llm/services/OfflineSynthesisService';
import { FileSystemService } from '../services/FileSystemService';
import { DirectoryScanner } from '../services/DirectoryScanner';
import { PathValidator } from '../services/PathValidator';
import { getOperationJournal } from '../services/OperationJournal';
import { AIOrganizerService } from '../services/AIOrganizerService';
import { searchWorkspacePaths } from './searchHandlers';
import path from 'path';
import os from 'os';

const INDEXABLE_WATCH_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.json', '.yaml', '.yml', '.toml',
  '.xml', '.html', '.htm', '.css', '.sh', '.sql', '.log', '.csv', '.tsv',
  '.pdf', '.docx', '.ipynb',
]);

/**
 * Calculate adaptive yield duration based on file type and indexing progress.
 * Heavy files (PDF, DOCX) need longer yields; system fatigue increases yield over time.
 */
function calculateAdaptiveYield(filePath: string, indexedCount: number): number {
  const ext = path.extname(filePath).toLowerCase();

  // Heavier files need longer yields to prevent blocking
  const heavyExtensions = ['.pdf', '.docx', '.xlsx', '.pptx'];
  const baseYield = heavyExtensions.includes(ext) ? 250 : 100;

  // Increase yield every 10 files to let system breathe (fatigue factor)
  const fatigueMultiplier = 1 + Math.floor(indexedCount / 10) * 0.1;

  return Math.min(Math.round(baseYield * fatigueMultiplier), 500);
}

// Service instances (lazy initialization)
let vectorStore: VectorStore | null = null;
let embeddingModel: EmbeddingWorkerPool | null = null;
let indexingService: IndexingService | null = null;
let retrievalService: RetrievalService | null = null;
let llmInterface: LLMInterface | null = null;
let fileSystemService: FileSystemService | null = null;
let initPromise: Promise<void> | null = null;

// Indexing state
let indexingInProgress = false;
let indexedCount = 0;
let totalToIndex = 0;
let currentFile = '';
let abortIndexing = false;
let activeIndexingPromise: Promise<void> | null = null;
const activeQueryAbortControllers = new Map<string, AbortController>();
const offlineSynthesis = new OfflineSynthesisService();

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
  const allowTestOverrides =
    process.env.NODE_ENV === 'test' || process.env.E2E_TEST === 'true';
  const overrideDbPath = allowTestOverrides ? process.env.FILE_MANAGER_VECTOR_DB_PATH : undefined;
  return overrideDbPath && overrideDbPath.trim().length > 0
    ? path.resolve(overrideDbPath.trim())
    : path.join(os.homedir(), '.file-manager', 'vectordb');
}

function withKnowledgeGraph<T>(fn: (kg: WorkspaceKnowledgeGraph) => T): T {
  const existingKg = vectorStore?.getKnowledgeGraph();
  if (existingKg) {
    return fn(existingKg);
  }
  const dbPath = resolveVectorDbPath();
  const kg = new WorkspaceKnowledgeGraph(path.join(dbPath, 'knowledge-graph.sqlite'));
  try {
    return fn(kg);
  } finally {
    kg.close();
  }
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
    const hits = kg.searchLexical(trimmed, fetchLimit);
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
  return withKnowledgeGraph((kg) => {
    const stats = kg.getInsights();
    const symbolMatches =
      input.symbolQuery && input.symbolQuery.trim().length > 0
        ? kg.findBySymbol(input.symbolQuery.trim(), 25)
        : undefined;
    const backlinks =
      input.backlinkTarget && input.backlinkTarget.trim().length > 0
        ? kg.findBacklinks(input.backlinkTarget.trim(), 50)
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

/**
 * Initialize LLM services (lazy, concurrency-safe).
 */
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
      const llmConfig = readLlmConfig();
      const configuredEmbeddingModel = llmConfig?.embeddingModel?.trim() || undefined;
      localVectorStore = new VectorStore({
        modelId: configuredEmbeddingModel,
      });
      const dbPath = resolveVectorDbPath();
      await localVectorStore.initialize(dbPath);
      LLMLogger.info('VectorStore initialized', { dbPath });

      // Initialize embedding model (runs in worker thread to avoid blocking main process)
      localEmbeddingModel = new EmbeddingWorkerPool({
        modelName: configuredEmbeddingModel,
      });
      await localEmbeddingModel.initialize();
      LLMLogger.info('EmbeddingWorkerPool initialized (worker thread)');

      // Share the kernel's unified FileSystemService so LRU cache telemetry stays coherent
      const kernel = getReactiveWorkspaceKernel();
      fileSystemService = kernel.getFileSystemService();

      // Reconcile offline-deleted or newly SecretGuard-blocked index records
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

/**
 * Handler: LLM:QUERY
 * Query LLM with streaming response.
 */
async function handleQuery(
  event: IpcMainInvokeEvent,
  input: {
    query: string;
    channel: string;
    mode?: CopilotQueryMode;
    contextScope?: CopilotContextScope;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }
): Promise<{
  success: boolean;
  error?: string;
  sources?: RetrievalSource[];
  agentSteps?: AgentTraceStep[];
  offlineSynthesis?: boolean;
  proposedPlan?: OrganizePlanResult;
}> {
  const { query, channel, mode = 'rag', contextScope, history } = input;
  LLMLogger.info('LLM query received', { query: query.substring(0, 100), mode });

  const safeSend = (streamChannel: string, payload: unknown): void => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(streamChannel, payload);
    }
  };

  let retrievalMs = 0;
  let generationMs = 0;
  const queryAbort = new AbortController();
  activeQueryAbortControllers.set(channel, queryAbort);
  const abortOnDestroy = (): void => {
    queryAbort.abort();
  };
  if (event.sender && typeof event.sender.once === 'function') {
    event.sender.once('destroyed', abortOnDestroy);
  }

  try {
    const llmConfig = readLlmConfig();
    const transportCfg = resolveActiveTransportSettings();

    if (mode === 'agent') {
      const activeClient =
        llmInterface ??
        new LLMInterface(transportCfg.baseUrl, {
          provider: transportCfg.provider,
          model: transportCfg.model,
        });
      const runtimeAvailable = await activeClient.checkConnection();
      if (!runtimeAvailable) {
        await ensureServicesInitialized();
        const retrievalStart = Date.now();
        const retrievalResult = await retrievalService!.retrieve(query, contextScope);
        retrievalMs = Date.now() - retrievalStart;

        const rootScope = contextScope?.useFolder && contextScope.currentPath ? contextScope.currentPath : undefined;
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
          },
          {
            step: 2,
            thought: 'Gathering FTS5 lexical + hybrid RAG citations from Knowledge Graph.',
            tool: 'search_content',
            arguments: { query, topK: 6, rootPath: rootScope },
            allowed: true,
            observationSummary: `Matched ${contentHits.length} lexical & ${retrievalResult.sources.length} semantic sources`,
            durationMs: 1,
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
        safeSend(channel, synth.answer);
        safeSend(`${channel}:end`, {
          ok: true,
          offlineSynthesis: true,
          sources: synth.sources,
          agentSteps: offlineSteps,
          retrievalMs,
          generationMs: 0,
        });
        RuntimeDiagnostics.getInstance().recordLlmQuery({
          success: true,
          retrievalMs,
          generationMs: 0,
        });
        return {
          success: true,
          offlineSynthesis: true,
          sources: synth.sources,
          agentSteps: offlineSteps,
        };
      }

      const kernel = getReactiveWorkspaceKernel();
      const fsService = kernel.getFileSystemService();
      const validator = new PathValidator(fsService.getAllowedRoots());

      const agent = new WorkspaceReActAgent({
        provider: transportCfg.provider,
        ollamaUrl: transportCfg.baseUrl,
        model: llmConfig?.model || activeClient.getModel(),
        temperature: llmConfig?.temperature,
        maxTokens: llmConfig?.maxTokens,
        searchFiles: (q, root) => searchWorkspacePaths(q, root),
        searchContent: (q, topK, root) => searchWorkspaceContent(q, topK ?? 8, root),
        readFileRange: (filePath, startLine, endLine) =>
          fsService.readFileRange(filePath, startLine, endLine),
        queryGraph: (graphInput) => queryWorkspaceGraphInsights(graphInput),
        proposeOrganizePlan: (targetDir, strategy) =>
          createOrganizerService().proposeOrganizationPlan({
            targetDir,
            strategy,
            useLLM: true,
          }),
        validatePath: (candidate) => validator.validateCanonical(candidate),
      });

      const genStart = Date.now();
      const agentResult = await agent.run(query, {
        maxSteps: 4,
        contextScope,
        history,
        signal: queryAbort.signal,
        onStep: (step): void => {
          safeSend(`${channel}:step`, step);
        },
      });
      generationMs = Date.now() - genStart;
      LLMMetrics.getInstance().recordTiming(MetricOperation.LLM_QUERY, generationMs);

      if (agentResult.answer && !event.sender.isDestroyed()) {
        safeSend(channel, agentResult.answer);
      }

      safeSend(`${channel}:end`, {
        ok: true,
        sources: agentResult.sources,
        agentSteps: agentResult.steps,
        proposedPlan: agentResult.proposedPlan,
        retrievalMs: 0,
        generationMs,
      });
      RuntimeDiagnostics.getInstance().recordLlmQuery({
        success: true,
        retrievalMs: 0,
        generationMs,
      });

      return {
        success: true,
        sources: agentResult.sources,
        agentSteps: agentResult.steps,
        proposedPlan: agentResult.proposedPlan,
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
          const range = await kernelFs.readFileRange(check.canonicalPath, 1, 50);
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

    const runtimeAvailable = await llmInterface!.checkConnection();
    if (!runtimeAvailable) {
      const synth = offlineSynthesis.synthesize({
        query,
        retrievalResult,
        knowledgeGraph: vectorStore?.getKnowledgeGraph(),
      });
      safeSend(channel, synth.answer);
      safeSend(`${channel}:end`, {
        ok: true,
        offlineSynthesis: true,
        sources: structuredSources,
        retrievalMs,
        generationMs: 0,
      });
      RuntimeDiagnostics.getInstance().recordLlmQuery({
        success: true,
        retrievalMs,
        generationMs: 0,
      });
      return {
        success: true,
        offlineSynthesis: true,
        sources: structuredSources,
      };
    }

    const genStart = Date.now();
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
      safeSend(channel, chunk);
    }
    generationMs = Date.now() - genStart;
    LLMMetrics.getInstance().recordTiming(MetricOperation.LLM_QUERY, generationMs);

    safeSend(`${channel}:end`, {
      ok: true,
      sources: structuredSources,
      retrievalMs,
      generationMs,
    });
    RuntimeDiagnostics.getInstance().recordLlmQuery({
      success: true,
      retrievalMs,
      generationMs,
    });

    return { success: true, sources: structuredSources };
  } catch (error: unknown) {
    if (queryAbort.signal.aborted) {
      safeSend(`${channel}:end`, { ok: true, aborted: true });
      return { success: true };
    }
    const rawMsg = error instanceof Error ? error.message : String(error);
    const msg = ErrorSerializer.sanitizeText(rawMsg);
    safeSend(channel, `Error: ${msg}`);
    safeSend(`${channel}:end`, { ok: false, error: msg });
    RuntimeDiagnostics.getInstance().recordLlmQuery({
      success: false,
      retrievalMs,
      generationMs,
      error: msg,
    });
    return { success: false, error: msg };
  } finally {
    activeQueryAbortControllers.delete(channel);
    if (event.sender && typeof event.sender.removeListener === 'function') {
      event.sender.removeListener('destroyed', abortOnDestroy);
    }
  }
}

async function handleAbortQuery(
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

/**
 * Handler: LLM:INDEX_STATUS
 * Get indexing progress.
 */
async function handleIndexStatus(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<IndexingStatus> {
  try {
    await ensureServicesInitialized();
    await indexingService!.getStats();

    return {
      indexed: indexedCount,
      total: totalToIndex,
      inProgress: indexingInProgress,
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

/**
 * Handler: LLM:START_INDEXING
 * Start indexing directory.
 */
async function handleStartIndexing(
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

    // Persist opt-in indexed root cleanly if not already covered
    try {
      const cm = ConfigManager.getInstance();
      const existing = cm.getAll()?.fileSystem?.indexedRoots ?? [];
      const cmp = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
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

/**
 * Index files in background with progress updates.
 * 
 * Optimized for responsiveness:
 * - Longer yields between files
 * - Batch pauses every 5 files
 * - Proper error handling per file
 */
async function indexFilesBackground(
  filePaths: string[],
  event: IpcMainInvokeEvent
): Promise<void> {
  const BATCH_SIZE = 5; // Pause every 5 files for UI responsiveness

  for (const filePath of filePaths) {
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

      const indexResult = await indexingService!.indexFile(canonicalPath, false, { skipMetadataStubs: true });
      const didEmbedWork = indexResult.success && indexResult.chunksCreated > 0;
      if (didEmbedWork) {
        indexedCount++;
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send('LLM:INDEXING_PROGRESS', {
          indexed: indexedCount,
          total: totalToIndex,
          currentFile: filePath,
        });
      }

      // Only yield / sleep after real embedding work; unchanged skipped files fly past without idle sleep
      if (didEmbedWork) {
        const yieldDuration = calculateAdaptiveYield(filePath, indexedCount);
        await new Promise(resolve => setTimeout(resolve, yieldDuration));

        if (indexedCount % BATCH_SIZE === 0) {
          const batchYield = Math.min(300 + indexedCount * 2, 600);
          await new Promise(resolve => setTimeout(resolve, batchYield));
        }
      } else {
        await new Promise(resolve => setImmediate(resolve));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      LLMLogger.warn('Failed to index file', { filePath, error: msg });
      // Continue with next file, don't break on error
    }
  }

  // Flush any remaining pending records in VectorStore
  try {
    await vectorStore?.flushPendingRecords();
  } catch (flushError) {
    LLMLogger.warn('Failed to flush pending records', {
      error: flushError instanceof Error ? flushError.message : String(flushError)
    });
  }

  indexingInProgress = false;
  currentFile = '';

  // Send completion event
  if (!event.sender.isDestroyed()) {
    event.sender.send('LLM:INDEXING_COMPLETE', {
      indexed: indexedCount,
      total: totalToIndex,
    });
  }

  LLMLogger.info('Indexing complete', { indexed: indexedCount, total: totalToIndex });
}

/**
 * Handler: LLM:STOP_INDEXING
 * Stop background indexing.
 */
async function handleStopIndexing(
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

/**
 * Handler: LLM:INDEX_FILE
 * Index a single file.
 */
async function handleIndexFile(
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

async function handleKernelIndexMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): Promise<void> {
  if (!vectorStore || !indexingService) {
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

    // Enforce opt-in Vault boundary for background incremental indexing
    try {
      const indexedRoots = ConfigManager.getInstance().getAll()?.fileSystem?.indexedRoots ?? [];
      if (indexedRoots.length === 0) {
        return;
      }
      const cmp = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
      const targetKey = cmp(canonicalPath);
      const insideOptInRoot = indexedRoots.some((root) => {
        const rootKey = cmp(root);
        return targetKey === rootKey || targetKey.startsWith(rootKey.endsWith(path.sep) ? rootKey : `${rootKey}${path.sep}`);
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

    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INDEXABLE_FILE_SIZE) {
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

/**
 * Handler: LLM:CHECK_OLLAMA
 * Check if Ollama is running without blocking on ONNX embedding downloads.
 */
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

async function handleCheckOllama(
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

  return {
    available,
    models,
    activeModel: llmCfg?.model ?? llmInterface?.getModel() ?? 'llama3.2',
    embeddingModel: llmCfg?.embeddingModel ?? 'Xenova/bge-small-en-v1.5',
    rerankerModel: llmCfg?.rerankerModel ?? 'Xenova/ms-marco-MiniLM-L-6-v2',
    temperature: llmCfg?.temperature ?? 0.7,
    maxTokens: llmCfg?.maxTokens ?? 2048,
    provider: transportCfg.provider,
    openAiBaseUrl: llmCfg?.openAiBaseUrl ?? 'http://127.0.0.1:1234',
    embeddingDevice: llmCfg?.embeddingDevice ?? 'auto',
    enableVisionCaptioning: llmCfg?.enableVisionCaptioning ?? false,
  };
}

async function handleListModels(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<LLMModelsSnapshot> {
  return buildModelsSnapshot();
}

async function handleSetModelConfig(
  _event: IpcMainInvokeEvent,
  input: {
    provider?: LocalLLMProvider;
    openAiBaseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    embeddingModel?: string;
    rerankerModel?: string;
    embeddingDevice?: 'auto' | 'cpu' | 'dml' | 'webgpu';
    enableVisionCaptioning?: boolean;
  }
): Promise<{ success: boolean; config: LLMModelsSnapshot }> {
  const updates: Array<[string, unknown]> = [];
  if (input.provider !== undefined) {
    updates.push(['llm.provider', input.provider]);
  }
  if (input.openAiBaseUrl !== undefined) {
    updates.push(['llm.openAiBaseUrl', input.openAiBaseUrl.trim()]);
  }
  if (input.model !== undefined) {
    updates.push(['llm.model', input.model.trim()]);
  }
  if (input.temperature !== undefined) {
    updates.push(['llm.temperature', input.temperature]);
  }
  if (input.maxTokens !== undefined) {
    updates.push(['llm.maxTokens', input.maxTokens]);
  }
  if (input.embeddingModel !== undefined) {
    updates.push(['llm.embeddingModel', input.embeddingModel.trim()]);
  }
  if (input.rerankerModel !== undefined) {
    updates.push(['llm.rerankerModel', input.rerankerModel.trim()]);
  }
  if (input.embeddingDevice !== undefined) {
    updates.push(['llm.embeddingDevice', input.embeddingDevice]);
  }
  if (input.enableVisionCaptioning !== undefined) {
    updates.push(['llm.enableVisionCaptioning', input.enableVisionCaptioning]);
  }

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

/**
 * Handler: LLM:CLEAR_INDEX
 * Clear the vector database and reset indexing state.
 */
async function handleClearIndex(
  _event: IpcMainInvokeEvent,
  _input: Record<string, never>
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureServicesInitialized();

    if (indexingInProgress || activeIndexingPromise) {
      abortIndexing = true;
      await activeIndexingPromise?.catch(() => undefined);
    }

    const result = await vectorStore!.clear();

    indexedCount = 0;
    totalToIndex = 0;
    currentFile = '';

    LLMLogger.info('Vector index cleared');

    return { success: result.success };
  } catch (error: unknown) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const msg = ErrorSerializer.sanitizeText(rawMsg);
    LLMLogger.error('Failed to clear index', { error: rawMsg });
    return { success: false, error: msg };
  }
}

function createOrganizerService(): AIOrganizerService {
  const kernel = getReactiveWorkspaceKernel();
  const fsService = kernel.getFileSystemService();
  const validator = new PathValidator(fsService.getAllowedRoots());
  const llmCfg = readLlmConfig();

  return new AIOrganizerService({
    validator,
    operationJournal: getOperationJournal(),
    ollamaUrl: resolveOllamaUrl(),
    model: llmCfg?.model,
  });
}

async function handlePlanOrganize(
  _event: IpcMainInvokeEvent,
  input: { targetDir: string; strategy?: OrganizeStrategy; useLLM?: boolean }
): Promise<OrganizePlanResult> {
  const canonicalTarget = await validateCanonicalPathOrThrow(input.targetDir);
  return createOrganizerService().proposeOrganizationPlan({
    targetDir: canonicalTarget,
    strategy: input.strategy,
    useLLM: input.useLLM,
  });
}

async function handleApplyOrganize(
  _event: IpcMainInvokeEvent,
  input: {
    planId: string;
    targetDir: string;
    operations: OrganizePlanOperation[];
  }
): Promise<OrganizeApplyResult> {
  const canonicalTarget = await validateCanonicalPathOrThrow(input.targetDir);
  return createOrganizerService().applyOrganizationPlan({
    planId: input.planId,
    targetDir: canonicalTarget,
    operations: input.operations,
  });
}

const LLM_CHANNELS: IPCChannel[] = [
  'LLM:QUERY',
  'LLM:ABORT_QUERY',
  'LLM:INDEX_STATUS',
  'LLM:START_INDEXING',
  'LLM:STOP_INDEXING',
  'LLM:INDEX_FILE',
  'LLM:CHECK_OLLAMA',
  'LLM:CLEAR_INDEX',
  'LLM:LIST_MODELS',
  'LLM:SET_MODEL_CONFIG',
  'AI:ORGANIZE_PLAN',
  'AI:ORGANIZE_APPLY',
];

/**
 * Register all LLM IPC handlers.
 */
export function registerLLMHandlers(): IPCChannel[] {
  IPCLogger.info('Registering LLM IPC handlers');

  ipcMain.handle('LLM:QUERY', withContract('LLM:QUERY', handleQuery));
  ipcMain.handle('LLM:ABORT_QUERY', withContract('LLM:ABORT_QUERY', handleAbortQuery));
  ipcMain.handle('LLM:INDEX_STATUS', withContract('LLM:INDEX_STATUS', handleIndexStatus));
  ipcMain.handle('LLM:START_INDEXING', withContract('LLM:START_INDEXING', handleStartIndexing));
  ipcMain.handle('LLM:STOP_INDEXING', withContract('LLM:STOP_INDEXING', handleStopIndexing));
  ipcMain.handle('LLM:INDEX_FILE', withContract('LLM:INDEX_FILE', handleIndexFile));
  ipcMain.handle('LLM:CHECK_OLLAMA', withContract('LLM:CHECK_OLLAMA', handleCheckOllama));
  ipcMain.handle('LLM:CLEAR_INDEX', withContract('LLM:CLEAR_INDEX', handleClearIndex));
  ipcMain.handle('LLM:LIST_MODELS', withContract('LLM:LIST_MODELS', handleListModels));
  ipcMain.handle('LLM:SET_MODEL_CONFIG', withContract('LLM:SET_MODEL_CONFIG', handleSetModelConfig));
  ipcMain.handle('AI:ORGANIZE_PLAN', withContract('AI:ORGANIZE_PLAN', handlePlanOrganize));
  ipcMain.handle('AI:ORGANIZE_APPLY', withContract('AI:ORGANIZE_APPLY', handleApplyOrganize));

  configureKernelHooks({ indexMutationHook: handleKernelIndexMutation });

  IPCLogger.info(`LLM IPC handlers registered (${LLM_CHANNELS.length} handlers)`);
  return [...LLM_CHANNELS];
}

/**
 * Cleanup LLM services on app shutdown.
 * Call this before app.quit() to properly terminate worker threads.
 */
export async function cleanupLLMServices(): Promise<void> {
  LLMLogger.info('Cleaning up LLM services...');
  configureKernelHooks({ indexMutationHook: null });
  abortIndexing = true;
  for (const ctrl of activeQueryAbortControllers.values()) {
    ctrl.abort();
  }
  activeQueryAbortControllers.clear();

  if (initPromise) {
    await initPromise.catch(() => undefined);
  }
  if (activeIndexingPromise) {
    await activeIndexingPromise.catch(() => undefined);
  }

  // Terminate embedding worker if active
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

  // Close vector store & Knowledge Graph SQLite handle
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

export async function resetLLMHandlersForTesting(): Promise<void> {
  await cleanupLLMServices();
}
