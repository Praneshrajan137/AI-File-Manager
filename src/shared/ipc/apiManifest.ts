/**
 * apiManifest.ts - Single-source manifest mapping renderer API namespaces & methods
 * to typed IPC channels (`IPC_CONTRACTS`).
 *
 * Both `src/main/preload.ts` (runtime bridge generator + IPCEnvelope types) and
 * `src/renderer/electron.d.ts` (unwrapped `window.electronAPI` types) derive
 * directly from `IPC_INVOKE_MANIFEST`, eliminating manual 4-file signature drift.
 */

import type { z } from 'zod';
import type {
  BatchTransferStep,
  FileDeleteMode,
  OrganizePlanOperation,
  OrganizeStrategy,
  UIPreferencesSnapshot,
} from '../contracts';
import type { IPCChannel, IPCResponse, IPC_SCHEMAS } from './contracts';
import type { IPCEnvelope } from './envelope';

export interface ChannelBinding<
  C extends IPCChannel = IPCChannel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Args extends any[] = any[],
> {
  readonly channel: C;
  readonly mapArgs?: (...args: Args) => unknown;
}

function bindChannel<C extends IPCChannel>(channel: C): ChannelBinding<C, []>;
function bindChannel<C extends IPCChannel, Args extends unknown[]>(
  channel: C,
  mapArgs: (...args: Args) => z.input<(typeof IPC_SCHEMAS)[C]>
): ChannelBinding<C, Args>;
function bindChannel<C extends IPCChannel, Args extends unknown[]>(
  channel: C,
  mapArgs?: (...args: Args) => z.input<(typeof IPC_SCHEMAS)[C]>
): ChannelBinding<C, Args> {
  return mapArgs ? { channel, mapArgs } : { channel };
}

/**
 * Channels intentionally implemented via custom multi-event streaming in preload
 * (`ipcRenderer.on(channel)` + `:step` + `:end` barrier) rather than `invokeContract`.
 */
export const IPC_STREAMING_CHANNELS = ['LLM:QUERY'] as const;

