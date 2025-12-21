/**
 * LLMMetrics - Performance Monitoring for LLM Operations
 * 
 * Tracks timing and performance metrics across LLM operations:
 * - Embedding generation time
 * - Indexing throughput
 * - Retrieval latency
 * - LLM query response time
 * 
 * Provides statistical analysis (avg, p95, count) for each operation type.
 * Uses singleton pattern for global access across services.
 */

export interface MetricStats {
    /** Average duration in milliseconds */
    avg: number;

    /** 95th percentile duration */
    p95: number;

    /** Total number of samples */
    count: number;

    /** Minimum duration recorded */
    min: number;

    /** Maximum duration recorded */
    max: number;
}

export interface AllMetrics {
    [operation: string]: MetricStats;
}

/**
 * Operation types tracked by the metrics system.
 */
export enum MetricOperation {
    EMBED_SINGLE = 'embed_single',
    EMBED_BATCH = 'embed_batch',
    INDEX_FILE = 'index_file',
    VECTOR_SEARCH = 'vector_search',
    VECTOR_ADD = 'vector_add',
    RETRIEVAL = 'retrieval',
    LLM_QUERY = 'llm_query',
    PDF_EXTRACT = 'pdf_extract',
}

export class LLMMetrics {
    private static instance: LLMMetrics | null = null;

    /** Timing samples per operation (max 100 samples kept) */
    private timings: Map<string, number[]> = new Map();

    /** Maximum samples to keep per operation */
    private readonly MAX_SAMPLES = 100;

    /** Counter for operations */
    private counters: Map<string, number> = new Map();

    /**
     * Get singleton instance.
     */
    static getInstance(): LLMMetrics {
        if (!LLMMetrics.instance) {
            LLMMetrics.instance = new LLMMetrics();
        }
        return LLMMetrics.instance;
    }

    /**
     * Reset singleton instance (for testing).
     */
    static resetInstance(): void {
        LLMMetrics.instance = null;
    }

    /**
     * Record a timing measurement for an operation.
     * 
     * @param operation - Operation type
     * @param durationMs - Duration in milliseconds
     */
    recordTiming(operation: MetricOperation | string, durationMs: number): void {
        const key = operation.toString();

        if (!this.timings.has(key)) {
            this.timings.set(key, []);
        }

        const samples = this.timings.get(key)!;
        samples.push(durationMs);

        // Keep only last MAX_SAMPLES
        if (samples.length > this.MAX_SAMPLES) {
            samples.shift();
        }

        // Increment counter
        this.counters.set(key, (this.counters.get(key) || 0) + 1);
    }

    /**
     * Create a timer that records duration when stopped.
     * 
     * @param operation - Operation type
     * @returns Object with stop() method
     * 
     * @example
     * const timer = metrics.startTimer(MetricOperation.INDEX_FILE);
     * await indexFile(path);
     * timer.stop(); // Records duration
     */
    startTimer(operation: MetricOperation | string): { stop: () => number } {
        const startTime = performance.now();

        return {
            stop: () => {
                const duration = performance.now() - startTime;
                this.recordTiming(operation, duration);
                return duration;
            },
        };
    }

    /**
     * Get statistics for a specific operation.
     * 
     * @param operation - Operation type
     * @returns Stats object with avg, p95, count, min, max
     */
    getStats(operation: MetricOperation | string): MetricStats {
        const key = operation.toString();
        const samples = this.timings.get(key) || [];

        if (samples.length === 0) {
            return { avg: 0, p95: 0, count: 0, min: 0, max: 0 };
        }

        const sorted = [...samples].sort((a, b) => a - b);
        const sum = samples.reduce((a, b) => a + b, 0);
        const avg = sum / samples.length;
        const p95Index = Math.floor(sorted.length * 0.95);
        const p95 = sorted[p95Index] || sorted[sorted.length - 1];

        return {
            avg: Math.round(avg * 100) / 100,
            p95: Math.round(p95 * 100) / 100,
            count: this.counters.get(key) || samples.length,
            min: Math.round(sorted[0] * 100) / 100,
            max: Math.round(sorted[sorted.length - 1] * 100) / 100,
        };
    }

    /**
     * Get statistics for all tracked operations.
     * 
     * @returns Object mapping operation names to stats
     */
    getAllStats(): AllMetrics {
        const result: AllMetrics = {};

        for (const key of this.timings.keys()) {
            result[key] = this.getStats(key);
        }

        return result;
    }

    /**
     * Get a formatted report of all metrics.
     * 
     * @returns Human-readable metrics report
     */
    getReport(): string {
        const stats = this.getAllStats();
        const lines: string[] = ['=== LLM Metrics Report ===', ''];

        for (const [operation, operationStats] of Object.entries(stats)) {
            lines.push(`${operation}:`);
            lines.push(`  Count: ${operationStats.count}`);
            lines.push(`  Avg: ${operationStats.avg}ms`);
            lines.push(`  P95: ${operationStats.p95}ms`);
            lines.push(`  Range: ${operationStats.min}ms - ${operationStats.max}ms`);
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Clear all metrics data.
     */
    clear(): void {
        this.timings.clear();
        this.counters.clear();
    }

    /**
     * Increment a counter without timing.
     * Useful for tracking events like errors.
     * 
     * @param name - Counter name
     * @param value - Amount to increment (default: 1)
     */
    incrementCounter(name: string, value: number = 1): void {
        this.counters.set(name, (this.counters.get(name) || 0) + value);
    }

    /**
     * Get counter value.
     * 
     * @param name - Counter name
     * @returns Counter value
     */
    getCounter(name: string): number {
        return this.counters.get(name) || 0;
    }
}

// Export singleton getter for convenience
export const getLLMMetrics = (): LLMMetrics => LLMMetrics.getInstance();
