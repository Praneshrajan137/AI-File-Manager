/**
 * VectorStore - LanceDB wrapper for semantic search
 * 
 * LanceDB is an embedded vector database optimized for:
 * - Local storage (no external server)
 * - Fast similarity search
 * - Efficient disk usage
 * 
 * Privacy: All data stored locally, no cloud uploads
 * 
 * @implements IVectorStore
 */
import * as lancedb from '@lancedb/lancedb';
import {
    IVectorStore,
    TextChunk,
    VectorRecord,
    Embedding,
    IndexStats,
} from '../../shared/contracts';
import { HybridLexicalIndex, LexicalSearchMatch } from './HybridLexicalIndex';
import { RuntimeDiagnostics } from '../../main/services/RuntimeDiagnostics';
import fs from 'fs/promises';

// Type definitions for LanceDB
type LanceConnection = Awaited<ReturnType<typeof lancedb.connect>>;
type LanceTable = Awaited<ReturnType<LanceConnection['openTable']>>;

// Record type for LanceDB storage (using Record for compatibility)
type LanceRecord = Record<string, unknown> & {
    id: string;
    chunk_text: string;
    vector: number[];
    file_path: string;
    chunk_index: number;
    indexed_at: number;
};

export class VectorStore implements IVectorStore {
    private db: LanceConnection | null = null;
    private table: LanceTable | null = null;
    private dbPath: string = '';
    private readonly TABLE_NAME = 'file_chunks';
    private readonly EMBEDDING_DIM = 384;

    /** Batch write optimization: accumulate records before flushing */
    private pendingRecords: LanceRecord[] = [];
    private filesPendingReplace = new Set<string>();
    private lexicalIndex = new HybridLexicalIndex();
    private opChain: Promise<void> = Promise.resolve();
    private readonly BATCH_WRITE_SIZE = 50;

