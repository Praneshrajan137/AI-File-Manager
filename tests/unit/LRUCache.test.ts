import { LRUCache } from '@main/dsa/LRUCache';

describe('LRUCache', () => {
    describe('basic operations', () => {
        let cache: LRUCache<string>;

        beforeEach(() => {
            cache = new LRUCache<string>(3); // Capacity of 3
        });

        it('should store and retrieve values', () => {
            cache.put('key1', 'value1');

            expect(cache.get('key1')).toBe('value1');
        });

        it('should return null for non-existent keys', () => {
            expect(cache.get('nonexistent')).toBeNull();
        });

        it('should update existing keys', () => {
            cache.put('key1', 'value1');
            cache.put('key1', 'value2');

            expect(cache.get('key1')).toBe('value2');
            expect(cache.size()).toBe(1);
        });

        it('should throw error for empty key in put', () => {
            expect(() => {
                cache.put('', 'value');
            }).toThrow('Cache key cannot be empty');
        });

        it('should throw error for empty key in get', () => {
            expect(() => {
                cache.get('');
            }).toThrow('Cache key cannot be empty');
        });

        it('should allow null and undefined as values', () => {
            cache.put('null-key', null as any);
            cache.put('undefined-key', undefined as any);

            expect(cache.get('null-key')).toBeNull();
            expect(cache.get('undefined-key')).toBeUndefined();
        });
    });

    describe('LRU eviction', () => {
        let cache: LRUCache<number>;

        beforeEach(() => {
            cache = new LRUCache<number>(3);
        });

        it('should evict least recently used item when capacity exceeded', () => {
            cache.put('a', 1);
            cache.put('b', 2);
            cache.put('c', 3);

            // Cache is full: [c, b, a] (c is most recent)

            cache.put('d', 4); // Should evict 'a' (least recent)

            expect(cache.get('a')).toBeNull();
            expect(cache.get('b')).toBe(2);
            expect(cache.get('c')).toBe(3);
            expect(cache.get('d')).toBe(4);
        });

        it('should update recency on get', () => {
            cache.put('a', 1);
            cache.put('b', 2);
            cache.put('c', 3);

            // Access 'a' to make it most recent
            cache.get('a');

            // Cache state: [a, c, b] (a is most recent)

            cache.put('d', 4); // Should evict 'b' (least recent)

            expect(cache.get('b')).toBeNull();
            expect(cache.get('a')).toBe(1);
            expect(cache.get('c')).toBe(3);
            expect(cache.get('d')).toBe(4);
        });

        it('should update recency on put (existing key)', () => {
            cache.put('a', 1);
            cache.put('b', 2);
            cache.put('c', 3);

            // Update 'a' to make it most recent
            cache.put('a', 10);

            // Cache state: [a, c, b] (a is most recent)

            cache.put('d', 4); // Should evict 'b' (least recent)

            expect(cache.get('b')).toBeNull();
            expect(cache.get('a')).toBe(10);
        });
    });

    describe('edge cases', () => {
        it('should handle capacity of 1', () => {
            const cache = new LRUCache<string>(1);

            cache.put('a', 'A');
            expect(cache.get('a')).toBe('A');

            cache.put('b', 'B'); // Should evict 'a'
            expect(cache.get('a')).toBeNull();
            expect(cache.get('b')).toBe('B');
        });

        it('should throw error for invalid capacity', () => {
            expect(() => new LRUCache<string>(0)).toThrow('Cache capacity must be at least 1');
            expect(() => new LRUCache<string>(-1)).toThrow('Cache capacity must be at least 1');
        });

        it('should handle many insertions', () => {
            const cache = new LRUCache<number>(100);

            for (let i = 0; i < 1000; i++) {
                cache.put(`key${i}`, i);
            }

            expect(cache.size()).toBe(100);

            // First 900 should be evicted
            expect(cache.get('key0')).toBeNull();
            expect(cache.get('key899')).toBeNull();

            // Last 100 should exist
            expect(cache.get('key900')).toBe(900);
            expect(cache.get('key999')).toBe(999);
        });

        it('should handle clear operation', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            cache.clear();

            expect(cache.size()).toBe(0);
            expect(cache.get('a')).toBeNull();
            expect(cache.get('b')).toBeNull();
            expect(cache.get('c')).toBeNull();
        });

        it('should handle has() method', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');

            expect(cache.has('a')).toBe(true);
            expect(cache.has('b')).toBe(false);
        });

        it('should not update recency on has()', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            // Check 'a' without updating recency
            expect(cache.has('a')).toBe(true);

            // Cache state should still be: [c, b, a] (a is least recent)

            cache.put('d', 'D'); // Should evict 'a' (least recent)

            expect(cache.get('a')).toBeNull();
            expect(cache.get('b')).toBe('B');
            expect(cache.get('c')).toBe('C');
            expect(cache.get('d')).toBe('D');
        });

        it('should handle delete() method', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');

            const deleted = cache.delete('a');

            expect(deleted).toBe(true);
            expect(cache.get('a')).toBeNull();
            expect(cache.size()).toBe(1);
        });

        it('should return false when deleting non-existent key', () => {
            const cache = new LRUCache<string>(3);

            const deleted = cache.delete('nonexistent');

            expect(deleted).toBe(false);
        });

        it('should handle deleting head node', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            // 'c' is the head (most recent)
            cache.delete('c');

            expect(cache.get('c')).toBeNull();
            expect(cache.get('a')).toBe('A');
            expect(cache.get('b')).toBe('B');
            expect(cache.size()).toBe(2);
        });

        it('should handle deleting tail node', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            // 'a' is the tail (least recent)
            cache.delete('a');

            expect(cache.get('a')).toBeNull();
            expect(cache.get('b')).toBe('B');
            expect(cache.get('c')).toBe('C');
            expect(cache.size()).toBe(2);
        });

        it('should handle deleting middle node', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            // 'b' is in the middle
            cache.delete('b');

            expect(cache.get('b')).toBeNull();
            expect(cache.get('a')).toBe('A');
            expect(cache.get('c')).toBe('C');
            expect(cache.size()).toBe(2);
        });

        it('should handle deleting from single-item cache', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.delete('a');

            expect(cache.get('a')).toBeNull();
            expect(cache.size()).toBe(0);
        });
    });

    describe('performance characteristics', () => {
        it('should have O(1) get operation - scaling test', () => {
            const cache = new LRUCache<number>(1000);

            // Fill cache
            for (let i = 0; i < 1000; i++) {
                cache.put(`key${i}`, i);
            }

            // Measure get time with small cache
            const iterations = 10000;
            const start1 = performance.now();
            for (let i = 0; i < iterations; i++) {
                cache.get('key500');
            }
            const time1 = performance.now() - start1;

            // Create larger cache
            const largeCache = new LRUCache<number>(10000);
            for (let i = 0; i < 10000; i++) {
                largeCache.put(`key${i}`, i);
            }

            // Measure get time with large cache
            const start2 = performance.now();
            for (let i = 0; i < iterations; i++) {
                largeCache.get('key5000');
            }
            const time2 = performance.now() - start2;

            // Time should be similar regardless of cache size (O(1))
            // Allow 3x variance for system noise (JIT, GC, system load)
            // Note: This is a performance characteristic test, not an exact timing test
            expect(time2).toBeLessThan(time1 * 3);
        });

        it('should have O(1) put operation - scaling test', () => {
            const cache = new LRUCache<number>(1000);

            // Fill cache to near capacity
            for (let i = 0; i < 999; i++) {
                cache.put(`key${i}`, i);
            }

            // Measure put time
            const iterations = 1000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                cache.put(`newKey${i}`, i);
            }
            const avgTime = (performance.now() - start) / iterations;

            // Average put should be very fast
            expect(avgTime).toBeLessThan(0.1);
        });
    });

    describe('keys() method', () => {
        it('should return keys in MRU to LRU order', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            const keys = cache.keys();

            // Most recent first
            expect(keys).toEqual(['c', 'b', 'a']);
        });

        it('should update order after get', () => {
            const cache = new LRUCache<string>(3);

            cache.put('a', 'A');
            cache.put('b', 'B');
            cache.put('c', 'C');

            cache.get('a'); // Make 'a' most recent

            const keys = cache.keys();

            expect(keys).toEqual(['a', 'c', 'b']);
        });

        it('should return empty array for empty cache', () => {
            const cache = new LRUCache<string>(3);

            expect(cache.keys()).toEqual([]);
        });
    });

    describe('memory management', () => {
        it('should properly clear all references', () => {
            const cache = new LRUCache<string>(10);

            // Add items
            for (let i = 0; i < 10; i++) {
                cache.put(`key${i}`, `value${i}`);
            }

            expect(cache.size()).toBe(10);

            cache.clear();

            expect(cache.size()).toBe(0);
            expect(cache.keys()).toEqual([]);

            // Should be able to add items after clear
            cache.put('new', 'value');
            expect(cache.get('new')).toBe('value');
        });
    });
});
