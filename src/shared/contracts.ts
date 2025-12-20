/**
 * contracts.ts - Interface Contracts (CRITICAL FILE)
 * 
 * This file defines ALL interfaces that govern communication between layers.
 * These are the "contracts" that AI must adhere to. Any implementation that
 * violates these contracts will be caught by TypeScript compiler.
 * 
 * RULES:
 * 1. Interfaces are IMMUTABLE once approved
 * 2. Changes require architecture review
 * 3. All services implement these interfaces
 * 4. Tests verify contract compliance
 */

// ============================================================================
// FILE SYSTEM TYPES
// ============================================================================

/**
 * Represents a file or directory node in the file system.
 */
export interface FileNode {
  /** Absolute path to the file/directory */
  path: string;

  /** Name of the file/directory (basename only, no path) */
  name: string;

  /** Whether this node is a directory */
  isDirectory: boolean;

  /** File size in bytes (0 for directories) */
  size: number;

  /** Last modified timestamp (Unix milliseconds) */
  modified: number;

  /** File extension (e.g., "txt", "pdf") or empty string for directories */
  extension: string;

  /** MIME type (e.g., "text/plain", "image/png") */
  mimeType: string;

  /** Optional: Is this node hidden? (starts with . on Unix) */
  isHidden?: boolean;
}

/**
 * Extended file statistics with permissions.
 */
export interface FileStats {
  path: string;
  size: number;
  created: number;
  modified: number;
  accessed: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  permissions: {
    readable: boolean;
    writable: boolean;
    executable: boolean;
  };
}

/**
 * Result of path validation operation.
 */
export interface ValidationResult {
  /** Whether the path is valid and safe */
  valid: boolean;

  /** Error code if validation failed */
  error?: 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'INVALID_PATH';

  /** Human-readable details about the validation failure */
  details?: string;
}

/**
 * Structured error for file system operations.
 */
export interface FileSystemError {
  /** Error code for programmatic handling */
  code: 'PATH_TRAVERSAL'
  | 'UNAUTHORIZED_ACCESS'
  | 'FILE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'DISK_FULL'
  | 'UNKNOWN';

  /** Human-readable error message */
  message: string;

  /** Path that caused the error (if applicable) */
  path?: string;

  /** Original error from fs module (for debugging) */
  originalError?: Error;
}

// ============================================================================
// SERVICE INTERFACES (CRITICAL - AI GUARDRAILS)
// ============================================================================

/**
 * File System Service Interface.
 * All file operations MUST go through implementations of this interface.
 * Main Process is the ONLY layer that implements this.
 */
export interface IFileSystemService {
  /**
   * Read directory contents.
   * 
   * @param path - Absolute path to directory
   * @returns Array of FileNode objects
   * @throws FileSystemError if path invalid or inaccessible
   * 
   * @example
   * const files = await fs.readDirectory('/home/user/Documents');
   * // Returns: [{ path: '/home/user/Documents/file.txt', name: 'file.txt', ... }]
   */
  readDirectory(path: string): Promise<FileNode[]>;

  /**
   * Read file content as string.
   * 
   * @param path - Absolute path to file
   * @param encoding - Character encoding (default: 'utf-8')
   * @returns File content as string
   * @throws FileSystemError if file not found or not readable
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;

  /**
   * Write content to file.
   * 
   * @param path - Absolute path to file
   * @param content - Content to write
   * @returns Success status
   * @throws FileSystemError if write fails (permissions, disk full, etc.)
   */
  writeFile(path: string, content: string): Promise<{ success: boolean }>;

  /**
   * Delete file or directory.
   * 
   * @param path - Absolute path to delete
   * @param recursive - If true, delete directories recursively (default: false)
   * @returns Success status
   * @throws FileSystemError if delete fails
   */
  delete(path: string, recursive?: boolean): Promise<{ success: boolean }>;

