/**
 * contracts.ts - Single source of truth for IPC channel contracts
 *
 * Every IPC channel's request Zod schema, canonical path validation fields,
 * rate-limit policy, and TypeScript request/response signatures live here.
 * Both Main registration and Preload invocation derive from this registry.
 */

import { z } from 'zod';
import type {
  AgentTraceStep,
  ContentSearchMatch,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
  FileStats,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  IndexingStatus,
  LLMModelsSnapshot,
  OperationJournalState,
  OrganizeApplyResult,
  OrganizePlanResult,
  RetrievalSource,
  SystemPaths,
  UIPreferencesSnapshot,
  UndoRedoResult,
  VaultConfigSnapshot,
} from '../contracts';
import type { RuntimeDiagnosticsSnapshot } from '../diagnostics';
export {
  type IPCSerializedErrorPayload,
  type IPCSuccessEnvelope,
  type IPCErrorEnvelope,
  type IPCEnvelope,
  wrapIPCSuccess,
  wrapIPCError,
  isIPCEnvelope,
} from './envelope';

const RESERVED_DOS_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Validates single directory/file entry names to prevent relative traversal,
 * embedded path separators, NTFS Alternate Data Streams, or invalid OS names.
 */
export function isSafeEntryName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed === '.' || trimmed === '..') {
    return false;
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    return false;
  }
  if (
    name.includes('\0') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    /[<>:"|?*]/.test(name)
  ) {
    return false;
  }
  const baseUpper = trimmed.split('.')[0].toUpperCase();
  if (RESERVED_DOS_NAMES.has(baseUpper)) {
    return false;
  }
  return true;
}

export const safeEntryNameSchema = z
  .string()
  .min(1, 'Name cannot be empty')
  .max(255, 'Name exceeds maximum length')
  .refine(isSafeEntryName, {
    message: 'Name contains invalid characters, "..", reserved DOS name, or trailing dots/spaces',
  });

const optionalEmptyObjectSchema = z
  .union([z.undefined(), z.null(), z.record(z.unknown())])
  .transform(() => ({} as Record<string, never>));

export interface IPCRateLimitPolicy {
  windowMs: number;
  maxRequests: number;
}

const READ_RATE_LIMIT: IPCRateLimitPolicy = { windowMs: 60_000, maxRequests: 600 };
const WRITE_RATE_LIMIT: IPCRateLimitPolicy = { windowMs: 60_000, maxRequests: 240 };
const NAV_RATE_LIMIT: IPCRateLimitPolicy = { windowMs: 60_000, maxRequests: 600 };
const SEARCH_RATE_LIMIT: IPCRateLimitPolicy = { windowMs: 60_000, maxRequests: 300 };
const LLM_RATE_LIMIT: IPCRateLimitPolicy = { windowMs: 60_000, maxRequests: 60 };
const LLM_INDEX_RATE_LIMIT: IPCRateLimitPolicy = { windowMs: 60_000, maxRequests: 30 };

