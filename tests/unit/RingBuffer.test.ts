import { RingBuffer } from '@main/dsa/RingBuffer';

describe('RingBuffer', () => {
    describe('basic operations', () => {
        let buffer: RingBuffer;

        beforeEach(() => {
            buffer = new RingBuffer(5); // Capacity of 5
        });

        it('should store and retrieve lines', () => {
            buffer.push('line 1');
            buffer.push('line 2');
            buffer.push('line 3');

            const lines = buffer.getLines();

            expect(lines).toEqual(['line 1', 'line 2', 'line 3']);
        });

        it('should report correct size', () => {
            expect(buffer.size()).toBe(0);

            buffer.push('line 1');
            expect(buffer.size()).toBe(1);

            buffer.push('line 2');
            expect(buffer.size()).toBe(2);
        });

        it('should report full correctly', () => {
            expect(buffer.isFull()).toBe(false);

            for (let i = 0; i < 5; i++) {
                buffer.push(`line ${i}`);
            }

            expect(buffer.isFull()).toBe(true);
        });

        it('should report empty correctly', () => {
            expect(buffer.isEmpty()).toBe(true);

            buffer.push('line 1');
            expect(buffer.isEmpty()).toBe(false);
        });
    });

    describe('circular behavior', () => {
        let buffer: RingBuffer;

        beforeEach(() => {
            buffer = new RingBuffer(3); // Small capacity for testing
        });

        it('should overwrite oldest when full', () => {
            buffer.push('line 1');
            buffer.push('line 2');
            buffer.push('line 3');

            // Buffer is full: [line 1, line 2, line 3]

            buffer.push('line 4'); // Should overwrite 'line 1'

            const lines = buffer.getLines();

            expect(lines).toEqual(['line 2', 'line 3', 'line 4']);
            expect(lines).not.toContain('line 1');
        });

        it('should maintain chronological order after wrapping', () => {
            buffer.push('A');
            buffer.push('B');
            buffer.push('C');
            buffer.push('D'); // Overwrites A
            buffer.push('E'); // Overwrites B

            const lines = buffer.getLines();

            expect(lines).toEqual(['C', 'D', 'E']);
        });

        it('should handle many overwrites', () => {
            for (let i = 0; i < 100; i++) {
                buffer.push(`line ${i}`);
            }

            const lines = buffer.getLines();

            expect(lines).toEqual(['line 97', 'line 98', 'line 99']);
            expect(lines.length).toBe(3);
        });
    });

    describe('getLines with count parameter', () => {
        let buffer: RingBuffer;

        beforeEach(() => {
            buffer = new RingBuffer(10);

            for (let i = 1; i <= 10; i++) {
                buffer.push(`line ${i}`);
            }
        });

        it('should return last N lines when requested', () => {
            const lines = buffer.getLines(3);

            expect(lines).toEqual(['line 8', 'line 9', 'line 10']);
        });

        it('should return all lines if count exceeds size', () => {
            const lines = buffer.getLines(20);

            expect(lines.length).toBe(10);
        });

        it('should return empty array if count is 0', () => {
            const lines = buffer.getLines(0);

            expect(lines).toEqual([]);
        });

        it('should handle negative count gracefully', () => {
            const lines = buffer.getLines(-5);

            expect(lines).toEqual([]);
        });

        it('should handle NaN count gracefully', () => {
            const lines = buffer.getLines(NaN);

            expect(lines).toEqual([]);
        });

        it('should handle Infinity count gracefully', () => {
            const lines = buffer.getLines(Infinity);

            expect(lines.length).toBe(10);
        });
    });

    describe('clear operation', () => {
        it('should clear all lines', () => {
            const buffer = new RingBuffer(5);

            buffer.push('line 1');
            buffer.push('line 2');
            buffer.push('line 3');

            buffer.clear();

            expect(buffer.size()).toBe(0);
            expect(buffer.getLines()).toEqual([]);
        });

        it('should allow pushing after clear', () => {
            const buffer = new RingBuffer(3);

            buffer.push('old 1');
            buffer.push('old 2');
            buffer.clear();

            buffer.push('new 1');
            buffer.push('new 2');

            const lines = buffer.getLines();

            expect(lines).toEqual(['new 1', 'new 2']);
        });
    });

    describe('edge cases', () => {
        it('should handle capacity of 1', () => {
            const buffer = new RingBuffer(1);

            buffer.push('first');
            expect(buffer.getLines()).toEqual(['first']);

            buffer.push('second');
            expect(buffer.getLines()).toEqual(['second']);
        });

        it('should handle empty strings', () => {
            const buffer = new RingBuffer(3);

            buffer.push('');
            buffer.push('line 2');
            buffer.push('');

            const lines = buffer.getLines();

            expect(lines).toEqual(['', 'line 2', '']);
        });

        it('should handle very long strings', () => {
            const buffer = new RingBuffer(2);
            const longString = 'a'.repeat(10000);

            buffer.push(longString);
            buffer.push('short');

            const lines = buffer.getLines();

            expect(lines[0]).toBe(longString);
            expect(lines[1]).toBe('short');
        });

        it('should handle large capacity', () => {
            const buffer = new RingBuffer(10000);

            for (let i = 0; i < 5000; i++) {
                buffer.push(`line ${i}`);
            }

            expect(buffer.size()).toBe(5000);
            expect(buffer.isFull()).toBe(false);
        });

        it('should throw error for capacity less than 1', () => {
            expect(() => new RingBuffer(0)).toThrow('RingBuffer capacity must be a positive integer');
            expect(() => new RingBuffer(-1)).toThrow('RingBuffer capacity must be a positive integer');
        });

        it('should throw error for non-integer capacity', () => {
            expect(() => new RingBuffer(3.5)).toThrow('RingBuffer capacity must be a positive integer');
            expect(() => new RingBuffer(NaN)).toThrow('RingBuffer capacity must be a positive integer');
        });
    });

    describe('performance characteristics', () => {
        it('should have O(1) push operation', () => {
            const buffer = new RingBuffer(1000);

            // Fill buffer
            for (let i = 0; i < 1000; i++) {
                buffer.push(`line ${i}`);
            }

            const startTime = performance.now();
            buffer.push('new line');
            const endTime = performance.now();

            const pushTime = endTime - startTime;
            expect(pushTime).toBeLessThan(0.1); // <0.1ms
        });

        it('should have O(n) getLines operation where n is count', () => {
            const buffer = new RingBuffer(1000);

            for (let i = 0; i < 1000; i++) {
                buffer.push(`line ${i}`);
            }

            const startTime = performance.now();
            buffer.getLines(100);
            const endTime = performance.now();

            const getTime = endTime - startTime;
            expect(getTime).toBeLessThan(1); // <1ms for 100 lines
        });
    });

    describe('real-world log file scenario', () => {
        it('should efficiently handle streaming log tail', () => {
            const buffer = new RingBuffer(100); // Last 100 lines

            // Simulate log file with 10,000 lines
            for (let i = 0; i < 10000; i++) {
                buffer.push(`[${new Date().toISOString()}] Log entry ${i}`);
            }

            // Should only keep last 100
            expect(buffer.size()).toBe(100);

            const lines = buffer.getLines(10);

            // Should get last 10 lines (9990-9999)
            expect(lines.length).toBe(10);
            expect(lines[0]).toContain('Log entry 9990');
            expect(lines[9]).toContain('Log entry 9999');
        });
    });

    describe('iterator support', () => {
        it('should be iterable', () => {
            const buffer = new RingBuffer(5);

            buffer.push('A');
            buffer.push('B');
            buffer.push('C');

            const result: string[] = [];
            for (const line of buffer) {
                result.push(line);
            }

            expect(result).toEqual(['A', 'B', 'C']);
        });

        it('should iterate in chronological order after wrapping', () => {
            const buffer = new RingBuffer(3);

            buffer.push('A');
            buffer.push('B');
            buffer.push('C');
            buffer.push('D'); // Overwrites A

            const result: string[] = [];
            for (const line of buffer) {
                result.push(line);
            }

            expect(result).toEqual(['B', 'C', 'D']);
        });
    });

    describe('toString method', () => {
        it('should return lines joined with newlines', () => {
            const buffer = new RingBuffer(5);

            buffer.push('line 1');
            buffer.push('line 2');
            buffer.push('line 3');

            expect(buffer.toString()).toBe('line 1\nline 2\nline 3');
        });

        it('should return empty string for empty buffer', () => {
            const buffer = new RingBuffer(5);

            expect(buffer.toString()).toBe('');
        });
    });
});