  /**
   * Move/rename file or directory.
   * 
   * @param source - Current path
   * @param destination - New path
   * @returns Success status and new path
   * @throws FileSystemError if move fails
   */
  move(source: string, destination: string): Promise<{ success: boolean; newPath: string }>;

  /**
   * Get detailed file statistics.
   * 
   * @param path - Absolute path
   * @returns FileStats object
   * @throws FileSystemError if path doesn't exist
   */
  getStats(path: string): Promise<FileStats>;

  /**
   * Validate path for security.
   * This is called internally before all operations.
   * 
   * @param path - Path to validate
   * @returns Validation result
   */
  validatePath(path: string): ValidationResult;
}

/**
 * Navigation Service Interface.
 * Manages browsing history (back/forward navigation).
 */
export interface INavigationService {
  /**
   * Navigate backward in history.
   * 
   * @returns Previous path or null if at start
   */
  back(): string | null;

  /**
   * Navigate forward in history.
   * 
   * @returns Next path or null if at end
   */
  forward(): string | null;

  /**
   * Add new path to history.
   * This clears any forward history.
   * 
   * @param path - Path to add
   */
  push(path: string): void;

  /**
   * Get current navigation state.
   * 
   * @returns Whether back/forward are available
   */
  getState(): { canGoBack: boolean; canGoForward: boolean };
}

/**
 * Search Service Interface.
 * Handles file search and autocomplete.
 */
export interface ISearchService {
  /**
   * Get autocomplete suggestions for partial path.
   * 
   * @param prefix - Partial path (e.g., "doc" for "documents")
   * @param maxResults - Maximum results to return (default: 10)
   * @returns Array of matching paths
   * 
   * @complexity O(L) where L = prefix length
   */
  autocomplete(prefix: string, maxResults?: number): Promise<string[]>;

  /**
   * Search for files matching query.
   * 
   * @param query - Search query
   * @param searchRoot - Directory to search in
   * @returns Array of matching FileNode objects
   */
  search(query: string, searchRoot: string): Promise<FileNode[]>;
}

// ============================================================================
// LLM TYPES
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
}

/**
 * Retrieval result from RAG pipeline.
 */
export interface RetrievalResult {
  /** Compressed context for LLM */
  context: string;

  /** Source file paths (for citation) */
  sources: string[];

  /** Total token count of context */
  tokenCount: number;
}

/**
 * LLM query options.
 */
export interface LLMQueryOptions {
  /** Model name (default: 'llama3.2') */
  model?: string;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Temperature (0-1, default: 0.7) */
  temperature?: number;

  /** Whether to stream response */
  stream?: boolean;
}

/**
 * Indexing progress status.
 */
export interface IndexingStatus {
  /** Number of files indexed so far */
  indexed: number;

  /** Total files to index */
  total: number;

  /** Whether indexing is currently running */
  inProgress: boolean;

  /** Current file being indexed (if inProgress) */
  currentFile?: string;
}

/**
 * LLM Service Interface.
 * Handles chat queries and file indexing.
 */
export interface ILLMService {
  /**
   * Query LLM with user question.
   * Uses RAG to retrieve relevant context from indexed files.
   * 
   * @param query - User's question
   * @param options - Query options
   * @returns Async generator yielding response chunks
   * 
   * @example
   * for await (const chunk of llm.query("What does auth.ts do?")) {
   *   console.log(chunk); // Stream response word-by-word
   * }
   */
  query(query: string, options?: LLMQueryOptions): AsyncGenerator<string, void, unknown>;

  /**
   * Index a file for semantic search.
   * 
   * @param filePath - Absolute path to file
   * @returns Success status
   */
  indexFile(filePath: string): Promise<{ success: boolean }>;

  /**
   * Get current indexing status.
   * 
   * @returns Indexing progress
   */
  getIndexingStatus(): Promise<IndexingStatus>;