export const IPC_INVOKE_MANIFEST = {
  fs: {
    readDirectory: bindChannel('FS:READ_DIR', (path: string) => ({ path })),
    readFile: bindChannel('FS:READ_FILE', (path: string) => ({ path })),
    previewFile: bindChannel('FS:PREVIEW_FILE', (path: string, maxLines?: number) => ({
      path,
      maxLines,
    })),
    readFileRange: bindChannel(
      'FS:READ_FILE_RANGE',
      (path: string, startLine: number, endLine?: number, contextLines?: number) => ({
        path,
        startLine,
        endLine,
        contextLines,
      })
    ),
    writeFile: bindChannel('FS:WRITE_FILE', (path: string, content: string) => ({
      path,
      content,
    })),
    createFile: bindChannel(
      'FS:CREATE_FILE',
      (path: string, name: string, content?: string) => ({ path, name, content })
    ),
    createDirectory: bindChannel('FS:CREATE_DIR', (path: string, name: string) => ({
      path,
      name,
    })),
    delete: bindChannel(
      'FS:DELETE',
      (path: string, recursive?: boolean, mode?: FileDeleteMode) => ({
        path,
        recursive,
        mode,
      })
    ),
    move: bindChannel(
      'FS:MOVE',
      (source: string, destination: string, repairMarkdownLinks?: boolean) => ({
        source,
        destination,
        repairMarkdownLinks,
      })
    ),
    copy: bindChannel('FS:COPY', (source: string, destination: string) => ({
      source,
      destination,
    })),
    getStats: bindChannel('FS:GET_STATS', (path: string) => ({ path })),
    getSystemPaths: bindChannel('FS:GET_SYSTEM_PATHS'),
    rename: bindChannel('FS:RENAME', (oldPath: string, newName: string) => ({
      oldPath,
      newName,
    })),
    undo: bindChannel('FS:UNDO'),
    redo: bindChannel('FS:REDO'),
    getJournalState: bindChannel('FS:GET_JOURNAL_STATE'),
    listTrashVault: bindChannel('FS:LIST_TRASH_VAULT'),
    restoreTrashItem: bindChannel('FS:RESTORE_TRASH_ITEM', (id: string) => ({ id })),
    purgeTrashItem: bindChannel('FS:PURGE_TRASH_ITEM', (id: string) => ({ id })),
    emptyTrashVault: bindChannel('FS:EMPTY_TRASH_VAULT'),
    watchSplitDir: bindChannel('FS:WATCH_SPLIT_DIR', (path: string | null) => ({ path })),
    batchTransfer: bindChannel(
      'FS:BATCH_TRANSFER',
      (steps: BatchTransferStep[], description?: string) => ({ steps, description })
    ),
  },

  vault: {
    getConfig: bindChannel('VAULT:GET_CONFIG'),
    addRoot: bindChannel(
      'VAULT:ADD_ROOT',
      (options?: { path?: string; pickDialog?: boolean }) => options ?? { pickDialog: true }
    ),
    removeRoot: bindChannel('VAULT:REMOVE_ROOT', (path: string) => ({ path })),
    setIndexed: bindChannel('VAULT:SET_INDEXED', (path: string, enabled: boolean) => ({
      path,
      enabled,
    })),
    toggleFavorite: bindChannel('VAULT:TOGGLE_FAVORITE', (path: string) => ({ path })),
    setUiPrefs: bindChannel('VAULT:SET_UI_PREFS', (prefs: Partial<UIPreferencesSnapshot>) => prefs),
    setDefaultDeleteMode: bindChannel(
      'VAULT:SET_DEFAULT_DELETE_MODE',
      (mode: 'vault' | 'trash') => ({ mode })
    ),
  },

  navigation: {
    back: bindChannel('NAV:BACK'),
    forward: bindChannel('NAV:FORWARD'),
    push: bindChannel('NAV:PUSH', (path: string) => ({ path })),
    getState: bindChannel('NAV:GET_STATE'),
  },

  search: {
    autocomplete: bindChannel('SEARCH:AUTOCOMPLETE', (prefix: string, maxResults?: number) => ({
      prefix,
      maxResults,
    })),
    query: bindChannel('SEARCH:QUERY', (query: string, searchRoot: string) => ({
      query,
      searchRoot,
    })),
    content: bindChannel(
      'SEARCH:CONTENT',
      (query: string, topK?: number, searchRoot?: string) => ({
        query,
        topK,
        searchRoot,
      })
    ),
  },

  graph: {
    queryInsights: bindChannel(
      'GRAPH:QUERY_INSIGHTS',
      (options?: { symbolQuery?: string; backlinkTarget?: string }) => options
    ),
    checkImpact: bindChannel('GRAPH:IMPACT_CHECK', (paths: string[]) => ({ paths })),
    getWorkspaceMap: bindChannel(
      'GRAPH:WORKSPACE_MAP',
      (options?: { rootPrefix?: string; maxNodes?: number }) => options
    ),
    getCollections: bindChannel(
      'GRAPH:COLLECTIONS',
      (options?: { rootPrefix?: string }) => options
    ),
    getFileConnections: bindChannel('GRAPH:FILE_CONNECTIONS', (filePath: string) => ({
      filePath,
    })),
  },

  llm: {
    abortQuery: bindChannel('LLM:ABORT_QUERY', (channel: string) => ({ channel })),
    getIndexingStatus: bindChannel('LLM:INDEX_STATUS'),
    startIndexing: bindChannel('LLM:START_INDEXING', (path: string) => ({ path })),
    stopIndexing: bindChannel('LLM:STOP_INDEXING'),
    indexFile: bindChannel('LLM:INDEX_FILE', (filePath: string) => ({ filePath })),
    checkOllama: bindChannel('LLM:CHECK_OLLAMA'),
    clearIndex: bindChannel('LLM:CLEAR_INDEX'),
    getTraces: bindChannel('LLM:GET_TRACES', (limit?: number) =>
      limit !== undefined ? { limit } : undefined
    ),
    clearTraces: bindChannel('LLM:CLEAR_TRACES'),
    listModels: bindChannel('LLM:LIST_MODELS'),
    setModelConfig: bindChannel(
      'LLM:SET_MODEL_CONFIG',
      (config: {
        provider?: 'ollama' | 'openai_compatible';
        ollamaUrl?: string;
        openAiBaseUrl?: string;
        model?: string;
        temperature?: number;
        maxTokens?: number;
        embeddingModel?: string;
        rerankerModel?: string;
        embeddingDevice?: 'auto' | 'cpu' | 'dml' | 'webgpu';
        allowRemoteModels?: boolean;
      }) => config
    ),
    downloadModels: bindChannel('LLM:DOWNLOAD_MODELS'),
  },

  ai: {
    planOrganize: bindChannel(
      'AI:ORGANIZE_PLAN',
      (
        targetDir: string,
        strategy?: OrganizeStrategy,
        useLLM?: boolean,
        recursive?: boolean
      ) => ({ targetDir, strategy, useLLM, recursive })
    ),
    applyOrganize: bindChannel(
      'AI:ORGANIZE_APPLY',
      (input: {
        planId: string;
        targetDir: string;
        operations: OrganizePlanOperation[];
        repairMarkdownLinks?: boolean;
      }) => input
    ),
  },

  clipboard: {
    writeText: bindChannel('CLIPBOARD:WRITE_TEXT', (text: string) => ({ text })),
  },

  shell: {
    openPath: bindChannel('SHELL:OPEN_PATH', (path: string) => ({ path })),
    revealInFolder: bindChannel('SHELL:REVEAL_IN_FOLDER', (path: string) => ({ path })),
  },

  diagnostics: {
    getSnapshot: bindChannel('RUNTIME:GET_DIAGNOSTICS'),
  },

  ping: bindChannel('ping'),
};

