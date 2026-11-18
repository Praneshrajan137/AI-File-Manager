import fs from 'fs/promises';
import path from 'path';
import { FileNode, FileSystemError } from '@shared/contracts';
import { ConfigManager, DEFAULT_EXCLUDED_DIRS } from '@shared/config';
import { FileSystemLogger } from '@shared/logging';
import { isSensitiveSecretFile } from '@shared/security/SecretGuard';
import { FileSystemService } from './FileSystemService';

/**
 * Options for directory scanning.
 */
export interface ScanOptions {
    /** Scan subdirectories recursively */
    recursive?: boolean;

    /** Maximum depth to scan (default: 100) */
    maxDepth?: number;

    /** Include hidden files (default: true) */
    includeHidden?: boolean;

    /** Filter by file extensions (e.g., ['txt', 'js']) */
    extensions?: string[];

    /** Minimum file size in bytes */
    minSize?: number;

    /** Maximum file size in bytes */
    maxSize?: number;

    /** Skip errors and continue scanning */
    skipErrors?: boolean;

    /** Abort signal for cancellation */
    signal?: AbortSignal;

    /** Directory basenames excluded from recursive traversal (defaults to ConfigManager/DEFAULT_EXCLUDED_DIRS; pass [] to disable) */
    excludedDirs?: string[];

    /** Follow symlinked entries (default: false for loop/escape safety) */
    followSymlinks?: boolean;

    /** Skip sensitive secret/credential files (.env*, *.pem, *.key, etc.) when collecting files for AI/indexing */
    skipSensitiveFiles?: boolean;
}

/**
 * DirectoryScanner - Recursive directory traversal with filtering.
 * 
 * Efficiently scans directories and subdirectories with configurable
 * depth limits and filtering options.
 * 
 * Performance optimizations:
 * - Non-blocking async iteration
 * - Depth-first traversal (memory efficient)
 * - Early termination on max depth
 * - Cancellation support via AbortSignal
 */
export class DirectoryScanner {
    private fileSystemService: FileSystemService;

    /**
     * Create directory scanner.
     * 
     * @param fileSystemService - File system service for operations
     * 
     * @example
     * const scanner = new DirectoryScanner(fileSystemService);
     * const files = await scanner.scan('/home/user/documents', {
     *   recursive: true,
     *   extensions: ['txt', 'pdf']
     * });
     */
    constructor(fileSystemService: FileSystemService) {
        this.fileSystemService = fileSystemService;
    }

    /**
     * Scan directory with options.
     * 
     * @param dirPath - Directory to scan
     * @param options - Scan options
     * @returns Array of FileNode objects matching filters
     * @throws FileSystemError if scan fails
     * 
     * @example
     * const files = await scanner.scan('/home/user/docs', {
     *   recursive: true,
     *   maxDepth: 3,
     *   extensions: ['txt', 'md'],
     *   minSize: 1024
     * });
     */
    async scan(
        dirPath: string,
        options: ScanOptions = {}
    ): Promise<FileNode[]> {
        const {
            recursive = false,
            maxDepth = 100,
            includeHidden = true,
            extensions,
            minSize,
            maxSize,
            skipErrors = false,
            signal,
            excludedDirs,
            followSymlinks = false,
            skipSensitiveFiles = false,
        } = options;

        const results: FileNode[] = [];
        const visitedDirs = new Set<string>();

        await this.scanRecursive(
            dirPath,
            results,
            {
                recursive,
                maxDepth,
                includeHidden,
                extensions,
                minSize,
                maxSize,
                skipErrors,
                signal,
                excludedDirs,
                followSymlinks,
                skipSensitiveFiles,
            },
            0,
            undefined,
            undefined,
            visitedDirs
        );

        return results;
    }