    private withLock<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.opChain.then(operation, operation);
        this.opChain = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    /**
     * Initialize vector database.
     */
    async initialize(dbPath: string): Promise<void> {
        if (this.db && this.dbPath === dbPath) {
            return;
        }

        this.dbPath = dbPath;

        try {
            await fs.mkdir(dbPath, { recursive: true });
            this.db = await lancedb.connect(dbPath);

            const tableNames = await this.db.tableNames();
            if (tableNames.includes(this.TABLE_NAME)) {
                this.table = await this.db.openTable(this.TABLE_NAME);
                await this.rebuildLexicalIndexFromTable();
            } else {
                await this.createTable();
                this.lexicalIndex.clear();
            }

            RuntimeDiagnostics.getInstance().setVectorStoreStats({
                initialized: true,
                totalChunks: this.lexicalIndex.size(),
                indexedFiles: this.lexicalIndex.fileCount(),
                lexicalDocs: this.lexicalIndex.size(),
                pendingBuffer: this.pendingRecords.length,
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to initialize vector store: ${msg}`);
        }
    }

    private async rebuildLexicalIndexFromTable(): Promise<void> {
        if (!this.table) {
            return;
        }
        try {
            const count = await this.table.countRows();
            if (count === 0) {
                this.lexicalIndex.clear();
                return;
            }
            const rows = (await this.table.query().toArray()) as LanceRecord[];
            const vectorRecords: VectorRecord[] = rows.map((row) => ({
                id: row.id,
                chunk_text: row.chunk_text,
                embedding: this.toPlainVector(row.vector),
                file_path: row.file_path,
                chunk_index: row.chunk_index,
                indexed_at: row.indexed_at,
            }));
            this.lexicalIndex.rebuildFromRecords(vectorRecords);
        } catch {
            this.lexicalIndex.clear();
        }
    }

    private async createTable(): Promise<void> {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const sampleRecord = {
            id: '__sample__',
            chunk_text: '',
            vector: new Array(this.EMBEDDING_DIM).fill(0) as number[],
            file_path: '',
            chunk_index: 0,
            indexed_at: Date.now(),
        };

        this.table = await this.db.createTable(this.TABLE_NAME, [sampleRecord]);

        try {
            await this.table.delete("id = '__sample__'");
        } catch {
            // Ignore
        }
    }

    async addChunks(
        chunks: TextChunk[],
        embeddings: Embedding[],
        filePath: string
    ): Promise<void> {
        this.ensureInitialized();

        if (chunks.length !== embeddings.length) {
            throw new Error(
                `Chunks and embeddings length mismatch: ${chunks.length} vs ${embeddings.length}`
            );
        }

        if (chunks.length === 0) {
            return;
        }

        return this.withLock(async () => {
            const now = Date.now();
            const records: LanceRecord[] = chunks.map((chunk, i) => ({
                id: `${filePath}:${chunk.chunkIndex}`,
                chunk_text: chunk.text,
                vector: embeddings[i],
                file_path: filePath,
                chunk_index: chunk.chunkIndex,
                indexed_at: now,
            }));

            // Eliminate any older pending records & schedule persisted delete-before-upsert
            this.pendingRecords = this.pendingRecords.filter((rec) => rec.file_path !== filePath);
            this.filesPendingReplace.add(filePath);

            // Keep hybrid lexical BM25 index immediately synchronized
            this.lexicalIndex.removeByFilePath(filePath);
            this.lexicalIndex.upsertBatch(
                records.map((r) => ({
                    id: r.id,
                    chunk_text: r.chunk_text,
                    embedding: r.vector,
                    file_path: r.file_path,
                    chunk_index: r.chunk_index,
                    indexed_at: r.indexed_at,
                }))
            );

            // Add to pending batch for optimized writes
            this.pendingRecords.push(...records);

            RuntimeDiagnostics.getInstance().setVectorStoreStats({
                initialized: true,
                lexicalDocs: this.lexicalIndex.size(),
                pendingBuffer: this.pendingRecords.length,
            });

            // Flush when batch size reached
            if (this.pendingRecords.length >= this.BATCH_WRITE_SIZE) {
                await this.flushPendingRecordsUnlocked();
            }
        });
    }

    /**
     * Flush pending records to database (serialized + delete-before-upsert prevents duplicates).
     */
    async flushPendingRecords(): Promise<void> {
        return this.withLock(async () => {
            await this.flushPendingRecordsUnlocked();
        });
    }

    private async flushPendingRecordsUnlocked(): Promise<void> {
        if (this.pendingRecords.length === 0 && this.filesPendingReplace.size === 0) return;

        this.ensureInitialized();

        const filesToDelete = Array.from(this.filesPendingReplace);
        const recordsToAdd = [...this.pendingRecords];

        try {
            // Delete existing LanceDB chunks for re-indexed files first
            for (const filePath of filesToDelete) {
                try {
                    await this.table!.delete(`file_path = '${this.escapeSql(filePath)}'`);
                } catch (deleteError: unknown) {
                    const msg = deleteError instanceof Error ? deleteError.message : String(deleteError);
                    if (!msg.includes('not found') && !msg.includes('empty')) {
                        throw deleteError;
                    }
                }
            }

            if (recordsToAdd.length > 0) {
                await this.table!.add(recordsToAdd);
            }

            this.filesPendingReplace.clear();
            this.pendingRecords = [];

            RuntimeDiagnostics.getInstance().setVectorStoreStats({
                initialized: true,
                totalChunks: this.lexicalIndex.size(),
                indexedFiles: this.lexicalIndex.fileCount(),
                lexicalDocs: this.lexicalIndex.size(),
                pendingBuffer: 0,
            });

            // Yield after write to prevent blocking
            await new Promise(resolve => setImmediate(resolve));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to flush pending records: ${msg}`);
        }
    }

    async search(
        queryEmbedding: Embedding,
        topK: number = 10
    ): Promise<VectorRecord[]> {
        return this.withLock(async () => {
            this.ensureInitialized();

            if (this.pendingRecords.length > 0 || this.filesPendingReplace.size > 0) {
                await this.flushPendingRecordsUnlocked();
            }

            try {
                const count = await this.table!.countRows();
                if (count === 0) {
                    return [];
                }

                // LanceDB v0.4.20: Use vectorSearch() method
                const results = await this.table!.vectorSearch(queryEmbedding).limit(topK).toArray() as LanceRecord[];

                return results.map((row) => ({
                    id: row.id,
                    chunk_text: row.chunk_text,
                    embedding: this.toPlainVector(row.vector),
                    file_path: row.file_path,
                    chunk_index: row.chunk_index,
                    indexed_at: row.indexed_at,
                }));
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                if (msg.includes('empty') || msg.includes('not found')) {
                    return [];
                }
                throw new Error(`Search failed: ${msg}`);
            }
        });
    }

    /**
     * Sort records by cosine similarity to query (fallback method).
     */
    private sortBySimilarity(rows: LanceRecord[], query: number[]): LanceRecord[] {
        return rows
            .map((row) => ({
                row,
                similarity: this.cosineSimilarity(row.vector, query),
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .map((item) => item.row);
    }

    /**
     * Calculate cosine similarity between two vectors.
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    searchLexical(query: string, topK: number = 10): LexicalSearchMatch[] {
        return this.lexicalIndex.search(query, topK);
    }

    async deleteFile(filePath: string): Promise<number> {
        return this.withLock(async () => {
            this.ensureInitialized();

            const beforePendingCount = this.pendingRecords.length;
            this.pendingRecords = this.pendingRecords.filter((rec) => rec.file_path !== filePath);
            const removedPending = beforePendingCount - this.pendingRecords.length;
            this.filesPendingReplace.delete(filePath);
            this.lexicalIndex.removeByFilePath(filePath);

            try {
                const filterExpr = `file_path = '${this.escapeSql(filePath)}'`;
                const persistedCount = await this.table!.countRows(filterExpr);

                if (persistedCount > 0) {
                    await this.table!.delete(filterExpr);
                }

                RuntimeDiagnostics.getInstance().setVectorStoreStats({
                    initialized: true,
                    totalChunks: this.lexicalIndex.size(),
                    indexedFiles: this.lexicalIndex.fileCount(),
                    lexicalDocs: this.lexicalIndex.size(),
                    pendingBuffer: this.pendingRecords.length,
                });

                return persistedCount + removedPending;
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                if (msg.includes('not found') || msg.includes('empty')) {
                    return removedPending;
                }
                throw new Error(`Delete failed: ${msg}`);
            }
        });
    }

    async getStats(): Promise<IndexStats> {
        return this.withLock(async () => {
            this.ensureInitialized();

            if (this.pendingRecords.length > 0 || this.filesPendingReplace.size > 0) {
                await this.flushPendingRecordsUnlocked();
            }

            try {
                const count = await this.table!.countRows();

                if (count === 0) {
                    RuntimeDiagnostics.getInstance().setVectorStoreStats({
                        initialized: true,
                        totalChunks: 0,
                        indexedFiles: 0,
                        lexicalDocs: this.lexicalIndex.size(),
                        pendingBuffer: this.pendingRecords.length,
                    });
                    return {
                        totalFiles: 0,
                        totalChunks: 0,
                        totalTokens: 0,
                        indexSize: 0,
                        lastIndexed: 0,
                    };
                }

                const allRows = (await this.table!
                    .query()
                    .select(['file_path', 'chunk_text', 'indexed_at'])
                    .toArray()) as Array<Pick<LanceRecord, 'file_path' | 'chunk_text' | 'indexed_at'>>;

                const uniqueFiles = new Set(allRows.map((r) => r.file_path));
                const totalTokens = allRows.reduce(
                    (sum, r) => sum + Math.ceil((r.chunk_text?.length ?? 0) / 4),
                    0
                );
                const indexSize = allRows.length * (this.EMBEDDING_DIM * 4 + 200);
                const lastIndexed = allRows.length > 0
                    ? Math.max(...allRows.map((r) => Number(r.indexed_at) || 0))
                    : 0;

                RuntimeDiagnostics.getInstance().setVectorStoreStats({
                    initialized: true,
                    totalChunks: allRows.length,
                    indexedFiles: uniqueFiles.size,
                    lexicalDocs: this.lexicalIndex.size(),
                    pendingBuffer: this.pendingRecords.length,
                });

                return {
                    totalFiles: uniqueFiles.size,
                    totalChunks: allRows.length,
                    totalTokens,
                    indexSize,
                    lastIndexed,
                };
            } catch {
                return {
                    totalFiles: 0,
                    totalChunks: 0,
                    totalTokens: 0,
                    indexSize: 0,
                    lastIndexed: 0,
                };
            }
        });
    }

    async clear(): Promise<{ success: boolean }> {
        return this.withLock(async () => {
            this.ensureInitialized();

            try {
                this.pendingRecords = [];
                this.filesPendingReplace.clear();
                this.lexicalIndex.clear();
                await this.db!.dropTable(this.TABLE_NAME);
                await this.createTable();

                RuntimeDiagnostics.getInstance().setVectorStoreStats({
                    initialized: true,
                    totalChunks: 0,
                    indexedFiles: 0,
                    lexicalDocs: 0,
                    pendingBuffer: 0,
                });

                return { success: true };
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                throw new Error(`Clear failed: ${msg}`);
            }
        });
    }

    private toPlainVector(raw: unknown): number[] {
        if (Array.isArray(raw)) {
            return raw.map((v) => Number(v));
        }
        if (raw && typeof (raw as { toArray?: () => ArrayLike<number> }).toArray === 'function') {
            return Array.from((raw as { toArray: () => ArrayLike<number> }).toArray(), Number);
        }
        if (raw && typeof (raw as Iterable<number>)[Symbol.iterator] === 'function') {
            return Array.from(raw as Iterable<number>, Number);
        }
        if (raw && typeof (raw as { length?: number; get?: (i: number) => number }).get === 'function') {
            const vec = raw as { length: number; get: (i: number) => number };
            const out: number[] = new Array(vec.length);
            for (let i = 0; i < vec.length; i++) {
                out[i] = Number(vec.get(i));
            }
            return out;
        }
        return [];
    }

    private ensureInitialized(): void {
        if (!this.db || !this.table) {
            throw new Error('VectorStore not initialized. Call initialize() first.');
        }
    }

    private escapeSql(str: string): string {
        return str.replace(/'/g, "''");
    }
}
