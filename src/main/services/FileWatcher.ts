import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as path from 'path';
import { EventQueue } from '@main/dsa/EventQueue';
import { FileEvent, EventPriority } from '@shared/contracts';

/**
 * Options for file watching.
 * Extends chokidar's WatchOptions with sensible defaults for security.
 */
export interface WatchOptions {
    /** Paths/globs to ignore */
    ignored?: string | string[] | ((path: string) => boolean);

    /** Keep process running (default: true) */
    persistent?: boolean;

    /** Ignore initial add events (default: true) */
    ignoreInitial?: boolean;

    /** Debounce delay - wait for file writes to finish */
    awaitWriteFinish?: boolean | { stabilityThreshold?: number; pollInterval?: number };

    /** Maximum depth to watch (0 = immediate directory only) */
    depth?: number;

    /** Follow symlinks (default: false for security) */
    followSymlinks?: boolean;

    /** Silently ignore permission errors (default: true) */
    ignorePermissionErrors?: boolean;
}

/**
 * FileWatcher - Real-time file system monitoring using chokidar.
 * 
 * Integrates with EventQueue to provide priority-based event processing.
 * Handles rapid-fire events (npm install) efficiently.
 * 
 * Event priorities:
 * - USER_ACTION: Manual file operations (handled separately)
 * - FILE_WATCHER: External file changes (this class)
 * - BACKGROUND_INDEX: LLM indexing (lowest priority)
 * 
 * Emitted Events:
 * - 'fileCreated': (filePath: string) => void - Emitted when a file is created
 * - 'fileChanged': (filePath: string) => void - Emitted when a file is modified
 * - 'fileDeleted': (filePath: string) => void - Emitted when a file is deleted
 * - 'error': (error: Error) => void - Emitted when an error occurs
 * - 'ready': () => void - Emitted when watcher is ready
 * - 'stopped': () => void - Emitted when watcher is stopped
 * 
 * @example
 * const watcher = new FileWatcher(eventQueue);
 * watcher.on('fileCreated', (path) => console.log('Created:', path));
 * await watcher.start('/home/user/documents');
 */
type WatcherListener = { callback(...args: unknown[]): void }['callback'];

export class FileWatcher extends EventEmitter {
    private watcher: chokidar.FSWatcher | null = null;
    private eventQueue: EventQueue;
    private watching: boolean = false;
    private watchRoot: string | null = null;
    private eventHandlers: Map<string, WatcherListener> = new Map();

    /**
     * Create file watcher.
     * 
     * @param eventQueue - Priority queue for file system events
     * 
     * @example
     * const watcher = new FileWatcher(eventQueue);
     * watcher.on('fileCreated', (path) => console.log('Created:', path));
     * await watcher.start('/home/user/documents');
     */
    constructor(eventQueue: EventQueue) {
        super();
        this.eventQueue = eventQueue;
    }

    /**
     * Start watching directory.
     * 
     * Returns a Promise that resolves when the watcher is ready.
     * This fixes Bug #4: Race condition in start() method.
     * 
     * @param dirPath - Directory path to watch
     * @param options - Watch options
     * @throws Error if already watching
     * 
     * @example
     * await watcher.start('/home/user/docs', {
     *   ignored: ['*.tmp', 'node_modules/**'],
     *   awaitWriteFinish: true
     * });
     */
    async start(dirPath: string, options: WatchOptions = {}): Promise<void> {
        if (this.watching) {
            throw new Error('Watcher is already running. Call stop() first.');
        }

        // Bug Fix #11: Normalize path for cross-platform compatibility
        const normalizedPath = path.normalize(dirPath);
        this.watchRoot = normalizedPath;

        const defaultOptions: WatchOptions = {
            ignored: this.defaultIgnorePatterns(normalizedPath),
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50,
            },
            // CRITICAL: Limit depth to prevent watching entire directory trees
            // depth: 0 = only watch immediate directory, not subdirectories
            depth: 0,
            // Don't follow symlinks (prevents infinite loops and EPERM errors)
            followSymlinks: false,
            // Ignore permission errors silently
            ignorePermissionErrors: true,
        };

        const mergedOptions = { ...defaultOptions, ...options };

