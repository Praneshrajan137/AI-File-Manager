# MAIN PROCESS CONTEXT (Backend/Kernel Interface)



## 🎯 PURPOSE

This layer is the **heart of the application**. It's the ONLY layer permitted to import Node.js `fs` module and interact directly with the OS kernel.



## 🏗️ ARCHITECTURE



### Responsibilities

1. **Blocking/Non-Blocking I/O**: File reads, writes, directory scans

2. **File Streams**: Large file handling without loading into memory

3. **Permission Management**: Validate user access to paths

4. **Process Spawning**: Execute shell commands (with security validation)

5. **OS Kernel Interaction**: Direct file system operations

6. **Security Gate**: Validate ALL requests from Renderer



### Directory Structure

```
src/main/
├── main.ts                 # Electron main entry point
├── services/
│   ├── FileSystemService.ts    # Implements IFileSystemService
│   ├── DirectoryScanner.ts     # Recursive directory traversal
│   ├── FileWatcher.ts          # Chokidar event handling
│   └── PathValidator.ts        # Security validation
├── handlers/
│   ├── ipcHandlers.ts          # IPC channel definitions
│   └── securityMiddleware.ts   # Request validation
├── dsa/
│   ├── PathTrie.ts             # File path search (O(L))
│   ├── LRUCache.ts             # Thumbnail/metadata cache
│   ├── EventQueue.ts           # Priority queue for file events
│   ├── HistoryStack.ts         # Navigation history
│   └── RingBuffer.ts           # Log file preview
└── CLAUDE.md               # This file
```



## 🔒 SECURITY CRITICAL



### Path Validation (EVERY IPC REQUEST)

```typescript
// MANDATORY before ANY fs operation
import path from 'path';

function validatePath(requestedPath: string, allowedRoot: string): ValidationResult {
  // Normalize to collapse relative segments
  const normalized = path.normalize(requestedPath);
  
  // Check for traversal attempts BEFORE resolving
  // After normalize, '..' still exists if user tried traversal
  if (normalized.includes('..')) {
    return {
      valid: false,
      error: 'PATH_TRAVERSAL_ATTEMPT',
      details: 'Relative paths not allowed'
    };
  }
  
  // Resolve to absolute path for boundary check
  const resolved = path.resolve(normalized);
  
  // Normalize allowedRoot to ensure it ends with separator
  const normalizedRoot = allowedRoot.endsWith(path.sep) 
    ? allowedRoot 
    : allowedRoot + path.sep;
  
  // Ensure within sandbox (primary defense)
  // Check with separator to prevent prefix attacks (e.g., /home/user vs /home/user2)
  // Allow accessing the allowedRoot directory itself (resolved === allowedRoot)
  if (!resolved.startsWith(normalizedRoot) && resolved !== allowedRoot) {
    return {
      valid: false,
      error: 'UNAUTHORIZED_ACCESS',
      details: 'Path outside allowed directory'
    };
  }
  
  return { valid: true };
}
```



### Dangerous Paths to Block

```typescript
const FORBIDDEN_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  'C:\\Windows\\System32',
  process.env.HOME + '/.ssh',
  // Add OS-specific critical paths
];
```



## ⚡ CONCURRENCY MODEL



### Event Loop Management

Node.js is single-threaded. Heavy I/O operations MUST NOT block the event loop.



**✅ Good - Non-Blocking**:

```typescript
import { promises as fs } from 'fs';

async function readDirectory(dirPath: string): Promise<FileNode[]> {
  // Non-blocking async I/O
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  
  return entries.map(entry => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    path: path.join(dirPath, entry.name)
  }));
}
```



**❌ Bad - Blocking**:

```typescript
import fs from 'fs';

function readDirectory(dirPath: string): FileNode[] {
  // BLOCKS event loop!
  const entries = fs.readdirSync(dirPath);
  return entries.map(...);
}
```



### Worker Threads for CPU-Intensive Tasks

```typescript
import { Worker } from 'worker_threads';

async function indexLargeDirectory(dirPath: string): Promise<IndexResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./workers/fileIndexer.js', {
      workerData: { path: dirPath }
    });
    
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}
```



## 🗂️ IPC CHANNEL DEFINITIONS



All IPC channels defined here MUST match ARCHITECTURE.md.

