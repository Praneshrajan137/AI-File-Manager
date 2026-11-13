/**
 * Type definitions for Electron API exposed via preload script.
 */

import type {
  FileNode,
  FilePreviewResult,
  FileStats,
  IndexingStatus,
  SystemPaths,
} from '../shared/contracts';
import type { RuntimeDiagnosticsSnapshot } from '../shared/diagnostics';

interface ElectronAPI {
  fs: {
    readDirectory: (path: string) => Promise<FileNode[]>;
    readFile: (path: string) => Promise<{ content: string; encoding: string }>;
    previewFile: (path: string, maxLines?: number) => Promise<FilePreviewResult>;
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
    delete: (path: string, recursive?: boolean) => Promise<{ success: boolean }>;
    move: (source: string, destination: string) => Promise<{ success: boolean; newPath: string }>;
    getStats: (path: string) => Promise<FileStats>;
    getSystemPaths: () => Promise<SystemPaths>;
    rename: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath: string }>;
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
  };

  llm: {
    query: (
      query: string,
      callback: (chunk: string) => void
    ) => Promise<{ success: boolean; error?: string }>;
    getIndexingStatus: () => Promise<IndexingStatus>;
    startIndexing: (
      path: string
    ) => Promise<{ success: boolean; message?: string; total?: number; error?: string }>;
    stopIndexing: () => Promise<{ success: boolean }>;
    indexFile: (
      filePath: string
    ) => Promise<{ success: boolean; chunksCreated?: number; error?: string }>;
    checkOllama: () => Promise<{ available: boolean; models: string[] }>;
    clearIndex: () => Promise<{ success: boolean; error?: string }>;
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
