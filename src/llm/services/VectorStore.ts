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
    DEFAULT_EMBEDDING_MODEL,
    IVectorStore,
    TextChunk,
    VectorRecord,
    Embedding,
    IndexStats,
    SearchScopeFilter,
} from '../../shared/contracts';
import { LexicalSearchMatch } from './HybridLexicalIndex';
import {
    KnowledgeGraphChunkRecord,
    WorkspaceKnowledgeGraph,
} from '../../main/services/WorkspaceKnowledgeGraph';
import { ExtractedLink, ExtractedSymbol } from './StructuralChunker';
import { RuntimeDiagnostics } from '../../main/services/RuntimeDiagnostics';
import fs from 'fs/promises';
import path from 'path';

// Type definitions for LanceDB
type LanceConnection = Awaited<ReturnType<typeof lancedb.connect>>;
type LanceTable = Awaited<ReturnType<LanceConnection['openTable']>>;

const VECTOR_SCHEMA_VERSION = 2;
const VECTOR_META_FILENAME = 'vector-meta.json';
const KNOWLEDGE_GRAPH_FILENAME = 'knowledge-graph.sqlite';
const MAX_LEGACY_BACKFILL_ROWS = 500;

interface VectorMetaFile {
    schemaVersion: number;
    modelId: string;
    dimensions: number;
    updatedAt: number;
}

export interface VectorMigrationNotice {
    needsReindex: boolean;
    reason?: string;
    previousModelId?: string;
    currentModelId: string;
}

export interface VectorStoreOptions {
    modelId?: string;
    dimensions?: number;
    autoResetOnMismatch?: boolean;
    knowledgeGraph?: WorkspaceKnowledgeGraph;
    enableKnowledgeGraph?: boolean;
}