    /**
     * Scan directory with progress callback.
     * 
     * BUG FIX: Changed callback signature to just report processed count
     * instead of (processed, total) since total is unknown during scan.
     * 
     * @param dirPath - Directory to scan
     * @param options - Scan options
     * @param onProgress - Callback with processed count
     * @returns Array of FileNode objects
     * 
     * @example
     * const files = await scanner.scanWithProgress(
     *   '/large/directory',
     *   { recursive: true },
     *   (processed) => {
     *     console.log(`${processed} files processed`);
     *   }
     * );
     */
    async scanWithProgress(
        dirPath: string,
        options: ScanOptions = {},
        onProgress: (processed: number) => void
    ): Promise<FileNode[]> {
        const results: FileNode[] = [];
        const visitedDirs = new Set<string>();
        let processed = 0;

        await this.scanRecursive(
            dirPath,
            results,
            options,
            0,
            (_file) => {
                processed++;
                onProgress(processed);
            },
            undefined,
            visitedDirs
        );

        return results;
    }

    /**
     * Bounded-parallel BFS/DFS directory traversal implementation.
     * Resolves exclusions once per scan, skips redundant realpath checks on non-symlinks,
     * and dispatches directory reads in deterministic FIFO order up to CONCURRENCY = 8.
     */
    private async scanRecursive(
        dirPath: string,
        results: FileNode[],
        options: ScanOptions,
        currentDepth: number,
        onFile?: (file: FileNode) => void,
        excludedDirsSet?: Set<string>,
        visitedDirs: Set<string> = new Set<string>()
    ): Promise<void> {
        const checkAborted = (atPath: string): void => {
            if (options.signal?.aborted) {
                const error: FileSystemError = {
                    code: 'UNKNOWN',
                    message: 'Scan aborted by user',
                    path: atPath,
                };
                throw error;
            }
        };

        checkAborted(dirPath);

        if (options.maxDepth !== undefined && currentDepth >= options.maxDepth) {
            return;
        }

        const effectiveExcludedDirs = excludedDirsSet ?? this.resolveExcludedDirsSet(options);
        const rootCanonical = await fs.realpath(dirPath).catch(() => path.resolve(dirPath));
        const normKey = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

        interface ScanQueueItem {
            dir: string;
            canonicalHint: string;
            depth: number;
            isSymlink: boolean;
        }

        const queue: ScanQueueItem[] = [
            { dir: dirPath, canonicalHint: rootCanonical, depth: currentDepth, isSymlink: false },
        ];
        let head = 0;
        let inFlight = 0;
        let fatalError: unknown = null;
        const SCAN_CONCURRENCY = 8;

        const formatErrMsg = (error: unknown): string =>
            error instanceof Error
                ? error.message
                : error && typeof error === 'object' && 'message' in error
                  ? String((error as { message: unknown }).message)
                  : String(error);

        await new Promise<void>((resolve, reject) => {
            const finishIfDone = (): void => {
                if (fatalError !== null && inFlight === 0) {
                    reject(fatalError);
                    return;
                }
                if (inFlight === 0 && head >= queue.length) {
                    resolve();
                }
            };

            const pump = (): void => {
                if (fatalError !== null) {
                    finishIfDone();
                    return;
                }

                while (inFlight < SCAN_CONCURRENCY && head < queue.length && fatalError === null) {
                    if (options.signal?.aborted) {
                        fatalError = {
                            code: 'UNKNOWN',
                            message: 'Scan aborted by user',
                            path: queue[head]?.dir ?? dirPath,
                        } as FileSystemError;
                        break;
                    }

                    const item = queue[head];
                    head += 1;
                    if (options.maxDepth !== undefined && item.depth >= options.maxDepth) {
                        continue;
                    }

                    const runItem = async (): Promise<void> => {
                        const canonicalDir = item.isSymlink
                            ? await fs.realpath(item.dir).catch(() => path.resolve(item.dir))
                            : item.canonicalHint;
                        const visitKey = normKey(canonicalDir);
                        if (visitedDirs.has(visitKey)) {
                            return;
                        }
                        visitedDirs.add(visitKey);

                        let entries: FileNode[];
                        try {
                            entries = await this.fileSystemService.readDirectory(item.dir);
                        } catch (error: unknown) {
                            if (!options.skipErrors) {
                                throw error;
                            }
                            FileSystemLogger.warn(`Error reading ${item.dir}`, { reason: formatErrMsg(error) });
                            return;
                        }

                        if (options.signal?.aborted) {
                            checkAborted(item.dir);
                        }

                        for (const entry of entries) {
                            if (!this.matchesFilters(entry, options, effectiveExcludedDirs)) {
                                continue;
                            }
                            results.push(entry);
                            if (onFile) {
                                onFile(entry);
                            }
                            if (
                                entry.isDirectory &&
                                options.recursive &&
                                (options.maxDepth === undefined || item.depth + 1 < options.maxDepth)
                            ) {
                                queue.push({
                                    dir: entry.path,
                                    canonicalHint: path.join(canonicalDir, entry.name),
                                    depth: item.depth + 1,
                                    isSymlink: Boolean(entry.isSymbolicLink),
                                });
                            }
                        }
                    };

                    inFlight += 1;
                    void runItem()
                        .catch((err: unknown) => {
                            if (fatalError === null) {
                                fatalError = err;
                            }
                        })
                        .finally(() => {
                            inFlight -= 1;
                            pump();
                        });
                }

                finishIfDone();
            };

            pump();
        });
    }