export const IPC_SCHEMAS = {
  'FS:READ_DIR': z.object({ path: z.string().min(1) }),
  'FS:READ_FILE': z.object({ path: z.string().min(1) }),
  'FS:PREVIEW_FILE': z.object({
    path: z.string().min(1),
    maxLines: z.number().int().min(1).max(100).optional(),
  }),
  'FS:READ_FILE_RANGE': z.object({
    path: z.string().min(1),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1).optional(),
    contextLines: z.number().int().min(0).max(50).optional(),
  }),
  'FS:WRITE_FILE': z.object({ path: z.string().min(1), content: z.string() }),
  'FS:DELETE': z.object({
    path: z.string().min(1),
    recursive: z.boolean().optional(),
    mode: z.enum(['vault', 'trash', 'permanent']).optional(),
  }),
  'FS:MOVE': z.object({
    source: z.string().min(1),
    destination: z.string().min(1),
    repairMarkdownLinks: z.boolean().optional(),
  }),
  'FS:COPY': z.object({ source: z.string().min(1), destination: z.string().min(1) }),
  'FS:CREATE_FILE': z.object({
    path: z.string().min(1),
    name: safeEntryNameSchema,
    content: z.string().optional(),
  }),
  'FS:CREATE_DIR': z.object({
    path: z.string().min(1),
    name: safeEntryNameSchema,
  }),
  'FS:GET_STATS': z.object({ path: z.string().min(1) }),
  'FS:GET_SYSTEM_PATHS': optionalEmptyObjectSchema,
  'FS:RENAME': z.object({
    oldPath: z.string().min(1),
    newName: safeEntryNameSchema,
  }),
  'FS:UNDO': optionalEmptyObjectSchema,
  'FS:REDO': optionalEmptyObjectSchema,
  'FS:GET_JOURNAL_STATE': optionalEmptyObjectSchema,
  'FS:EMPTY_TRASH_VAULT': optionalEmptyObjectSchema,
  'VAULT:GET_CONFIG': optionalEmptyObjectSchema,
  'VAULT:ADD_ROOT': z.object({
    path: z.string().min(1).optional(),
    pickDialog: z.boolean().optional(),
  }),
  'VAULT:REMOVE_ROOT': z.object({ path: z.string().min(1) }),
  'VAULT:SET_INDEXED': z.object({ path: z.string().min(1), enabled: z.boolean() }),
  'VAULT:TOGGLE_FAVORITE': z.object({ path: z.string().min(1) }),
  'VAULT:SET_UI_PREFS': z.object({
    theme: z.enum(['light', 'dark']).optional(),
    explorerLens: z.enum(['files', 'graph', 'collections', 'duplicates']).optional(),
    viewMode: z.enum(['grid', 'list']).optional(),
    splitPaneOpen: z.boolean().optional(),
  }),
  'NAV:BACK': optionalEmptyObjectSchema,
  'NAV:FORWARD': optionalEmptyObjectSchema,
  'NAV:PUSH': z.union([
    z.string().min(1).transform((p) => ({ path: p })),
    z.object({ path: z.string().min(1) }),
  ]),
  'NAV:GET_STATE': optionalEmptyObjectSchema,
  'SEARCH:AUTOCOMPLETE': z.object({
    prefix: z.string(),
    maxResults: z.number().int().min(1).max(200).optional(),
  }),
  'SEARCH:QUERY': z.object({
    query: z.string(),
    searchRoot: z.string().min(1),
  }),
  'SEARCH:CONTENT': z.object({
    query: z.string().min(1).max(500),
    topK: z.number().int().min(1).max(50).optional(),
    searchRoot: z.string().min(1).optional(),
  }),
  'GRAPH:QUERY_INSIGHTS': z
    .union([
      z.undefined(),
      z.null(),
      z.object({
        symbolQuery: z.string().max(200).optional(),
        backlinkTarget: z.string().max(200).optional(),
      }),
    ])
    .transform((v) => v ?? {}),
  'GRAPH:IMPACT_CHECK': z.object({
    paths: z.array(z.string().min(1)).min(1).max(250),
  }),
  'LLM:QUERY': z.object({
    query: z.string().min(1).max(8000),
    channel: z
      .string()
      .min(1)
      .regex(/^LLM:QUERY:[A-Za-z0-9:_-]+$/, 'Invalid stream channel name'),
    mode: z.enum(['rag', 'agent']).optional(),
    contextScope: z
      .object({
        currentPath: z.string().min(1).max(1000).optional(),
        selectedPaths: z.array(z.string().min(1).max(1000)).max(25).optional(),
        useFolder: z.boolean().optional(),
        useSelection: z.boolean().optional(),
      })
      .optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(8000),
        })
      )
      .max(12)
      .optional(),
  }),
  'LLM:ABORT_QUERY': z.object({
    channel: z
      .string()
      .min(1)
      .regex(/^LLM:QUERY:[A-Za-z0-9:_-]+$/, 'Invalid stream channel name'),
  }),
  'AI:ORGANIZE_PLAN': z.object({
    targetDir: z.string().min(1),
    strategy: z
      .enum(['auto', 'smart_category', 'by_type', 'by_date', 'ai_suggested'])
      .optional(),
    useLLM: z.boolean().optional(),
  }),
  'AI:ORGANIZE_APPLY': z.object({
    planId: z.string().min(1).max(120),
    targetDir: z.string().min(1),
    operations: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          action: z.enum(['move', 'rename']),
          sourcePath: z.string().min(1),
          destinationPath: z.string().min(1),
          sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid SHA-256 hex digest'),
          size: z.number().int().nonnegative(),
          category: z.string().min(1).max(120),
          reason: z.string().min(1).max(300),
        })
      )
      .min(1)
      .max(500),
  }),
  'LLM:INDEX_STATUS': optionalEmptyObjectSchema,
  'LLM:START_INDEXING': z.object({ path: z.string().min(1) }),
  'LLM:STOP_INDEXING': optionalEmptyObjectSchema,
  'LLM:INDEX_FILE': z.union([
    z.object({ filePath: z.string().min(1) }),
    z.object({ path: z.string().min(1) }).transform((v) => ({ filePath: v.path })),
  ]),
  'LLM:CHECK_OLLAMA': optionalEmptyObjectSchema,
  'LLM:CLEAR_INDEX': optionalEmptyObjectSchema,
  'LLM:LIST_MODELS': optionalEmptyObjectSchema,
  'LLM:SET_MODEL_CONFIG': z.object({
    provider: z.enum(['ollama', 'openai_compatible']).optional(),
    openAiBaseUrl: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(120).optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(64).max(32768).optional(),
    embeddingModel: z.string().min(1).max(120).optional(),
    rerankerModel: z.string().min(1).max(120).optional(),
    embeddingDevice: z.enum(['auto', 'cpu', 'dml', 'webgpu']).optional(),
    enableVisionCaptioning: z.boolean().optional(),
  }),
  'CLIPBOARD:WRITE_TEXT': z.union([
    z.string().max(1024 * 1024).transform((text) => ({ text })),
    z.object({ text: z.string().max(1024 * 1024) }),
  ]),
  'SHELL:OPEN_PATH': z.union([
    z.string().min(1).transform((p) => ({ path: p })),
    z.object({ path: z.string().min(1) }),
  ]),
  'RUNTIME:GET_DIAGNOSTICS': optionalEmptyObjectSchema,
  ping: optionalEmptyObjectSchema,
} as const;

