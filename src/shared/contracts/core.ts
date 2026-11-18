/**
 * contracts/core.ts - Leaf domain primitives, utility types, and system constants.
 */

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Result type for operations that can fail.
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Async result type.
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * File type categories.
 */
export type FileType =
  | 'text'
  | 'code'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'document'
  | 'unknown';

/**
 * Sort criteria for file list.
 */
export type SortCriteria = 'name' | 'size' | 'modified' | 'type';

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc';

// ============================================================================
// INDEX & CHUNK PRIMITIVES (SHARED ACROSS FS, SEARCH, GRAPH, AI)
// ============================================================================

/**
 * Text chunk for embedding and indexing.
 */
export interface TextChunk {
  /** Chunk content */
  text: string;

  /** Starting character index in original file */
  startChar: number;

  /** Ending character index in original file */
  endChar: number;

  /** Chunk number (0-indexed) */
  chunkIndex: number;

  /** Optional 1-based start line in original file */
  startLine?: number;

  /** Optional 1-based end line in original file */
  endLine?: number;

  /** Optional active structural heading / symbol label */
  heading?: string;
}

/**
 * File metadata for indexing.
 */
export interface FileMetadata {
  /** Absolute path to file */
  filePath: string;

  /** Total number of chunks */
  totalChunks: number;

  /** When file was indexed (Unix milliseconds) */
  indexedAt: number;

  /** File size in bytes */
  fileSize: number;

  /** Programming language (if detected) */
  language?: string;
}

/**
 * Vector database record.
 */
export interface VectorRecord {
  /** Unique identifier: "{filePath}:{chunkIndex}" */
  id: string;

  /** Original text content */
  chunk_text: string;

  /** Embedding vector (384 dimensions for all-MiniLM-L6-v2) */
  embedding: number[];

  /** Source file path */
  file_path: string;

  /** Chunk index within file */
  chunk_index: number;

  /** Indexing timestamp */
  indexed_at: number;

  /** Optional 1-based start line in source file */
  start_line?: number;

  /** Optional 1-based end line in source file */
  end_line?: number;

  /** Optional active structural heading / symbol label */
  heading?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum file size for indexing (10MB).
 */
export const MAX_INDEXABLE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Chunk size for text splitting (tokens).
 */
export const CHUNK_SIZE = 500;

/**
 * Chunk overlap (tokens).
 */
export const CHUNK_OVERLAP = 50;

/**
 * LRU cache capacity (number of items).
 */
export const CACHE_CAPACITY = 100;

/**
 * Maximum memory for thumbnail cache (bytes).
 */
export const MAX_CACHE_MEMORY = 100 * 1024 * 1024; // 100MB

/**
 * History stack maximum size.
 */
export const MAX_HISTORY_SIZE = 50;

/**
 * Ring buffer capacity (log lines).
 */
export const RING_BUFFER_CAPACITY = 100;
