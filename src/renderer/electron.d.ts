/**
 * Type definitions for Electron API exposed via preload script.
 */

import type {
  AgentTraceStep,
  ContentSearchMatch,
  CopilotContextScope,
  CopilotQueryMode,
  FileDeleteMode,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
  FileStats,
  GraphInsightsResponse,
  IndexingStatus,
  LLMModelsSnapshot,
  OperationJournalState,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  RetrievalSource,
  SystemPaths,
  UndoRedoResult,
  VaultConfigSnapshot,
} from '../shared/contracts';
import type { RuntimeDiagnosticsSnapshot } from '../shared/diagnostics';

interface ElectronAPI {
  fs: {
    readDirectory: (path: string) => Promise<FileNode[]>;
    readFile: (path: string) => Promise<{ content: string; encoding: string }>;
    previewFile: (path: string, maxLines?: number) => Promise<FilePreviewResult>;
    readFileRange: (
      path: string,
      startLine: number,
      endLine?: number,
      contextLines?: number
    ) => Promise<FileLineRangeResult>;
    writeFile: (path: string, content: string) => Promise<{ success: boolean }>;
    createFile: (
      path: string,
      name: string,
      content?: string
    ) => Promise<{ success: boolean; path: string }>;
    createDirectory: (
      path: string,
      name: string
    ) => Promise<{ success: boolean; path: string }>;
    delete: (path: string, recursive?: boolean, mode?: FileDeleteMode) => Promise<{ success: boolean }>;
    move: (source: string, destination: string) => Promise<{ success: boolean; newPath: string }>;
    getStats: (path: string) => Promise<FileStats>;
    getSystemPaths: () => Promise<SystemPaths>;
    rename: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath: string }>;
    undo: () => Promise<UndoRedoResult>;
    redo: () => Promise<UndoRedoResult>;
    getJournalState: () => Promise<OperationJournalState>;
    emptyTrashVault: () => Promise<OperationJournalState>;
  };

  vault: {
    getConfig: () => Promise<VaultConfigSnapshot>;
    addRoot: (options?: {
      path?: string;
      pickDialog?: boolean;
    }) => Promise<{ cancelled: boolean; addedPath?: string; config: VaultConfigSnapshot }>;
    removeRoot: (path: string) => Promise<VaultConfigSnapshot>;
    setIndexed: (path: string, enabled: boolean) => Promise<VaultConfigSnapshot>;
    toggleFavorite: (path: string) => Promise<VaultConfigSnapshot>;
  };

  navigation: {
    back: () => Promise<string | null>;
    forward: () => Promise<string | null>;
    push: (path: string) => Promise<{ success: boolean }>;
    getState: () => Promise<{ canGoBack: boolean; canGoForward: boolean }>;
  };

  search: {
    autocomplete: (prefix: string, maxResults?: number) => Promise<string[]>;
    query: (query: string, searchRoot: string) => Promise<FileNode[]>;
    content: (query: string, topK?: number, searchRoot?: string) => Promise<ContentSearchMatch[]>;
  };

  graph: {
    queryInsights: (options?: {
      symbolQuery?: string;
      backlinkTarget?: string;
    }) => Promise<GraphInsightsResponse>;
  };

  llm: {
    query: (
      query: string,
      callback: (chunk: string) => void,
      options?: { mode?: CopilotQueryMode; contextScope?: CopilotContextScope }
    ) => Promise<{
      success: boolean;
      error?: string;
      sources?: RetrievalSource[];
      agentSteps?: AgentTraceStep[];
    }>;
    getIndexingStatus: () => Promise<IndexingStatus>;
    onIndexingProgress: (callback: (status: IndexingStatus) => void) => () => void;
    startIndexing: (
      path: string
    ) => Promise<{ success: boolean; message?: string; total?: number; error?: string }>;
    stopIndexing: () => Promise<{ success: boolean }>;
    indexFile: (
      filePath: string
    ) => Promise<{ success: boolean; chunksCreated?: number; error?: string }>;
    checkOllama: () => Promise<{ available: boolean; models: string[] }>;
    clearIndex: () => Promise<{ success: boolean; error?: string }>;
    listModels: () => Promise<LLMModelsSnapshot>;
    setModelConfig: (config: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      embeddingModel?: string;
      rerankerModel?: string;
    }) => Promise<{ success: boolean; config: LLMModelsSnapshot }>;
  };

  ai?: {
    planOrganize: (
      targetDir: string,
      strategy?: OrganizeStrategy,
      useLLM?: boolean
    ) => Promise<OrganizePlanResult>;
    applyOrganize: (input: {
      planId: string;
      targetDir: string;
      operations: OrganizePlanOperation[];
    }) => Promise<OrganizeApplyResult>;
  };

  fileWatcher: {
    subscribe: (callback: (event: { type: string; path: string }) => void) => () => void;
  };

  clipboard: {
    writeText: (text: string) => Promise<{ success: boolean }>;
  };

  shell: {
    openPath: (path: string) => Promise<{ success: boolean; error?: string }>;
  };

  diagnostics: {
    getSnapshot: () => Promise<RuntimeDiagnosticsSnapshot>;
  };

  ping: () => Promise<'pong'>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __electronIPCBridge?: unknown;
  }
}

export {};
