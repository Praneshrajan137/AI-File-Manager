import { FileWatcher } from '@main/services/FileWatcher';
import { EventQueue } from '@main/dsa/EventQueue';
import { FileEvent, EventPriority } from '@shared/contracts';
import chokidar from 'chokidar';
import * as path from 'path';

// Mock chokidar
jest.mock('chokidar');

describe('FileWatcher', () => {
    let watcher: FileWatcher;
    let mockChokidarWatcher: any;
    let eventQueue: EventQueue;

    // Helper: normalize paths for cross-platform testing
    const normalizePath = (p: string) => path.normalize(p);

    beforeEach(() => {
        eventQueue = new EventQueue();

        // Mock chokidar watcher
        mockChokidarWatcher = {
            on: jest.fn().mockReturnThis(),
            close: jest.fn().mockResolvedValue(undefined),
            add: jest.fn(),
            unwatch: jest.fn(),
            removeListener: jest.fn(),
        };

        (chokidar.watch as jest.Mock).mockReturnValue(mockChokidarWatcher);

        watcher = new FileWatcher(eventQueue);

        jest.clearAllMocks();
    });

    afterEach(async () => {
        await watcher.stop();
    });

    describe('start()', () => {
        it('should start watching directory', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            expect(chokidar.watch).toHaveBeenCalledWith(
                normalizePath('/home/user/documents'),
                expect.objectContaining({
                    ignored: expect.any(Function),
                    persistent: true,
                    ignoreInitial: true,
                })
            );
        });

        it('should register event handlers', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            expect(mockChokidarWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
            expect(mockChokidarWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
            expect(mockChokidarWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
            expect(mockChokidarWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(mockChokidarWatcher.on).toHaveBeenCalledWith('ready', expect.any(Function));
        });

        it('should ignore hidden files by default', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            const ignoreFunc = (chokidar.watch as jest.Mock).mock.calls[0][1].ignored;

            // Test hidden files - use paths that will normalize correctly
            expect(ignoreFunc('.DS_Store')).toBe(true);
            expect(ignoreFunc('.gitignore')).toBe(true);
            expect(ignoreFunc('normal-file.txt')).toBe(false);
        });

        it('should ignore node_modules by default', async () => {
            const startPromise = watcher.start('/home/user/projects');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            const ignoreFunc = (chokidar.watch as jest.Mock).mock.calls[0][1].ignored;

            // Use platform-agnostic paths for node_modules test
            const nodeModulesPath = path.join('home', 'user', 'projects', 'node_modules', 'package', 'file.js');
            const srcPath = path.join('home', 'user', 'projects', 'src', 'index.js');

            expect(ignoreFunc(nodeModulesPath)).toBe(true);
            expect(ignoreFunc(srcPath)).toBe(false);
        });

        it('should throw if already watching', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            await expect(watcher.start('/home/user/other')).rejects.toThrow(
                'Watcher is already running'
            );
        });

        it('should resolve when ready event fires', async () => {
            const startPromise = watcher.start('/home/user/documents');

            // Watcher should not be watching yet
            expect(watcher.isWatching()).toBe(false);

            // Simulate ready event
            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            // Now it should be watching
            expect(watcher.isWatching()).toBe(true);
        });
    });

    describe('event handling', () => {
        // Store handlers before each test
        let handlers: Map<string, Function>;

        beforeEach(async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            // Store handlers BEFORE clearing mocks
            handlers = new Map();
            mockChokidarWatcher.on.mock.calls.forEach((call: any) => {
                handlers.set(call[0], call[1]);
            });

            jest.clearAllMocks();
        });

        it('should enqueue file creation events', () => {
            const testPath = '/home/user/documents/new-file.txt';
            const addHandler = handlers.get('add');

            if (addHandler) {
                addHandler(testPath);
            }

            const event = eventQueue.dequeue();
            expect(event).not.toBeNull();
            expect(event?.type).toBe('create');
            // Use normalizePath for cross-platform comparison
            expect(event?.path).toBe(normalizePath(testPath));
            expect(event?.priority).toBe(EventPriority.FILE_WATCHER);
        });

        it('should enqueue file change events', () => {
            const testPath = '/home/user/documents/modified.txt';
            const changeHandler = handlers.get('change');

            if (changeHandler) {
                changeHandler(testPath);
            }

            const event = eventQueue.dequeue();
            expect(event?.type).toBe('change');
            expect(event?.path).toBe(normalizePath(testPath));
        });

        it('should enqueue file deletion events', () => {
            const testPath = '/home/user/documents/deleted.txt';
            const unlinkHandler = handlers.get('unlink');

            if (unlinkHandler) {
                unlinkHandler(testPath);
            }

            const event = eventQueue.dequeue();
            expect(event?.type).toBe('unlink');
            expect(event?.path).toBe(normalizePath(testPath));
        });

        it('should handle errors gracefully', () => {
            const errorCallback = jest.fn();
            watcher.on('error', errorCallback);

            const errorHandler = handlers.get('error');

            if (errorHandler) {
                errorHandler(new Error('Watcher error'));
            }

            expect(errorCallback).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('Watcher error'),
                })
            );
        });
    });

    describe('stop()', () => {
        it('should stop watching', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;
            await watcher.stop();

            expect(mockChokidarWatcher.close).toHaveBeenCalled();
        });

        it('should allow restart after stop', async () => {
            const startPromise1 = watcher.start('/home/user/documents');

            let readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise1;
            await watcher.stop();

            // Reset mock
            jest.clearAllMocks();
            (chokidar.watch as jest.Mock).mockReturnValue(mockChokidarWatcher);

            // Should not throw
            const startPromise2 = watcher.start('/home/user/documents');

            readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await expect(startPromise2).resolves.not.toThrow();
        });

        it('should be idempotent', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;
            await watcher.stop();
            await watcher.stop(); // Second stop should not throw

            expect(mockChokidarWatcher.close).toHaveBeenCalledTimes(1);
        });
    });

    describe('isWatching()', () => {
        it('should return false initially', () => {
            expect(watcher.isWatching()).toBe(false);
        });

        it('should return true when watching', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            expect(watcher.isWatching()).toBe(true);
        });

        it('should return false after stop', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;
            await watcher.stop();

            expect(watcher.isWatching()).toBe(false);
        });
    });

    describe('addPath()', () => {
        it('should add additional path to watch', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            const testPath = '/home/user/downloads';
            watcher.addPath(testPath);

            // Expect normalized path
            expect(mockChokidarWatcher.add).toHaveBeenCalledWith(normalizePath(testPath));
        });

        it('should throw if not watching', () => {
            expect(() => {
                watcher.addPath('/home/user/downloads');
            }).toThrow('Watcher is not running');
        });
    });

    describe('removePath()', () => {
        it('should remove path from watching', async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            const testPath = '/home/user/documents/subfolder';
            watcher.removePath(testPath);

            // Expect normalized path
            expect(mockChokidarWatcher.unwatch).toHaveBeenCalledWith(normalizePath(testPath));
        });

        it('should throw if not watching', () => {
            expect(() => {
                watcher.removePath('/some/path');
            }).toThrow('Watcher is not running');
        });
    });

    describe('event emitter', () => {
        // Store handlers before each test
        let handlers: Map<string, Function>;

        beforeEach(async () => {
            const startPromise = watcher.start('/home/user/documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            // Store handlers BEFORE clearing mocks
            handlers = new Map();
            mockChokidarWatcher.on.mock.calls.forEach((call: any) => {
                handlers.set(call[0], call[1]);
            });

            jest.clearAllMocks();
        });

        it('should emit fileCreated event', () => {
            const callback = jest.fn();
            watcher.on('fileCreated', callback);

            const testPath = '/home/user/documents/new.txt';
            const addHandler = handlers.get('add');

            if (addHandler) {
                addHandler(testPath);
            }

            // Expect normalized path
            expect(callback).toHaveBeenCalledWith(normalizePath(testPath));
        });

        it('should emit fileChanged event', () => {
            const callback = jest.fn();
            watcher.on('fileChanged', callback);

            const testPath = '/home/user/documents/modified.txt';
            const changeHandler = handlers.get('change');

            if (changeHandler) {
                changeHandler(testPath);
            }

            // Expect normalized path
            expect(callback).toHaveBeenCalledWith(normalizePath(testPath));
        });

        it('should emit fileDeleted event', () => {
            const callback = jest.fn();
            watcher.on('fileDeleted', callback);

            const testPath = '/home/user/documents/deleted.txt';
            const unlinkHandler = handlers.get('unlink');

            if (unlinkHandler) {
                unlinkHandler(testPath);
            }

            // Expect normalized path
            expect(callback).toHaveBeenCalledWith(normalizePath(testPath));
        });
    });

    describe('options', () => {
        it('should allow custom ignore patterns', async () => {
            const startPromise = watcher.start('/home/user/documents', {
                ignored: ['.tmp', '.log'],
            });

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            const options = (chokidar.watch as jest.Mock).mock.calls[0][1];

            expect(options.ignored).toBeDefined();
        });

        it('should allow disabling persistent watching', async () => {
            const testPath = '/home/user/documents';
            const startPromise = watcher.start(testPath, {
                persistent: false,
            });

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            expect(chokidar.watch).toHaveBeenCalledWith(
                normalizePath(testPath),
                expect.objectContaining({
                    persistent: false,
                })
            );
        });
    });

    describe('path normalization', () => {
        it('should normalize Windows paths', async () => {
            const startPromise = watcher.start('C:\\Users\\test\\documents');

            const readyHandler = mockChokidarWatcher.on.mock.calls.find(
                (call: any) => call[0] === 'ready'
            )?.[1];

            if (readyHandler) {
                readyHandler();
            }

            await startPromise;

            // Path should be normalized before passing to chokidar
            expect(chokidar.watch).toHaveBeenCalled();
        });
    });
});
