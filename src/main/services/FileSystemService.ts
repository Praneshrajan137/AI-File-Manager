import fs from 'fs/promises';
import path from 'path';
import {
    IFileSystemService,
    FileLineRangeResult,
    FileNode,
    FilePreviewResult,
    FileRangeLine,
    FileStats,
    ValidationResult,
    CACHE_CAPACITY,
    MAX_CACHE_MEMORY,
    RING_BUFFER_CAPACITY,
} from '@shared/contracts';
import { CanonicalValidationContext, PathValidator } from './PathValidator';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { LRUCache } from '@main/dsa/LRUCache';
import { RingBuffer } from '@main/dsa/RingBuffer';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { ErrorFactory, FileSystemError } from '@shared/errors';
import { FileSystemLogger, SecurityLogger } from '@shared/logging';
import {
    atomicWriteFile,
    extractFsErrorCode,
    renameWithWindowsRetry,
} from '@shared/utils/atomicFs';

const MAX_READ_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_RANGE_READ_BYTES = 2 * 1024 * 1024;
const MAX_RANGE_RETURN_LINES = 400;
const READ_DIR_CONCURRENCY = 16;

function estimateFileNodesBytes(nodes: FileNode[]): number {
    return nodes.reduce((sum, node) => sum + 128 + (node.path.length + node.name.length) * 2, 64);
}

function estimatePreviewBytes(preview: FilePreviewResult): number {
    return preview.lines.reduce((sum, line) => sum + line.length * 2 + 16, 256);
}

function getFsErrorCode(error: unknown): string | undefined {
    return extractFsErrorCode(error);
}

export class FileSystemService implements IFileSystemService {
    private validator: PathValidator;
    private dirCache: LRUCache<FileNode[]>;
    private previewCache: LRUCache<FilePreviewResult>;

    constructor(allowedRoot: string | string[]) {
        const roots = Array.isArray(allowedRoot)
            ? allowedRoot.filter((entry) => entry && entry.trim() !== '')
            : allowedRoot && allowedRoot.trim() !== ''
                ? [allowedRoot]
                : [];

        if (roots.length === 0) {
            throw new Error('Allowed root directory cannot be empty');
        }

        this.validator = VaultRootAuthority.getInstance().createScopedValidator(roots);
        this.dirCache = new LRUCache<FileNode[]>(CACHE_CAPACITY, {
            maxBytes: Math.floor(MAX_CACHE_MEMORY / 2),
            sizeOf: estimateFileNodesBytes,
        });
        this.previewCache = new LRUCache<FilePreviewResult>(CACHE_CAPACITY, {
            maxBytes: Math.floor(MAX_CACHE_MEMORY / 2),
            sizeOf: estimatePreviewBytes,
        });
    }

