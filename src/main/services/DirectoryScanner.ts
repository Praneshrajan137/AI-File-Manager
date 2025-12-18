import { FileNode, FileSystemError } from '@shared/contracts';
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
        } = options;

        const results: FileNode[] = [];

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
            },
            0 // current depth
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
        let processed = 0;

        await this.scanRecursive(
            dirPath,
            results,
            options,
            0,
            (file) => {
                processed++;
                onProgress(processed);
            }
        );

        return results;
    }

    /**
     * Recursive directory scan implementation.
     * 
     * @param dirPath - Current directory
     * @param results - Accumulator for results
     * @param options - Scan options
     * @param currentDepth - Current recursion depth
     * @param onFile - Optional callback for each file
     */
    private async scanRecursive(
        dirPath: string,
        results: FileNode[],
        options: ScanOptions,
        currentDepth: number,
        onFile?: (file: FileNode) => void
    ): Promise<void> {
        // Check for cancellation (BUG FIX: Proper error handling)
        if (options.signal?.aborted) {
            const error: FileSystemError = {
                code: 'UNKNOWN',
                message: 'Scan aborted by user',
                path: dirPath,
            };
            throw error;
        }

        // Check max depth
        if (options.maxDepth !== undefined && currentDepth >= options.maxDepth) {
            return;
        }

        try {
            // Read directory contents
            const entries = await this.fileSystemService.readDirectory(dirPath);

            for (const entry of entries) {
                // Check for cancellation again
                if (options.signal?.aborted) {
                    const error: FileSystemError = {
                        code: 'UNKNOWN',
                        message: 'Scan aborted by user',
                        path: dirPath,
                    };
                    throw error;
                }

                // Apply filters
                if (!this.matchesFilters(entry, options)) {
                    continue;
                }

                // Add to results
                results.push(entry);

                // Notify progress
                if (onFile) {
                    onFile(entry);
                }

                // Recurse into subdirectories
                if (entry.isDirectory && options.recursive) {
                    try {
                        await this.scanRecursive(
                            entry.path,
                            results,
                            options,
                            currentDepth + 1,
                            onFile
                        );
                    } catch (error: any) {
                        // Skip errors if requested
                        if (!options.skipErrors) {
                            throw error;
                        }
                        // Otherwise, log and continue
                        console.warn(`Skipping directory ${entry.path}:`, error.message);
                    }
                }
            }
        } catch (error: any) {
            if (!options.skipErrors) {
                throw error;
            }
            // Log and continue
            console.warn(`Error reading ${dirPath}:`, error.message);
        }
    }

    /**
     * Check if file matches filter criteria.
     * 
     * @param file - File to check
     * @param options - Filter options
     * @returns True if file matches all filters
     */
    private matchesFilters(file: FileNode, options: ScanOptions): boolean {
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
