/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

import { CacheNode } from '@shared/contracts';

interface SizedCacheNode<T> extends CacheNode<T> {
    byteSize: number;
    prev: SizedCacheNode<T> | null;
    next: SizedCacheNode<T> | null;
}

export interface LRUCacheOptions<T> {
    maxBytes?: number;
    sizeOf?: (value: T) => number;
}

export interface LRUCacheStats {
    size: number;
    capacity: number;
    bytes: number;
    maxBytes: number;
    hits: number;
    misses: number;
    evictions: number;
    invalidations: number;
    hitRate: number;
}

/**
 * LRU (Least Recently Used) Cache with O(1) operations.
 * 
 * Implements the caching strategy used in OS page replacement algorithms.
 * When cache is full, evicts the least recently used item.
 * 
 * Implementation combines:
 * - HashMap: O(1) key lookup
 * - Doubly Linked List: O(1) move-to-front and eviction
 * 
 * Visual representation:
 * 
 *   HEAD (most recent) ← new items added here
 *      ↓
 *   [Node C] ←→ [Node A] ←→ [Node B]
 *                                ↓
 *                         TAIL (least recent) ← eviction happens here
 * 
 * HashMap: { 'A' → Node A, 'B' → Node B, 'C' → Node C }
 * 
 * Complexity:
 * - get(): O(1)
 * - put(): O(1)
 * - delete(): O(1)
 * - has(): O(1)
 * - Space: O(capacity)
 */
export class LRUCache<T> {
    private capacity: number;
    private cache: Map<string, SizedCacheNode<T>>;
    private head: SizedCacheNode<T> | null; // Most recently used
    private tail: SizedCacheNode<T> | null; // Least recently used
    private maxBytes: number;
    private sizeOf: (value: T) => number;
    private currentBytes: number = 0;
    private hits: number = 0;
    private misses: number = 0;
    private evictions: number = 0;
    private invalidations: number = 0;

    constructor(capacity: number, options?: LRUCacheOptions<T>) {
        if (capacity < 1) {
            throw new Error('Cache capacity must be at least 1');
        }

        this.capacity = capacity;
        this.maxBytes = options?.maxBytes ?? Infinity;
        this.sizeOf = options?.sizeOf ?? ((): number => 0);
        this.cache = new Map();
        this.head = null;
        this.tail = null;
    }

    get(key: string): T | null {
        this.validateKey(key);

        const node = this.cache.get(key);

        if (!node) {
            this.misses++;
            return null;
        }

        this.hits++;
        // Move to front (mark as most recently used)
        this.moveToFront(node);

        return node.value;
    }

    put(key: string, value: T): void {
        this.validateKey(key);

        const nextByteSize = Math.max(0, this.sizeOf(value));
        if (Number.isFinite(this.maxBytes) && nextByteSize > this.maxBytes) {
            this.delete(key);
            return;
        }

        const existingNode = this.cache.get(key);

        if (existingNode) {
            this.currentBytes = Math.max(0, this.currentBytes - existingNode.byteSize + nextByteSize);
            existingNode.value = value;
            existingNode.byteSize = nextByteSize;
            this.moveToFront(existingNode);
            this.enforceBounds();
            return;
        }

        const newNode: SizedCacheNode<T> = {
            key,
            value,
            byteSize: nextByteSize,
            prev: null,
            next: null,
        };

        this.addToFront(newNode);
        this.cache.set(key, newNode);
        this.currentBytes += nextByteSize;

        this.enforceBounds();
    }

    /**
     * Check if key exists in cache (does NOT update recency).
     * 
     * @param key - Cache key
     * @returns True if key exists
     * 
     * @complexity O(1)
     * 
     * @example
     * if (cache.has('thumbnail.jpg')) {
     *   // Use cached thumbnail
     * }
     */
    has(key: string): boolean {
        return this.cache.has(key);
    }

