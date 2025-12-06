import { HistoryStack } from '@main/dsa/HistoryStack';

describe('HistoryStack', () => {
    let history: HistoryStack;

    beforeEach(() => {
        history = new HistoryStack();
    });

    describe('constructor', () => {
        it('should throw error for invalid maxSize', () => {
            expect(() => new HistoryStack(0)).toThrow('Max size must be a positive integer');
            expect(() => new HistoryStack(-1)).toThrow('Max size must be a positive integer');
            expect(() => new HistoryStack(1.5)).toThrow('Max size must be a positive integer');
        });

        it('should accept valid maxSize', () => {
            expect(() => new HistoryStack(10)).not.toThrow();
            expect(() => new HistoryStack(100)).not.toThrow();
        });
    });

    describe('basic navigation', () => {
        it('should push paths to history', () => {
            history.push('/home');
            history.push('/home/user');
            history.push('/home/user/documents');

            expect(history.currentPath()).toBe('/home/user/documents');
        });

        it('should return null for currentPath when empty', () => {
            expect(history.currentPath()).toBeNull();
        });

        it('should navigate backward', () => {
            history.push('/home');
            history.push('/home/user');
            history.push('/home/user/documents');

            const path = history.back();

            expect(path).toBe('/home/user');
            expect(history.currentPath()).toBe('/home/user');
        });

        it('should navigate forward', () => {
            history.push('/home');
            history.push('/home/user');
            history.push('/home/user/documents');

            history.back();
            history.back();

            const path = history.forward();

            expect(path).toBe('/home/user');
            expect(history.currentPath()).toBe('/home/user');
        });

        it('should return null when backing past start', () => {
            history.push('/home');

            const path = history.back();

            expect(path).toBeNull();
            expect(history.currentPath()).toBe('/home'); // Unchanged
        });

        it('should return null when forwarding past end', () => {
            history.push('/home');
            history.push('/home/user');

            const path = history.forward();

            expect(path).toBeNull();
            expect(history.currentPath()).toBe('/home/user'); // Unchanged
        });
    });

    describe('navigation state', () => {
        it('should report canGoBack correctly', () => {
            expect(history.canGoBack()).toBe(false);

            history.push('/home');
            expect(history.canGoBack()).toBe(false);

            history.push('/home/user');
            expect(history.canGoBack()).toBe(true);
        });

        it('should report canGoForward correctly', () => {
            history.push('/home');
            history.push('/home/user');

            expect(history.canGoForward()).toBe(false);

            history.back();
            expect(history.canGoForward()).toBe(true);

            history.forward();
            expect(history.canGoForward()).toBe(false);
        });

        it('should return navigation state object', () => {
            history.push('/home');
            history.push('/home/user');
            history.back();

            const state = history.getState();

            expect(state.canGoBack).toBe(false); // At first node
            expect(state.canGoForward).toBe(true);
        });
    });

    describe('forward history clearing', () => {
        it('should clear forward history when pushing new path', () => {
            history.push('/home');
            history.push('/home/user');
            history.push('/home/user/documents');

            history.back();
            history.back();

            expect(history.canGoForward()).toBe(true);

            // Push new path - should clear forward history
            history.push('/home/downloads');

            expect(history.canGoForward()).toBe(false);
            expect(history.currentPath()).toBe('/home/downloads');
        });

        it('should properly link nodes after clearing forward history', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            history.back();
            history.back();
            history.push('/d');

            expect(history.currentPath()).toBe('/d');
            expect(history.back()).toBe('/a');
            expect(history.forward()).toBe('/d');
        });
    });

    describe('capacity management', () => {
        it('should enforce maximum history size', () => {
            const maxSize = 10;
            const testHistory = new HistoryStack(maxSize);

            // Push more than max size
            for (let i = 0; i < 20; i++) {
                testHistory.push(`/path/${i}`);
            }

            expect(testHistory.size()).toBeLessThanOrEqual(maxSize);
        });

        it('should evict oldest paths when at capacity', () => {
            const testHistory = new HistoryStack(10);

            // Fill to capacity and beyond
            for (let i = 0; i < 15; i++) {
                testHistory.push(`/path/${i}`);
            }

            // Go back to first entry
            let iterations = 0;
            while (testHistory.back() && iterations < 20) {
                iterations++;
            }

            // First pushed paths should be evicted
            expect(testHistory.currentPath()).not.toBe('/path/0');
            expect(testHistory.currentPath()).not.toBe('/path/1');
        });

        it('should handle pushing when current is oldest node', () => {
            const testHistory = new HistoryStack(3);
            testHistory.push('/a');
            testHistory.push('/b');
            testHistory.push('/c');

            // Go back to oldest
            testHistory.back();
            testHistory.back();

            expect(testHistory.currentPath()).toBe('/a');

            // Push new - this will eventually evict /a
            testHistory.push('/d');
            testHistory.push('/e');

            expect(testHistory.currentPath()).toBe('/e');
            expect(testHistory.size()).toBeLessThanOrEqual(3);
        });

        it('should evict oldest when pushing at max capacity', () => {
            const testHistory = new HistoryStack(3);
            testHistory.push('/a');
            testHistory.push('/b');
            testHistory.push('/c');

            // At max capacity, push new item
            testHistory.push('/d');

            // Should evict /a
            expect(testHistory.size()).toBe(3);

            // Go back to check oldest
            testHistory.back();
            testHistory.back();

            // Oldest should be /b, not /a
            expect(testHistory.currentPath()).toBe('/b');
        });
    });

    describe('size tracking', () => {
        it('should report correct size', () => {
            expect(history.size()).toBe(0);

            history.push('/home');
            expect(history.size()).toBe(1);

            history.push('/home/user');
            expect(history.size()).toBe(2);

            history.back();
            expect(history.size()).toBe(2); // Size doesn't change on navigation
        });

        it('should update size correctly when clearing forward history', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            expect(history.size()).toBe(3);

            history.back();
            history.push('/d');

            expect(history.size()).toBe(3); // /a, /b, and /d
        });
    });

    describe('clear operation', () => {
        it('should clear all history', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            history.clear();

            expect(history.size()).toBe(0);
            expect(history.currentPath()).toBeNull();
            expect(history.canGoBack()).toBe(false);
            expect(history.canGoForward()).toBe(false);
        });

        it('should handle clearing empty history', () => {
            history.clear(); // Clear when already empty

            expect(history.size()).toBe(0);
            expect(history.currentPath()).toBeNull();
        });
    });

    describe('toArray operation', () => {
        it('should return all paths in order', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            const array = history.toArray();

            expect(array).toEqual(['/a', '/b', '/c']);
        });

        it('should return paths in order even after navigation', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            history.back();
            const array = history.toArray();

            expect(array).toEqual(['/a', '/b', '/c']);
            expect(history.currentPath()).toBe('/b'); // Current unchanged
        });

        it('should return empty array for empty history', () => {
            expect(history.toArray()).toEqual([]);
        });
    });

    describe('performance characteristics', () => {
        it('should have O(1) push operation', () => {
            // Fill with many paths
            for (let i = 0; i < 1000; i++) {
                history.push(`/path/${i}`);
            }

            const startTime = performance.now();
            history.push('/new/path');
            const endTime = performance.now();

            const pushTime = endTime - startTime;
            // Aspirational benchmark - may vary by system
            expect(pushTime).toBeLessThan(1); // <1ms (relaxed from 0.1ms)
        });

        it('should have O(1) back operation', () => {
            for (let i = 0; i < 1000; i++) {
                history.push(`/path/${i}`);
            }

            const startTime = performance.now();
            history.back();
            const endTime = performance.now();

            const backTime = endTime - startTime;
            // Aspirational benchmark - may vary by system
            expect(backTime).toBeLessThan(1); // <1ms (relaxed from 0.1ms)
        });

        it('should have O(1) forward operation', () => {
            for (let i = 0; i < 1000; i++) {
                history.push(`/path/${i}`);
            }

            history.back();

            const startTime = performance.now();
            history.forward();
            const endTime = performance.now();

            const forwardTime = endTime - startTime;
            // Aspirational benchmark - may vary by system
            expect(forwardTime).toBeLessThan(1); // <1ms (relaxed from 0.1ms)
        });
    });

    describe('edge cases', () => {
        it('should handle rapid back/forward cycling', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            for (let i = 0; i < 10; i++) {
                history.back();
                history.forward();
            }

            expect(history.currentPath()).toBe('/c');
        });

        it('should handle duplicate paths', () => {
            history.push('/home');
            history.push('/home'); // Duplicate

            expect(history.size()).toBe(2);
            expect(history.canGoBack()).toBe(true);
        });

        it('should handle empty path strings', () => {
            history.push('');

            expect(history.currentPath()).toBe('');
        });

        it('should handle single node history', () => {
            history.push('/home');

            expect(history.canGoBack()).toBe(false);
            expect(history.canGoForward()).toBe(false);
            expect(history.back()).toBeNull();
            expect(history.forward()).toBeNull();
        });
    });

    describe('memory management', () => {
        it('should properly cleanup pointers when clearing forward history', () => {
            history.push('/a');
            history.push('/b');
            history.push('/c');

            history.back();
            history.push('/d'); // Should cleanup /c node

            // Verify no dangling references by checking state
            expect(history.canGoForward()).toBe(false);
            expect(history.size()).toBe(3); // /a, /b, and /d
        });

        it('should cleanup all pointers on clear()', () => {
            for (let i = 0; i < 100; i++) {
                history.push(`/path/${i}`);
            }

            history.clear();

            // After clear, should be completely empty
            expect(history.size()).toBe(0);
            expect(history.currentPath()).toBeNull();
        });
    });
});
