import { FileEvent, EventPriority } from '@shared/contracts';

/**
 * EventQueue - Min-Heap Priority Queue for file system events.
 * 
 * Implements priority-based event processing similar to OS process scheduling.
 * Lower priority number = higher priority (1 is highest, 10 is lowest).
 * 
 * Heap Structure (array-based binary tree):
 * 
 *         [0: Priority 1]
 *        /                \
 *   [1: P 5]            [2: P 10]
 *   /       \           /        \
 * [3: P 5] [4: P 10] [5: P 10] [6: P 10]
 * 
 * Array: [1, 5, 10, 5, 10, 10, 10]
 * 
 * Formulas:
 * - Parent of i: Math.floor((i - 1) / 2)
 * - Left child of i: 2 * i + 1
 * - Right child of i: 2 * i + 2
 * 
 * Complexity:
 * - enqueue(): O(log n)
 * - dequeue(): O(log n)
 * - peek(): O(1)
 * - Space: O(n)
 */
export class EventQueue {
    private heap: FileEvent[];

    constructor() {
        this.heap = [];
    }

    /**
     * Add event to queue with priority-based ordering.
     * 
     * @param event - File system event
     * 
     * @complexity O(log n)
     * 
     * @throws Error if event is null/undefined or has invalid priority
     * 
     * @example
     * queue.enqueue({
     *   type: 'delete',
     *   path: '/file.txt',
     *   priority: EventPriority.USER_ACTION,
     *   timestamp: Date.now()
     * });
     */
    enqueue(event: FileEvent): void {
        this.validateEvent(event);

        this.heap.push(event);
        this.heapifyUp(this.heap.length - 1);
    }

    /**
     * Remove and return highest priority event.
     * 
     * @returns Highest priority event or null if empty
     * 
     * @complexity O(log n)
     * 
     * @example
     * const event = queue.dequeue();
     * if (event) {
     *   processEvent(event);
     * }
     */
    dequeue(): FileEvent | null {
        if (this.heap.length === 0) {
            return null;
        }

        if (this.heap.length === 1) {
            return this.heap.pop()!;
        }

        // Save root (highest priority)
        const root = this.heap[0];

        // Move last element to root
        this.heap[0] = this.heap.pop()!;

        // Restore heap property
        this.heapifyDown(0);

        return root;
    }

    /**
     * View highest priority event without removing.
     * 
     * @returns Highest priority event or null if empty
     * 
     * @complexity O(1)
     * 
     * @example
     * const nextEvent = queue.peek();
     * if (nextEvent?.priority === EventPriority.USER_ACTION) {
     *   // Process immediately
     * }
     */
    peek(): FileEvent | null {
        return this.heap.length > 0 ? this.heap[0] : null;
    }

    /**
     * Get number of events in queue.
     * 
     * @returns Queue size
     * 
     * @complexity O(1)
     */
    size(): number {
        return this.heap.length;
    }

    /**
     * Check if queue is empty.
     * 
     * @returns True if empty
     * 
     * @complexity O(1)
     */
    isEmpty(): boolean {
        return this.heap.length === 0;
    }

    /**
     * Remove all events from queue.
     * 
     * @complexity O(1)
     */
    clear(): void {
        this.heap = [];
    }

    /**
     * Get all events in priority order (for debugging).
     * Does not modify the queue.
     * 
     * @returns Array of events in priority order
     * 
     * @complexity O(n log n)
     * 
     * @example
     * const events = queue.toArray();
     * console.log('Next event:', events[0]);
     */
    toArray(): FileEvent[] {
        // Create a copy and drain it
        const copy = new EventQueue();
        copy.heap = [...this.heap];

        const result: FileEvent[] = [];
        while (!copy.isEmpty()) {
            const event = copy.dequeue();
            if (event) {
                result.push(event);
            }
        }

        return result;
    }

    /**
     * Validate event before enqueueing.
     * 
     * @param event - Event to validate
     * @throws Error if event is invalid
     */
    private validateEvent(event: FileEvent): void {
        if (!event) {
            throw new Error('Event cannot be null or undefined');
        }
        if (typeof event.priority !== 'number' || event.priority < 1) {
            throw new Error('Event priority must be a number >= 1');
        }
    }

    /**
     * Bubble element up to restore heap property.
     * Called after inserting at end.
     * 
     * @param index - Index of element to bubble up
     * 
     * @complexity O(log n)
     */
    private heapifyUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);

            // Compare priorities (lower number = higher priority)
            if (this.comparePriority(this.heap[index], this.heap[parentIndex]) >= 0) {
                break; // Heap property satisfied
            }

            // Swap with parent
            this.swap(index, parentIndex);
            index = parentIndex;
        }
    }

    /**
     * Bubble element down to restore heap property.
     * Called after removing root.
     * 
     * @param index - Index of element to bubble down
     * 
     * @complexity O(log n)
     */
    private heapifyDown(index: number): void {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;

            // Compare with left child
            if (
                leftChild < this.heap.length &&
                this.comparePriority(this.heap[leftChild], this.heap[smallest]) < 0
            ) {
                smallest = leftChild;
            }

            // Compare with right child
            if (
                rightChild < this.heap.length &&
                this.comparePriority(this.heap[rightChild], this.heap[smallest]) < 0
            ) {
                smallest = rightChild;
            }

            // Heap property satisfied
            if (smallest === index) {
                break;
            }

            // Swap with smallest child
            this.swap(index, smallest);
            index = smallest;
        }
    }

    /**
     * Compare two events by priority.
     * 
     * Lower priority NUMBER = higher priority (1 is highest, 10 is lowest)
     * 
     * @param a - First event
     * @param b - Second event
     * @returns Negative if a has higher priority (lower number),
     *          Positive if b has higher priority (lower number),
     *          0 if equal priority (then compare timestamps for FIFO)
     */
    private comparePriority(a: FileEvent, b: FileEvent): number {
        // Lower priority number = higher priority
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }

        // If same priority, use timestamp (FIFO within priority)
        return a.timestamp - b.timestamp;
    }

    /**
     * Swap two elements in heap.
     * 
     * @param i - First index
     * @param j - Second index
     */
    private swap(i: number, j: number): void {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }
}
