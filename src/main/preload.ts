/**
 * preload.ts - Electron Preload Script (Security Bridge)
 * 
 * This script runs in the renderer process BUT has access to Node.js APIs.
 * It's the ONLY way to safely expose controlled APIs to the renderer.
 * 
 * SECURITY MODEL:
 * - Renderer process is sandboxed (no Node.js access)
 * - Preload script uses contextBridge to expose ONLY specific APIs
 * - All file operations go through IPC to Main process
 * - Main process validates ALL requests before executing
 * 
 * CRITICAL: Never expose dangerous APIs like require(), process, or fs directly!
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Exposed API for Renderer process.
 * This object will be available as window.electronAPI in renderer.
 * 
 * RULES:
 * 1. Only expose invoke() for request-response IPC
 * 2. Never expose send() or sendSync() (security risk)
 * 3. Validate all inputs before sending to Main
 * 4. Use TypeScript types for type safety
 */
const electronAPI = {
    /**
     * File System Operations
     */
    fs: {
        /**
         * Read directory contents.
         * @param path - Absolute path to directory
         * @returns Array of FileNode objects
         */
        readDirectory: (path: string) =>
            ipcRenderer.invoke('FS:READ_DIR', { path }),

        /**
         * Read file content.
         * @param path - Absolute path to file
         * @returns File content as string
         */
        readFile: (path: string) =>
            ipcRenderer.invoke('FS:READ_FILE', { path }),

        /**
         * Write content to file.
         * @param path - Absolute path to file
         * @param content - Content to write
         * @returns Success status
         */
        writeFile: (path: string, content: string) =>
            ipcRenderer.invoke('FS:WRITE_FILE', { path, content }),

        /**
         * Delete file or directory.
         * @param path - Absolute path to delete
         * @param recursive - If true, delete directories recursively
         * @returns Success status
         */
        delete: (path: string, recursive?: boolean) =>
            ipcRenderer.invoke('FS:DELETE', { path, recursive }),

        /**
         * Move/rename file or directory.
         * @param source - Current path
         * @param destination - New path
         * @returns Success status and new path
         */
        move: (source: string, destination: string) =>
            ipcRenderer.invoke('FS:MOVE', { source, destination }),

        /**
         * Get file statistics.
         * @param path - Absolute path
         * @returns FileStats object
         */
        getStats: (path: string) =>
            ipcRenderer.invoke('FS:GET_STATS', { path }),
    },

    /**
     * Navigation Operations
     */
    navigation: {
        /**
         * Navigate backward in history.
         * @returns Previous path or null
         */
        back: () =>
            ipcRenderer.invoke('NAV:BACK'),

        /**
         * Navigate forward in history.
         * @returns Next path or null
         */
        forward: () =>
            ipcRenderer.invoke('NAV:FORWARD'),

        /**
         * Add path to navigation history.
         * @param path - Path to add
         */
        push: (path: string) =>
            ipcRenderer.invoke('NAV:PUSH', { path }),

        /**
         * Get navigation state.
         * @returns Whether back/forward are available
         */
        getState: () =>
            ipcRenderer.invoke('NAV:GET_STATE'),
    },

    /**
     * Search Operations
     */
    search: {
        /**
         * Get autocomplete suggestions.
         * @param prefix - Search prefix
         * @param maxResults - Maximum results to return
         * @returns Array of matching paths
         */
        autocomplete: (prefix: string, maxResults?: number) =>
            ipcRenderer.invoke('SEARCH:AUTOCOMPLETE', { prefix, maxResults }),

        /**
         * Search for files.
         * @param query - Search query
         * @param searchRoot - Directory to search in
         * @returns Array of matching FileNode objects
         */
        query: (query: string, searchRoot: string) =>
            ipcRenderer.invoke('SEARCH:QUERY', { query, searchRoot }),
    },

    /**
     * LLM Operations
     */
    llm: {
        /**
         * Query LLM with streaming response.
         * @param query - User's question
         * @param callback - Called for each chunk of response
         * @returns Promise that resolves when streaming complete
         */
        query: (query: string, callback: (chunk: string) => void) => {
            // Set up listener for streaming chunks
            const channel = `LLM:QUERY:${Date.now()}`;

            ipcRenderer.on(channel, (_event: IpcRendererEvent, chunk: string) => {
                callback(chunk);
            });

            // Send query
            return ipcRenderer.invoke('LLM:QUERY', { query, channel });
        },

        /**
         * Get indexing status.
         * @returns Indexing progress
         */
        getIndexingStatus: () =>
            ipcRenderer.invoke('LLM:INDEX_STATUS'),

        /**
         * Start indexing directory.
         * @param path - Directory to index
         * @returns Success status
         */
        startIndexing: (path: string) =>
            ipcRenderer.invoke('LLM:START_INDEXING', path),

        /**
         * Stop background indexing.
         * @returns Success status
         */
        stopIndexing: () =>
            ipcRenderer.invoke('LLM:STOP_INDEXING'),
    },

    /**
     * File Watcher Operations
     */
    fileWatcher: {
        /**
         * Subscribe to file system events.
         * @param callback - Called when file events occur
         * @returns Cleanup function to remove listener
         */
        subscribe: (callback: (event: { type: string; path: string }) => void) => {
            const handleFileCreated = (_event: IpcRendererEvent, path: string) => {
                callback({ type: 'create', path });
            };

            const handleFileChanged = (_event: IpcRendererEvent, path: string) => {
                callback({ type: 'change', path });
            };

            const handleFileDeleted = (_event: IpcRendererEvent, path: string) => {
                callback({ type: 'unlink', path });
            };

            // Listen to Main Process file watcher events
            ipcRenderer.on('FILE_CREATED', handleFileCreated);
            ipcRenderer.on('FILE_CHANGED', handleFileChanged);
            ipcRenderer.on('FILE_DELETED', handleFileDeleted);

            // Return cleanup function
            return () => {
                ipcRenderer.removeListener('FILE_CREATED', handleFileCreated);
                ipcRenderer.removeListener('FILE_CHANGED', handleFileChanged);
                ipcRenderer.removeListener('FILE_DELETED', handleFileDeleted);
            };
        },
    },

    /**
     * Utility: Ping test for IPC connectivity.
     */
    ping: () => ipcRenderer.invoke('ping'),
};

/**
 * Expose API to renderer process.
 * 
 * SECURITY: This is the ONLY way renderer can communicate with Main process.
 * The API is frozen and cannot be modified by renderer code.
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

/**
 * TypeScript type definition for window.electronAPI
 * This should be declared in a .d.ts file for renderer to use.
 */
export type ElectronAPI = typeof electronAPI;