        // Bug Fix #4: Return Promise that resolves when 'ready' event fires and rejects on startup error
        return new Promise<void>((resolve, reject) => {
            const watcher = chokidar.watch(normalizedPath, mergedOptions);
            this.watcher = watcher;
            let settled = false;

            // Create bound handlers to allow cleanup later (Bug Fix #9)
            const addHandler = (filePath: string): void => this.handleFileCreated(filePath);
            const changeHandler = (filePath: string): void => this.handleFileChanged(filePath);
            const unlinkHandler = (filePath: string): void => this.handleFileDeleted(filePath);
            const errorHandler = (error: Error): void => {
                if (!settled) {
                    settled = true;
                    watcher.removeAllListeners();
                    void watcher.close().catch(() => undefined);
                    if (this.watcher === watcher) {
                        this.watcher = null;
                        this.watchRoot = null;
                        this.watching = false;
                        this.eventHandlers.clear();
                    }
                    this.handleError(error);
                    reject(error);
                    return;
                }
                this.handleError(error);
            };
            const readyHandler = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                this.watching = true;
                this.emit('ready');
                resolve();
            };

            // Store handlers for cleanup (Bug Fix #9)
            this.eventHandlers.set('add', addHandler as WatcherListener);
            this.eventHandlers.set('change', changeHandler as WatcherListener);
            this.eventHandlers.set('unlink', unlinkHandler as WatcherListener);
            this.eventHandlers.set('error', errorHandler as WatcherListener);
            this.eventHandlers.set('ready', readyHandler as WatcherListener);

            // Register event handlers
            watcher
                .on('add', addHandler)
                .on('change', changeHandler)
                .on('unlink', unlinkHandler)
                .on('error', errorHandler)
                .on('ready', readyHandler);
        });
    }

    /**
     * Stop watching.
     * 
     * Bug Fix #9: Properly cleanup event listeners to prevent memory leaks.
     * 
     * @example
     * await watcher.stop();
     */
    async stop(): Promise<void> {
        if (!this.watcher) {
            return; // Already stopped
        }

        // Bug Fix #9: Remove event listeners before closing
        if (this.eventHandlers.size > 0) {
            for (const [event, handler] of this.eventHandlers.entries()) {
                this.watcher.removeListener(event, handler);
            }
            this.eventHandlers.clear();
        }

        await this.watcher.close();
        this.watcher = null;
        this.watching = false;
        this.watchRoot = null;
        this.emit('stopped');
    }

    /**
     * Check if currently watching.
     * 
     * @returns True if watching
     */
    isWatching(): boolean {
        return this.watching;
    }

    /**
     * Get currently watched directory path, if active.
     */
    getWatchedPath(): string | null {
        return this.watchRoot;
    }

    /**
     * Add additional path to watch.
     * 
     * @param dirPath - Path to add
     * @throws Error if not watching
     * 
     * @example
     * watcher.addPath('/home/user/downloads');
     */
    addPath(dirPath: string): void {
        if (!this.watcher) {
            throw new Error('Watcher is not running');
        }

        // Bug Fix #11: Normalize path
        const normalizedPath = path.normalize(dirPath);
        this.watcher.add(normalizedPath);
    }

    /**
     * Remove path from watching.
     * 
     * @param dirPath - Path to remove
     * @throws Error if not watching
     * 
     * @example
     * watcher.removePath('/home/user/temp');
     */
    removePath(dirPath: string): void {
        if (!this.watcher) {
            throw new Error('Watcher is not running');
        }

        // Bug Fix #11: Normalize path
        const normalizedPath = path.normalize(dirPath);
        this.watcher.unwatch(normalizedPath);
    }

    /**
     * Handle file creation event.
     * 
     * Bug Fix #2: Map chokidar 'add' event to 'create' for FileEvent interface.
     * 
     * @param filePath - Created file path
     */
    private handleFileCreated(filePath: string): void {
        // Bug Fix #11: Normalize path
        const normalizedPath = path.normalize(filePath);

        // Bug Fix #2: Map 'add' to 'create' to match FileEvent interface
        const event: FileEvent = {
            type: 'create',
            path: normalizedPath,
            priority: EventPriority.FILE_WATCHER,
            timestamp: Date.now(),
        };

        this.eventQueue.enqueue(event);
        this.emit('fileCreated', normalizedPath);
    }

    /**
     * Handle file change event.
     * 
     * @param filePath - Changed file path
     */
    private handleFileChanged(filePath: string): void {
        // Bug Fix #11: Normalize path
        const normalizedPath = path.normalize(filePath);

        const event: FileEvent = {
            type: 'change',
            path: normalizedPath,
            priority: EventPriority.FILE_WATCHER,
            timestamp: Date.now(),
        };

        this.eventQueue.enqueue(event);
        this.emit('fileChanged', normalizedPath);
    }

    /**
     * Handle file deletion event.
     * 
     * @param filePath - Deleted file path
     */
    private handleFileDeleted(filePath: string): void {
        // Bug Fix #11: Normalize path
        const normalizedPath = path.normalize(filePath);

        const event: FileEvent = {
            type: 'unlink',
            path: normalizedPath,
            priority: EventPriority.FILE_WATCHER,
            timestamp: Date.now(),
        };

        this.eventQueue.enqueue(event);
        this.emit('fileDeleted', normalizedPath);
    }

    /**
     * Handle watcher error.
     * 
     * Bug Fix #8: Enhanced error handling with logging.
     * 
     * @param error - Error object
     */
    private handleError(error: Error): void {
        // Log error for debugging
        console.error('[FileWatcher] Error:', error.message);

        // Emit error event for consumers
        this.emit('error', error);
    }

    /**
     * Get default ignore patterns.
     * 
     * Bug Fix #6: Cross-platform path handling with proper normalization.
     * CRITICAL: Includes Windows-specific system folder exclusions.
     * 
     * @returns Function that returns true for ignored paths
     */
    private defaultIgnorePatterns(watchRoot?: string): (filePath: string) => boolean {
        const normalizedRoot = watchRoot
            ? path.normalize(watchRoot).toLowerCase().replace(/[\\/]+$/, '')
            : null;

        return (filePath: string): boolean => {
            const normalizedPath = path.normalize(filePath).toLowerCase().replace(/[\\/]+$/, '');

            // Never ignore the watched directory itself
            if (normalizedRoot && normalizedPath === normalizedRoot) {
                return false;
            }

            // Inspect segments strictly relative to watchRoot when inside watchRoot
            // so OS temp roots (e.g. AppData\Local\Temp, /tmp) are watchable when explicitly opened.
            let targetForDirChecks = normalizedPath;
            if (normalizedRoot && normalizedPath.startsWith(normalizedRoot + path.sep)) {
                targetForDirChecks = normalizedPath.slice(normalizedRoot.length + 1);
            }

            const basename = path.basename(normalizedPath);
            if (basename.startsWith('.') && basename !== '.' && basename !== '..') {
                return true;
            }

            // Windows-specific noisy/EPERM subtrees (avoids blocking AppData\Local\Temp when watched)
            const windowsSystemSubpaths = [
                `${path.sep}appdata${path.sep}local${path.sep}microsoft`,
                `${path.sep}appdata${path.sep}local${path.sep}packages`,
                `${path.sep}appdata${path.sep}local${path.sep}google`,
                `${path.sep}appdata${path.sep}roaming${path.sep}microsoft`,
                `${path.sep}application data`,
                `${path.sep}local settings`,
                `${path.sep}temporary internet files`,
                `${path.sep}system volume information`,
                `${path.sep}$recycle.bin`,
                `${path.sep}programdata`,
                `${path.sep}msocache`,
                `${path.sep}recovery`,
                `${path.sep}config.msi`,
            ];

            for (const folder of windowsSystemSubpaths) {
                if (
                    targetForDirChecks.includes(`${folder}${path.sep}`) ||
                    targetForDirChecks.endsWith(folder)
                ) {
                    return true;
                }
            }

            const segments = targetForDirChecks.split(/[\\/]+/).filter(Boolean);
            const ignoredDirs = new Set([
                'node_modules',
                '.git',
                '.vscode',
                '.idea',
                '.cursor',
                '__pycache__',
                '.file-manager',
                'vectordb',
                '.lancedb',
            ]);

            if (segments.some((segment) => ignoredDirs.has(segment))) {
                return true;
            }

            // Ignore temporary/lock/database artifact extensions (allow user .log & cache dirs)
            const ext = path.extname(normalizedPath).toLowerCase();
            const ignoredExtensions = ['.tmp', '.swp', '.ldb'];
            if (ignoredExtensions.includes(ext)) {
                return true;
            }

            // Ignore Windows-specific Office/temp files
            if (basename.startsWith('~$') || basename.endsWith('.tmp')) {
                return true;
            }

            return false;
        };
    }
}