    /**
     * Read directory contents with metadata.
     * 
     * @param dirPath - Absolute path to directory
     * @returns Array of FileNode objects
     * @throws FileSystemError if validation fails or directory inaccessible
     */
    async readDirectory(
        dirPath: string,
        options?: { bypassCache?: boolean }
    ): Promise<FileNode[]> {
        // SECURITY: Validate path lexically and canonically first (guards symlinks & traversal)
        const canonicalDir = await this.validateCanonicalPathOrThrow(dirPath);

        const cacheKey = this.normalizeCacheKey(canonicalDir);
        const cached = options?.bypassCache ? undefined : this.dirCache.get(cacheKey);
        if (cached) {
            this.syncCacheTelemetry();
            return cached.map((entry) => ({ ...entry }));
        }

        try {
            // Read directory with file types
            const entries = await fs.readdir(canonicalDir, { withFileTypes: true });
            const fileNodes = new Array<FileNode | null>(entries.length);
            const hasAnySymlink = entries.some(
                (entry) => typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()
            );
            const canonicalCtx = hasAnySymlink ? await this.validator.createCanonicalContext() : null;
            const workerCount = Math.max(1, Math.min(READ_DIR_CONCURRENCY, entries.length));
            let nextIdx = 0;

            const runStatWorker = async (): Promise<void> => {
                while (nextIdx < entries.length) {
                    const idx = nextIdx;
                    nextIdx += 1;
                    const entry = entries[idx];
                    const fullPath = path.join(canonicalDir, entry.name);
                    try {
                        const isSym = typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink();
                        if (isSym) {
                            const canonicalCheck = canonicalCtx
                                ? await this.validator.validateCanonicalWithContext(fullPath, canonicalCtx)
                                : await this.validator.validateCanonical(fullPath);
                            if (!canonicalCheck.valid) {
                                SecurityLogger.warn('Skipping directory entry with symlink escape', {
                                    path: fullPath,
                                    reason: canonicalCheck.error,
                                });
                                fileNodes[idx] = null;
                                continue;
                            }
                        }
                        const stats = await fs.stat(fullPath);
                        const isDir = entry.isDirectory() || (typeof stats.isDirectory === 'function' && stats.isDirectory());
                        fileNodes[idx] = {
                            path: fullPath,
                            name: entry.name,
                            isDirectory: isDir,
                            size: stats.size,
                            modified: stats.mtimeMs,
                            extension: this.getExtension(entry.name),
                            mimeType: this.getMimeType(entry.name),
                            isHidden: this.isHidden(entry.name),
                            isSymbolicLink: isSym,
                        };
                    } catch (statError: unknown) {
                        FileSystemLogger.warn('Failed to stat file', {
                            path: fullPath,
                            error: statError instanceof Error ? statError.message : String(statError),
                        });
                        fileNodes[idx] = null;
                    }
                }
            };

            if (entries.length > 0) {
                await Promise.all(Array.from({ length: workerCount }, () => runStatWorker()));
            }
            const compactNodes: FileNode[] = [];
            for (const node of fileNodes) {
                if (node) {
                    compactNodes.push(node);
                }
            }

            this.dirCache.put(cacheKey, compactNodes);
            this.syncCacheTelemetry();

            return compactNodes.map((entry) => ({ ...entry }));
        } catch (error: unknown) {
            throw this.wrapError(error, dirPath);
        }
    }

