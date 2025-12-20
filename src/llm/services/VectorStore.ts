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
            } else {
                await this.createTable();
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to initialize vector store: ${msg}`);
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

        const records = chunks.map((chunk, i) => ({
            id: `${filePath}:${chunk.chunkIndex}`,
            chunk_text: chunk.text,
            vector: embeddings[i],
            file_path: filePath,
            chunk_index: chunk.chunkIndex,
            indexed_at: Date.now(),
        }));

        try {
            await this.table!.add(records);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to add chunks: ${msg}`);
        }
    }

    async search(
        queryEmbedding: Embedding,
        topK: number = 10
    ): Promise<VectorRecord[]> {
        this.ensureInitialized();

        try {
            const count = await this.table!.countRows();
            if (count === 0) {
                return [];
            }

            // LanceDB v0.4.20: Use vectorSearch() method
            // The table.vectorSearch(vector) returns a VectorQuery builder
            // Chain: .limit(n).toArray() to get results
            const results = await this.table!.vectorSearch(queryEmbedding).limit(topK).toArray() as LanceRecord[];

            // Map LanceDB results to VectorRecord
            // Results include: id, chunk_text, vector, file_path, chunk_index, indexed_at, _distance
            return results.map((row) => ({
                id: row.id,
                chunk_text: row.chunk_text,
                embedding: row.vector,
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

    async deleteFile(filePath: string): Promise<number> {
        this.ensureInitialized();

        try {
            // Get all rows first to count
            const allRows = await this.table!.query().toArray() as LanceRecord[];
            const matchingRows = allRows.filter(
                (r) => r.file_path === filePath
            );
            const count = matchingRows.length;

            if (count === 0) {
                return 0;
            }

            await this.table!.delete(`file_path = '${this.escapeSql(filePath)}'`);
            return count;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('not found') || msg.includes('empty')) {
                return 0;
            }
            throw new Error(`Delete failed: ${msg}`);
        }
    }

    async getStats(): Promise<IndexStats> {
        this.ensureInitialized();

        try {
            const count = await this.table!.countRows();

            if (count === 0) {
                return {
                    totalFiles: 0,
                    totalChunks: 0,
                    totalTokens: 0,
                    indexSize: 0,
                    lastIndexed: 0,
                };
            }

            const allRows = await this.table!.query().toArray() as LanceRecord[];

            const uniqueFiles = new Set(allRows.map((r) => r.file_path));
            const totalTokens = allRows.reduce(
                (sum, r) => sum + Math.ceil(r.chunk_text.length / 4),
                0
            );
            const indexSize = allRows.length * (this.EMBEDDING_DIM * 4 + 200);
            const lastIndexed = allRows.length > 0
                ? Math.max(...allRows.map((r) => r.indexed_at))
                : 0;

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
    }

    async clear(): Promise<{ success: boolean }> {
        this.ensureInitialized();

        try {
            await this.db!.dropTable(this.TABLE_NAME);
            await this.createTable();
            return { success: true };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Clear failed: ${msg}`);
        }
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