export interface ChunkIndexMetadata {
    sha256?: string;
    size?: number;
    mtimeMs?: number;
    fileType?: string;
    symbols?: ExtractedSymbol[];
    links?: ExtractedLink[];
}

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
    private readonly EMBEDDING_DIM: number;
    private readonly modelId: string;
    private readonly autoResetOnMismatch: boolean;
    private readonly injectedKnowledgeGraph?: WorkspaceKnowledgeGraph;
    private readonly enableKnowledgeGraph: boolean;
    private knowledgeGraph: WorkspaceKnowledgeGraph | null = null;
    private ownsKnowledgeGraph = false;
    private migrationNotice: VectorMigrationNotice;

    /** Batch write optimization: accumulate records before flushing */
    private pendingRecords: LanceRecord[] = [];
    private filesPendingReplace = new Set<string>();
    private opChain: Promise<void> = Promise.resolve();
    private readonly BATCH_WRITE_SIZE = 50;

    constructor(options: VectorStoreOptions = {}) {
        this.modelId = options.modelId || DEFAULT_EMBEDDING_MODEL;
        this.EMBEDDING_DIM = options.dimensions ?? 384;
        this.autoResetOnMismatch = options.autoResetOnMismatch ?? true;
        this.injectedKnowledgeGraph = options.knowledgeGraph;
        this.enableKnowledgeGraph = options.enableKnowledgeGraph ?? true;
        this.knowledgeGraph = options.knowledgeGraph ?? null;
        this.migrationNotice = {
            needsReindex: false,
            currentModelId: this.modelId,
        };
    }

    getModelId(): string {
        return this.modelId;
    }

    getMigrationNotice(): VectorMigrationNotice {
        return { ...this.migrationNotice };
    }

    private withLock<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.opChain.then(operation, operation);
        this.opChain = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    private async readMetaFile(dbPath: string): Promise<VectorMetaFile | null> {
        try {
            const raw = await fs.readFile(path.join(dbPath, VECTOR_META_FILENAME), 'utf-8');
            const parsed = JSON.parse(raw) as Partial<VectorMetaFile>;
            if (typeof parsed.modelId === 'string' && typeof parsed.dimensions === 'number') {
                return {
                    schemaVersion: Number(parsed.schemaVersion ?? 1),
                    modelId: parsed.modelId,
                    dimensions: parsed.dimensions,
                    updatedAt: Number(parsed.updatedAt ?? Date.now()),
                };
            }
        } catch {
            // Missing or unreadable marker indicates pre-M8 index or fresh directory
        }
        return null;
    }

    private async writeMetaFile(dbPath: string): Promise<void> {
        const payload: VectorMetaFile = {
            schemaVersion: VECTOR_SCHEMA_VERSION,
            modelId: this.modelId,
            dimensions: this.EMBEDDING_DIM,
            updatedAt: Date.now(),
        };
        await fs.writeFile(
            path.join(dbPath, VECTOR_META_FILENAME),
            JSON.stringify(payload, null, 2),
            'utf-8'
        );
    }

    /**
     * Initialize vector database.
     */
    async initialize(dbPath: string): Promise<void> {
        if (this.db && this.dbPath === dbPath) {
            return;
        }

        this.dbPath = dbPath;
        this.migrationNotice = {
            needsReindex: false,
            currentModelId: this.modelId,
        };

        try {
            await fs.mkdir(dbPath, { recursive: true });
            if (this.enableKnowledgeGraph) {
                if (this.ownsKnowledgeGraph && this.knowledgeGraph) {
                    this.knowledgeGraph.close();
                    this.knowledgeGraph = null;
                }
                if (this.injectedKnowledgeGraph) {
                    this.knowledgeGraph = this.injectedKnowledgeGraph;
                    this.ownsKnowledgeGraph = false;
                } else {
                    this.knowledgeGraph = new WorkspaceKnowledgeGraph(
                        path.join(dbPath, KNOWLEDGE_GRAPH_FILENAME)
                    );
                    this.ownsKnowledgeGraph = true;
                }
            }
            this.db = await lancedb.connect(dbPath);

            const tableNames = await this.db.tableNames();
            if (tableNames.includes(this.TABLE_NAME)) {
                this.table = await this.db.openTable(this.TABLE_NAME);
                const existingMeta = await this.readMetaFile(dbPath);
                const rowCount = await this.table.countRows();
                const mismatch =
                    !existingMeta ||
                    existingMeta.modelId !== this.modelId ||
                    existingMeta.dimensions !== this.EMBEDDING_DIM ||
                    existingMeta.schemaVersion !== VECTOR_SCHEMA_VERSION;

                if (mismatch && rowCount > 0) {
                    const prevModel = existingMeta?.modelId ?? 'pre-M8-legacy';
                    const reason = `Existing vector index (${prevModel}, ${existingMeta?.dimensions ?? this.EMBEDDING_DIM}d) requires clean re-index for ${this.modelId}`;
                    this.migrationNotice = {
                        needsReindex: true,
                        previousModelId: prevModel,
                        currentModelId: this.modelId,
                        reason,
                    };

                    if (this.autoResetOnMismatch) {
                        await this.db.dropTable(this.TABLE_NAME);
                        await this.createTable();
                        this.knowledgeGraph?.clear();
                        await this.writeMetaFile(dbPath);
                    } else {
                        await this.backfillSmallLegacyGraphIfEmpty(rowCount);
                    }
                } else {
                    if (!existingMeta || mismatch) {
                        await this.writeMetaFile(dbPath);
                    }
                    await this.backfillSmallLegacyGraphIfEmpty(rowCount);
                }
            } else {
                await this.createTable();
                await this.writeMetaFile(dbPath);
                // Preserve any existing SQLite lexical/knowledge-graph index when creating
                // a missing LanceDB table so lexical-first/pre-populated stores are never wiped.
            }

            const kgStats = this.knowledgeGraph?.getStats() ?? {
                totalFiles: 0,
                totalChunks: 0,
                totalTokens: 0,
                lastIndexed: 0,
            };

            RuntimeDiagnostics.getInstance().setVectorStoreStats({
                initialized: true,
                totalChunks: kgStats.totalChunks,
                indexedFiles: kgStats.totalFiles,
                lexicalDocs: kgStats.totalChunks,
                pendingBuffer: this.pendingRecords.length,
                modelId: this.modelId,
                needsReindex: this.migrationNotice.needsReindex,
                migrationReason: this.migrationNotice.reason,
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to initialize vector store: ${msg}`);
        }
    }

    /**
     * Bounded legacy migration helper: only runs if SQLite Knowledge Graph is empty
     * AND existing LanceDB table is tiny (<= 500 rows), avoiding full-table OOM scans.
     */
    private async backfillSmallLegacyGraphIfEmpty(rowCount: number): Promise<void> {
        if (!this.table || !this.knowledgeGraph || rowCount === 0 || rowCount > MAX_LEGACY_BACKFILL_ROWS) {
            return;
        }
        const kgStats = this.knowledgeGraph.getStats();
        if (kgStats.totalChunks > 0) {
            return;
        }
        try {
            const rows = (await this.table.query().limit(MAX_LEGACY_BACKFILL_ROWS).toArray()) as LanceRecord[];
            const byFile = new Map<string, LanceRecord[]>();
            for (const row of rows) {
                const list = byFile.get(row.file_path) ?? [];
                list.push(row);
                byFile.set(row.file_path, list);
            }
            for (const [filePath, fileRows] of byFile.entries()) {
                fileRows.sort((a, b) => a.chunk_index - b.chunk_index);
                let charCursor = 0;
                this.knowledgeGraph.upsertDocument({
                    filePath,
                    indexedAt: Math.max(...fileRows.map((r) => Number(r.indexed_at) || 0)),
                    chunks: fileRows.map((r) => {
                        const startChar = charCursor;
                        charCursor += r.chunk_text.length;
                        return {
                            id: r.id,
                            chunkIndex: r.chunk_index,
                            text: r.chunk_text,
                            startChar,
                            endChar: charCursor,
                        };
                    }),
                });
            }
        } catch {
            // Best-effort bounded backfill; never crash initialization
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

    getKnowledgeGraph(): WorkspaceKnowledgeGraph | null {
        return this.knowledgeGraph;
    }

    needsReindex(filePath: string, mtimeMs: number, size: number, sha256?: string): boolean {
        if (!this.knowledgeGraph) {
            return true;
        }
        return this.knowledgeGraph.needsReindex(filePath, mtimeMs, size, sha256);
    }

    getIndexedFiles(limit: number = 10000): string[] {
        return this.knowledgeGraph?.getIndexedFiles(limit) ?? [];
    }

    async addChunks(
        chunks: TextChunk[],
        embeddings: Embedding[],
        filePath: string,
        metadata?: ChunkIndexMetadata
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
            const seenChunkIds = new Set<string>();
            const resolvedIds = chunks.map((chunk, i) => {
                let candidateId = `${filePath}:${chunk.chunkIndex}`;
                if (seenChunkIds.has(candidateId)) {
                    candidateId = `${filePath}:${chunk.chunkIndex}#${i}`;
                }
                seenChunkIds.add(candidateId);
                return candidateId;
            });

            const records: LanceRecord[] = chunks.map((chunk, i) => ({
                id: resolvedIds[i],
                chunk_text: chunk.text,
                vector: embeddings[i],
                file_path: filePath,
                chunk_index: chunk.chunkIndex,
                indexed_at: now,
            }));

            // Eliminate any older pending records & schedule persisted delete-before-upsert
            this.pendingRecords = this.pendingRecords.filter((rec) => rec.file_path !== filePath);
            this.filesPendingReplace.add(filePath);

            // Upsert into disk-backed SQLite Knowledge Graph (FTS5 BM25 + SHA-256 + symbols/links)
            this.knowledgeGraph?.upsertDocument({
                filePath,
                sha256: metadata?.sha256,
                size: metadata?.size,
                mtimeMs: metadata?.mtimeMs,
                fileType: metadata?.fileType,
                indexedAt: now,
                chunks: chunks.map((c, i) => ({
                    id: resolvedIds[i],
                    chunkIndex: c.chunkIndex,
                    text: c.text,
                    startChar: c.startChar,
                    endChar: c.endChar,
                    startLine: c.startLine,
                    endLine: c.endLine,
                    heading: c.heading,
                })),
                symbols: metadata?.symbols,
                links: metadata?.links,
            });

            // Add to pending batch for optimized writes
            this.pendingRecords.push(...records);

            const kgStats = this.knowledgeGraph?.getStats();
            RuntimeDiagnostics.getInstance().setVectorStoreStats({
                initialized: true,
                totalChunks: kgStats?.totalChunks ?? this.pendingRecords.length,
                indexedFiles: kgStats?.totalFiles ?? 0,
                lexicalDocs: kgStats?.totalChunks ?? this.pendingRecords.length,
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
            // Delete existing LanceDB chunks for re-indexed files in batched SQL slices
            if (filesToDelete.length > 0) {
                const BATCH_DELETE_SIZE = 100;
                for (let idx = 0; idx < filesToDelete.length; idx += BATCH_DELETE_SIZE) {
                    const batch = filesToDelete.slice(idx, idx + BATCH_DELETE_SIZE);
                    const inList = batch.map((p) => `'${this.escapeSql(p)}'`).join(', ');
                    try {
                        await this.table!.delete(`file_path IN (${inList})`);
                    } catch (batchErr: unknown) {
                        const batchMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
                        if (batchMsg.includes('not found') || batchMsg.includes('empty')) {
                            continue;
                        }
                        // Fallback for minimal mock tables that only match `file_path = '...'`
                        for (const filePath of batch) {
                            try {
                                await this.table!.delete(`file_path = '${this.escapeSql(filePath)}'`);
                            } catch (deleteError: unknown) {
                                const msg = deleteError instanceof Error ? deleteError.message : String(deleteError);
                                if (!msg.includes('not found') && !msg.includes('empty')) {
                                    throw deleteError;
                                }
                            }
                        }
                    }
                }
            }

            if (recordsToAdd.length > 0) {
                await this.table!.add(recordsToAdd);
            }

            this.filesPendingReplace.clear();
            this.pendingRecords = [];

            const kgStats = this.knowledgeGraph?.getStats();
            RuntimeDiagnostics.getInstance().setVectorStoreStats({
                initialized: true,
                totalChunks: kgStats?.totalChunks ?? 0,
                indexedFiles: kgStats?.totalFiles ?? 0,
                lexicalDocs: kgStats?.totalChunks ?? 0,
                pendingBuffer: 0,
            });

            // Yield after write to prevent blocking
            await new Promise(resolve => setImmediate(resolve));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to flush pending records: ${msg}`);
        }
    }

    private buildScopedPathFilter(scopeFilter?: SearchScopeFilter): {
        emptyScope: boolean;
        sqlPredicate: string | null;
        allowedCanonicalSet: Set<string> | null;
    } {
        if (!scopeFilter) {
            return { emptyScope: false, sqlPredicate: null, allowedCanonicalSet: null };
        }

        const hasScopeCriteria = Boolean(
            (scopeFilter.folderPath && scopeFilter.folderPath.trim().length > 0) ||
            (Array.isArray(scopeFilter.filePaths) && scopeFilter.filePaths.length > 0) ||
            (Array.isArray(scopeFilter.fileExtensions) && scopeFilter.fileExtensions.length > 0)
        );
        if (!hasScopeCriteria) {
            return { emptyScope: false, sqlPredicate: null, allowedCanonicalSet: null };
        }

        const canonicalKey = (p: string): string =>
            process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

        if (this.knowledgeGraph) {
            const scopedFiles = this.knowledgeGraph.getFilesInScope(scopeFilter, 10000);
            if (scopedFiles.length === 0) {
                return { emptyScope: true, sqlPredicate: null, allowedCanonicalSet: new Set() };
            }
            const allowedCanonicalSet = new Set(scopedFiles.map(canonicalKey));
            if (scopedFiles.length <= 250) {
                const inList = scopedFiles.map((p) => `'${this.escapeSql(p)}'`).join(', ');
                return {
                    emptyScope: false,
                    sqlPredicate: `file_path IN (${inList})`,
                    allowedCanonicalSet,
                };
            }
            // Large subtrees (>250 files): enforce SQLite-verified canonical membership after widened pre-fetch
            return {
                emptyScope: false,
                sqlPredicate: null,
                allowedCanonicalSet,
            };
        }

        if (Array.isArray(scopeFilter.filePaths) && scopeFilter.filePaths.length > 0 && scopeFilter.filePaths.length <= 250) {
            const inList = scopeFilter.filePaths.map((p) => `'${this.escapeSql(p)}'`).join(', ');
            return {
                emptyScope: false,
                sqlPredicate: `file_path IN (${inList})`,
                allowedCanonicalSet: new Set(scopeFilter.filePaths.map(canonicalKey)),
            };
        }

        return { emptyScope: false, sqlPredicate: null, allowedCanonicalSet: null };
    }

    async search(
        queryEmbedding: Embedding,
        topK: number = 10,
        scopeFilter?: SearchScopeFilter
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

                const scope = this.buildScopedPathFilter(scopeFilter);
                if (scope.emptyScope) {
                    return [];
                }

                let queryBuilder = this.table!.vectorSearch(queryEmbedding) as unknown as {
                    distanceType?: (metric: 'l2' | 'cosine' | 'dot') => unknown;
                    where?: (predicate: string) => unknown;
                    limit: (k: number) => { toArray: () => Promise<LanceRecord[]> };
                };

                if (typeof queryBuilder.distanceType === 'function') {
                    queryBuilder = queryBuilder.distanceType('cosine') as typeof queryBuilder;
                }

                let usedSqlPredicate = false;
                if (scope.sqlPredicate && typeof queryBuilder.where === 'function') {
                    queryBuilder = queryBuilder.where(scope.sqlPredicate) as typeof queryBuilder;
                    usedSqlPredicate = true;
                }

                const fetchLimit = scope.allowedCanonicalSet && !usedSqlPredicate ? Math.max(topK * 8, 80) : topK;
                const rawResults = (await queryBuilder.limit(fetchLimit).toArray()) as LanceRecord[];

                const canonicalKey = (p: string): string =>
                    process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
                const filtered = scope.allowedCanonicalSet
                    ? rawResults.filter((row) => scope.allowedCanonicalSet!.has(canonicalKey(row.file_path))).slice(0, topK)
                    : rawResults.slice(0, topK);

                return filtered.map((row) => {
                    const loc = this.knowledgeGraph?.getChunkLocation(row.id);
                    return {
                        id: row.id,
                        chunk_text: row.chunk_text,
                        embedding: this.toPlainVector(row.vector),
                        file_path: row.file_path,
                        chunk_index: row.chunk_index,
                        indexed_at: row.indexed_at,
                        start_line: loc?.startLine,
                        end_line: loc?.endLine,
                        heading: loc?.heading,
                    };
                });
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

    searchLexical(query: string, topK: number = 10, scopeFilter?: SearchScopeFilter): LexicalSearchMatch[] {
        if (!this.knowledgeGraph) {
            return [];
        }
        const rows: KnowledgeGraphChunkRecord[] = this.knowledgeGraph.searchLexical(query, topK, scopeFilter);
        return rows.map((row) => ({
            record: {
                id: row.id,
                chunk_text: row.chunkText,
                embedding: [],
                file_path: row.filePath,
                chunk_index: row.chunkIndex,
                indexed_at: row.indexedAt,
                start_line: row.startLine,
                end_line: row.endLine,
                heading: row.heading,
            },
            bm25Score: row.bm25Score,
        }));
    }

    getChunksForFile(filePath: string, limit: number = 8): VectorRecord[] {
        if (!this.knowledgeGraph) {
            return [];
        }
        return this.knowledgeGraph.getChunksForFile(filePath, limit).map((row) => ({
            id: row.id,
            chunk_text: row.chunkText,
            embedding: [],
            file_path: row.filePath,
            chunk_index: row.chunkIndex,
            indexed_at: row.indexedAt,
            start_line: row.startLine,
            end_line: row.endLine,
            heading: row.heading,
        }));
    }

    async deleteFile(filePath: string): Promise<number> {
        return this.withLock(async () => {
            this.ensureInitialized();

            const beforePendingCount = this.pendingRecords.length;
            this.pendingRecords = this.pendingRecords.filter((rec) => rec.file_path !== filePath);
            const removedPending = beforePendingCount - this.pendingRecords.length;
            this.filesPendingReplace.delete(filePath);
            this.knowledgeGraph?.removeFile(filePath);

            try {
                const filterExpr = `file_path = '${this.escapeSql(filePath)}'`;
                const persistedCount = await this.table!.countRows(filterExpr);

                if (persistedCount > 0) {
                    await this.table!.delete(filterExpr);
                }

                const kgStats = this.knowledgeGraph?.getStats();
                RuntimeDiagnostics.getInstance().setVectorStoreStats({
                    initialized: true,
                    totalChunks: kgStats?.totalChunks ?? 0,
                    indexedFiles: kgStats?.totalFiles ?? 0,
                    lexicalDocs: kgStats?.totalChunks ?? 0,
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
                        lexicalDocs: 0,
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

                const kgStats = this.knowledgeGraph?.getStats();
                if (kgStats && kgStats.totalChunks > 0) {
                    const indexSize = kgStats.totalChunks * (this.EMBEDDING_DIM * 4 + 200);
                    RuntimeDiagnostics.getInstance().setVectorStoreStats({
                        initialized: true,
                        totalChunks: kgStats.totalChunks,
                        indexedFiles: kgStats.totalFiles,
                        lexicalDocs: kgStats.totalChunks,
                        pendingBuffer: this.pendingRecords.length,
                    });

                    return {
                        totalFiles: kgStats.totalFiles,
                        totalChunks: kgStats.totalChunks,
                        totalTokens: kgStats.totalTokens,
                        indexSize,
                        lastIndexed: kgStats.lastIndexed,
                    };
                }

                // Fallback without loading table into memory when KnowledgeGraph is disabled
                const estimatedSize = count * (this.EMBEDDING_DIM * 4 + 200);
                RuntimeDiagnostics.getInstance().setVectorStoreStats({
                    initialized: true,
                    totalChunks: count,
                    indexedFiles: 0,
                    lexicalDocs: 0,
                    pendingBuffer: this.pendingRecords.length,
                });
                return {
                    totalFiles: 0,
                    totalChunks: count,
                    totalTokens: 0,
                    indexSize: estimatedSize,
                    lastIndexed: 0,
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
                this.knowledgeGraph?.clear();
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

    async close(): Promise<void> {
        return this.withLock(async () => {
            if (this.ownsKnowledgeGraph && this.knowledgeGraph) {
                this.knowledgeGraph.close();
            }
            this.knowledgeGraph = this.injectedKnowledgeGraph ?? null;
            this.ownsKnowledgeGraph = false;
            this.table = null;
            this.db = null;
            this.dbPath = '';
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