    async readFile(
        filePath: string,
        encoding: BufferEncoding = 'utf-8'
    ): Promise<string> {
        // SECURITY: Validate canonical path first and consume canonicalPath to narrow TOCTOU windows
        const canonicalPath = await this.validateCanonicalPathOrThrow(filePath);

        try {
            const stats = await fs.stat(canonicalPath);
            if (typeof stats?.size === 'number' && stats.size > MAX_READ_FILE_BYTES) {
                throw new FileSystemError(
                    'FILE_TOO_LARGE',
                    `File exceeds maximum read size of ${Math.round(MAX_READ_FILE_BYTES / (1024 * 1024))}MB`,
                    {
                        path: canonicalPath,
                        operation: 'readFile',
                        details: { size: stats.size, maxBytes: MAX_READ_FILE_BYTES },
                    }
                );
            }
            const content = await fs.readFile(canonicalPath, encoding);
            return content;
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalPath);
        }
    }

    async readFileRange(
        filePath: string,
        startLine: number,
        endLine?: number,
        contextLines: number = 0
    ): Promise<FileLineRangeResult> {
        const canonicalPath = await this.validateCanonicalPathOrThrow(filePath);

        let stats: Awaited<ReturnType<typeof fs.stat>>;
        try {
            stats = await fs.stat(canonicalPath);
        } catch (error: unknown) {
            throw this.wrapError(error, filePath);
        }

        if (typeof stats.isDirectory === 'function' && stats.isDirectory()) {
            throw new FileSystemError('INVALID_PATH', 'Cannot read line range of a directory', {
                path: filePath,
                operation: 'readFileRange',
            });
        }

        if (stats.size > MAX_RANGE_READ_BYTES) {
            throw new FileSystemError(
                'INVALID_PATH',
                `File exceeds line-range reader limit (${MAX_RANGE_READ_BYTES} bytes)`,
                { path: filePath, operation: 'readFileRange' }
            );
        }

        const rawBuf = await fs.readFile(canonicalPath);
        if (Buffer.isBuffer(rawBuf)) {
            const utf16Text = this.decodeUtf16WithBom(rawBuf);
            let decoded: string;
            if (utf16Text !== null) {
                decoded = utf16Text;
            } else if (rawBuf.includes(0)) {
                throw new FileSystemError('INVALID_PATH', 'Binary file cannot be displayed as text lines', {
                    path: filePath,
                    operation: 'readFileRange',
                });
            } else {
                decoded = rawBuf.toString('utf-8');
            }

            const allLines = decoded.length === 0 ? [] : decoded.split(/\r?\n/);
            if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
                allLines.pop();
            }

            const totalLines = allLines.length;
            const requestedStart = Math.max(1, Math.floor(startLine));
            const requestedEnd = endLine !== undefined ? Math.max(requestedStart, Math.floor(endLine)) : requestedStart;
            const pad = Math.max(0, Math.min(50, Math.floor(contextLines)));

            if (totalLines === 0) {
                return {
                    path: canonicalPath,
                    name: path.basename(canonicalPath),
                    startLine: 1,
                    endLine: 1,
                    totalLines: 0,
                    lines: [],
                    truncated: false,
                };
            }

            const windowStart = Math.max(1, Math.min(totalLines, requestedStart - pad));
            const rawWindowEnd = Math.min(totalLines, requestedEnd + pad);
            const cappedWindowEnd = Math.min(rawWindowEnd, windowStart + MAX_RANGE_RETURN_LINES - 1);
            const lines: FileRangeLine[] = [];
            for (let ln = windowStart; ln <= cappedWindowEnd; ln++) {
                lines.push({ lineNumber: ln, text: allLines[ln - 1] });
            }

            return {
                path: canonicalPath,
                name: path.basename(canonicalPath),
                startLine: windowStart,
                endLine: cappedWindowEnd,
                totalLines,
                lines,
                truncated: cappedWindowEnd < rawWindowEnd,
            };
        }

        throw new FileSystemError('UNKNOWN', 'Unexpected non-buffer file read', {
            path: filePath,
            operation: 'readFileRange',
        });
    }

    async previewFile(
        filePath: string,
        maxLines: number = RING_BUFFER_CAPACITY
    ): Promise<FilePreviewResult> {
        const canonicalPath = await this.validateCanonicalPathOrThrow(filePath);

        const cap = Math.max(1, Math.min(Math.floor(maxLines), RING_BUFFER_CAPACITY));
        const normalizedFile = this.normalizeCacheKey(canonicalPath);
        const previewKey = `${normalizedFile}:${cap}`;

        let stats: Awaited<ReturnType<typeof fs.stat>>;
        try {
            stats = await fs.stat(canonicalPath);
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalPath);
        }

        if (typeof stats.isDirectory === 'function' && stats.isDirectory()) {
            throw new FileSystemError('INVALID_PATH', 'Cannot preview a directory', {
                path: canonicalPath,
                operation: 'previewFile',
            });
        }

        const cached = this.previewCache.get(previewKey);
        if (cached && cached.modified === stats.mtimeMs && cached.size === stats.size) {
            this.syncCacheTelemetry();
            RuntimeDiagnostics.getInstance().recordPreviewServed(true);
            return {
                ...cached,
                lines: [...cached.lines],
                fromCache: true,
            };
        }

        if (cached) {
            this.previewCache.invalidate(previewKey);
        }

        const ext = this.getExtension(canonicalPath);
        const isLogTail = ext === 'log';

        try {
            const { text, binary, truncatedByBytes } = await this.readBoundedText(
                canonicalPath,
                stats.size,
                isLogTail
            );

            if (binary) {
                const binaryPreview: FilePreviewResult = {
                    path: canonicalPath,
                    name: path.basename(canonicalPath),
                    extension: ext,
                    size: stats.size,
                    modified: stats.mtimeMs,
                    lines: [],
                    totalLinesBuffered: 0,
                    truncated: false,
                    binary: true,
                    fromCache: false,
                };
                this.previewCache.put(previewKey, binaryPreview);
                this.syncCacheTelemetry();
                RuntimeDiagnostics.getInstance().recordPreviewServed(false);
                return { ...binaryPreview, lines: [] };
            }

            const rawLines = text.length === 0 ? [] : text.split(/\r?\n/);
            if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
                rawLines.pop();
            }

            const ringBuffer = new RingBuffer(cap);
            if (isLogTail) {
                for (const line of rawLines) {
                    ringBuffer.push(line);
                }
            } else {
                const limit = Math.min(rawLines.length, cap);
                for (let i = 0; i < limit; i++) {
                    ringBuffer.push(rawLines[i]);
                }
            }

            const bufferedLines = ringBuffer.getLines(cap);
            const previewResult: FilePreviewResult = {
                path: canonicalPath,
                name: path.basename(canonicalPath),
                extension: ext,
                size: stats.size,
                modified: stats.mtimeMs,
                lines: bufferedLines,
                totalLinesBuffered: ringBuffer.size(),
                truncated: truncatedByBytes || rawLines.length > cap,
                binary: false,
                fromCache: false,
            };

            this.previewCache.put(previewKey, previewResult);
            this.syncCacheTelemetry();
            RuntimeDiagnostics.getInstance().recordPreviewServed(false);

            return {
                ...previewResult,
                lines: [...previewResult.lines],
            };
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalPath);
        }
    }

    async writeFile(
        filePath: string,
        content: string
    ): Promise<{ success: boolean }> {
        // SECURITY: Validate canonical target/ancestor path first and write atomically via temp+rename
        const canonicalPath = await this.validateCanonicalPathOrThrow(filePath);

        try {
            await atomicWriteFile(canonicalPath, content, {
                encoding: 'utf-8',
                onRetry: () => RuntimeDiagnostics.getInstance().recordRenameRetry(),
            });
            this.invalidatePath(canonicalPath);
            if (canonicalPath !== filePath) {
                this.invalidatePath(filePath);
            }
            return { success: true };
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalPath);
        }
    }

    async delete(
        filePath: string,
        recursive: boolean = false
    ): Promise<{ success: boolean }> {
        // SECURITY: Validate parent canonically if leaf is a symlink so we unlink without dereferencing targets
        const canonicalTarget = await this.validateLinkAwarePathOrThrow(filePath);

        try {
            await fs.rm(canonicalTarget, { recursive, force: true });
            this.invalidatePath(canonicalTarget);
            if (canonicalTarget !== filePath) {
                this.invalidatePath(filePath);
            }
            return { success: true };
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalTarget);
        }
    }

    async move(
        source: string,
        destination: string,
        canonicalContext?: CanonicalValidationContext
    ): Promise<{ success: boolean; newPath: string }> {
        // SECURITY: Validate source (link-aware) and canonical destination
        const canonicalSource = await this.validateLinkAwarePathOrThrow(source, canonicalContext);
        const canonicalDestination = await this.validateCanonicalPathOrThrow(destination, canonicalContext);

        const recordRetry = (): void => {
            RuntimeDiagnostics.getInstance().recordRenameRetry();
        };

        try {
            await renameWithWindowsRetry(canonicalSource, canonicalDestination, {
                onRetry: recordRetry,
            });
            this.invalidatePath(canonicalSource);
            this.invalidatePath(canonicalDestination);
            if (canonicalSource !== source) this.invalidatePath(source);
            if (canonicalDestination !== destination) this.invalidatePath(destination);
            return { success: true, newPath: canonicalDestination };
        } catch (error: unknown) {
            // If rename fails with EXDEV (cross-device), perform link-safe copy + atomic delete rollback
            if (getFsErrorCode(error) === 'EXDEV') {
                let copiedToDest = false;
                try {
                    const sourceStats = await fs.lstat(canonicalSource);
                    const isSym = Boolean(
                        sourceStats && typeof sourceStats.isSymbolicLink === 'function' && sourceStats.isSymbolicLink()
                    );
                    const isDir = !isSym && Boolean(
                        sourceStats && typeof sourceStats.isDirectory === 'function' && sourceStats.isDirectory()
                    );

                    if (isSym) {
                        const target = await fs.readlink(canonicalSource);
                        await fs.symlink(target, canonicalDestination);
                    } else if (isDir) {
                        await fs.cp(canonicalSource, canonicalDestination, {
                            recursive: true,
                            preserveTimestamps: true,
                            verbatimSymlinks: true,
                        });
                    } else {
                        await fs.copyFile(canonicalSource, canonicalDestination);
                    }
                    copiedToDest = true;

                    await fs.rm(canonicalSource, { recursive: true, force: true });
                    this.invalidatePath(canonicalSource);
                    this.invalidatePath(canonicalDestination);
                    if (canonicalSource !== source) this.invalidatePath(source);
                    if (canonicalDestination !== destination) this.invalidatePath(destination);
                    return { success: true, newPath: canonicalDestination };
                } catch (copyError: unknown) {
                    if (copiedToDest) {
                        try {
                            await fs.rm(canonicalDestination, { recursive: true, force: true });
                        } catch {
                            // Best-effort cleanup of half-moved cross-device destination
                        }
                    }
                    throw this.wrapError(copyError, canonicalSource);
                }
            }

            throw this.wrapError(error, canonicalSource);
        }
    }

    async copy(
        source: string,
        destination: string
    ): Promise<{ success: boolean; copiedPath: string }> {
        const canonicalSource = await this.validateLinkAwarePathOrThrow(source);
        const canonicalDestination = await this.validateCanonicalPathOrThrow(destination);

        const normSource = this.normalizeCacheKey(canonicalSource);
        const normDest = this.normalizeCacheKey(canonicalDestination);
        const srcPrefix = normSource.endsWith(path.sep) ? normSource : `${normSource}${path.sep}`;
        if (normDest === normSource || normDest.startsWith(srcPrefix)) {
            throw new FileSystemError('INVALID_PATH', 'Cannot copy a directory into itself', {
                path: canonicalDestination,
                operation: 'copy',
            });
        }

        try {
            let existsDest = false;
            try {
                const destStat = await fs.lstat(canonicalDestination);
                existsDest = Boolean(destStat);
            } catch {
                existsDest = false;
            }
            if (existsDest) {
                throw new FileSystemError('UNKNOWN', `Destination already exists: ${path.basename(canonicalDestination)}`, {
                    path: canonicalDestination,
                    operation: 'copy',
                });
            }

            await fs.mkdir(path.dirname(canonicalDestination), { recursive: true });
            const sourceStats = await fs.lstat(canonicalSource);
            const isSym = Boolean(
                sourceStats && typeof sourceStats.isSymbolicLink === 'function' && sourceStats.isSymbolicLink()
            );
            const isDir = !isSym && Boolean(
                sourceStats && typeof sourceStats.isDirectory === 'function' && sourceStats.isDirectory()
            );

            if (isDir) {
                await fs.cp(canonicalSource, canonicalDestination, {
                    recursive: true,
                    preserveTimestamps: true,
                    verbatimSymlinks: true,
                    errorOnExist: true,
                    force: false,
                });
            } else if (isSym) {
                const target = await fs.readlink(canonicalSource);
                await fs.symlink(target, canonicalDestination);
            } else {
                await fs.copyFile(canonicalSource, canonicalDestination);
            }
            this.invalidatePath(canonicalDestination);
            if (canonicalDestination !== destination) this.invalidatePath(destination);
            return { success: true, copiedPath: canonicalDestination };
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalSource);
        }
    }

    async getStats(filePath: string): Promise<FileStats> {
        // SECURITY: Validate canonical path first and read stats from canonicalPath
        const canonicalPath = await this.validateCanonicalPathOrThrow(filePath);

        try {
            const stats = await fs.stat(canonicalPath);

            return {
                path: canonicalPath,
                size: stats.size,
                created: stats.birthtimeMs,
                modified: stats.mtimeMs,
                accessed: stats.atimeMs,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                isSymbolicLink: stats.isSymbolicLink(),
                permissions: this.extractPermissions(stats.mode),
            };
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalPath);
        }
    }

    async createDirectory(dirPath: string): Promise<{ success: boolean }> {
        // SECURITY: Validate canonical path first and create canonical target
        const canonicalDir = await this.validateCanonicalPathOrThrow(dirPath);

        try {
            // Create directory (recursive: false to only create final directory)
            await fs.mkdir(canonicalDir, { recursive: false });
            this.invalidatePath(canonicalDir);
            if (canonicalDir !== dirPath) {
                this.invalidatePath(dirPath);
            }

            FileSystemLogger.info('Directory created', { path: canonicalDir });

            return { success: true };
        } catch (error: unknown) {
            throw this.wrapError(error, canonicalDir);
        }
    }

    invalidatePath(targetPath: string): void {
        const normalizedTarget = this.normalizeCacheKey(targetPath);
        const parentDir = this.normalizeCacheKey(path.dirname(targetPath));
        const descendantPrefix = normalizedTarget.endsWith(path.sep)
            ? normalizedTarget
            : `${normalizedTarget}${path.sep}`;

        this.dirCache.invalidate(normalizedTarget);
        this.dirCache.invalidate(parentDir);
        this.dirCache.invalidatePrefix(descendantPrefix);
        this.previewCache.invalidatePrefix(`${normalizedTarget}:`);
        this.previewCache.invalidatePrefix(descendantPrefix);
        this.syncCacheTelemetry();
    }

    clearCache(): void {
        this.dirCache.clear();
        this.previewCache.clear();
        this.syncCacheTelemetry();
    }

    getCacheStats(): {
        items: number;
        bytes: number;
        hits: number;
        misses: number;
        evictions: number;
        invalidations: number;
    } {
        const dirStats = this.dirCache.getStats();
        const previewStats = this.previewCache.getStats();
        return {
            items: dirStats.size + previewStats.size,
            bytes: dirStats.bytes + previewStats.bytes,
            hits: dirStats.hits + previewStats.hits,
            misses: dirStats.misses + previewStats.misses,
            evictions: dirStats.evictions + previewStats.evictions,
            invalidations: dirStats.invalidations + previewStats.invalidations,
        };
    }

    /**
     * Validate path without throwing.
     * 
     * @param filePath - Path to validate
     * @returns Validation result
     */
    validatePath(filePath: string): ValidationResult {
        return this.validator.validate(filePath);
    }

    async validateCanonicalPath(filePath: string): Promise<ValidationResult> {
        return this.validator.validateCanonical(filePath);
    }

    async createCanonicalContext(): Promise<CanonicalValidationContext> {
        return this.validator.createCanonicalContext();
    }

    /**
     * Get allowed root directory.
     * 
     * @returns Absolute path to allowed root
     */
    getAllowedRoot(): string {
        return this.validator.getAllowedRoot();
    }

    getAllowedRoots(): string[] {
        return this.validator.getAllowedRoots();
    }

    /**
     * Dynamically update allowed workspace/vault roots and invalidate directory caches.
     */
    updateAllowedRoots(allowedRoot: string | string[]): void {
        const roots = Array.isArray(allowedRoot)
            ? allowedRoot.filter((entry) => entry && entry.trim() !== '')
            : allowedRoot && allowedRoot.trim() !== ''
                ? [allowedRoot]
                : [];
        if (roots.length === 0) {
            throw new Error('Allowed root directory cannot be empty');
        }
        this.validator = VaultRootAuthority.getInstance().createScopedValidator(roots);
        this.clearCache();
    }

    private async validateLinkAwarePathOrThrow(
        filePath: string,
        canonicalContext?: CanonicalValidationContext
    ): Promise<string> {
        this.validatePathOrThrow(filePath);
        if (typeof fs.lstat === 'function') {
            try {
                const lstatInfo = await fs.lstat(path.resolve(filePath));
                if (typeof lstatInfo.isSymbolicLink === 'function' && lstatInfo.isSymbolicLink()) {
                    const linkCheck = await this.validator.validateParentCanonicalForLink(filePath);
                    if (!linkCheck.valid || !linkCheck.canonicalLinkPath) {
                        const errorCode =
                            linkCheck.error === 'SYMLINK_ESCAPE'
                                ? 'UNAUTHORIZED_ACCESS'
                                : (linkCheck.error as 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'INVALID_PATH');
                        throw ErrorFactory.createFileSystemError(
                            errorCode || 'UNAUTHORIZED_ACCESS',
                            filePath,
                            undefined,
                            { details: linkCheck.details }
                        );
                    }
                    return linkCheck.canonicalLinkPath;
                }
            } catch (error: unknown) {
                if (getFsErrorCode(error) !== 'ENOENT') {
                    // Propagate validation errors; let downstream fs operations handle OS-level errors cleanly
                    if (error instanceof Error && error.name !== 'Error' && 'code' in error && (error as { code?: string }).code === 'UNAUTHORIZED_ACCESS') {
                        throw error;
                    }
                }
            }
        }
        return this.validateCanonicalPathOrThrow(filePath, canonicalContext);
    }

    private async validateCanonicalPathOrThrow(
        filePath: string,
        canonicalContext?: CanonicalValidationContext
    ): Promise<string> {
        const result = canonicalContext
            ? await this.validator.validateCanonicalWithContext(filePath, canonicalContext)
            : await this.validator.validateCanonical(filePath);

        if (!result.valid) {
            const errorCode =
                result.error === 'SYMLINK_ESCAPE'
                    ? 'UNAUTHORIZED_ACCESS'
                    : (result.error as 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'INVALID_PATH');
            throw ErrorFactory.createFileSystemError(
                errorCode,
                filePath,
                undefined,
                { details: result.details }
            );
        }

        return result.canonicalPath ?? filePath;
    }

    /**
     * Validate path and throw FileSystemError if invalid.
     * 
     * @param filePath - Path to validate
     * @throws FileSystemError if validation fails
     */
    private validatePathOrThrow(filePath: string): void {
        const result = this.validator.validate(filePath);

        if (!result.valid) {
            // Use ErrorFactory to create proper FileSystemError
            const errorCode = result.error as 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'INVALID_PATH';
            const error = ErrorFactory.createFileSystemError(
                errorCode,
                filePath,
                undefined,
                { details: result.details }
            );

            throw error;
        }
    }

    /**
     * Wrap fs errors in structured FileSystemError.
     * 
     * @param error - Original fs error
     * @param filePath - Path where error occurred
     * @returns Structured FileSystemError
     */
    private wrapError(error: unknown, filePath: string): FileSystemError {
        if (error instanceof FileSystemError) {
            return error;
        }
        // Use ErrorFactory to create FileSystemError from fs error
        const fsError = ErrorFactory.fromFsError(error, filePath);

        // Log the error
        FileSystemLogger.error('File system operation failed', {
            code: fsError.code,
            path: filePath,
            originalCode: getFsErrorCode(error),
            message: fsError.message,
        });

        return fsError;
    }

    private normalizeCacheKey(targetPath: string): string {
        const resolved = path.resolve(targetPath);
        const root = path.parse(resolved).root;
        const stripped =
            resolved.length > root.length && (resolved.endsWith('/') || resolved.endsWith('\\'))
                ? resolved.slice(0, -1)
                : resolved;
        return process.platform === 'win32' ? stripped.toLowerCase() : stripped;
    }

    private syncCacheTelemetry(): void {
        const stats = this.getCacheStats();
        RuntimeDiagnostics.getInstance().setCacheStats({
            entries: stats.items,
            currentBytes: stats.bytes,
            hits: stats.hits,
            misses: stats.misses,
            invalidations: stats.invalidations,
        });
    }

    private decodeUtf16WithBom(slice: Buffer): string | null {
        if (slice.length >= 2 && slice[0] === 0xff && slice[1] === 0xfe) {
            return slice.subarray(2).toString('utf16le');
        }
        if (slice.length >= 2 && slice[0] === 0xfe && slice[1] === 0xff) {
            const payload = Buffer.from(slice.subarray(2));
            payload.swap16();
            return payload.toString('utf16le');
        }
        return null;
    }

    private async readBoundedText(
        filePath: string,
        fileSize: number,
        tailMode: boolean
    ): Promise<{ text: string; binary: boolean; truncatedByBytes: boolean }> {
        if (typeof fs.open === 'function') {
            const handle = await fs.open(filePath, 'r');
            if (handle) {
                try {
                    const bytesToRead =
                        typeof fileSize === 'number' && Number.isFinite(fileSize) && fileSize >= 0
                            ? Math.min(fileSize, MAX_PREVIEW_BYTES)
                            : MAX_PREVIEW_BYTES;

                    if (bytesToRead === 0) {
                        return { text: '', binary: false, truncatedByBytes: false };
                    }

                    const startOffset =
                        tailMode && typeof fileSize === 'number' && fileSize > MAX_PREVIEW_BYTES
                            ? fileSize - bytesToRead
                            : 0;
                    const buffer = Buffer.allocUnsafe(bytesToRead);
                    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, startOffset);
                    const slice = buffer.subarray(0, bytesRead);
                    const utf16Text = startOffset === 0 ? this.decodeUtf16WithBom(slice) : null;
                    if (utf16Text !== null) {
                        return {
                            text: utf16Text,
                            binary: false,
                            truncatedByBytes: typeof fileSize === 'number' && fileSize > bytesToRead,
                        };
                    }
                    if (slice.includes(0)) {
                        return { text: '', binary: true, truncatedByBytes: false };
                    }
                    return {
                        text: slice.toString('utf-8'),
                        binary: false,
                        truncatedByBytes: typeof fileSize === 'number' && fileSize > bytesToRead,
                    };
                } finally {
                    await handle.close();
                }
            }
        }

        const raw = await fs.readFile(filePath, 'utf-8');
        if (raw.includes('\0')) {
            return { text: '', binary: true, truncatedByBytes: false };
        }
        return { text: raw, binary: false, truncatedByBytes: false };
    }

    /**
     * Get file extension from name.
     * 
     * @param fileName - File name
     * @returns Extension without dot, or empty string
     */
    private getExtension(fileName: string): string {
        const ext = path.extname(fileName);
        return ext ? ext.slice(1).toLowerCase() : '';
    }

    /**
     * Get MIME type from file name.
     * 
     * @param fileName - File name
     * @returns MIME type string
     */
    private getMimeType(fileName: string): string {
        const ext = this.getExtension(fileName);

        // Common MIME types mapping
        const mimeTypes: Record<string, string> = {
            // Text
            txt: 'text/plain',
            md: 'text/markdown',
            html: 'text/html',
            css: 'text/css',
            csv: 'text/csv',

            // Images
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            svg: 'image/svg+xml',
            webp: 'image/webp',

            // Documents
            pdf: 'application/pdf',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xls: 'application/vnd.ms-excel',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

            // Code
            js: 'application/javascript',
            json: 'application/json',
            ts: 'application/typescript',
            py: 'text/x-python',
            java: 'text/x-java',
            cpp: 'text/x-c++src',
            c: 'text/x-csrc',

            // Archives
            zip: 'application/zip',
            tar: 'application/x-tar',
            gz: 'application/gzip',

            // Audio/Video
            mp3: 'audio/mpeg',
            mp4: 'video/mp4',
            avi: 'video/x-msvideo',
        };

        return mimeTypes[ext] || 'application/octet-stream';
    }

    /**
     * Check if file is hidden (starts with dot on Unix).
     * 
     * @param fileName - File name
     * @returns True if hidden
     */
    private isHidden(fileName: string): boolean {
        return fileName.startsWith('.');
    }

    /**
     * Extract permission flags from mode.
     * 
     * @param mode - File mode from fs.stat
     * @returns Permission object
     */
    private extractPermissions(mode: number): {
        readable: boolean;
        writable: boolean;
        executable: boolean;
    } {
        // Extract user permissions (owner)
        const userPerms = (mode >> 6) & 0x7;

        return {
            readable: (userPerms & 0x4) !== 0,
            writable: (userPerms & 0x2) !== 0,
            executable: (userPerms & 0x1) !== 0,
        };
    }
}
