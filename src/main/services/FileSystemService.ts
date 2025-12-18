import fs from 'fs/promises';
import path from 'path';
import {
    IFileSystemService,
    FileNode,
    FileStats,
    ValidationResult,
    FileSystemError,
} from '@shared/contracts';
import { PathValidator } from './PathValidator';

/**
 * FileSystemService - Core file system operations with security validation.
 * 
 * SECURITY: All operations validate paths using PathValidator before
 * executing any fs operations.
 * 
 * PERFORMANCE: Uses fs/promises for non-blocking async operations.
 * 
 * ERROR HANDLING: Wraps fs errors in structured FileSystemError objects.
 */
export class FileSystemService implements IFileSystemService {
    private validator: PathValidator;

    /**
     * Create file system service for specific root directory.
     * 
     * @param allowedRoot - Root directory that all operations are restricted to
     * 
     * @throws Error if allowedRoot is empty
     * 
     * @example
     * const service = new FileSystemService('/home/user/documents');
     * const files = await service.readDirectory('/home/user/documents');
     */
    constructor(allowedRoot: string) {
        if (!allowedRoot || allowedRoot.trim() === '') {
            throw new Error('Allowed root directory cannot be empty');
        }

        this.validator = new PathValidator(allowedRoot);
    }

    /**
     * Read directory contents with metadata.
     * 
     * @param dirPath - Absolute path to directory
     * @returns Array of FileNode objects
     * @throws FileSystemError if validation fails or directory inaccessible
     */
    async readDirectory(dirPath: string): Promise<FileNode[]> {
        // SECURITY: Validate path first
        this.validatePathOrThrow(dirPath);

        try {
            // Read directory with file types
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            // Build FileNode objects with metadata
            const fileNodes: FileNode[] = [];

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                try {
                    // Get detailed stats for each file
                    const stats = await fs.stat(fullPath);

                    const fileNode: FileNode = {
                        path: fullPath,
                        name: entry.name,
                        isDirectory: entry.isDirectory(),
                        size: stats.size,
                        modified: stats.mtimeMs,
                        extension: this.getExtension(entry.name),
                        mimeType: this.getMimeType(entry.name),
                        isHidden: this.isHidden(entry.name),
                    };

                    fileNodes.push(fileNode);
                } catch (statError) {
                    // If stat fails for individual file, skip it but continue
                    console.warn(`Failed to stat ${fullPath}:`, statError);
                }
            }

            return fileNodes;
        } catch (error: any) {
            throw this.wrapError(error, dirPath);
        }
    }

    /**
     * Read file content as string.
     * 
     * @param filePath - Absolute path to file
     * @param encoding - Character encoding (default: 'utf-8')
     * @returns File content
     * @throws FileSystemError if validation fails or file inaccessible
     */
    async readFile(
        filePath: string,
        encoding: BufferEncoding = 'utf-8'
    ): Promise<string> {
        // SECURITY: Validate path first
        this.validatePathOrThrow(filePath);

        try {
            const content = await fs.readFile(filePath, encoding);
            return content;
        } catch (error: any) {
            throw this.wrapError(error, filePath);
        }
    }

    /**
     * Write content to file.
     * 
     * @param filePath - Absolute path to file
     * @param content - Content to write
     * @returns Success status
     * @throws FileSystemError if validation fails or write fails
     */
    async writeFile(
        filePath: string,
        content: string
    ): Promise<{ success: boolean }> {
        // SECURITY: Validate path first
        this.validatePathOrThrow(filePath);

        try {
            await fs.writeFile(filePath, content, 'utf-8');
            return { success: true };
        } catch (error: any) {
            throw this.wrapError(error, filePath);
        }
    }

    /**
     * Delete file or directory.
     * 
     * @param filePath - Absolute path to delete
     * @param recursive - If true, delete directories recursively
     * @returns Success status
     * @throws FileSystemError if validation fails or deletion fails
     * 
     * BUG FIX: Simplified to use fs.rm() for everything (handles both files and directories)
     * This avoids race conditions and unnecessary stat() calls.
     */
    async delete(
        filePath: string,
        recursive: boolean = false
    ): Promise<{ success: boolean }> {
        // SECURITY: Validate path first
        this.validatePathOrThrow(filePath);

        try {
            // fs.rm() works for both files and directories
            // No need to check with stat() first (avoids race condition)
            await fs.rm(filePath, { recursive, force: true });
            return { success: true };
        } catch (error: any) {
            throw this.wrapError(error, filePath);
        }
    }

    /**
     * Move or rename file/directory.
     * 
     * @param source - Current path
     * @param destination - New path
     * @returns Success status and new path
     * @throws FileSystemError if validation fails or move fails
     */
    async move(
        source: string,
        destination: string
    ): Promise<{ success: boolean; newPath: string }> {
        // SECURITY: Validate both paths
        this.validatePathOrThrow(source);
        this.validatePathOrThrow(destination);

        try {
            // Try rename first (fastest, works within same filesystem)
            await fs.rename(source, destination);
            return { success: true, newPath: destination };
        } catch (error: any) {
            // If rename fails with EXDEV (cross-device), do copy + delete
            if (error.code === 'EXDEV') {
                try {
                    await fs.copyFile(source, destination);
                    await fs.rm(source, { recursive: true, force: true });
                    return { success: true, newPath: destination };
                } catch (copyError: any) {
                    throw this.wrapError(copyError, source);
                }
            }

            throw this.wrapError(error, source);
        }
    }

    /**
     * Get detailed file statistics.
     * 
     * @param filePath - Absolute path
     * @returns FileStats object
     * @throws FileSystemError if validation fails or path doesn't exist
     */
    async getStats(filePath: string): Promise<FileStats> {
        // SECURITY: Validate path first
        this.validatePathOrThrow(filePath);

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
        } catch (error: any) {
            throw this.wrapError(error, filePath);
        }
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

    /**
     * Get allowed root directory.
     * 
     * @returns Absolute path to allowed root
     */
    getAllowedRoot(): string {
        return this.validator.getAllowedRoot();
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
            const error: FileSystemError = {
                code: result.error as FileSystemError['code'],
                message: result.details || `Path validation failed: ${result.error}`,
                path: filePath,
            };

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
    private wrapError(error: any, filePath: string): FileSystemError {
        let code: FileSystemError['code'] = 'UNKNOWN';
        let message = error.message || 'Unknown file system error';

        // Map fs error codes to our error codes
        switch (error.code) {
            case 'ENOENT':
                code = 'FILE_NOT_FOUND';
                message = `File or directory not found: ${filePath}`;
                break;

            case 'EACCES':
            case 'EPERM':
                code = 'PERMISSION_DENIED';
                message = `Permission denied: ${filePath}`;
                break;

            case 'ENOSPC':
                code = 'DISK_FULL';
                message = `Disk full, cannot write to: ${filePath}`;
                break;

            default:
                message = `File system error (${error.code || 'unknown'}): ${message}`;
        }

        return {
            code,
            message,
            path: filePath,
            originalError: error,
        };
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
