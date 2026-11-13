/**
 * contracts.ts - Single source of truth for IPC channel contracts
 *
 * Every IPC channel's request Zod schema, canonical path validation fields,
 * rate-limit policy, and TypeScript request/response signatures live here.
 * Both Main registration and Preload invocation derive from this registry.
 */

import { z } from 'zod';
import type {
  FileNode,
  FilePreviewResult,
  FileStats,
  IndexingStatus,
  SystemPaths,
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

/**
 * Validates single directory/file entry names to prevent relative traversal
 * or embedded path separators (e.g. "../escape", "a/b", "a\\b", ".", "..").
 */
export function isSafeEntryName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed === '.' || trimmed === '..') {
    return false;
  }
  if (name.includes('\0') || name.includes('/') || name.includes('\\')) {
    return false;
  }
  if (name.includes('..') && (name === '..' || name.includes('/') || name.includes('\\'))) {
    return false;
  }
  return true;
}

export const safeEntryNameSchema = z
  .string()
  .min(1, 'Name cannot be empty')
  .max(255, 'Name exceeds maximum length')
  .refine(isSafeEntryName, {
    message: 'Name cannot contain path separators ("/", "\\"), null bytes, or be "." / ".."',
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
  'FS:WRITE_FILE': z.object({ path: z.string().min(1), content: z.string() }),
  'FS:DELETE': z.object({ path: z.string().min(1), recursive: z.boolean().optional() }),
  'FS:MOVE': z.object({ source: z.string().min(1), destination: z.string().min(1) }),
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
  'LLM:QUERY': z.object({
    query: z.string().min(1).max(8000),
    channel: z
      .string()
      .min(1)
      .regex(/^LLM:QUERY:[A-Za-z0-9:_-]+$/, 'Invalid stream channel name'),
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
  'FS:WRITE_FILE': { success: boolean };
  'FS:DELETE': { success: boolean };
  'FS:MOVE': { success: boolean; newPath: string };
  'FS:CREATE_FILE': { success: boolean; path: string };
  'FS:CREATE_DIR': { success: boolean; path: string };
  'FS:GET_STATS': FileStats;
  'FS:GET_SYSTEM_PATHS': SystemPaths;
  'FS:RENAME': { success: boolean; newPath: string };
  'NAV:BACK': string | null;
  'NAV:FORWARD': string | null;
  'NAV:PUSH': { success: boolean };
  'NAV:GET_STATE': { canGoBack: boolean; canGoForward: boolean };
  'SEARCH:AUTOCOMPLETE': string[];
  'SEARCH:QUERY': FileNode[];
  'LLM:QUERY': { success: boolean; error?: string };
  'LLM:INDEX_STATUS': IndexingStatus;
  'LLM:START_INDEXING': { success: boolean; message?: string; total?: number; error?: string };
  'LLM:STOP_INDEXING': { success: boolean };
  'LLM:INDEX_FILE': { success: boolean; chunksCreated?: number; error?: string };
  'LLM:CHECK_OLLAMA': { available: boolean; models: string[] };
  'LLM:CLEAR_INDEX': { success: boolean; error?: string };
  'CLIPBOARD:WRITE_TEXT': { success: boolean };
  'SHELL:OPEN_PATH': { success: boolean; error?: string };
  'RUNTIME:GET_DIAGNOSTICS': RuntimeDiagnosticsSnapshot;
  ping: 'pong';
}

export type IPCRequest<C extends IPCChannel> = z.output<(typeof IPC_SCHEMAS)[C]>;
export type IPCResponse<C extends IPCChannel> = IPCResponseMap[C];

export interface IPCContractEntry<C extends IPCChannel = IPCChannel> {
  channel: C;
  group: 'fileSystem' | 'navigation' | 'search' | 'llm' | 'shell' | 'runtime';
  schema: (typeof IPC_SCHEMAS)[C];
  pathFields: readonly string[];
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
    pathFields: ['path'],
    rateLimit: WRITE_RATE_LIMIT,
  },
  'FS:MOVE': {
    channel: 'FS:MOVE',
    group: 'fileSystem',
    schema: IPC_SCHEMAS['FS:MOVE'],
    pathFields: ['source', 'destination'],
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