  /**
   * Start background indexing of directory.
   * 
   * @param directoryPath - Directory to index recursively
   * @returns Success status
   */
  startIndexing(directoryPath: string): Promise<{ success: boolean }>;

  /**
   * Stop background indexing.
   * 
   * @returns Success status
   */
  stopIndexing(): Promise<{ success: boolean }>;
}

// ============================================================================
// EMBEDDING MODEL INTERFACES
// ============================================================================

/**
 * Embedding vector (384 dimensions for all-MiniLM-L6-v2)
 */
export type Embedding = number[];

/**
 * Embedding generation options
 */
export interface EmbeddingOptions {
  /** Model name (default: 'all-MiniLM-L6-v2') */
  model?: string;

  /** Normalize embeddings (default: true) */
  normalize?: boolean;

  /** Batch size for processing (default: 32) */
  batchSize?: number;
}

/**
 * Embedding model interface for text-to-vector conversion.
 * Implementations must use local models only (privacy-first).
 */
export interface IEmbeddingModel {
  /**
   * Initialize the embedding model.
   * Must be called before first use.
   * Downloads model on first run (~100MB, cached thereafter).
   */
  initialize(): Promise<void>;

  /**
   * Generate embedding for single text.
   * 
   * @param text - Input text
   * @returns Embedding vector (384 dimensions)
   * 
   * @example
   * const embedding = await model.embed("Hello world");
   * console.log(embedding.length); // 384
   */
  embed(text: string): Promise<Embedding>;

  /**
   * Generate embeddings for multiple texts (batched).
   * 
   * @param texts - Array of input texts
   * @returns Array of embedding vectors
   * 
   * @complexity O(n) where n = number of texts
   */
  embedBatch(texts: string[]): Promise<Embedding[]>;

  /**
   * Get embedding dimensionality.
   * 
   * @returns Number of dimensions (e.g., 384)
   */
  getDimensions(): number;

  /**
   * Calculate cosine similarity between embeddings.
   * 
   * @param a - First embedding
   * @param b - Second embedding
   * @returns Similarity score (-1 to 1, where 1 = identical)
   */
  similarity(a: Embedding, b: Embedding): number;
}

// ============================================================================
// INDEXING SERVICE INTERFACES
// ============================================================================

/**
 * Result of indexing operation
 */
export interface IndexingResult {
  /** File that was indexed */
  filePath: string;

  /** Number of chunks created */
  chunksCreated: number;

  /** Estimated total tokens */
  totalTokens: number;

  /** When indexing occurred (Unix milliseconds) */
  indexedAt: number;

  /** Whether indexing succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Index statistics
 */
export interface IndexStats {
  /** Total files indexed */
  totalFiles: number;

  /** Total chunks in index */
  totalChunks: number;

  /** Estimated total tokens */
  totalTokens: number;

  /** Index size in bytes */
  indexSize: number;

  /** Last indexing timestamp */
  lastIndexed: number;
}

/**
 * Indexing service interface.
 * Responsible for chunking file content and generating embeddings.
 */
export interface IIndexingService {
  /**
   * Index a single file.
   * 
   * Process:
   * 1. Read file content
   * 2. Chunk into 500-token segments with 50-token overlap
   * 3. Generate embeddings for each chunk
   * 4. Store in vector database
   * 
   * @param filePath - Absolute path to file
   * @returns Indexing result with chunk count
   */
  indexFile(filePath: string): Promise<IndexingResult>;

  /**
   * Index multiple files in batch.
   * 
   * @param filePaths - Array of absolute paths
   * @returns Array of indexing results
   */
  indexFiles(filePaths: string[]): Promise<IndexingResult[]>;

  /**
   * Remove file from index.
   * 
   * @param filePath - Absolute path to file
   * @returns Success status
   */
  removeFile(filePath: string): Promise<{ success: boolean }>;

