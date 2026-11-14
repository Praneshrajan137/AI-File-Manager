import fs from 'fs/promises';
import path from 'path';
import {
    IFileSystemService,
    FileNode,
    FilePreviewResult,
    FileStats,
    ValidationResult,
    CACHE_CAPACITY,
    MAX_CACHE_MEMORY,
    RING_BUFFER_CAPACITY,
} from '@shared/contracts';
import { PathValidator } from './PathValidator';
import { LRUCache } from '@main/dsa/LRUCache';
import { RingBuffer } from '@main/dsa/RingBuffer';
import { RuntimeDiagnostics } from './RuntimeDiagnostics';
import { ErrorFactory, FileSystemError } from '@shared/errors';
import { FileSystemLogger, SecurityLogger } from '@shared/logging';

const MAX_PREVIEW_BYTES = 256 * 1024;
const READ_DIR_CONCURRENCY = 16;

function estimateFileNodesBytes(nodes: FileNode[]): number {
    return nodes.reduce((sum, node) => sum + 128 + (node.path.length + node.name.length) * 2, 64);
}

function estimatePreviewBytes(preview: FilePreviewResult): number {
    return preview.lines.reduce((sum, line) => sum + line.length * 2 + 16, 256);
}

function getFsErrorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
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

        this.validator = new PathValidator(roots);
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
    async readDirectory(dirPath: string): Promise<FileNode[]> {
        // SECURITY: Validate path lexically and canonically first (guards symlinks & traversal)
        await this.validateCanonicalPathOrThrow(dirPath);

        const cacheKey = this.normalizeCacheKey(dirPath);
        const cached = this.dirCache.get(cacheKey);
        if (cached) {
            this.syncCacheTelemetry();
            return cached.map((entry) => ({ ...entry }));
        }

        try {
            // Read directory with file types
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const fileNodes: FileNode[] = [];

            for (let i = 0; i < entries.length; i += READ_DIR_CONCURRENCY) {
                const batch = entries.slice(i, i + READ_DIR_CONCURRENCY);
                const settled = await Promise.all(
                    batch.map(async (entry): Promise<FileNode | null> => {
                        const fullPath = path.join(dirPath, entry.name);
                        try {
                            if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
                                const canonicalCheck = await this.validator.validateCanonical(fullPath);
                                if (!canonicalCheck.valid) {
                                    SecurityLogger.warn('Skipping directory entry with symlink escape', {
                                        path: fullPath,
                                        reason: canonicalCheck.error,
                                    });
                                    return null;
                                }
                            }
                            const stats = await fs.stat(fullPath);
                            const isDir = entry.isDirectory() || (typeof stats.isDirectory === 'function' && stats.isDirectory());
                            return {
                                path: fullPath,
                                name: entry.name,
                                isDirectory: isDir,
                                size: stats.size,
                                modified: stats.mtimeMs,
                                extension: this.getExtension(entry.name),
                                mimeType: this.getMimeType(entry.name),
                                isHidden: this.isHidden(entry.name),
                            };
                        } catch (statError: unknown) {
                            FileSystemLogger.warn('Failed to stat file', {
                                path: fullPath,
                                error: statError instanceof Error ? statError.message : String(statError),
                            });
                            return null;
                        }
                    })
                );

                for (const node of settled) {
                    if (node) {
                        fileNodes.push(node);
                    }
                }
            }

            this.dirCache.put(cacheKey, fileNodes);
            this.syncCacheTelemetry();

            return fileNodes.map((entry) => ({ ...entry }));
        } catch (error: unknown) {
            throw this.wrapError(error, dirPath);
        }
    }

    async readFile(
        filePath: string,
        encoding: BufferEncoding = 'utf-8'
    ): Promise<string> {
        // SECURITY: Validate canonical path first (prevents ancestor/leaf symlink escapes)
        await this.validateCanonicalPathOrThrow(filePath);

        try {
            const content = await fs.readFile(filePath, encoding);
            return content;
        } catch (error: unknown) {
            throw this.wrapError(error, filePath);
        }
    }

    async previewFile(
        filePath: string,
        maxLines: number = RING_BUFFER_CAPACITY
    ): Promise<FilePreviewResult> {
        await this.validateCanonicalPathOrThrow(filePath);

        const cap = Math.max(1, Math.min(Math.floor(maxLines), RING_BUFFER_CAPACITY));
        const normalizedFile = this.normalizeCacheKey(filePath);
        const previewKey = `${normalizedFile}:${cap}`;

        let stats: Awaited<ReturnType<typeof fs.stat>>;
        try {
            stats = await fs.stat(filePath);
        } catch (error: unknown) {
            throw this.wrapError(error, filePath);
        }

        if (typeof stats.isDirectory === 'function' && stats.isDirectory()) {
            throw new FileSystemError('INVALID_PATH', 'Cannot preview a directory', {
                path: filePath,
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

        const ext = this.getExtension(filePath);
        const isLogTail = ext === 'log';

        try {
            const { text, binary, truncatedByBytes } = await this.readBoundedText(
                filePath,
                stats.size,
                isLogTail
            );

            if (binary) {
                const binaryPreview: FilePreviewResult = {
                    path: filePath,
                    name: path.basename(filePath),
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
                path: filePath,
                name: path.basename(filePath),
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
            throw this.wrapError(error, filePath);
        }
    }

    async writeFile(
        filePath: string,
        content: string
    ): Promise<{ success: boolean }> {
        // SECURITY: Validate canonical target/ancestor path first
        await this.validateCanonicalPathOrThrow(filePath);

        try {
            await fs.writeFile(filePath, content, 'utf-8');
            this.invalidatePath(filePath);
            return { success: true };
        } catch (error: unknown) {
            throw this.wrapError(error, filePath);
        }
    }

    async delete(
        filePath: string,
        recursive: boolean = false
    ): Promise<{ success: boolean }> {
        // SECURITY: Validate parent canonically if leaf is a symlink so we unlink without dereferencing targets
        await this.validateLinkAwarePathOrThrow(filePath);

        try {
            await fs.rm(filePath, { recursive, force: true });
            this.invalidatePath(filePath);
            return { success: true };
        } catch (error: unknown) {
            throw this.wrapError(error, filePath);
        }
    }

    async move(
        source: string,
        destination: string
    ): Promise<{ success: boolean; newPath: string }> {
        // SECURITY: Validate source (link-aware) and canonical destination
        await this.validateLinkAwarePathOrThrow(source);
        await this.validateCanonicalPathOrThrow(destination);

        try {
            await fs.rename(source, destination);
            this.invalidatePath(source);
            this.invalidatePath(destination);
            return { success: true, newPath: destination };
        } catch (error: unknown) {
            // If rename fails with EXDEV (cross-device), do copy + delete (supports files and directories)
            if (getFsErrorCode(error) === 'EXDEV') {
                try {
                    const sourceStats = await fs.stat(source);
                    if (typeof sourceStats.isDirectory === 'function' && sourceStats.isDirectory()) {
                        await fs.cp(source, destination, { recursive: true });
                    } else {
                        await fs.copyFile(source, destination);
                    }
                    await fs.rm(source, { recursive: true, force: true });
                    this.invalidatePath(source);
                    this.invalidatePath(destination);
                    return { success: true, newPath: destination };
                } catch (copyError: unknown) {
                    throw this.wrapError(copyError, source);
                }
            }

            throw this.wrapError(error, source);
        }
    }

    async getStats(filePath: string): Promise<FileStats> {
        // SECURITY: Validate canonical path first
        await this.validateCanonicalPathOrThrow(filePath);

        try {
            const stats = await fs.stat(filePath);

            return {
                path: filePath,
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
            throw this.wrapError(error, filePath);
        }
    }

    async createDirectory(dirPath: string): Promise<{ success: boolean }> {
        // SECURITY: Validate canonical path first
        await this.validateCanonicalPathOrThrow(dirPath);

        try {
            // Create directory (recursive: false to only create final directory)
            await fs.mkdir(dirPath, { recursive: false });
            this.invalidatePath(dirPath);

            FileSystemLogger.info('Directory created', { path: dirPath });

            return { success: true };
        } catch (error: unknown) {
            throw this.wrapError(error, dirPath);
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
        this.validator = new PathValidator(roots);
        this.clearCache();
    }

    private async validateLinkAwarePathOrThrow(filePath: string): Promise<string> {
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
        return this.validateCanonicalPathOrThrow(filePath);
    }

    private async validateCanonicalPathOrThrow(filePath: string): Promise<string> {
        const result = await this.validator.validateCanonical(filePath);

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