export type PreloadInvokeTree<T> = {
  [K in keyof T]: T[K] extends ChannelBinding<infer C, infer Args>
    ? (...args: Args) => Promise<IPCEnvelope<IPCResponse<C>>>
    : PreloadInvokeTree<T[K]>;
};

export type RendererInvokeTree<T> = {
  [K in keyof T]: T[K] extends ChannelBinding<infer C, infer Args>
    ? (...args: Args) => Promise<IPCResponse<C>>
    : RendererInvokeTree<T[K]>;
};

type ExtractManifestChannels<T> = T extends ChannelBinding<infer C, infer _Args>
  ? C
  : T extends Record<string, unknown>
    ? { [K in keyof T]: ExtractManifestChannels<T[K]> }[keyof T]
    : never;

// Compile-time exhaustiveness proof: fails `tsc --noEmit` if a new IPCChannel is
// added to `IPC_CONTRACTS` without mapping it in `IPC_INVOKE_MANIFEST` or streaming list.
type UnmappedIPCChannels = Exclude<
  IPCChannel,
  ExtractManifestChannels<typeof IPC_INVOKE_MANIFEST> | (typeof IPC_STREAMING_CHANNELS)[number]
>;
export type AssertAllIPCChannelsMapped = UnmappedIPCChannels extends never ? true : UnmappedIPCChannels;
export const IPC_MANIFEST_EXHAUSTIVE: AssertAllIPCChannelsMapped = true;

export type ContractInvoker = <C extends IPCChannel>(
  channel: C,
  payload?: unknown
) => Promise<IPCEnvelope<IPCResponse<C>>>;

function isChannelBinding(value: unknown): value is ChannelBinding {
  return (
    value !== null &&
    typeof value === 'object' &&
    'channel' in value &&
    typeof (value as { channel: unknown }).channel === 'string'
  );
}

/**
 * Materializes the preload bridge invoke object tree from `IPC_INVOKE_MANIFEST`.
 */
export function buildPreloadInvokeTree<T extends Record<string, unknown>>(
  manifest: T,
  invoke: ContractInvoker
): PreloadInvokeTree<T> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(manifest)) {
    if (isChannelBinding(entry)) {
      result[key] = (...args: unknown[]): Promise<IPCEnvelope<IPCResponse<IPCChannel>>> => {
        const payload = entry.mapArgs ? entry.mapArgs(...args) : undefined;
        return invoke(entry.channel, payload);
      };
    } else if (entry !== null && typeof entry === 'object') {
      result[key] = buildPreloadInvokeTree(entry as Record<string, unknown>, invoke);
    }
  }
  return result as PreloadInvokeTree<T>;
}

/**
 * Enumerates all request-response IPC channels registered in `IPC_INVOKE_MANIFEST`.
 */
export function listManifestInvokeChannels(
  node: Record<string, unknown> = IPC_INVOKE_MANIFEST as unknown as Record<string, unknown>
): IPCChannel[] {
  const channels: IPCChannel[] = [];
  for (const entry of Object.values(node)) {
    if (isChannelBinding(entry)) {
      channels.push(entry.channel);
    } else if (entry !== null && typeof entry === 'object') {
      channels.push(...listManifestInvokeChannels(entry as Record<string, unknown>));
    }
  }
  return channels;
}
