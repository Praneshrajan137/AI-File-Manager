import { EventQueue } from '@main/dsa/EventQueue';
import { FileEvent, EventPriority } from '@shared/contracts';

describe('EventQueue', () => {
    let queue: EventQueue;

    beforeEach(() => {
        queue = new EventQueue();
    });

    // Helper function to create test events
    const createEvent = (priority: EventPriority, timestamp: number = Date.now(), path: string = '/test.txt'): FileEvent => ({
        type: 'create',
        path,
        priority,
        timestamp,
    });

    describe('basic operations', () => {
        it('should enqueue and dequeue single event', () => {
            const event: FileEvent = {
                type: 'create',
                path: '/test.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: Date.now(),
            };

            queue.enqueue(event);

            const dequeued = queue.dequeue();

            expect(dequeued).toEqual(event);
        });

        it('should return null when dequeuing from empty queue', () => {
            const result = queue.dequeue();

            expect(result).toBeNull();
        });

        it('should report correct size', () => {
            expect(queue.size()).toBe(0);

            queue.enqueue({
                type: 'create',
                path: '/file1.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: Date.now(),
            });

            expect(queue.size()).toBe(1);

            queue.enqueue({
                type: 'change',
                path: '/file2.txt',
                priority: EventPriority.FILE_WATCHER,
                timestamp: Date.now(),
            });

            expect(queue.size()).toBe(2);
        });

        it('should report empty correctly', () => {
            expect(queue.isEmpty()).toBe(true);

            queue.enqueue({
                type: 'create',
                path: '/test.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: Date.now(),
            });

            expect(queue.isEmpty()).toBe(false);
        });

        it('should throw error for null event', () => {
            expect(() => {
                queue.enqueue(null as any);
            }).toThrow('Event cannot be null or undefined');
        });

        it('should throw error for undefined event', () => {
            expect(() => {
                queue.enqueue(undefined as any);
            }).toThrow('Event cannot be null or undefined');
        });

        it('should throw error for invalid priority', () => {
            expect(() => {
                queue.enqueue({
                    type: 'create',
                    path: '/test.txt',
                    priority: 0 as EventPriority,
                    timestamp: Date.now(),
                });
            }).toThrow('Event priority must be a number >= 1');
        });
    });

    describe('priority ordering', () => {
        it('should dequeue highest priority first (lowest number)', () => {
            // Add events in random priority order
            queue.enqueue({
                type: 'create',
                path: '/bg-index.txt',
                priority: EventPriority.BACKGROUND_INDEX, // 10
                timestamp: Date.now(),
            });

            queue.enqueue({
                type: 'change',
                path: '/watcher.txt',
                priority: EventPriority.FILE_WATCHER, // 5
                timestamp: Date.now(),
            });

            queue.enqueue({
                type: 'unlink',
                path: '/user.txt',
                priority: EventPriority.USER_ACTION, // 1
                timestamp: Date.now(),
            });

            // Should dequeue in priority order: USER_ACTION, FILE_WATCHER, BACKGROUND_INDEX
            const first = queue.dequeue();
            expect(first?.priority).toBe(EventPriority.USER_ACTION);

            const second = queue.dequeue();
            expect(second?.priority).toBe(EventPriority.FILE_WATCHER);

            const third = queue.dequeue();
            expect(third?.priority).toBe(EventPriority.BACKGROUND_INDEX);
        });

        it('should handle multiple events with same priority (FIFO within priority)', () => {
            const timestamp1 = 1000;
            const timestamp2 = 2000;
            const timestamp3 = 3000;

            queue.enqueue({
                type: 'create',
                path: '/file1.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: timestamp1,
            });

            queue.enqueue({
                type: 'change',
                path: '/file2.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: timestamp2,
            });

            queue.enqueue({
                type: 'unlink',
                path: '/file3.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: timestamp3,
            });

            // Within same priority, should maintain FIFO order
            const first = queue.dequeue();
            expect(first?.timestamp).toBe(timestamp1);

            const second = queue.dequeue();
            expect(second?.timestamp).toBe(timestamp2);

            const third = queue.dequeue();
            expect(third?.timestamp).toBe(timestamp3);
        });

        it('should maintain heap property after multiple operations', () => {
            // Add many events with mixed priorities
            const priorities = [
                EventPriority.BACKGROUND_INDEX,
                EventPriority.FILE_WATCHER,
                EventPriority.USER_ACTION,
                EventPriority.BACKGROUND_INDEX,
                EventPriority.FILE_WATCHER,
                EventPriority.USER_ACTION,
                EventPriority.BACKGROUND_INDEX,
                EventPriority.FILE_WATCHER,
                EventPriority.USER_ACTION,
            ];

            for (let i = 0; i < priorities.length; i++) {
                queue.enqueue({
                    type: 'create',
                    path: `/file${i}.txt`,
                    priority: priorities[i],
                    timestamp: Date.now() + i,
                });
            }

            // Dequeue all and verify priority order
            let lastPriority = 0;

            while (!queue.isEmpty()) {
                const event = queue.dequeue();
                expect(event).not.toBeNull();
                expect(event!.priority).toBeGreaterThanOrEqual(lastPriority);
                lastPriority = event!.priority;
            }
        });
    });

    describe('peek operation', () => {
        it('should peek at highest priority without removing', () => {
            queue.enqueue({
                type: 'create',
                path: '/low.txt',
                priority: EventPriority.BACKGROUND_INDEX,
                timestamp: Date.now(),
            });

            queue.enqueue({
                type: 'unlink',
                path: '/high.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: Date.now(),
            });

            const peeked = queue.peek();

            expect(peeked?.priority).toBe(EventPriority.USER_ACTION);
            expect(queue.size()).toBe(2); // Size unchanged
        });

        it('should return null when peeking empty queue', () => {
            const peeked = queue.peek();

            expect(peeked).toBeNull();
        });

        it('should return same event on multiple peeks', () => {
            queue.enqueue(createEvent(EventPriority.USER_ACTION));

            const peek1 = queue.peek();
            const peek2 = queue.peek();

            expect(peek1).toEqual(peek2);
            expect(queue.size()).toBe(1);
        });
    });

    describe('clear operation', () => {
        it('should clear all events', () => {
            for (let i = 0; i < 10; i++) {
                queue.enqueue({
                    type: 'create',
                    path: `/file${i}.txt`,
                    priority: EventPriority.FILE_WATCHER,
                    timestamp: Date.now(),
                });
            }

            expect(queue.size()).toBe(10);

            queue.clear();

            expect(queue.size()).toBe(0);
            expect(queue.isEmpty()).toBe(true);
            expect(queue.dequeue()).toBeNull();
        });

        it('should allow enqueue after clear', () => {
            queue.enqueue(createEvent(EventPriority.USER_ACTION));
            queue.clear();

            queue.enqueue(createEvent(EventPriority.FILE_WATCHER));

            expect(queue.size()).toBe(1);
            expect(queue.dequeue()?.priority).toBe(EventPriority.FILE_WATCHER);
        });
    });

    describe('toArray operation', () => {
        it('should return events in priority order', () => {
            queue.enqueue(createEvent(EventPriority.BACKGROUND_INDEX, 1000));
            queue.enqueue(createEvent(EventPriority.USER_ACTION, 2000));
            queue.enqueue(createEvent(EventPriority.FILE_WATCHER, 3000));

            const array = queue.toArray();

            expect(array[0].priority).toBe(EventPriority.USER_ACTION);
            expect(array[1].priority).toBe(EventPriority.FILE_WATCHER);
            expect(array[2].priority).toBe(EventPriority.BACKGROUND_INDEX);

            // Original queue should be unchanged
            expect(queue.size()).toBe(3);
        });

        it('should return empty array for empty queue', () => {
            const array = queue.toArray();

            expect(array).toEqual([]);
        });
    });

    describe('edge cases', () => {
        it('should be empty after dequeuing all items', () => {
            for (let i = 0; i < 10; i++) {
                queue.enqueue(createEvent(EventPriority.FILE_WATCHER, i));
            }

            for (let i = 0; i < 10; i++) {
                queue.dequeue();
            }

            expect(queue.isEmpty()).toBe(true);
            expect(queue.size()).toBe(0);
            expect(queue.peek()).toBeNull();
            expect(queue.dequeue()).toBeNull();
        });

        it('should handle single element queue', () => {
            queue.enqueue(createEvent(EventPriority.USER_ACTION));

            expect(queue.size()).toBe(1);
            expect(queue.peek()?.priority).toBe(EventPriority.USER_ACTION);
            expect(queue.dequeue()?.priority).toBe(EventPriority.USER_ACTION);
            expect(queue.isEmpty()).toBe(true);
        });

        it('should handle interleaved enqueue/dequeue operations', () => {
            queue.enqueue(createEvent(EventPriority.BACKGROUND_INDEX, 1));
            queue.enqueue(createEvent(EventPriority.USER_ACTION, 2));

            expect(queue.dequeue()?.priority).toBe(EventPriority.USER_ACTION);

            queue.enqueue(createEvent(EventPriority.FILE_WATCHER, 3));
            queue.enqueue(createEvent(EventPriority.USER_ACTION, 4));

            expect(queue.dequeue()?.priority).toBe(EventPriority.USER_ACTION);
            expect(queue.dequeue()?.priority).toBe(EventPriority.FILE_WATCHER);
            expect(queue.dequeue()?.priority).toBe(EventPriority.BACKGROUND_INDEX);
        });
    });

    describe('performance characteristics', () => {
        it('should have O(log n) enqueue complexity - scaling test', () => {
            const priorities = [
                EventPriority.USER_ACTION,
                EventPriority.FILE_WATCHER,
                EventPriority.BACKGROUND_INDEX,
            ];

            // Test with small queue
            const smallQueue = new EventQueue();
            for (let i = 0; i < 100; i++) {
                smallQueue.enqueue(createEvent(priorities[i % 3], i));
            }

            const smallStart = performance.now();
            for (let i = 0; i < 100; i++) {
                smallQueue.enqueue(createEvent(priorities[i % 3], i));
            }
            const smallTime = performance.now() - smallStart;

            // Test with large queue
            const largeQueue = new EventQueue();
            for (let i = 0; i < 10000; i++) {
                largeQueue.enqueue(createEvent(priorities[i % 3], i));
            }

            const largeStart = performance.now();
            for (let i = 0; i < 100; i++) {
                largeQueue.enqueue(createEvent(priorities[i % 3], i));
            }
            const largeTime = performance.now() - largeStart;

            // O(log n) means large should be ~log(10000)/log(100) = ~2x slower
            // Allow 3x for system noise
            expect(largeTime).toBeLessThan(smallTime * 3);
        });

        it('should have O(log n) dequeue complexity - scaling test', () => {
            const priorities = [
                EventPriority.USER_ACTION,
                EventPriority.FILE_WATCHER,
                EventPriority.BACKGROUND_INDEX,
            ];

            // Fill queue with many items
            for (let i = 0; i < 1000; i++) {
                queue.enqueue(createEvent(priorities[i % 3], i));
            }

            const iterations = 100;
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                queue.dequeue();
            }

            const avgTime = (performance.now() - startTime) / iterations;

            // Should be very fast
            expect(avgTime).toBeLessThan(0.1);
        });
    });

    describe('real-world scenario', () => {
        it('should handle npm install event storm correctly', () => {
            // Simulate npm install creating 1000 files (background events)
            for (let i = 0; i < 1000; i++) {
                queue.enqueue({
                    type: 'create',
                    path: `/node_modules/package${i}/file.js`,
                    priority: EventPriority.BACKGROUND_INDEX,
                    timestamp: Date.now() + i,
                });
            }

            // User deletes a file during npm install
            queue.enqueue({
                type: 'unlink',
                path: '/user-file.txt',
                priority: EventPriority.USER_ACTION,
                timestamp: Date.now() + 1000,
            });

            // User action should be processed first
            const firstEvent = queue.dequeue();

            expect(firstEvent?.type).toBe('unlink');
            expect(firstEvent?.priority).toBe(EventPriority.USER_ACTION);
            expect(firstEvent?.path).toBe('/user-file.txt');

            // Remaining events should be background
            const secondEvent = queue.dequeue();
            expect(secondEvent?.priority).toBe(EventPriority.BACKGROUND_INDEX);
        });

        it('should handle mixed priority event storm', () => {
            // Add 100 events of each priority
            for (let i = 0; i < 100; i++) {
                queue.enqueue(createEvent(EventPriority.BACKGROUND_INDEX, i));
                queue.enqueue(createEvent(EventPriority.FILE_WATCHER, i + 100));
                queue.enqueue(createEvent(EventPriority.USER_ACTION, i + 200));
            }

            // First 100 should be USER_ACTION
            for (let i = 0; i < 100; i++) {
                const event = queue.dequeue();
                expect(event?.priority).toBe(EventPriority.USER_ACTION);
            }

            // Next 100 should be FILE_WATCHER
            for (let i = 0; i < 100; i++) {
                const event = queue.dequeue();
                expect(event?.priority).toBe(EventPriority.FILE_WATCHER);
            }

            // Last 100 should be BACKGROUND_INDEX
            for (let i = 0; i < 100; i++) {
                const event = queue.dequeue();
                expect(event?.priority).toBe(EventPriority.BACKGROUND_INDEX);
            }
        });
    });
});
