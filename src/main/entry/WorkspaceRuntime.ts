/**
 * WorkspaceRuntime.ts - Explicit Composition Root for PrivateVault Intelligence & File Ops.
 *
 * Replaces hidden global singletons in `LlmWorkspaceService.ts` by assembling:
 *   - VaultRootAuthority + PathValidator (IPathValidationPort)
 *   - VaultSqliteDb / WorkspaceKnowledgeGraph (IGraphIndexPort)
 *   - RuntimeDiagnostics (IDiagnosticsSink)
 *   - Electron net.fetch injection for LocalModelTransport
 *   - ReactiveWorkspaceKernel + DirectoryScanner + WorkspaceSearchService
 *   - IntelligenceRuntime (Tier A FTS5/KG/Offline + Tier B ONNX/LanceDB)
 *   - IndexingCoordinator + CopilotCoordinator + ModelLifecycleManager + AIOrganizerService
 */

import * as path from 'path';
import { IpcMainInvokeEvent, net } from 'electron';
import { ConfigManager, resolveCanonicalVectorDbDir } from '@shared/config';
import {
  ContentSearchMatch,
  FileConnectionsSummary,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  IndexingStatus,
  LLMModelsSnapshot,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '@shared/contracts';
import { IPCResponseMap } from '@shared/ipc/contracts';
import { LLMLogger } from '@shared/logging';
import { normalizePathKey } from '@main/platform/pathNormalize';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { OrganizerVectorClusterGroup } from '@main/platform/organizer/OrganizerPlanner';
import { ErrorSerializer } from '@main/middleware/ErrorSerializer';
import { AIOrganizerService } from '@main/services/AIOrganizerService';
import { DirectoryScanner } from '@main/services/DirectoryScanner';
import { getOperationJournal } from '@main/services/OperationJournal';
import { getReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { searchWorkspacePaths } from '@main/services/WorkspaceSearchService';
import { WorkspaceKnowledgeGraph } from '@main/services/WorkspaceKnowledgeGraph';
import {
  ISecureFileReaderPort,
  IStreamTarget,
  TierHealthStatus,
} from '../../llm/ports/IntelligencePorts';
import {
  LocalLLMProvider,
  LocalModelTransport,
  registerDefaultLocalFetchTransport,
} from '../../llm/services/LocalModelTransport';
import { clusterDocumentsByVector } from '../../llm/services/SemanticClustering';
import { CopilotCoordinator, CopilotQueryInput } from '../../llm/runtime/CopilotCoordinator';
import { IndexingCoordinator } from '../../llm/runtime/IndexingCoordinator';
import {
  IntelligenceRuntime,
  IntelligenceRuntimeDeps,
} from '../../llm/runtime/IntelligenceRuntime';
import {
  ModelLifecycleManager,
  SetLlmModelConfigInput,
} from '../../llm/runtime/ModelLifecycleManager';

const INDEXABLE_SCAN_EXTENSIONS = [
  'txt', 'md', 'markdown', 'mdx', 'rst',
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'json', 'yaml', 'yml', 'toml',
  'xml', 'html', 'htm', 'css', 'sh', 'ps1', 'sql', 'log',
  'pdf', 'docx', 'csv', 'tsv', 'ipynb',
];

export interface WorkspaceRuntimeOverrides {
  resolveVectorDbDir?: () => string;
  embeddingPoolFactory?: IntelligenceRuntimeDeps['embeddingPoolFactory'];
}

function adaptElectronStreamTarget(event: IpcMainInvokeEvent): IStreamTarget {
  return {
    isDestroyed: (): boolean => event.sender.isDestroyed(),
    send: (channel, payload): void => {
      event.sender.send(channel, payload);
    },
    onceDestroyed: (listener): void => {
      if (event.sender && typeof event.sender.once === 'function') {
        event.sender.once('destroyed', listener);
      }
    },
    removeDestroyedListener: (listener): void => {
      if (event.sender && typeof event.sender.removeListener === 'function') {
        event.sender.removeListener('destroyed', listener);
      }
    },
  };
}

export class WorkspaceRuntime {
  readonly modelManager: ModelLifecycleManager;
  readonly intelligence: IntelligenceRuntime;
  readonly indexing: IndexingCoordinator;
  readonly copilot: CopilotCoordinator;
  private readonly resolveDbDir: () => string;

  constructor(overrides: WorkspaceRuntimeOverrides = {}) {
    if (typeof net?.fetch === 'function') {
      registerDefaultLocalFetchTransport((urlOrReq, init) =>
        net.fetch(urlOrReq instanceof URL ? urlOrReq.toString() : urlOrReq, init)
      );
    }

    const diagnostics = RuntimeDiagnostics.getInstance();
    const authority = VaultRootAuthority.getInstance();
    const sanitizeError = (raw: string): string => ErrorSerializer.sanitizeText(raw);
    this.resolveDbDir = overrides.resolveVectorDbDir ?? resolveCanonicalVectorDbDir;

    const configPort = {
      readLlmConfig: (): ReturnType<ConfigManager['getAll']>['llm'] | undefined => {
        try {
          return ConfigManager.getInstance().get('llm');
        } catch {
          return undefined;
        }
      },
      readIndexedRoots: (): string[] => {
        try {
          return ConfigManager.getInstance().getAll()?.fileSystem?.indexedRoots ?? [];
        } catch {
          return [];
        }
      },
      addIndexedRootIfMissing: (canonicalDir: string): void => {
        const cm = ConfigManager.getInstance();
        const existing = cm.getAll()?.fileSystem?.indexedRoots ?? [];
        const dirKey = normalizePathKey(canonicalDir);
        const alreadyCovered = existing.some((r) => {
          const rk = normalizePathKey(r);
          return (
            dirKey === rk || dirKey.startsWith(rk.endsWith(path.sep) ? rk : `${rk}${path.sep}`)
          );
        });
        if (!alreadyCovered) {
          cm.set('fileSystem.indexedRoots', [...existing, canonicalDir], true);
        }
      },
      updateLlmConfig: (entries: Array<[string, unknown]>): void => {
        const cm = ConfigManager.getInstance();
        for (let i = 0; i < entries.length; i++) {
          const [key, val] = entries[i];
          cm.set(key, val, i === entries.length - 1);
        }
      },
    };

    const pathPort = {
      resolveAllowedRoots: (): string[] => authority.resolveAllowedRoots(),
      validateCanonical: (candidatePath: string): ReturnType<ReturnType<VaultRootAuthority['getValidator']>['validateCanonical']> =>
        authority.getValidator().validateCanonical(candidatePath),
      validateCanonicalPathOrThrow: async (targetPath: string): Promise<string> => {
        const validation = await authority.getValidator().validateCanonical(targetPath);
        if (!validation.valid || !validation.canonicalPath) {
          const err = new Error(
            validation.details || `Access denied to ${targetPath}`
          ) as Error & { code?: string };
          err.code = validation.error || 'UNAUTHORIZED_ACCESS';
          throw err;
        }
        return validation.canonicalPath;
      },
    };

    const kernelPort = {
      watchIndexedRoot: async (root: string): Promise<void> => {
        await getReactiveWorkspaceKernel().watchIndexedRoot(root);
      },
      reconcileIndexedFiles: async (
        indexedPaths: string[],
        onDelete: (stalePath: string) => Promise<void>
      ): Promise<number> =>
        getReactiveWorkspaceKernel().reconcileIndexedFiles(indexedPaths, onDelete),
      getFileReader: (): ISecureFileReaderPort => getReactiveWorkspaceKernel().getFileSystemService(),
      scanIndexableFiles: async (canonicalDir: string): Promise<string[]> => {
        const scanner = new DirectoryScanner(getReactiveWorkspaceKernel().getFileSystemService());
        const scanned = await scanner.scan(canonicalDir, {
          recursive: true,
          skipErrors: true,
          skipSensitiveFiles: true,
          extensions: INDEXABLE_SCAN_EXTENSIONS,
          maxSize: 10 * 1024 * 1024,
        });
        return scanned.map((entry) => entry.path);
      },
    };

    this.modelManager = new ModelLifecycleManager(configPort, diagnostics, sanitizeError);

    let indexingRef: IndexingCoordinator | null = null;
    this.intelligence = new IntelligenceRuntime({
      configPort,
      pathPort,
      kernelPort,
      diagnostics,
      modelManager: this.modelManager,
      resolveVectorDbDir: this.resolveDbDir,
      createKnowledgeGraph: (sqliteDbPath: string): WorkspaceKnowledgeGraph =>
        new WorkspaceKnowledgeGraph(sqliteDbPath),
      sanitizeError,
      embeddingPoolFactory: overrides.embeddingPoolFactory,
      onTierBReady: async (): Promise<void> => {
        if (!process.env.JEST_WORKER_ID) {
          indexingRef?.triggerOutboxReplay();
        }
        if (indexingRef && indexingRef.getPreInitBufferSize() > 0) {
          void indexingRef.drainPreInitMutations().catch((drainErr: unknown) => {
            LLMLogger.warn('Failed to drain pre-init kernel mutations', {
              error: drainErr instanceof Error ? drainErr.message : String(drainErr),
            });
          });
        }
      },
    });

    this.copilot = new CopilotCoordinator({
      runtime: this.intelligence,
      searchPort: {
        searchPaths: (q: string, root?: string): Promise<string[]> =>
          searchWorkspacePaths(q, root),
      },
      createOrganizer: (): AIOrganizerService => this.createOrganizerService(),
    });

    indexingRef = new IndexingCoordinator(this.intelligence, () =>
      this.copilot.getActiveQueriesCount()
    );
    this.indexing = indexingRef;
  }

  getTierHealth(): { tierA: TierHealthStatus; tierB: TierHealthStatus; tierBError?: string } {
    return this.intelligence.getTierStatus();
  }

  resolveVectorDbPath(): string {
    return this.resolveDbDir();
  }

  createOrganizerService(): AIOrganizerService {
    const kernel = getReactiveWorkspaceKernel();
    const fsService = kernel.getFileSystemService();
    const validator = VaultRootAuthority.getInstance().createScopedValidator(
      fsService.getAllowedRoots()
    );
    const transportCfg = this.modelManager.resolveActiveTransportSettings();
    const transport = new LocalModelTransport({
      provider: transportCfg.provider,
      baseUrl: transportCfg.baseUrl,
      model: transportCfg.model,
    });

    return new AIOrganizerService({
      validator,
      operationJournal: getOperationJournal(),
      provider: transportCfg.provider,
      ollamaUrl: transportCfg.baseUrl,
      model: transportCfg.model,
      findImpactForPaths: (targetPaths) =>
        this.intelligence.withKnowledgeGraph((kg) => kg.findImpactForPaths(targetPaths)),
      getDocumentVectors: async (filePaths): Promise<Map<string, number[]>> => {
        const centroids = await this.intelligence.getVectorStoreCentroids(filePaths);
        const vectors = new Map<string, number[]>();
        for (const [filePath, centroid] of centroids.entries()) {
          if (Array.isArray(centroid.vector) && centroid.vector.length > 0) {
            vectors.set(filePath, centroid.vector);
          }
        }
        return vectors;
      },
      embedTexts: (texts) => this.intelligence.embedBatchWithFallback(texts),
      clusterVectors: (items): OrganizerVectorClusterGroup[] =>
        clusterDocumentsByVector(items, { maxClusters: 6 }).groups,
      completeChat: (messages, options) => transport.completeChat(messages, options),
    });
  }

  executeCopilotQuery(
    event: IpcMainInvokeEvent,
    input: CopilotQueryInput
  ): Promise<IPCResponseMap['LLM:QUERY']> {
    return this.copilot.executeQuery(adaptElectronStreamTarget(event), input);
  }

  async abortCopilotQuery(
    _event: IpcMainInvokeEvent,
    input: { channel: string }
  ): Promise<{ aborted: boolean }> {
    return this.copilot.abortQuery(input.channel);
  }

  async getIndexingStatus(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<IndexingStatus> {
    return this.indexing.getIndexingStatus();
  }

  startDirectoryIndexing(
    event: IpcMainInvokeEvent,
    input: { path: string }
  ): Promise<{ success: boolean; message?: string; total?: number; error?: string }> {
    return this.indexing.startDirectoryIndexing(
      {
        isDestroyed: () => event.sender.isDestroyed(),
        send: (ch, payload) => event.sender.send(ch, payload),
      },
      input
    );
  }

  async stopDirectoryIndexing(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<{ success: boolean }> {
    return this.indexing.stopDirectoryIndexing();
  }

  indexSingleFile(
    _event: IpcMainInvokeEvent,
    input: { filePath: string }
  ): Promise<{ success: boolean; chunksCreated?: number; error?: string }> {
    return this.indexing.indexSingleFile(input);
  }

  handleKernelIndexMutation(
    eventType: 'create' | 'change' | 'unlink',
    filePath: string
  ): Promise<void> {
    return this.indexing.handleKernelIndexMutation(eventType, filePath);
  }

  checkOllamaStatus(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<{ available: boolean; models: string[] }> {
    return this.modelManager.checkOllamaStatus(this.intelligence.llmInterface);
  }

  listLlmModels(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<LLMModelsSnapshot> {
    return this.modelManager.buildModelsSnapshot({
      existingClient: this.intelligence.llmInterface,
      activeExecutionProvider: this.intelligence.embeddingModel?.getExecutionProvider(),
      supportedEmbeddingDevices: this.intelligence.embeddingModel?.getSupportedDevices(),
    });
  }

  setLlmModelConfig(
    _event: IpcMainInvokeEvent,
    input: SetLlmModelConfigInput
  ): Promise<{ success: boolean; config: LLMModelsSnapshot }> {
    return this.modelManager.setLlmModelConfig(input, {
      activeClient: this.intelligence.llmInterface,
      onEmbeddingPipelineDirty: () => this.intelligence.clearEmbeddingPipeline(),
      getSnapshot: () =>
        this.modelManager.buildModelsSnapshot({
          existingClient: this.intelligence.llmInterface,
          activeExecutionProvider: this.intelligence.embeddingModel?.getExecutionProvider(),
          supportedEmbeddingDevices: this.intelligence.embeddingModel?.getSupportedDevices(),
        }),
    });
  }

  downloadLlmModels(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<{ success: boolean; snapshot: LLMModelsSnapshot; error?: string }> {
    return this.modelManager.downloadLlmModels(() =>
      this.modelManager.buildModelsSnapshot({
        existingClient: this.intelligence.llmInterface,
        activeExecutionProvider: this.intelligence.embeddingModel?.getExecutionProvider(),
        supportedEmbeddingDevices: this.intelligence.embeddingModel?.getSupportedDevices(),
      })
    );
  }

  clearVectorIndex(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<{ success: boolean; error?: string }> {
    return this.indexing.clearVectorIndex();
  }

  async getRecentAgentTraces(
    _event: IpcMainInvokeEvent,
    input?: { limit?: number }
  ): Promise<IPCResponseMap['LLM:GET_TRACES']> {
    return this.copilot.getRecentAgentTraces(input?.limit);
  }

  async clearAgentTracesHistory(
    _event: IpcMainInvokeEvent,
    _input: Record<string, never>
  ): Promise<IPCResponseMap['LLM:CLEAR_TRACES']> {
    return this.copilot.clearAgentTracesHistory();
  }

  searchWorkspaceContent(
    query: string,
    topK: number = 20,
    searchRoot?: string
  ): ContentSearchMatch[] {
    return this.intelligence.searchWorkspaceContent(query, topK, searchRoot);
  }

  queryWorkspaceGraphInsights(input: {
    symbolQuery?: string;
    backlinkTarget?: string;
  }): GraphInsightsResponse {
    return this.intelligence.queryWorkspaceGraphInsights(input);
  }

  checkWorkspaceGraphImpact(targetPaths: string[]): GraphImpactCheckResult {
    return this.intelligence.checkWorkspaceGraphImpact(targetPaths);
  }

  getWorkspaceGraphMapData(input?: {
    rootPrefix?: string;
    maxNodes?: number;
  }): WorkspaceGraphMap {
    return this.intelligence.getWorkspaceGraphMapData(input);
  }

  getWorkspaceCollectionsData(input?: {
    rootPrefix?: string;
  }): Promise<WorkspaceCollectionGroup[]> {
    return this.intelligence.getWorkspaceCollectionsData(input);
  }

  getWorkspaceFileConnectionsData(filePath: string): FileConnectionsSummary {
    return this.intelligence.getWorkspaceFileConnectionsData(filePath);
  }

  async planWorkspaceOrganize(
    _event: IpcMainInvokeEvent,
    input: { targetDir: string; strategy?: OrganizeStrategy; useLLM?: boolean; recursive?: boolean }
  ): Promise<OrganizePlanResult> {
    const validation = await VaultRootAuthority.getInstance().getValidator().validateCanonical(input.targetDir);
    if (!validation.valid || !validation.canonicalPath) {
      throw new Error(validation.details || `Access denied to ${input.targetDir}`);
    }
    return this.createOrganizerService().proposeOrganizationPlan({
      targetDir: validation.canonicalPath,
      strategy: input.strategy,
      useLLM: input.useLLM,
      recursive: input.recursive,
    });
  }

  async applyWorkspaceOrganize(
    _event: IpcMainInvokeEvent,
    input: {
      planId: string;
      targetDir: string;
      operations: OrganizePlanOperation[];
      repairMarkdownLinks?: boolean;
    }
  ): Promise<OrganizeApplyResult> {
    const validation = await VaultRootAuthority.getInstance().getValidator().validateCanonical(input.targetDir);
    if (!validation.valid || !validation.canonicalPath) {
      throw new Error(validation.details || `Access denied to ${input.targetDir}`);
    }
    return this.createOrganizerService().applyOrganizationPlan({
      planId: input.planId,
      targetDir: validation.canonicalPath,
      operations: input.operations,
      repairMarkdownLinks: input.repairMarkdownLinks,
    });
  }

  withKnowledgeGraphSession<T>(fn: () => Promise<T>): Promise<T> {
    return this.intelligence.withKnowledgeGraphSession(fn);
  }

  async cleanup(): Promise<void> {
    LLMLogger.info('Cleaning up WorkspaceRuntime services...');
    this.copilot.abortAll();
    await this.indexing.cleanup();
    await this.intelligence.cleanup();
    LLMLogger.info('WorkspaceRuntime cleanup complete');
  }
}

let sharedRuntime: WorkspaceRuntime | null = null;

export function getWorkspaceRuntime(): WorkspaceRuntime {
  if (!sharedRuntime) {
    sharedRuntime = new WorkspaceRuntime();
  }
  return sharedRuntime;
}

export async function cleanupWorkspaceRuntime(): Promise<void> {
  if (sharedRuntime) {
    await sharedRuntime.cleanup();
    sharedRuntime = null;
  }
}

export { type LocalLLMProvider };
