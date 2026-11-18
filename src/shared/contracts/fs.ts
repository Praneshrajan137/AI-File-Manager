/**
 * contracts/fs.ts - File system, navigation, operation journal, Trash Vault,
 * DSA node contracts, and low-level IPC FS message DTOs.
 */

import type { FileMetadata } from './core';

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

  /** Optional: Whether the underlying directory entry is a symbolic link or junction */
  isSymbolicLink?: boolean;
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
  error?: 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'INVALID_PATH' | 'SYMLINK_ESCAPE';

  /** Human-readable details about the validation failure */
  details?: string;

  /** Canonical resolved path (populated by validateCanonical) */
  canonicalPath?: string;
}

export interface FilePreviewResult {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: number;
  lines: string[];
  totalLinesBuffered: number;
  truncated: boolean;
  binary: boolean;
  fromCache: boolean;
}

export interface FileRangeLine {
  lineNumber: number;
  text: string;
}

export interface FileLineRangeResult {
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  lines: FileRangeLine[];
  truncated: boolean;
}

export interface SystemPaths {
  home: string;
  documents: string;
  downloads: string;
  pictures: string;
}

export type FileDeleteMode = 'vault' | 'trash' | 'permanent';

export type BatchTransferStep =
  | { type: 'move'; source: string; destination: string }
  | { type: 'copy'; source: string; destination: string }
  | { type: 'delete'; path: string; recursive?: boolean; mode?: FileDeleteMode };

export interface BatchTransferResult {
  success: boolean;
  count: number;
  operationId?: string;
  journalState: OperationJournalState;
}

export interface OperationRecord {
  id: string;
  type:
    | 'delete'
    | 'move'
    | 'rename'
    | 'create_file'
    | 'create_dir'
    | 'copy'
    | 'edit_links'
    | 'batch';
  timestamp: number;
  sourcePath: string;
  destinationPath?: string;
  vaultPayloadPath?: string;
  symlinkTarget?: string;
  previousContent?: string;
  nextContent?: string;
  children?: OperationRecord[];
  isDirectory: boolean;
  isSymlink?: boolean;
  size: number;
  undoable: boolean;
  mode?: FileDeleteMode;
  description: string;
}

export interface OperationJournalState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  lastUndoDescription?: string;
  lastRedoDescription?: string;
  vaultItemCount: number;
  vaultTotalBytes: number;
}

export interface TrashVaultEntry {
  id: string;
  name: string;
  originalPath: string;
  deletedAt: number;
  size: number;
  isDirectory: boolean;
  isSymlink: boolean;
  description: string;
}

export interface UndoRedoResult {
  success: boolean;
  operation?: OperationRecord;
  restoredPath?: string;
  state: OperationJournalState;
}

/**
 * Structured error for file system operations.
 */
export interface FileSystemError {
  /** Error code for programmatic handling */
  code:
    | 'PATH_TRAVERSAL'
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
// FILE SYSTEM & NAVIGATION SERVICE INTERFACES
// ============================================================================

/**
 * File System Service Interface.
 * All file operations MUST go through implementations of this interface.
 * Main Process is the ONLY layer that implements this.
 */
export interface IFileSystemService {
  /**
   * Read directory contents.
   */
  readDirectory(path: string): Promise<FileNode[]>;

  /**
   * Read file content as string.
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;

  /**
   * Write content to file.
   */
  writeFile(path: string, content: string): Promise<{ success: boolean }>;

  /**
   * Delete file or directory.
   */
  delete(path: string, recursive?: boolean): Promise<{ success: boolean }>;

  /**
   * Move/rename file or directory.
   */
  move(source: string, destination: string): Promise<{ success: boolean; newPath: string }>;

  /**
   * Get detailed file statistics.
   */
  getStats(path: string): Promise<FileStats>;

  /**
   * Validate path for security.
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
   */
  back(): string | null;

  /**
   * Navigate forward in history.
   */
  forward(): string | null;

  /**
   * Add new path to history.
   */
  push(path: string): void;

  /**
   * Get current navigation state.
   */
  getState(): { canGoBack: boolean; canGoForward: boolean };
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
