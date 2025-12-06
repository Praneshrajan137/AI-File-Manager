import { HistoryNode } from '@shared/contracts';

/**
 * HistoryStack - Doubly Linked List for navigation history.
 * 
 * Implements browser-style back/forward navigation with O(1) operations.
 * 
 * Visual representation:
 * 
 *   [/home] ←→ [/home/user] ←→ [/home/user/docs]
 *       ↑                              ↑
 *     start                         current
 * 
 * Doubly linked allows O(1) traversal in both directions.
 * 
 * Complexity:
 * - push(): O(1)
 * - back(): O(1)
 * - forward(): O(1)
 * - Space: O(n) where n = history size
 */
export class HistoryStack {
    private current: HistoryNode | null;
    private maxSize: number;
    private count: number;

    /**
     * Create navigation history with optional max size.
     * 
     * @param maxSize - Maximum history entries (default: 50)
     * 
     * @throws Error if maxSize is not a positive integer
     * 
     * @example
     * const history = new HistoryStack();
     * history.push('/home');
     * history.push('/home/user');
     * history.back(); // Returns '/home'
     */
    constructor(maxSize: number = 50) {
        if (maxSize < 1 || !Number.isInteger(maxSize)) {
            throw new Error('Max size must be a positive integer');
        }

        this.current = null;
        this.maxSize = maxSize;
        this.count = 0;
    }

    /**
     * Navigate to new path, clearing forward history.
     * 
     * @param path - Directory path
     * 
     * @complexity O(1)
     * 
     * @example
     * history.push('/home/documents');
     */
    push(path: string): void {
        const newNode: HistoryNode = {
            path,
            timestamp: Date.now(),
            prev: this.current,
            next: null,
        };

        if (this.current) {
            // Clear forward history (CRITICAL: explicit pointer cleanup - BUG FIX #4)
            this.clearForwardHistory(this.current);

            this.current.next = newNode;
        }

        this.current = newNode;
        this.count++;

        // Enforce max size by evicting oldest
        if (this.count > this.maxSize) {
            this.evictOldest();
        }
    }

    /**
     * Navigate backward in history.
     * 
     * @returns Previous path or null if at start
     * 
     * @complexity O(1)
     * 
     * @example
     * const prevPath = history.back();
     * if (prevPath) {
     *   navigateToDirectory(prevPath);
     * }
     */
    back(): string | null {
        if (!this.current?.prev) {
            return null; // Already at start
        }

        this.current = this.current.prev;
        return this.current.path;
    }

    /**
     * Navigate forward in history.
     * 
     * @returns Next path or null if at end
     * 
     * @complexity O(1)
     * 
     * @example
     * const nextPath = history.forward();
     * if (nextPath) {
     *   navigateToDirectory(nextPath);
     * }
     */
    forward(): string | null {
        if (!this.current?.next) {
            return null; // Already at end
        }

        this.current = this.current.next;
        return this.current.path;
    }

    /**
     * Get current path without navigating.
     * 
     * @returns Current path or null if empty
     * 
     * @complexity O(1)
     */
    currentPath(): string | null {
        return this.current?.path ?? null;
    }

    /**
     * Check if backward navigation is possible.
     * 
     * @returns True if can go back
     * 
     * @complexity O(1)
     */
    canGoBack(): boolean {
        return !!this.current?.prev;
    }

    /**
     * Check if forward navigation is possible.
     * 
     * @returns True if can go forward
     * 
     * @complexity O(1)
     */
    canGoForward(): boolean {
        return !!this.current?.next;
    }

    /**
     * Get navigation state.
     * 
     * @returns Object with canGoBack and canGoForward
     * 
     * @complexity O(1)
     */
    getState(): { canGoBack: boolean; canGoForward: boolean } {
        return {
            canGoBack: this.canGoBack(),
            canGoForward: this.canGoForward(),
        };
    }

    /**
     * Get number of paths in history.
     * 
     * @returns History size
     * 
     * @complexity O(1)
     */
    size(): number {
        return this.count;
    }

    /**
     * Clear all history.
     * 
     * CRITICAL: Explicitly null out all pointers to aid garbage collection
     * and prevent memory leaks (BUG FIX #4).
     * 
     * @complexity O(n)
     */
    clear(): void {
        if (!this.current) {
            return;
        }

        // Find start of list
        let node: HistoryNode | null = this.current;
        while (node.prev) {
            node = node.prev;
        }

        // Traverse and null out pointers
        while (node) {
            const next: HistoryNode | null = node.next;

            // Explicitly null pointers (BUG FIX #4)
            node.prev = null;
            node.next = null;

            node = next;
        }

        this.current = null;
        this.count = 0;
    }

    /**
     * Clear forward history from given node.
     * Called when pushing new path while in middle of history.
     * 
     * CRITICAL: Explicit pointer cleanup (BUG FIX #4)
     * 
     * Size tracking: This method decrements count by the number of nodes cleared.
     * The caller (push) will then increment count for the new node, resulting
     * in the correct final count.
     * 
     * @param node - Node to clear forward from
     * 
     * @complexity O(m) where m = nodes to clear
     */
    private clearForwardHistory(node: HistoryNode): void {
        let current = node.next;
        let nodesCleared = 0;

        while (current) {
            const next = current.next;

            // Explicitly null pointers (BUG FIX #4)
            current.prev = null;
            current.next = null;

            current = next;
            nodesCleared++;
        }

        // Sever connection
        node.next = null;

        // Update count
        // Note: push() will increment count after this, so final count will be correct
        this.count -= nodesCleared;
    }

    /**
     * Evict oldest entry when at capacity.
     * 
     * CRITICAL: Explicit pointer cleanup (BUG FIX #4)
     * 
     * @complexity O(n) - must find oldest node
     */
    private evictOldest(): void {
        if (!this.current) {
            return;
        }

        // Find oldest node (start of list)
        let oldest: HistoryNode = this.current;
        while (oldest.prev) {
            oldest = oldest.prev;
        }

        // If oldest has a next node, update its prev pointer
        if (oldest.next) {
            oldest.next.prev = null;
        }

        // Explicitly null pointers (BUG FIX #4)
        oldest.next = null;
        oldest.prev = null;

        this.count--;
    }

    /**
     * Get all paths in history order (for debugging).
     * Does not modify current position.
     * 
     * @returns Array of paths from oldest to newest
     * 
     * @complexity O(n)
     * 
     * @example
     * const paths = history.toArray();
     * console.log('History:', paths);
     */
    toArray(): string[] {
        if (!this.current) {
            return [];
        }

        const result: string[] = [];

        // Find start
        let node: HistoryNode | null = this.current;
        while (node.prev) {
            node = node.prev;
        }

        // Collect all paths
        while (node) {
            result.push(node.path);
            node = node.next;
        }

        return result;
    }
}