    /**
     * Check if file matches filter criteria.
     * 
     * @param file - File to check
     * @param options - Filter options
     * @returns True if file matches all filters
     */
    private resolveExcludedDirsSet(options: ScanOptions): Set<string> {
        let configured: readonly string[] = options.excludedDirs ?? [];
        if (options.excludedDirs === undefined) {
            try {
                const fromConfig = ConfigManager.getInstance().getAll()?.fileSystem?.excludedDirs;
                configured = Array.isArray(fromConfig) && fromConfig.length > 0
                    ? fromConfig
                    : DEFAULT_EXCLUDED_DIRS;
            } catch {
                configured = DEFAULT_EXCLUDED_DIRS;
            }
        }
        return new Set(configured.map((name) => name.trim().toLowerCase()).filter(Boolean));
    }

    private matchesFilters(
        file: FileNode,
        options: ScanOptions,
        excludedDirsSet?: Set<string>
    ): boolean {
        // Never traverse excluded system/VCS/build/trash directories by default
        const excludedSet = excludedDirsSet ?? this.resolveExcludedDirsSet(options);
        if (file.isDirectory && excludedSet.has(file.name.toLowerCase())) {
            return false;
        }

        // Skip symlinks unless caller explicitly enables followSymlinks
        if (!options.followSymlinks && (file as FileNode & { isSymbolicLink?: boolean }).isSymbolicLink) {
            return false;
        }

        // Skip sensitive credential artifacts during AI/index scans
        if (options.skipSensitiveFiles && !file.isDirectory && isSensitiveSecretFile(file.path).blocked) {
            return false;
        }

        // Hidden files filter
        if (!options.includeHidden && file.isHidden) {
            return false;
        }

        // Extension filter (only for files, not directories)
        if (options.extensions && !file.isDirectory) {
            if (!options.extensions.includes(file.extension)) {
                return false;
            }
        }

        // Size filters (only for files)
        if (!file.isDirectory) {
            if (options.minSize !== undefined && file.size < options.minSize) {
                return false;
            }

            if (options.maxSize !== undefined && file.size > options.maxSize) {
                return false;
            }
        }

        return true;
    }

    /**
     * Count total files in directory (quick estimate).
     * 
     * @param dirPath - Directory to count
     * @param options - Scan options
     * @returns Estimated file count
     */
    async countFiles(
        dirPath: string,
        options: ScanOptions = {}
    ): Promise<number> {
        const files = await this.scan(dirPath, options);
        return files.filter(f => !f.isDirectory).length;
    }

    /**
     * Get total size of directory.
     * 
     * @param dirPath - Directory to measure
     * @param options - Scan options
     * @returns Total size in bytes
     */
    async getTotalSize(
        dirPath: string,
        options: ScanOptions = {}
    ): Promise<number> {
        const files = await this.scan(dirPath, {
            ...options,
            recursive: true,
        });

        return files
            .filter(f => !f.isDirectory)
            .reduce((total, file) => total + file.size, 0);
    }
}
