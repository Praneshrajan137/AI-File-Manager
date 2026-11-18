/**
 * Type definitions for Electron API exposed via preload script.
 * Derived directly from `@shared/ipc/apiManifest` (`IPC_INVOKE_MANIFEST`) so renderer
 * types never drift from preload bindings or main IPC contracts.
 */

import type {
  AgentTraceStep,
  CopilotContextScope,
  CopilotQueryMode,
  IndexingStatus,
} from '../shared/contracts';
import type { IPC_INVOKE_MANIFEST, RendererInvokeTree } from '../shared/ipc/apiManifest';
import type { IPCResponse } from '../shared/ipc/contracts';

type BaseInvokeAPI = RendererInvokeTree<typeof IPC_INVOKE_MANIFEST>;
type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

interface ElectronAPI {
  fs: WithOptional<
    BaseInvokeAPI['fs'],
    'listTrashVault' | 'restoreTrashItem' | 'purgeTrashItem' | 'watchSplitDir' | 'batchTransfer'
  > & {
    getPathsForDroppedFiles?: (files: File[]) => string[];
  };

  vault: WithOptional<BaseInvokeAPI['vault'], 'setUiPrefs' | 'setDefaultDeleteMode'>;

  navigation: BaseInvokeAPI['navigation'];

  search: BaseInvokeAPI['search'];

  graph: WithOptional<
    BaseInvokeAPI['graph'],
    'checkImpact' | 'getWorkspaceMap' | 'getCollections' | 'getFileConnections'
  >;

  llm: WithOptional<
    BaseInvokeAPI['llm'],
    'abortQuery' | 'getTraces' | 'clearTraces' | 'downloadModels'
  > & {
    query: (
      query: string,
      callback: (chunk: string) => void,
      options?: {
        mode?: CopilotQueryMode;
        contextScope?: CopilotContextScope;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        onStep?: (step: AgentTraceStep) => void;
        onChannelCreated?: (channel: string) => void;
      }
    ) => Promise<IPCResponse<'LLM:QUERY'>>;
    onIndexingProgress: (callback: (status: IndexingStatus) => void) => () => void;
  };

  ai?: BaseInvokeAPI['ai'];

  fileWatcher: {
    subscribe: (callback: (event: { type: string; path: string }) => void) => () => void;
  };

  clipboard: BaseInvokeAPI['clipboard'];

  shell: WithOptional<BaseInvokeAPI['shell'], 'revealInFolder'>;

  diagnostics: BaseInvokeAPI['diagnostics'];

  ping: BaseInvokeAPI['ping'];
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __electronIPCBridge?: unknown;
  }
}

export {};
