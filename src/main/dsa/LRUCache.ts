/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

import { CacheNode } from '@shared/contracts';

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
    private cache: Map<string, CacheNode<T>>;
    private head: CacheNode<T> | null; // Most recently used
    private tail: CacheNode<T> | null; // Least recently used

    /**
     * Create LRU cache with specified capacity.
     * 
     * @param capacity - Maximum number of items to store
     * 
     * @throws Error if capacity < 1
     * 
     * @example
     * const cache = new LRUCache<Buffer>(100);
     * cache.put('thumbnail1', buffer);
     */
    constructor(capacity: number) {
        if (capacity < 1) {
            throw new Error('Cache capacity must be at least 1');
        }

        this.capacity = capacity;
        this.cache = new Map();
        this.head = null;
        this.tail = null;
    }

    /**
     * Get value by key and mark as recently used.
     * 
     * @param key - Cache key
     * @returns Cached value or null if not found
     * 
     * @complexity O(1)
     * 
     * @throws Error if key is empty
     * 
     * @example
     * const thumbnail = cache.get('file1.jpg');
     * if (thumbnail) {
     *   displayThumbnail(thumbnail);
     * }
     */
    get(key: string): T | null {
        this.validateKey(key);

        const node = this.cache.get(key);

        if (!node) {
            return null;
        }

        // Move to front (mark as most recently used)
        this.moveToFront(node);

        return node.value;
    }

    /**
     * Put value in cache, evicting LRU item if at capacity.
     * 
     * If key already exists, updates value and marks as most recently used.
     * 
     * @param key - Cache key
     * @param value - Value to cache
     * 
     * @complexity O(1)
     * 
     * @throws Error if key is empty
     * 
     * @example
     * cache.put('thumbnail.jpg', thumbnailBuffer);
     */
    put(key: string, value: T): void {
        this.validateKey(key);

        const existingNode = this.cache.get(key);

        if (existingNode) {
            // Key exists - update value and move to front
            existingNode.value = value;
            this.moveToFront(existingNode);
            return;
        }

        // Create new node
        const newNode: CacheNode<T> = {
            key,
            value,
            prev: null,
            next: null,
        };

        // Add to front
        this.addToFront(newNode);
        this.cache.set(key, newNode);

        // Evict if over capacity
        if (this.cache.size > this.capacity) {
            this.evictTail();
        }
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

        return true;
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
    private moveToFront(node: CacheNode<T>): void {
        if (node === this.head) {
            return; // Already at front
        }

        // Remove from current position
        this.removeNode(node);

        // Add to front
        this.addToFront(node);
    }

    /**
     * Add node to front of list.
     * 
     * @param node - Node to add
     * 
     * @complexity O(1)
     */
    private addToFront(node: CacheNode<T>): void {
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

    /**
     * Remove node from list (but don't delete from cache).
     * 
     * This method updates the doubly linked list pointers to remove
     * the node from the list. The node's prev/next pointers are nulled
     * after removal to aid garbage collection.
     * 
     * @param node - Node to remove
     * 
     * @complexity O(1)
     */
    private removeNode(node: CacheNode<T>): void {
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

        // Null out pointers after removal to aid GC (BUG FIX #4)
        // This happens after reassigning head/tail to ensure we don't
        // lose references to the list structure
        node.prev = null;
        node.next = null;
    }

    /**
     * Evict least recently used item (tail).
     * 
     * @complexity O(1)
     */
    private evictTail(): void {
        if (!this.tail) {
            return;
        }

        const keyToEvict = this.tail.key;
        this.removeNode(this.tail);
        this.cache.delete(keyToEvict);
    }
}
