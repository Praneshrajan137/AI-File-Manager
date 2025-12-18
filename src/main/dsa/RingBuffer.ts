/**
 * RingBuffer - Circular buffer for efficient log file preview.
 * 
 * Implements fixed-size buffer that overwrites oldest entries when full.
 * Similar to "tail -f" functionality in Unix systems.
 * 
 * Visual representation (capacity = 5):
 * 
 * Initial state (empty):
 *   [_, _, _, _, _]
 *    ↑
 *   write index = 0
 * 
 * After pushing "A", "B", "C":
 *   [A, B, C, _, _]
 *             ↑
 *   write index = 3
 * 
 * After filling (A, B, C, D, E):
 *   [A, B, C, D, E]
 *    ↑
 *   write index = 0 (wraps around)
 * 
 * After overwrite (pushing F):
 *   [F, B, C, D, E]
 *       ↑
 *   write index = 1
 * 
 * getLines() returns chronological order: [B, C, D, E, F]
 * 
 * Complexity:
 * - push(): O(1)
 * - getLines(n): O(n)
 * - Space: O(capacity)
 */
export class RingBuffer implements Iterable<string> {
    private buffer: string[];
    private capacity: number;
    private writeIndex: number;
    private currentSize: number;

    /**
     * Create ring buffer with specified capacity.
     * 
     * @param capacity - Maximum number of lines to store
     * 
     * @throws Error if capacity < 1 or not an integer
     * 
     * @example
     * const buffer = new RingBuffer(100);
     * buffer.push('Log line 1');
     * buffer.push('Log line 2');
     * const lastTen = buffer.getLines(10);
     */
    constructor(capacity: number) {
        if (capacity < 1 || !Number.isInteger(capacity)) {
            throw new Error('RingBuffer capacity must be a positive integer');
        }

        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.writeIndex = 0;
        this.currentSize = 0;
    }

    /**
     * Add line to buffer, overwriting oldest if full.
     * 
     * @param line - Text line to add
     * 
     * @complexity O(1)
     * 
     * @example
     * buffer.push('[2025-01-01 10:00:00] Server started');
     */
    push(line: string): void {
        this.buffer[this.writeIndex] = line;
        this.writeIndex = (this.writeIndex + 1) % this.capacity;

        if (this.currentSize < this.capacity) {
            this.currentSize++;
        }
    }

    /**
     * Get last N lines in chronological order.
     * 
     * @param count - Number of lines to retrieve (default: all)
     * @returns Array of lines
     * 
     * @complexity O(n) where n = count
     * 
     * @example
     * const lastTen = buffer.getLines(10);
     * console.log(lastTen.join('\n'));
     */
    getLines(count?: number): string[] {
        // Handle invalid inputs (NaN, negative)
        // Note: Infinity is valid and means "all lines"
        if (count !== undefined && (Number.isNaN(count) || count < 0)) {
            return [];
        }

        const n = Math.min(
            Math.floor(count ?? this.currentSize),
            this.currentSize
        );

        if (n <= 0) {
            return [];
        }

        const result: string[] = [];

        // Calculate starting index (oldest line we want)
        const startIndex = this.calculateStartIndex(n);

        // Extract lines in chronological order
        for (let i = 0; i < n; i++) {
            const index = (startIndex + i) % this.capacity;
            result.push(this.buffer[index]);
        }

        return result;
    }

    /**
     * Get number of lines currently stored.
     * 
     * @returns Current size (0 to capacity)
     */
    size(): number {
        return this.currentSize;
    }

    /**
     * Check if buffer is at capacity.
     * 
     * @returns True if full
     */
    isFull(): boolean {
        return this.currentSize === this.capacity;
    }

    /**
     * Check if buffer is empty.
     * 
     * @returns True if empty
     */
    isEmpty(): boolean {
        return this.currentSize === 0;
    }

    /**
     * Clear all lines from buffer.
     */
    clear(): void {
        this.buffer = new Array(this.capacity);
        this.writeIndex = 0;
        this.currentSize = 0;
    }

    /**
     * Calculate starting index for retrieving N lines.
     * 
     * @param count - Number of lines to retrieve
     * @returns Starting index in circular buffer
     */
    private calculateStartIndex(count: number): number {
        if (this.currentSize < this.capacity) {
            // Buffer not full yet - start from beginning
            return Math.max(0, this.currentSize - count);
        } else {
            // Buffer full - calculate from write index
            // writeIndex points to oldest entry (will be overwritten next)
            return (this.writeIndex - count + this.capacity) % this.capacity;
        }
    }

    /**
     * Make buffer iterable (for...of support).
     * 
     * @returns Iterator yielding lines in chronological order
     * 
     * @example
     * for (const line of buffer) {
     *   console.log(line);
     * }
     */
    *[Symbol.iterator](): Iterator<string> {
        const lines = this.getLines();
        for (const line of lines) {
            yield line;
        }
    }

    /**
     * Get all lines as string with newlines.
     * Useful for displaying in UI.
     * 
     * @returns All lines joined with newlines
     * 
     * @example
     * console.log(buffer.toString());
     */
    toString(): string {
        return this.getLines().join('\n');
    }
}
