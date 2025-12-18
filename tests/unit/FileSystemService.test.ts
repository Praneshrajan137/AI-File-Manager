import { FileSystemService } from '@main/services/FileSystemService';
import { FileNode, FileStats } from '@shared/contracts';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock fs module
jest.mock('fs/promises');

describe('FileSystemService', () => {
    let service: FileSystemService;
    let testRoot: string;

    beforeEach(() => {
        testRoot = path.join(os.tmpdir(), 'test-file-manager');
        service = new FileSystemService(testRoot);

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with allowed root', () => {
            expect(service.getAllowedRoot()).toBe(path.resolve(testRoot));
        });

        it('should throw error if root is empty', () => {
            expect(() => {
                new FileSystemService('');
            }).toThrow();
        });
    });

    describe('readDirectory()', () => {
        it('should read directory contents', async () => {
            const mockFiles = [
                { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
                { name: 'folder1', isDirectory: () => true, isFile: () => false },
            ];

            (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);
            (fs.stat as jest.Mock).mockResolvedValue({
                size: 1024,
                mtimeMs: Date.now(),
                isDirectory: () => false,
                isFile: () => true,
            });

            const dirPath = path.join(testRoot, 'documents');
            const files = await service.readDirectory(dirPath);

            expect(files).toHaveLength(2);
            expect(files[0].name).toBe('file1.txt');
            expect(files[0].isDirectory).toBe(false);
            expect(files[1].name).toBe('folder1');
            expect(files[1].isDirectory).toBe(true);
        });

        it('should reject path traversal attempts', async () => {
            const maliciousPath = testRoot + '/../../../etc/passwd';

            await expect(service.readDirectory(maliciousPath)).rejects.toMatchObject({
                code: 'PATH_TRAVERSAL',
            });

            // fs.readdir should NEVER be called
            expect(fs.readdir).not.toHaveBeenCalled();
        });

        it('should reject paths outside allowed root', async () => {
            const outsidePath = '/tmp/other-directory';

            await expect(service.readDirectory(outsidePath)).rejects.toMatchObject({
                code: 'UNAUTHORIZED_ACCESS',
            });

            expect(fs.readdir).not.toHaveBeenCalled();
        });

        it('should handle directory not found', async () => {
            (fs.readdir as jest.Mock).mockRejectedValue({
                code: 'ENOENT',
                message: 'Directory not found',
            });

            const dirPath = path.join(testRoot, 'nonexistent');

            await expect(service.readDirectory(dirPath)).rejects.toMatchObject({
                code: 'FILE_NOT_FOUND',
            });
        });

        it('should handle permission denied', async () => {
            (fs.readdir as jest.Mock).mockRejectedValue({
                code: 'EACCES',
                message: 'Permission denied',
            });

            const dirPath = path.join(testRoot, 'restricted');

            await expect(service.readDirectory(dirPath)).rejects.toMatchObject({
                code: 'PERMISSION_DENIED',
            });
        });

        it('should include file metadata', async () => {
            const mockFiles = [
                { name: 'document.pdf', isDirectory: () => false, isFile: () => true },
            ];

            const mockStats = {
                size: 2048,
                mtimeMs: 1640000000000,
                isDirectory: () => false,
                isFile: () => true,
            };

            (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);
            (fs.stat as jest.Mock).mockResolvedValue(mockStats);

            const dirPath = path.join(testRoot, 'documents');
            const files = await service.readDirectory(dirPath);

            expect(files[0].size).toBe(2048);
            expect(files[0].modified).toBe(1640000000000);
            expect(files[0].extension).toBe('pdf');
        });

        it('should detect MIME types correctly', async () => {
            const mockFiles = [
                { name: 'image.png', isDirectory: () => false, isFile: () => true },
                { name: 'document.pdf', isDirectory: () => false, isFile: () => true },
                { name: 'script.js', isDirectory: () => false, isFile: () => true },
            ];

            (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);
            (fs.stat as jest.Mock).mockResolvedValue({
                size: 1024,
                mtimeMs: Date.now(),
                isDirectory: () => false,
                isFile: () => true,
            });

            const dirPath = path.join(testRoot, 'files');
            const files = await service.readDirectory(dirPath);

            expect(files[0].mimeType).toBe('image/png');
            expect(files[1].mimeType).toBe('application/pdf');
            expect(files[2].mimeType).toBe('application/javascript');
        });

        it('should mark hidden files correctly', async () => {
            const mockFiles = [
                { name: '.hidden', isDirectory: () => false, isFile: () => true },
                { name: 'visible.txt', isDirectory: () => false, isFile: () => true },
            ];

            (fs.readdir as jest.Mock).mockResolvedValue(mockFiles);
            (fs.stat as jest.Mock).mockResolvedValue({
                size: 100,
                mtimeMs: Date.now(),
                isDirectory: () => false,
                isFile: () => true,
            });

            const dirPath = path.join(testRoot, 'files');
            const files = await service.readDirectory(dirPath);

            expect(files[0].isHidden).toBe(true);
            expect(files[1].isHidden).toBe(false);
        });
    });

    describe('readFile()', () => {
        it('should read file content', async () => {
            const content = 'Hello, World!';
            (fs.readFile as jest.Mock).mockResolvedValue(content);

            const filePath = path.join(testRoot, 'file.txt');
            const result = await service.readFile(filePath);

            expect(result).toBe(content);
            expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
        });

        it('should validate path before reading', async () => {
            const maliciousPath = testRoot + '/../../../etc/passwd';

            await expect(service.readFile(maliciousPath)).rejects.toMatchObject({
                code: 'PATH_TRAVERSAL',
            });

            expect(fs.readFile).not.toHaveBeenCalled();
        });

        it('should support different encodings', async () => {
            (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('binary data'));

            const filePath = path.join(testRoot, 'file.bin');
            await service.readFile(filePath, 'binary');

            expect(fs.readFile).toHaveBeenCalledWith(filePath, 'binary');
        });

        it('should handle file not found', async () => {
            (fs.readFile as jest.Mock).mockRejectedValue({
                code: 'ENOENT',
            });

            const filePath = path.join(testRoot, 'nonexistent.txt');

            await expect(service.readFile(filePath)).rejects.toMatchObject({
                code: 'FILE_NOT_FOUND',
            });
        });
    });

    describe('writeFile()', () => {
        it('should write file content', async () => {
            (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

            const filePath = path.join(testRoot, 'new-file.txt');
            const content = 'Test content';

            const result = await service.writeFile(filePath, content);

            expect(result.success).toBe(true);
            expect(fs.writeFile).toHaveBeenCalledWith(filePath, content, 'utf-8');
        });

        it('should validate path before writing', async () => {
            const maliciousPath = testRoot + '/../../../etc/passwd';

            await expect(
                service.writeFile(maliciousPath, 'hacked')
            ).rejects.toMatchObject({
                code: 'PATH_TRAVERSAL',
            });

            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        it('should handle disk full error', async () => {
            (fs.writeFile as jest.Mock).mockRejectedValue({
                code: 'ENOSPC',
            });

            const filePath = path.join(testRoot, 'file.txt');

            await expect(
                service.writeFile(filePath, 'content')
            ).rejects.toMatchObject({
                code: 'DISK_FULL',
            });
        });

        it('should handle permission denied', async () => {
            (fs.writeFile as jest.Mock).mockRejectedValue({
                code: 'EACCES',
            });

            const filePath = path.join(testRoot, 'readonly.txt');

            await expect(
                service.writeFile(filePath, 'content')
            ).rejects.toMatchObject({
                code: 'PERMISSION_DENIED',
            });
        });
    });

    describe('delete()', () => {
        it('should delete file', async () => {
            (fs.rm as jest.Mock).mockResolvedValue(undefined);

            const filePath = path.join(testRoot, 'file.txt');
            const result = await service.delete(filePath);

            expect(result.success).toBe(true);
            expect(fs.rm).toHaveBeenCalledWith(filePath, { recursive: false, force: true });
        });

        it('should delete directory recursively', async () => {
            (fs.rm as jest.Mock).mockResolvedValue(undefined);

            const dirPath = path.join(testRoot, 'folder');
            const result = await service.delete(dirPath, true);

            expect(result.success).toBe(true);
            expect(fs.rm).toHaveBeenCalledWith(dirPath, { recursive: true, force: true });
        });

        it('should validate path before deleting', async () => {
            const maliciousPath = '/etc/passwd';

            await expect(service.delete(maliciousPath)).rejects.toMatchObject({
                code: 'UNAUTHORIZED_ACCESS',
            });

            expect(fs.rm).not.toHaveBeenCalled();
        });

        it('should handle file not found', async () => {
            (fs.rm as jest.Mock).mockRejectedValue({
                code: 'ENOENT',
            });

            const filePath = path.join(testRoot, 'nonexistent.txt');

            await expect(service.delete(filePath)).rejects.toMatchObject({
                code: 'FILE_NOT_FOUND',
            });
        });
    });

    describe('move()', () => {
        it('should move file', async () => {
            (fs.rename as jest.Mock).mockResolvedValue(undefined);

            const source = path.join(testRoot, 'old.txt');
            const dest = path.join(testRoot, 'new.txt');

            const result = await service.move(source, dest);

            expect(result.success).toBe(true);
            expect(result.newPath).toBe(dest);
            expect(fs.rename).toHaveBeenCalledWith(source, dest);
        });

        it('should validate both source and destination', async () => {
            const validSource = path.join(testRoot, 'file.txt');
            const invalidDest = '/tmp/outside/file.txt';

            await expect(
                service.move(validSource, invalidDest)
            ).rejects.toMatchObject({
                code: 'UNAUTHORIZED_ACCESS',
            });

            expect(fs.rename).not.toHaveBeenCalled();
        });

        it('should handle cross-device move', async () => {
            // First rename fails with EXDEV, then copy+delete succeeds
            (fs.rename as jest.Mock).mockRejectedValueOnce({
                code: 'EXDEV',
            });
            (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
            (fs.rm as jest.Mock).mockResolvedValue(undefined);

            const source = path.join(testRoot, 'file.txt');
            const dest = path.join(testRoot, 'moved.txt');

            const result = await service.move(source, dest);

            expect(result.success).toBe(true);
            expect(fs.copyFile).toHaveBeenCalled();
            expect(fs.rm).toHaveBeenCalled();
        });
    });

    describe('getStats()', () => {
        it('should return detailed file statistics', async () => {
            const mockStats = {
                size: 2048,
                birthtimeMs: 1640000000000,
                mtimeMs: 1640100000000,
                atimeMs: 1640200000000,
                isDirectory: () => false,
                isFile: () => true,
                isSymbolicLink: () => false,
                mode: 0o644,
            };

            (fs.stat as jest.Mock).mockResolvedValue(mockStats);

            const filePath = path.join(testRoot, 'file.txt');
            const stats = await service.getStats(filePath);

            expect(stats.size).toBe(2048);
            expect(stats.created).toBe(1640000000000);
            expect(stats.modified).toBe(1640100000000);
            expect(stats.accessed).toBe(1640200000000);
            expect(stats.isFile).toBe(true);
            expect(stats.isDirectory).toBe(false);
        });

        it('should include permission information', async () => {
            const mockStats = {
                size: 0,
                birthtimeMs: Date.now(),
                mtimeMs: Date.now(),
                atimeMs: Date.now(),
                isDirectory: () => false,
                isFile: () => true,
                isSymbolicLink: () => false,
                mode: 0o755, // rwxr-xr-x
            };

            (fs.stat as jest.Mock).mockResolvedValue(mockStats);

            const filePath = path.join(testRoot, 'script.sh');
            const stats = await service.getStats(filePath);

            expect(stats.permissions.readable).toBe(true);
            expect(stats.permissions.writable).toBe(true);
            expect(stats.permissions.executable).toBe(true);
        });

        it('should validate path before getting stats', async () => {
            const maliciousPath = '/etc/shadow';

            await expect(service.getStats(maliciousPath)).rejects.toMatchObject({
                code: 'UNAUTHORIZED_ACCESS',
            });

            expect(fs.stat).not.toHaveBeenCalled();
        });
    });

    describe('validatePath()', () => {
        it('should expose path validation', () => {
            const validPath = path.join(testRoot, 'file.txt');
            const result = service.validatePath(validPath);

            expect(result.valid).toBe(true);
        });

        it('should return validation errors', () => {
            const invalidPath = '../../../etc/passwd';
            const result = service.validatePath(invalidPath);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('PATH_TRAVERSAL');
        });
    });

    describe('error handling', () => {
        it('should wrap fs errors in FileSystemError', async () => {
            (fs.readFile as jest.Mock).mockRejectedValue(new Error('Unknown error'));

            const filePath = path.join(testRoot, 'file.txt');

            await expect(service.readFile(filePath)).rejects.toMatchObject({
                code: 'UNKNOWN',
                message: expect.stringContaining('Unknown error'),
            });
        });

        it('should preserve original error for debugging', async () => {
            const originalError = new Error('Test error');
            (fs.readFile as jest.Mock).mockRejectedValue(originalError);

            const filePath = path.join(testRoot, 'file.txt');

            try {
                await service.readFile(filePath);
            } catch (error: any) {
                expect(error.originalError).toBe(originalError);
            }
        });
    });
});
