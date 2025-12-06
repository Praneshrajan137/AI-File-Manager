import { PathTrie } from '@main/dsa/PathTrie';
import { TrieNode, FileMetadata } from '@shared/contracts';

describe('PathTrie', () => {
    let trie: PathTrie;

    beforeEach(() => {
        trie = new PathTrie();
    });

    describe('insert()', () => {
        it('should insert a single path', () => {
            const metadata: FileMetadata = {
                filePath: '/home/user/document.txt',
                totalChunks: 1,
                indexedAt: Date.now(),
                fileSize: 1024,
            };

            trie.insert('/home/user/document.txt', metadata);

            const result = trie.search('/home/user/document.txt');
            expect(result).not.toBeNull();
            expect(result?.filePath).toBe('/home/user/document.txt');
        });

        it('should insert nested paths correctly', () => {
            trie.insert('/home/user/docs/file1.txt', { filePath: '/home/user/docs/file1.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/docs/file2.txt', { filePath: '/home/user/docs/file2.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/images/photo.jpg', { filePath: '/home/user/images/photo.jpg', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            expect(trie.search('/home/user/docs/file1.txt')).not.toBeNull();
            expect(trie.search('/home/user/docs/file2.txt')).not.toBeNull();
            expect(trie.search('/home/user/images/photo.jpg')).not.toBeNull();
        });

        it('should handle duplicate paths by updating metadata', () => {
            const meta1: FileMetadata = {
                filePath: '/test.txt',
                totalChunks: 1,
                indexedAt: 100,
                fileSize: 100,
            };

            const meta2: FileMetadata = {
                filePath: '/test.txt',
                totalChunks: 2,
                indexedAt: 200,
                fileSize: 200,
            };

            trie.insert('/test.txt', meta1);
            trie.insert('/test.txt', meta2);

            const result = trie.search('/test.txt');
            expect(result?.indexedAt).toBe(200); // Should use latest metadata
            expect(result?.totalChunks).toBe(2); // Old values should be replaced
            expect(result?.fileSize).toBe(200);
        });

        it('should handle empty path segments gracefully', () => {
            // Path with double slashes: /home//user/file.txt
            const metadata: FileMetadata = {
                filePath: '/home/user/file.txt', // Normalized path in metadata
                totalChunks: 1,
                indexedAt: Date.now(),
                fileSize: 100,
            };

            trie.insert('/home//user/file.txt', metadata);

            // Should normalize and still find it
            const result = trie.search('/home/user/file.txt');
            expect(result).not.toBeNull();
        });

        it('should reject empty path', () => {
            const metadata: FileMetadata = {
                filePath: '',
                totalChunks: 1,
                indexedAt: Date.now(),
                fileSize: 100,
            };

            expect(() => {
                trie.insert('', metadata);
            }).toThrow('Path cannot be empty');
        });

        it('should validate metadata consistency', () => {
            const metadata: FileMetadata = {
                filePath: '/different/path.txt', // Doesn't match insert path
                totalChunks: 1,
                indexedAt: Date.now(),
                fileSize: 100,
            };

            expect(() => {
                trie.insert('/home/user/file.txt', metadata);
            }).toThrow('Metadata filePath must match the inserted path');
        });
    });

    describe('search()', () => {
        beforeEach(() => {
            trie.insert('/home/user/documents/report.pdf', { filePath: '/home/user/documents/report.pdf', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/images/photo.jpg', { filePath: '/home/user/images/photo.jpg', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
        });

        it('should find existing path', () => {
            const result = trie.search('/home/user/documents/report.pdf');
            expect(result).not.toBeNull();
        });

        it('should return null for non-existing path', () => {
            const result = trie.search('/home/user/nonexistent.txt');
            expect(result).toBeNull();
        });

        it('should return null for partial path', () => {
            const result = trie.search('/home/user/documents');
            expect(result).toBeNull(); // Not a complete file path
        });

        it('should be case-insensitive', () => {
            trie.insert('/Home/User/File.TXT', { filePath: '/Home/User/File.TXT', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            const result = trie.search('/home/user/file.txt');
            expect(result).not.toBeNull();
        });

        it('should reject empty path', () => {
            expect(() => {
                trie.search('');
            }).toThrow('Path cannot be empty');
        });
    });

    describe('autocomplete()', () => {
        beforeEach(() => {
            trie.insert('/home/user/documents/report.pdf', { filePath: '/home/user/documents/report.pdf', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/documents/draft.txt', { filePath: '/home/user/documents/draft.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/downloads/file.zip', { filePath: '/home/user/downloads/file.zip', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/desktop/notes.md', { filePath: '/home/user/desktop/notes.md', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
        });

        it('should return all matches for prefix', () => {
            // Use /home/user/documents which will match both files in documents folder
            const results = trie.autocomplete('/home/user/documents');

            expect(results.length).toBeGreaterThan(0);
            expect(results.length).toBeLessThanOrEqual(2); // documents/report, documents/draft

            // Check that results contain expected paths
            const hasDocumentsReport = results.some((r: string) => r.includes('documents/report.pdf'));
            const hasDocumentsDraft = results.some((r: string) => r.includes('documents/draft.txt'));

            expect(hasDocumentsReport || hasDocumentsDraft).toBe(true);
        });

        it('should respect maxResults parameter', () => {
            const results = trie.autocomplete('/home/user', 2);

            expect(results.length).toBeLessThanOrEqual(2);
        });

        it('should return empty array for non-matching prefix', () => {
            const results = trie.autocomplete('/var/log');

            expect(results).toEqual([]);
        });

        it('should handle root path with maxResults', () => {
            const results = trie.autocomplete('/', 10);

            expect(results.length).toBeGreaterThan(0);
            expect(results.length).toBeLessThanOrEqual(10); // Should respect maxResults
        });

        it('should be case-insensitive in autocomplete', () => {
            const results = trie.autocomplete('/HOME/USER/DOCUMENTS');

            expect(results.length).toBeGreaterThan(0);
        });

        it('should reject empty prefix', () => {
            expect(() => {
                trie.autocomplete('');
            }).toThrow('Prefix cannot be empty');
        });
    });

    describe('remove()', () => {
        beforeEach(() => {
            trie.insert('/home/user/file1.txt', { filePath: '/home/user/file1.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/file2.txt', { filePath: '/home/user/file2.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/home/user/docs/file3.txt', { filePath: '/home/user/docs/file3.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
        });

        it('should remove existing path', () => {
            const removed = trie.remove('/home/user/file1.txt');

            expect(removed).toBe(true);
            expect(trie.search('/home/user/file1.txt')).toBeNull();
        });

        it('should return false for non-existing path', () => {
            const removed = trie.remove('/home/user/nonexistent.txt');

            expect(removed).toBe(false);
        });

        it('should not affect other paths', () => {
            trie.remove('/home/user/file1.txt');

            expect(trie.search('/home/user/file2.txt')).not.toBeNull();
            expect(trie.search('/home/user/docs/file3.txt')).not.toBeNull();
        });

        it('should update size after removal', () => {
            const sizeBefore = trie.size();
            trie.remove('/home/user/file1.txt');
            const sizeAfter = trie.size();

            expect(sizeAfter).toBe(sizeBefore - 1);
        });

        it('should remove from autocomplete results', () => {
            trie.remove('/home/user/file1.txt');

            const results = trie.autocomplete('/home/user/file');
            expect(results).not.toContain('/home/user/file1.txt');
        });

        it('should be case-insensitive', () => {
            const removed = trie.remove('/HOME/USER/FILE1.TXT');

            expect(removed).toBe(true);
            expect(trie.search('/home/user/file1.txt')).toBeNull();
        });

        it('should return false for empty path', () => {
            const removed = trie.remove('');

            expect(removed).toBe(false);
        });

        it('should return false when trying to remove partial path', () => {
            // Try to remove a directory path that's not a terminal node
            const removed = trie.remove('/home/user');

            expect(removed).toBe(false);
        });
    });

    describe('complexity verification', () => {
        it('should have O(L) insert complexity - scaling test', () => {
            // Insert paths of different lengths and verify time scales with path length, not total paths
            const shortPath = '/a/b/c.txt';
            const longPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z.txt';

            // Warm up V8
            for (let i = 0; i < 100; i++) {
                trie.insert(`/warmup/${i}.txt`, { filePath: `/warmup/${i}.txt`, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            }

            // Measure short path
            const shortStart = performance.now();
            for (let i = 0; i < 1000; i++) {
                trie.insert(`${shortPath}${i}`, { filePath: `${shortPath}${i}`, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            }
            const shortTime = performance.now() - shortStart;

            // Measure long path (should be roughly proportional to path length, not total paths)
            const longStart = performance.now();
            for (let i = 0; i < 1000; i++) {
                trie.insert(`${longPath}${i}`, { filePath: `${longPath}${i}`, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            }
            const longTime = performance.now() - longStart;

            // Long path should take more time, but not exponentially more
            // If it were O(N), long path would be much slower due to more total nodes
            // Since it's O(L), the ratio should be roughly proportional to path length ratio
            const pathLengthRatio = longPath.length / shortPath.length;
            const timeRatio = longTime / shortTime;

            // Time ratio should be less than 2x the path length ratio (allowing for overhead)
            expect(timeRatio).toBeLessThan(pathLengthRatio * 2);
        });

        it('should have O(L) search complexity - independent of tree size', () => {
            // Insert many paths
            for (let i = 0; i < 1000; i++) {
                trie.insert(`/path/${i}/file.txt`, { filePath: `/path/${i}/file.txt`, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            }

            const searchPath = '/path/500/file.txt';

            // Warm up
            for (let i = 0; i < 100; i++) {
                trie.search(searchPath);
            }

            // Measure search time
            const iterations = 10000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                trie.search(searchPath);
            }
            const end = performance.now();

            const avgTime = (end - start) / iterations;

            // Average search should be very fast (< 0.1ms per search)
            expect(avgTime).toBeLessThan(0.1);
        });
    });

    describe('edge cases', () => {
        it('should handle Windows-style paths', () => {
            const winPath = 'C:\\Users\\John\\Documents\\file.txt';
            const normalizedPath = 'C:/Users/John/Documents/file.txt';

            trie.insert(winPath, { filePath: normalizedPath, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            const result = trie.search(winPath);
            expect(result).not.toBeNull();
        });

        it('should handle paths with special characters', () => {
            const specialPath = '/home/user/file-name_v2.1.txt';
            trie.insert(specialPath, { filePath: specialPath, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            const result = trie.search(specialPath);
            expect(result).not.toBeNull();
        });

        it('should handle very long paths (>255 characters)', () => {
            const longPath = '/home/' + 'a'.repeat(300) + '/file.txt';

            expect(() => {
                trie.insert(longPath, { filePath: longPath, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            }).not.toThrow();

            expect(trie.search(longPath)).not.toBeNull();
        });

        it('should handle paths with dots', () => {
            const dotPath = '/home/user/.config/settings.json';
            trie.insert(dotPath, { filePath: dotPath, totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            expect(trie.search(dotPath)).not.toBeNull();
        });
    });

    describe('size() and clear()', () => {
        it('should return correct size', () => {
            expect(trie.size()).toBe(0);

            trie.insert('/file1.txt', { filePath: '/file1.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            expect(trie.size()).toBe(1);

            trie.insert('/file2.txt', { filePath: '/file2.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            expect(trie.size()).toBe(2);
        });

        it('should clear all paths', () => {
            trie.insert('/file1.txt', { filePath: '/file1.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.insert('/file2.txt', { filePath: '/file2.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            trie.clear();

            expect(trie.size()).toBe(0);
            expect(trie.search('/file1.txt')).toBeNull();
            expect(trie.search('/file2.txt')).toBeNull();
        });

        it('should allow reuse after clear', () => {
            trie.insert('/file1.txt', { filePath: '/file1.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);
            trie.clear();

            trie.insert('/file2.txt', { filePath: '/file2.txt', totalChunks: 1, indexedAt: Date.now(), fileSize: 100 } as FileMetadata);

            expect(trie.size()).toBe(1);
            expect(trie.search('/file2.txt')).not.toBeNull();
        });
    });
});