```typescript
// src/main/handlers/ipcHandlers.ts
import { ipcMain } from 'electron';

// File System Operations
ipcMain.handle('FS:READ_DIR', async (event, path: string) => {
  // 1. Validate path
  const validation = validatePath(path, ALLOWED_ROOT);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  // 2. Execute operation
  return await fileSystemService.readDirectory(path);
});

ipcMain.handle('FS:READ_FILE', async (event, path: string) => { ... });
ipcMain.handle('FS:WRITE_FILE', async (event, path: string, content: string) => { ... });
ipcMain.handle('FS:DELETE', async (event, path: string) => { ... });
ipcMain.handle('FS:MOVE', async (event, source: string, dest: string) => { ... });

// LLM Operations
ipcMain.handle('LLM:QUERY', async (event, query: string) => { ... });
ipcMain.handle('LLM:INDEX_FILE', async (event, path: string) => { ... });
```



## 📊 DSA IMPLEMENTATIONS (Required)



### 1. PathTrie - File Path Search

```typescript
// src/main/dsa/PathTrie.ts
/**
 * Trie for O(L) file path search where L = path length.
 * Mimics how OS kernels look up inodes.
 */
interface PathTrieNode {
  children: Map<string, PathTrieNode>;
  isEndOfPath: boolean;
  metadata?: FileMetadata;
}

class PathTrie {
  private root: PathTrieNode;
  
  /**
   * Insert a file path into the trie.
   * Complexity: O(L) where L is path length
   */
  insert(filePath: string, metadata: FileMetadata): void {
    const segments = filePath.split('/').filter(Boolean);
    let current = this.root;
    
    for (const segment of segments) {
      if (!current.children.has(segment)) {
        current.children.set(segment, {
          children: new Map(),
          isEndOfPath: false
        });
      }
      current = current.children.get(segment)!;
    }
    
    current.isEndOfPath = true;
    current.metadata = metadata;
  }
  
  /**
   * Search for exact path match.
   * Complexity: O(L)
   */
  search(filePath: string): FileMetadata | null { ... }
  
  /**
   * Autocomplete suggestions for partial path.
   * Returns all paths with given prefix.
   */
  autocomplete(prefix: string, maxResults: number = 10): string[] { ... }
}
```



### 2. LRUCache - Thumbnail & Metadata Caching

```typescript
// src/main/dsa/LRUCache.ts
/**
 * LRU Cache with O(1) get/put operations.
 * Mimics OS page replacement algorithms.
 * 
 * Implementation: DoublyLinkedList + HashMap
 * - HashMap for O(1) access
 * - DLL for O(1) eviction of least recently used
 */
interface CacheNode<T> {
  key: string;
  value: T;
  prev: CacheNode<T> | null;
  next: CacheNode<T> | null;
}

class LRUCache<T> {
  private capacity: number;
  private cache: Map<string, CacheNode<T>>;
  private head: CacheNode<T> | null;  // Most recently used
  private tail: CacheNode<T> | null;  // Least recently used
  
  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
    this.head = null;
    this.tail = null;
  }
  
  /**
   * Get value and move to front (most recently used).
   * Complexity: O(1)
   */
  get(key: string): T | null {
    const node = this.cache.get(key);
    if (!node) return null;
    
    // Move to front
    this.moveToFront(node);
    return node.value;
  }
  
  /**
   * Put value at front, evict tail if over capacity.
   * Complexity: O(1)
   */
  put(key: string, value: T): void {
    // Check if exists
    if (this.cache.has(key)) {
      const node = this.cache.get(key)!;
      node.value = value;
      this.moveToFront(node);
      return;
    }
    
    // Create new node
    const newNode: CacheNode<T> = { key, value, prev: null, next: null };
    
    // Add to front
    if (!this.head) {
      this.head = this.tail = newNode;
    } else {
      newNode.next = this.head;
      this.head.prev = newNode;
      this.head = newNode;
    }
    
    this.cache.set(key, newNode);
    
    // Evict if over capacity
    if (this.cache.size > this.capacity) {
      this.evictTail();
    }
  }
  
  private moveToFront(node: CacheNode<T>): void { ... }
  private evictTail(): void { ... }
}
```



### 3. EventQueue - Priority-Based Event Processing