    /**
     * Delete key from cache.
     * 
     * @param key - Cache key
     * @returns True if key was deleted, false if not found
     * 
     * @complexity O(1)
     * 
     * @example
     * const deleted = cache.delete('old-thumbnail.jpg');
     * if (deleted) {
     *   console.log('Removed from cache');
     * }
     */
    delete(key: string): boolean {
        const node = this.cache.get(key);

        if (!node) {
            return false;
        }

        this.removeNode(node);
        this.cache.delete(key);
        this.currentBytes = Math.max(0, this.currentBytes - node.byteSize);

        return true;
    }

    invalidate(key: string): boolean {
        if (this.delete(key)) {
            this.invalidations++;
            return true;
        }
        return false;
    }

    invalidatePrefix(prefix: string): number {
        let removed = 0;
        for (const key of Array.from(this.cache.keys())) {
            if (key.startsWith(prefix)) {
                if (this.delete(key)) {
                    removed++;
                }
            }
        }
        this.invalidations += removed;
        return removed;
    }

    getBytes(): number {
        return this.currentBytes;
    }

    getStats(): LRUCacheStats {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            capacity: this.capacity,
            bytes: this.currentBytes,
            maxBytes: Number.isFinite(this.maxBytes) ? this.maxBytes : -1,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            invalidations: this.invalidations,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }

    /**
     * Get current number of cached items.
     * 
     * @returns Cache size
     * 
     * @complexity O(1)
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Clear all cached items.
     * 
     * CRITICAL: Explicitly null out pointers to aid garbage collection
     * and prevent memory leaks (BUG FIX #4 from architecture review).
     * 
     * @complexity O(n) where n = current cache size
     */
    clear(): void {
        // Traverse list and null out all pointers
        let current = this.head;
        while (current) {
            const next = current.next;

            // Explicitly null pointers to aid GC (BUG FIX #4)
            current.prev = null;
            current.next = null;

            current = next;
        }

        this.cache.clear();
        this.head = null;
        this.tail = null;
        this.currentBytes = 0;
    }

    /**
     * Get all keys in order from most to least recently used.
     * Useful for debugging and testing.
     * 
     * @returns Array of keys in MRU to LRU order
     * 
     * @complexity O(n) where n = current cache size
     * 
     * @example
     * const keys = cache.keys();
     * console.log('Most recent:', keys[0]);
     * console.log('Least recent:', keys[keys.length - 1]);
     */
    keys(): string[] {
        const result: string[] = [];
        let current = this.head;

        while (current) {
            result.push(current.key);
            current = current.next;
        }

        return result;
    }

    /**
     * Validate cache key.
     * 
     * @param key - Key to validate
     * @throws Error if key is empty or whitespace
     */
    private validateKey(key: string): void {
        if (!key || key.trim().length === 0) {
            throw new Error('Cache key cannot be empty');
        }
    }

    /**
     * Move node to front of list (mark as most recently used).
     * 
     * @param node - Node to move
     * 
     * @complexity O(1)
     */
    private moveToFront(node: SizedCacheNode<T>): void {
        if (node === this.head) {
            return; // Already at front
        }

        // Remove from current position
        this.removeNode(node);

        // Add to front
        this.addToFront(node);
    }

    private addToFront(node: SizedCacheNode<T>): void {
        node.next = this.head;
        node.prev = null;

        if (this.head) {
            this.head.prev = node;
        }

        this.head = node;

        if (!this.tail) {
            this.tail = node;
        }
    }

    private removeNode(node: SizedCacheNode<T>): void {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            // Node is head
            this.head = node.next;
        }

        if (node.next) {
            node.next.prev = node.prev;
        } else {
            // Node is tail
            this.tail = node.prev;
        }

        node.prev = null;
        node.next = null;
    }

    private enforceBounds(): void {
        while (
            this.tail &&
            (this.cache.size > this.capacity ||
                (Number.isFinite(this.maxBytes) && this.currentBytes > this.maxBytes))
        ) {
            this.evictTail();
        }
    }

    private evictTail(): void {
        if (!this.tail) {
            return;
        }

        const evicted = this.tail;
        this.removeNode(evicted);
        this.cache.delete(evicted.key);
        this.currentBytes = Math.max(0, this.currentBytes - evicted.byteSize);
        this.evictions++;
    }
}
