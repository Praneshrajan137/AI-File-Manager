/**
 * Type definitions for Electron API exposed via preload script.
 * 
 * This file provides TypeScript types for window.electronAPI
 * so renderer code has full type safety and autocomplete.
 */

/**
 * Electron API exposed to renderer process via contextBridge.
 */
interface ElectronAPI {
    fs: {
        readDirectory: (path: string) => Promise<any[]>;
        readFile: (path: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<{ success: boolean }>;
        delete: (path: string, recursive?: boolean) => Promise<{ success: boolean }>;
        move: (source: string, destination: string) => Promise<{ success: boolean; newPath: string }>;
        getStats: (path: string) => Promise<any>;
        getSystemPaths: () => Promise<{ home: string; documents: string; downloads: string; pictures: string }>;
        rename: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath: string }>;
    };

    navigation: {
        back: () => Promise<string | null>;
        forward: () => Promise<string | null>;
        push: (path: string) => Promise<void>;
        getState: () => Promise<{ canGoBack: boolean; canGoForward: boolean }>;
    };

    search: {
        autocomplete: (prefix: string, maxResults?: number) => Promise<string[]>;
        query: (query: string, searchRoot: string) => Promise<any[]>;
    };

    llm: {
        query: (query: string, callback: (chunk: string) => void) => Promise<void>;
        getIndexingStatus: () => Promise<{ indexed: number; total: number; inProgress: boolean }>;
        startIndexing: (path: string) => Promise<{ success: boolean }>;
        stopIndexing: () => Promise<{ success: boolean }>;
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

    ping: () => Promise<string>;
}

/**
 * Extend Window interface to include electronAPI.
 */
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