```typescript
// src/main/dsa/EventQueue.ts
/**
 * Min-Heap priority queue for file system events.
 * Ensures high-priority events (user actions) processed before
 * background tasks (indexing).
 */
enum EventPriority {
  USER_ACTION = 1,      // User delete, rename (highest)
  FILE_WATCHER = 5,     // External file changes
  BACKGROUND_INDEX = 10  // LLM indexing (lowest)
}

interface FileEvent {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  priority: EventPriority;
  timestamp: number;
}

class EventQueue {
  private heap: FileEvent[] = [];
  
  /**
   * Insert event with O(log n) complexity
   */
  enqueue(event: FileEvent): void {
    this.heap.push(event);
    this.heapifyUp(this.heap.length - 1);
  }
  
  /**
   * Remove and return highest priority event.
   * O(log n) complexity
   */
  dequeue(): FileEvent | null {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop()!;
    
    const root = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.heapifyDown(0);
    
    return root;
  }
  
  private heapifyUp(index: number): void { ... }
  private heapifyDown(index: number): void { ... }
}
```



### 4. HistoryStack - Navigation History

```typescript
// src/main/dsa/HistoryStack.ts
/**
 * Doubly linked list for O(1) navigation history operations.
 * Supports back/forward like browser navigation.
 */
interface HistoryNode {
  path: string;
  timestamp: number;
  prev: HistoryNode | null;
  next: HistoryNode | null;
}

class HistoryStack {
  private current: HistoryNode | null = null;
  private maxSize: number = 50;
  private size: number = 0;
  
  /**
   * Navigate to new path. Clears forward history.
   */
  push(path: string): void {
    // Clear forward history by severing next pointers
    if (this.current) {
      this.current.next = null;
    }
    
    const newNode: HistoryNode = {
      path,
      timestamp: Date.now(),
      prev: this.current,
      next: null
    };
    
    // Link current to new node (creates new forward history from old position)
    if (this.current) {
      this.current.next = newNode;
    }
    
    this.current = newNode;
    this.size++;
    
    // Enforce max size
    if (this.size > this.maxSize) {
      this.evictOldest();
    }
  }
  
  /**
   * Navigate backward. O(1) operation.
   */
  back(): string | null {
    if (!this.current?.prev) return null;
    this.current = this.current.prev;
    return this.current.path;
  }
  
  /**
   * Navigate forward. O(1) operation.
   */
  forward(): string | null {
    if (!this.current?.next) return null;
    this.current = this.current.next;
    return this.current.path;
  }
  
  canGoBack(): boolean { return this.current?.prev !== null; }
  canGoForward(): boolean { return this.current?.next !== null; }
}
```



### 5. RingBuffer - Log File Preview

```typescript
// src/main/dsa/RingBuffer.ts
/**
 * Circular buffer for efficiently reading last N lines of large log files.
 * Implements `tail -f` style functionality without loading entire file.
 */
class RingBuffer<T> {
  private buffer: T[];
  private capacity: number;
  private writeIndex: number = 0;
  private size: number = 0;
  
  constructor(capacity: number = 100) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }
  
  /**
   * Add item to buffer. Overwrites oldest if full.
   * O(1) operation.
   */
  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }
  
  /**
   * Get last N items in chronological order.
   */
  getItems(count?: number): T[] {
    const n = Math.min(count ?? this.size, this.size);
    const result: T[] = [];
    
    // Calculate starting index
    let startIndex = (this.writeIndex - n + this.capacity) % this.capacity;
    
    for (let i = 0; i < n; i++) {
      result.push(this.buffer[(startIndex + i) % this.capacity]);
    }
    
    return result;
  }
}
```



## 🧪 TESTING MAIN PROCESS



### Mock fs Module

```typescript
// tests/unit/FileSystemService.test.ts
import { vi, describe, it, expect } from 'vitest';

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

describe('FileSystemService', () => {
  it('should validate paths before read operations', async () => {
    const service = new FileSystemService();
    
    await expect(
      service.readDirectory('../../etc/passwd')
    ).rejects.toThrow('Path traversal detected');
  });
});
```



## 🚨 ANTI-PATTERNS (Main Process Specific)



1. **❌ Blocking Event Loop**: Using sync fs methods

2. **❌ No Path Validation**: Trusting Renderer input

3. **❌ Memory Leaks**: Not cleaning up file watchers

4. **❌ Race Conditions**: Not handling concurrent file access

5. **❌ Error Swallowing**: Not propagating errors to Renderer



## 📚 REFERENCES



- `src/shared/contracts.ts` - IFileSystemService interface

- `docs/ARCHITECTURE.md` - IPC channel specifications

- `Node.js fs/promises API` - https://nodejs.org/api/fs.html



---



**CONTEXT SCOPE**: Main Process development ONLY

**LAST UPDATED**: December 4, 2025