export type IPCChannel = keyof typeof IPC_SCHEMAS;

export interface IPCResponseMap {
  'FS:READ_DIR': FileNode[];
  'FS:READ_FILE': { content: string; encoding: string };
  'FS:PREVIEW_FILE': FilePreviewResult;
  'FS:READ_FILE_RANGE': FileLineRangeResult;
  'FS:WRITE_FILE': { success: boolean };
  'FS:DELETE': { success: boolean };
  'FS:MOVE': { success: boolean; newPath: string; repairedLinksCount?: number };
  'FS:COPY': { success: boolean; copiedPath: string };
  'FS:CREATE_FILE': { success: boolean; path: string };
  'FS:CREATE_DIR': { success: boolean; path: string };
  'FS:GET_STATS': FileStats;
  'FS:GET_SYSTEM_PATHS': SystemPaths;
  'FS:RENAME': { success: boolean; newPath: string };
  'FS:UNDO': UndoRedoResult;
  'FS:REDO': UndoRedoResult;
  'FS:GET_JOURNAL_STATE': OperationJournalState;
  'FS:EMPTY_TRASH_VAULT': OperationJournalState;
  'VAULT:GET_CONFIG': VaultConfigSnapshot;
  'VAULT:ADD_ROOT': { cancelled: boolean; addedPath?: string; config: VaultConfigSnapshot };
  'VAULT:REMOVE_ROOT': VaultConfigSnapshot;
  'VAULT:SET_INDEXED': VaultConfigSnapshot;
  'VAULT:TOGGLE_FAVORITE': VaultConfigSnapshot;
  'VAULT:SET_UI_PREFS': UIPreferencesSnapshot;
  'NAV:BACK': string | null;
  'NAV:FORWARD': string | null;
  'NAV:PUSH': { success: boolean };
  'NAV:GET_STATE': { canGoBack: boolean; canGoForward: boolean };
  'SEARCH:AUTOCOMPLETE': string[];
  'SEARCH:QUERY': FileNode[];
  'SEARCH:CONTENT': ContentSearchMatch[];
  'GRAPH:QUERY_INSIGHTS': GraphInsightsResponse;
  'GRAPH:IMPACT_CHECK': GraphImpactCheckResult;
  'LLM:QUERY': {
    success: boolean;
    error?: string;
    sources?: RetrievalSource[];
    agentSteps?: AgentTraceStep[];
    offlineSynthesis?: boolean;
    proposedPlan?: OrganizePlanResult;
  };
  'LLM:ABORT_QUERY': { aborted: boolean };
  'AI:ORGANIZE_PLAN': OrganizePlanResult;
  'AI:ORGANIZE_APPLY': OrganizeApplyResult;
  'LLM:INDEX_STATUS': IndexingStatus;
  'LLM:START_INDEXING': { success: boolean; message?: string; total?: number; error?: string };
  'LLM:STOP_INDEXING': { success: boolean };
  'LLM:INDEX_FILE': { success: boolean; chunksCreated?: number; error?: string };
  'LLM:CHECK_OLLAMA': { available: boolean; models: string[] };
  'LLM:CLEAR_INDEX': { success: boolean; error?: string };
  'LLM:LIST_MODELS': LLMModelsSnapshot;
  'LLM:SET_MODEL_CONFIG': { success: boolean; config: LLMModelsSnapshot };
  'CLIPBOARD:WRITE_TEXT': { success: boolean };
  'SHELL:OPEN_PATH': { success: boolean; error?: string };
  'RUNTIME:GET_DIAGNOSTICS': RuntimeDiagnosticsSnapshot;
  ping: 'pong';
}

