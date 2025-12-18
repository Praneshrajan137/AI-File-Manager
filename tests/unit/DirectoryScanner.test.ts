import { DirectoryScanner } from '@main/services/DirectoryScanner';
import { FileNode } from '@shared/contracts';
import { FileSystemService } from '@main/services/FileSystemService';
import path from 'path';
import os from 'os';

// Mock FileSystemService
jest.mock('@main/services/FileSystemService');

describe('DirectoryScanner', () => {
    let scanner: DirectoryScanner;
    let mockFileSystemService: jest.Mocked<FileSystemService>;
    let testRoot: string;

    beforeEach(() => {
        testRoot = path.join(os.tmpdir(), 'test-scanner');

        mockFileSystemService = new FileSystemService(testRoot) as jest.Mocked<FileSystemService>;
        scanner = new DirectoryScanner(mockFileSystemService);

        jest.clearAllMocks();
    });

    describe('scan()', () => {
        it('should scan single-level directory', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'file1.txt'),
                    name: 'file1.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'file2.txt'),
                    name: 'file2.txt',
                    isDirectory: false,
                    size: 200,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const results = await scanner.scan(testRoot);

            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('file1.txt');
            expect(results[1].name).toBe('file2.txt');
        });

        it('should scan recursively', async () => {
            // Root directory
            const rootFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'file.txt'),
                    name: 'file.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'subfolder'),
                    name: 'subfolder',
                    isDirectory: true,
                    size: 0,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                },
            ];

            // Subfolder contents
            const subfolderFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'subfolder', 'nested.txt'),
                    name: 'nested.txt',
                    isDirectory: false,
                    size: 50,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory
                .mockResolvedValueOnce(rootFiles)
                .mockResolvedValueOnce(subfolderFiles);

            const results = await scanner.scan(testRoot, { recursive: true });

            expect(results).toHaveLength(3); // file.txt, subfolder, nested.txt
            expect(results.some(f => f.name === 'file.txt')).toBe(true);
            expect(results.some(f => f.name === 'subfolder')).toBe(true);
            expect(results.some(f => f.name === 'nested.txt')).toBe(true);
        });

        it('should respect maxDepth option', async () => {
            // Root: file.txt, level1/
            const rootFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'file.txt'),
                    name: 'file.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'level1'),
                    name: 'level1',
                    isDirectory: true,
                    size: 0,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                },
            ];

            // level1: file1.txt, level2/
            const level1Files: FileNode[] = [
                {
                    path: path.join(testRoot, 'level1', 'file1.txt'),
                    name: 'file1.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'level1', 'level2'),
                    name: 'level2',
                    isDirectory: true,
                    size: 0,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                },
            ];

            mockFileSystemService.readDirectory
                .mockResolvedValueOnce(rootFiles)
                .mockResolvedValueOnce(level1Files);

            const results = await scanner.scan(testRoot, {
                recursive: true,
                maxDepth: 2,
            });

            // Should include: file.txt, level1/, file1.txt, level2/
            // Should NOT include: file2.txt (exceeds maxDepth)
            expect(results).toHaveLength(4);
            expect(results.some(f => f.name === 'file2.txt')).toBe(false);
        });

        it('should filter hidden files when specified', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'visible.txt'),
                    name: 'visible.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                    isHidden: false,
                },
                {
                    path: path.join(testRoot, '.hidden'),
                    name: '.hidden',
                    isDirectory: false,
                    size: 50,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                    isHidden: true,
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const results = await scanner.scan(testRoot, {
                includeHidden: false,
            });

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('visible.txt');
        });

        it('should filter by file extensions', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'doc.txt'),
                    name: 'doc.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'image.png'),
                    name: 'image.png',
                    isDirectory: false,
                    size: 200,
                    modified: Date.now(),
                    extension: 'png',
                    mimeType: 'image/png',
                },
                {
                    path: path.join(testRoot, 'script.js'),
                    name: 'script.js',
                    isDirectory: false,
                    size: 150,
                    modified: Date.now(),
                    extension: 'js',
                    mimeType: 'application/javascript',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const results = await scanner.scan(testRoot, {
                extensions: ['txt', 'js'],
            });

            expect(results).toHaveLength(2);
            expect(results.some(f => f.extension === 'txt')).toBe(true);
            expect(results.some(f => f.extension === 'js')).toBe(true);
            expect(results.some(f => f.extension === 'png')).toBe(false);
        });

        it('should filter by minimum file size', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'small.txt'),
                    name: 'small.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'large.txt'),
                    name: 'large.txt',
                    isDirectory: false,
                    size: 10000,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const results = await scanner.scan(testRoot, {
                minSize: 1000,
            });

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('large.txt');
        });

        it('should filter by maximum file size', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'small.txt'),
                    name: 'small.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'large.txt'),
                    name: 'large.txt',
                    isDirectory: false,
                    size: 10000000, // 10MB
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const results = await scanner.scan(testRoot, {
                maxSize: 1000000, // 1MB
            });

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('small.txt');
        });
    });

    describe('scanWithProgress()', () => {
        it('should report progress during scan', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'file1.txt'),
                    name: 'file1.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'file2.txt'),
                    name: 'file2.txt',
                    isDirectory: false,
                    size: 200,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const progressUpdates: number[] = [];
            const onProgress = (processed: number) => {
                progressUpdates.push(processed);
            };

            await scanner.scanWithProgress(testRoot, {}, onProgress);

            expect(progressUpdates.length).toBeGreaterThan(0);
            expect(progressUpdates[progressUpdates.length - 1]).toBe(2);
        });
    });

    describe('error handling', () => {
        it('should handle permission denied gracefully', async () => {
            mockFileSystemService.readDirectory.mockRejectedValue({
                code: 'PERMISSION_DENIED',
                message: 'Permission denied',
            });

            await expect(scanner.scan(testRoot)).rejects.toMatchObject({
                code: 'PERMISSION_DENIED',
            });
        });

        it('should skip inaccessible subdirectories and continue', async () => {
            const rootFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'accessible'),
                    name: 'accessible',
                    isDirectory: true,
                    size: 0,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                },
                {
                    path: path.join(testRoot, 'restricted'),
                    name: 'restricted',
                    isDirectory: true,
                    size: 0,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                },
            ];

            const accessibleFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'accessible', 'file.txt'),
                    name: 'file.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory
                .mockResolvedValueOnce(rootFiles)
                .mockResolvedValueOnce(accessibleFiles)
                .mockRejectedValueOnce({
                    code: 'PERMISSION_DENIED',
                    message: 'Cannot read restricted',
                });

            const results = await scanner.scan(testRoot, {
                recursive: true,
                skipErrors: true,
            });

            // Should include accessible/, file.txt, restricted/ (but not restricted's contents)
            expect(results.length).toBeGreaterThanOrEqual(2);
            expect(results.some(f => f.name === 'file.txt')).toBe(true);
        });
    });

    describe('performance', () => {
        it('should handle large directories efficiently', async () => {
            // Mock 1000 files
            const mockFiles: FileNode[] = [];
            for (let i = 0; i < 1000; i++) {
                mockFiles.push({
                    path: path.join(testRoot, `file${i}.txt`),
                    name: `file${i}.txt`,
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                });
            }

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const startTime = performance.now();
            const results = await scanner.scan(testRoot);
            const endTime = performance.now();

            const scanTime = endTime - startTime;

            expect(results).toHaveLength(1000);
            expect(scanTime).toBeLessThan(1000); // <1 second for 1000 files
        });
    });

    describe('cancel support', () => {
        it('should support cancellation', async () => {
            const mockFiles: FileNode[] = [];
            for (let i = 0; i < 100; i++) {
                mockFiles.push({
                    path: path.join(testRoot, `file${i}.txt`),
                    name: `file${i}.txt`,
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                });
            }

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const abortController = new AbortController();

            // Abort immediately before scan
            abortController.abort();

            await expect(
                scanner.scan(testRoot, { signal: abortController.signal })
            ).rejects.toMatchObject({
                message: expect.stringContaining('abort'),
            });
        });
    });

    describe('utility methods', () => {
        it('should count files correctly', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'file1.txt'),
                    name: 'file1.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'folder'),
                    name: 'folder',
                    isDirectory: true,
                    size: 0,
                    modified: Date.now(),
                    extension: '',
                    mimeType: 'application/octet-stream',
                },
                {
                    path: path.join(testRoot, 'file2.txt'),
                    name: 'file2.txt',
                    isDirectory: false,
                    size: 200,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const count = await scanner.countFiles(testRoot);

            expect(count).toBe(2); // Only files, not directories
        });

        it('should calculate total size correctly', async () => {
            const mockFiles: FileNode[] = [
                {
                    path: path.join(testRoot, 'file1.txt'),
                    name: 'file1.txt',
                    isDirectory: false,
                    size: 100,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
                {
                    path: path.join(testRoot, 'file2.txt'),
                    name: 'file2.txt',
                    isDirectory: false,
                    size: 200,
                    modified: Date.now(),
                    extension: 'txt',
                    mimeType: 'text/plain',
                },
            ];

            mockFileSystemService.readDirectory.mockResolvedValue(mockFiles);

            const totalSize = await scanner.getTotalSize(testRoot);

            expect(totalSize).toBe(300);
        });
    });
});