  /**
   * Get indexing statistics.
   * 
   * @returns Current index stats
   */
  getStats(): Promise<IndexStats>;
}

// ============================================================================
// VECTOR STORE INTERFACES
// ============================================================================

/**
 * Vector store interface for semantic search.
 * Wraps LanceDB for embedding storage and retrieval.
 */
export interface IVectorStore {
  /**
   * Initialize the vector store.
   * 
   * @param dbPath - Path to database directory
   */
  initialize(dbPath: string): Promise<void>;

  /**
   * Add chunks with embeddings to the store.
   * 
   * @param chunks - Text chunks
   * @param embeddings - Corresponding embeddings
   * @param filePath - Source file path
   */
  addChunks(chunks: TextChunk[], embeddings: Embedding[], filePath: string): Promise<void>;

  /**
   * Search for similar chunks.
   * 
   * @param queryEmbedding - Query embedding vector
   * @param topK - Number of results to return
   * @returns Array of matching records
   */
  search(queryEmbedding: Embedding, topK?: number): Promise<VectorRecord[]>;

  /**
   * Delete all chunks for a file.
   * 
   * @param filePath - File path to remove
   * @returns Number of chunks deleted
   */
  deleteFile(filePath: string): Promise<number>;

  /**
   * Get store statistics.
   * 
   * @returns Index statistics
   */
  getStats(): Promise<IndexStats>;

  /**
   * Clear entire database.
   * 
   * WARNING: Irreversible operation
   * 
   * @returns Success status
   */
  clear(): Promise<{ success: boolean }>;
}

// ============================================================================
// DSA-SPECIFIC INTERFACES
// ============================================================================

/**
 * Trie node for path search.
 */
export interface TrieNode {
  /** Child nodes (key = path segment) */
  children: Map<string, TrieNode>;

  /** Whether this node represents end of a complete path */
  isEndOfPath: boolean;

  /** Optional metadata at terminal nodes */
  metadata?: FileMetadata;
}

/**
 * Cache node for LRU implementation.
 */
export interface CacheNode<T> {
  /** Cache key */
  key: string;

  /** Cached value */
  value: T;

  /** Previous node in linked list */
  prev: CacheNode<T> | null;

  /** Next node in linked list */
  next: CacheNode<T> | null;
}

/**
 * File system event for priority queue.
 */
export interface FileEvent {
  /** Event type */
  type: 'create' | 'change' | 'unlink' | 'rename';

  /** File path */
  path: string;

  /** Event priority (lower = higher priority) */
  priority: EventPriority;

  /** When event occurred (Unix milliseconds) */
  timestamp: number;

  /** Additional event data */
  data?: Record<string, unknown>;
}

/**
 * Event priority levels.
 */
export enum EventPriority {
  /** User-initiated actions (delete, rename) - highest priority */
  USER_ACTION = 1,

  /** External file changes detected by watcher */
  FILE_WATCHER = 5,

  /** Background indexing operations - lowest priority */
  BACKGROUND_INDEX = 10,
}

/**
 * History node for navigation stack.
 */
export interface HistoryNode {
  /** Directory path */
  path: string;

  /** When navigated (Unix milliseconds) */
  timestamp: number;

  /** Previous node in history */
  prev: HistoryNode | null;

  /** Next node in history (for forward navigation) */
  next: HistoryNode | null;
}

// ============================================================================
// IPC MESSAGE TYPES (FOR TYPE-SAFE COMMUNICATION)
// ============================================================================

/**
 * IPC request for reading directory.
 */
export interface IPCReadDirRequest {
  path: string;
}

/**
 * IPC response for reading directory.
 */
export interface IPCReadDirResponse {
  files: FileNode[];
}

/**
 * IPC request for file deletion.
 */
export interface IPCDeleteRequest {
  path: string;
  recursive?: boolean;
}

/**
 * IPC response for file deletion.
 */
export interface IPCDeleteResponse {
  success: boolean;
  error?: FileSystemError;
}

// ... (More IPC types can be added as needed)

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