export type IPCRequest<C extends IPCChannel> = z.output<(typeof IPC_SCHEMAS)[C]>;
export type IPCResponse<C extends IPCChannel> = IPCResponseMap[C];

export interface IPCContractEntry<C extends IPCChannel = IPCChannel> {
  channel: C;
  group: 'fileSystem' | 'vault' | 'navigation' | 'search' | 'graph' | 'llm' | 'shell' | 'runtime';
  schema: (typeof IPC_SCHEMAS)[C];
  pathFields: readonly string[];
  linkSafePathFields?: readonly string[];
  rateLimit?: IPCRateLimitPolicy;
}

export const IPC_CONTRACTS: { [C in IPCChannel]: IPCContractEntry<C> } = {
  'FS:READ_DIR': {
    channel: 'FS:READ_DIR',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:READ_DIR'],
    pathFields: ['path'],
    rateLimit: READ_RATE_LIMIT,
  },
  'FS:READ_FILE': {
    channel: 'FS:READ_FILE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:READ_FILE'],
    pathFields: ['path'],
    rateLimit: READ_RATE_LIMIT,
  },
  'FS:PREVIEW_FILE': {
    channel: 'FS:PREVIEW_FILE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:PREVIEW_FILE'],
    pathFields: ['path'],
    rateLimit: READ_RATE_LIMIT,
  },
  'FS:READ_FILE_RANGE': {
    channel: 'FS:READ_FILE_RANGE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:READ_FILE_RANGE'],
    pathFields: ['path'],
    rateLimit: READ_RATE_LIMIT,
  },
  'FS:WRITE_FILE': {
    channel: 'FS:WRITE_FILE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:WRITE_FILE'],
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:DELETE': {
    channel: 'FS:DELETE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:DELETE'],
    pathFields: [],
    linkSafePathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:MOVE': {
    channel: 'FS:MOVE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:MOVE'],
    pathFields: ['destination'],
    linkSafePathFields: ['source'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:COPY': {
    channel: 'FS:COPY',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:COPY'],
    pathFields: ['destination'],
    linkSafePathFields: ['source'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:CREATE_FILE': {
    channel: 'FS:CREATE_FILE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:CREATE_FILE'],
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:CREATE_DIR': {
    channel: 'FS:CREATE_DIR',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:CREATE_DIR'],
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:GET_STATS': {
    channel: 'FS:GET_STATS',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:GET_STATS'],
    pathFields: ['path'],
    rateLimit: READ_RATE_LIMIT,
  },
  'FS:GET_SYSTEM_PATHS': {
    channel: 'FS:GET_SYSTEM_PATHS',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:GET_SYSTEM_PATHS'],
    pathFields: [],
  },
  'FS:RENAME': {
    channel: 'FS:RENAME',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:RENAME'],
    pathFields: ['oldPath'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:UNDO': {
    channel: 'FS:UNDO',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:UNDO'],
    pathFields: [],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:REDO': {
    channel: 'FS:REDO',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:REDO'],
    pathFields: [],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:GET_JOURNAL_STATE': {
    channel: 'FS:GET_JOURNAL_STATE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:GET_JOURNAL_STATE'],
    pathFields: [],
    rateLimit: READ_RATE_LIMIT,
  },
  'FS:EMPTY_TRASH_VAULT': {
    channel: 'FS:EMPTY_TRASH_VAULT',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:EMPTY_TRASH_VAULT'],
    pathFields: [],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'VAULT:GET_CONFIG': {
    channel: 'VAULT:GET_CONFIG',
    group: 'vault',
    schema: IPC_SCHEMAS['VAULT:GET_CONFIG'],
    pathFields: [],
    rateLimit: READ_RATE_LIMIT,
  },
  'VAULT:ADD_ROOT': {
    channel: 'VAULT:ADD_ROOT',
    group: 'vault',
    schema: IPC_SCHEMAS['VAULT:ADD_ROOT'],
    pathFields: [],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'VAULT:REMOVE_ROOT': {
    channel: 'VAULT:REMOVE_ROOT',
    group: 'vault',
    schema: IPC_SCHEMAS['VAULT:REMOVE_ROOT'],
    pathFields: [],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'VAULT:SET_INDEXED': {
    channel: 'VAULT:SET_INDEXED',
    group: 'vault',
    schema: IPC_SCHEMAS['VAULT:SET_INDEXED'],
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'VAULT:TOGGLE_FAVORITE': {
    channel: 'VAULT:TOGGLE_FAVORITE',
    group: 'vault',
    schema: IPC_SCHEMAS['VAULT:TOGGLE_FAVORITE'],
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'VAULT:SET_UI_PREFS': {
    channel: 'VAULT:SET_UI_PREFS',
    group: 'vault',
    schema: IPC_SCHEMAS['VAULT:SET_UI_PREFS'],
    pathFields: [],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'NAV:BACK': {
    channel: 'NAV:BACK',
    group: 'navigation',
    schema: IPC_SCHEMAS['NAV:BACK'],
    pathFields: [],
    rateLimit: NAV_RATE_LIMIT,
  },
  'NAV:FORWARD': {
    channel: 'NAV:FORWARD',
    group: 'navigation',
    schema: IPC_SCHEMAS['NAV:FORWARD'],
    pathFields: [],
    rateLimit: NAV_RATE_LIMIT,
  },
  'NAV:PUSH': {
    channel: 'NAV:PUSH',
    group: 'navigation',
    schema: IPC_SCHEMAS['NAV:PUSH'],
    pathFields: ['path'],
    rateLimit: NAV_RATE_LIMIT,
  },
  'NAV:GET_STATE': {
    channel: 'NAV:GET_STATE',
    group: 'navigation',
    schema: IPC_SCHEMAS['NAV:GET_STATE'],
    pathFields: [],
    rateLimit: NAV_RATE_LIMIT,
  },
  'SEARCH:AUTOCOMPLETE': {
    channel: 'SEARCH:AUTOCOMPLETE',
    group: 'search',
    schema: IPC_SCHEMAS['SEARCH:AUTOCOMPLETE'],
    pathFields: [],
    rateLimit: SEARCH_RATE_LIMIT,
  },
  'SEARCH:QUERY': {
    channel: 'SEARCH:QUERY',
    group: 'search',
    schema: IPC_SCHEMAS['SEARCH:QUERY'],
    pathFields: ['searchRoot'],
    rateLimit: SEARCH_RATE_LIMIT,
  },
  'SEARCH:CONTENT': {
    channel: 'SEARCH:CONTENT',
    group: 'search',
    schema: IPC_SCHEMAS['SEARCH:CONTENT'],
    pathFields: [],
    rateLimit: SEARCH_RATE_LIMIT,
  },
  'GRAPH:QUERY_INSIGHTS': {
    channel: 'GRAPH:QUERY_INSIGHTS',
    group: 'graph',
    schema: IPC_SCHEMAS['GRAPH:QUERY_INSIGHTS'],
    pathFields: [],
    rateLimit: READ_RATE_LIMIT,
  },
  'GRAPH:IMPACT_CHECK': {
    channel: 'GRAPH:IMPACT_CHECK',
    group: 'graph',
    schema: IPC_SCHEMAS['GRAPH:IMPACT_CHECK'],
    pathFields: [],
    rateLimit: READ_RATE_LIMIT,
  },
  'LLM:QUERY': {
    channel: 'LLM:QUERY',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:QUERY'],
    pathFields: [],
    rateLimit: LLM_RATE_LIMIT,
  },
  'LLM:INDEX_STATUS': {
    channel: 'LLM:INDEX_STATUS',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:INDEX_STATUS'],
    pathFields: [],
  },
  'LLM:START_INDEXING': {
    channel: 'LLM:START_INDEXING',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:START_INDEXING'],
    pathFields: ['path'],
    rateLimit: LLM_INDEX_RATE_LIMIT,
  },
  'LLM:STOP_INDEXING': {
    channel: 'LLM:STOP_INDEXING',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:STOP_INDEXING'],
    pathFields: [],
  },
  'LLM:INDEX_FILE': {
    channel: 'LLM:INDEX_FILE',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:INDEX_FILE'],
    pathFields: ['filePath'],
    rateLimit: LLM_INDEX_RATE_LIMIT,
  },
  'LLM:CHECK_OLLAMA': {
    channel: 'LLM:CHECK_OLLAMA',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:CHECK_OLLAMA'],
    pathFields: [],
  },
  'LLM:CLEAR_INDEX': {
    channel: 'LLM:CLEAR_INDEX',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:CLEAR_INDEX'],
    pathFields: [],
    rateLimit: LLM_INDEX_RATE_LIMIT,
  },
  'LLM:LIST_MODELS': {
    channel: 'LLM:LIST_MODELS',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:LIST_MODELS'],
    pathFields: [],
  },
  'LLM:ABORT_QUERY': {
    channel: 'LLM:ABORT_QUERY',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:ABORT_QUERY'],
    pathFields: [],
  },
  'LLM:SET_MODEL_CONFIG': {
    channel: 'LLM:SET_MODEL_CONFIG',
    group: 'llm',
    schema: IPC_SCHEMAS['LLM:SET_MODEL_CONFIG'],
    pathFields: [],
    rateLimit: LLM_RATE_LIMIT,
  },
  'AI:ORGANIZE_PLAN': {
    channel: 'AI:ORGANIZE_PLAN',
    group: 'llm',
    schema: IPC_SCHEMAS['AI:ORGANIZE_PLAN'],
    pathFields: ['targetDir'],
    rateLimit: LLM_RATE_LIMIT,
  },
  'AI:ORGANIZE_APPLY': {
    channel: 'AI:ORGANIZE_APPLY',
    group: 'llm',
    schema: IPC_SCHEMAS['AI:ORGANIZE_APPLY'],
    pathFields: ['targetDir'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'CLIPBOARD:WRITE_TEXT': {
    channel: 'CLIPBOARD:WRITE_TEXT',
    group: 'shell',
    schema: IPC_SCHEMAS['CLIPBOARD:WRITE_TEXT'],
    pathFields: [],
  },
  'SHELL:OPEN_PATH': {
    channel: 'SHELL:OPEN_PATH',
    group: 'shell',
    schema: IPC_SCHEMAS['SHELL:OPEN_PATH'],
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'RUNTIME:GET_DIAGNOSTICS': {
    channel: 'RUNTIME:GET_DIAGNOSTICS',
    group: 'runtime',
    schema: IPC_SCHEMAS['RUNTIME:GET_DIAGNOSTICS'],
    pathFields: [],
  },
  ping: {
    channel: 'ping',
    group: 'runtime',
    schema: IPC_SCHEMAS['ping'],
    pathFields: [],
  },
};

export const ALL_IPC_CHANNELS = Object.keys(IPC_CONTRACTS) as IPCChannel[];
