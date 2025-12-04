# System Architecture Document

## Project-2: OS File Manager with Custom LLM



**Version**: 1.0  
**Last Updated**: December 4, 2025  
**Status**: Approved



---



## 1. ARCHITECTURAL OVERVIEW



### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     ELECTRON FRAMEWORK                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         RENDERER PROCESS (React + Tailwind)        │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  Components:                              │     │    │
│  │  │  - FileExplorer (virtualized grid/list)  │     │    │
│  │  │  - SearchBar (with autocomplete)          │     │    │
│  │  │  - Sidebar (directory tree)               │     │    │
│  │  │  - ChatPanel (LLM interface)              │     │    │
│  │  │  - ContextMenu                             │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  │                                                    │    │
│  │  Hooks:                                           │    │
│  │  - useFileSystem() → IPC wrapper                 │    │
│  │  - useNavigation() → History management          │    │
│  │  - useLLM() → Chat interface                     │    │
│  └────────────────────────────────────────────────────┘    │
│                          ▲                                   │
│                          │ IPC Bridge (contextBridge)       │
│                          │ Serialized JSON only             │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │           MAIN PROCESS (Node.js Backend)           │    │
│  │                                                    │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  Services:                                │     │    │
│  │  │  - FileSystemService (fs/promises)        │     │    │
│  │  │  - DirectoryScanner (recursive)           │     │    │
│  │  │  - FileWatcher (chokidar)                 │     │    │
│  │  │  - PathValidator (security gate)          │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  │                                                    │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  Data Structures (DSA):                   │     │    │
│  │  │  - PathTrie (file search)                 │     │    │
│  │  │  - LRUCache (thumbnails)                  │     │    │
│  │  │  - EventQueue (file events)               │     │    │
│  │  │  - HistoryStack (navigation)              │     │    │
│  │  │  - RingBuffer (log preview)               │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  │                                                    │    │
│  │  IPC Handlers:                                    │    │
│  │  - FS:READ_DIR, FS:READ_FILE, FS:WRITE_FILE     │    │
│  │  - FS:DELETE, FS:MOVE, FS:RENAME                 │    │
│  │  - NAV:BACK, NAV:FORWARD, NAV:PUSH               │    │
│  │  - LLM:QUERY, LLM:INDEX_STATUS                   │    │
│  └────────────────────────────────────────────────────┘    │
│                          ▲                                   │
│                          │ File System Events               │
│                          │ (chokidar)                        │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │      INTELLIGENCE LAYER (Background Service)       │    │
│  │                                                    │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  IndexingService                          │     │    │
│  │  │  - Watches file changes                   │     │    │
│  │  │  - Chunks text (500 tokens, 50 overlap)   │     │    │
│  │  │  - Generates embeddings                   │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  │              ▼                                     │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  VectorStore (LanceDB)                    │     │    │
│  │  │  - In-process database                    │     │    │
│  │  │  - Stores: chunks, embeddings, metadata   │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  │              ▼                                     │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  RetrievalService (RAG)                   │     │    │
│  │  │  - Semantic search                        │     │    │
│  │  │  - Re-ranking                             │     │    │
│  │  │  - Context compression                    │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  │              ▼                                     │    │
│  │  ┌──────────────────────────────────────────┐     │    │
│  │  │  LLMInterface (Ollama)                    │     │    │
│  │  │  - Local model: llama3.2                  │     │    │
│  │  │  - Streaming responses                    │     │    │
│  │  │  - http://localhost:11434                 │     │    │
│  │  └──────────────────────────────────────────┘     │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ Native OS APIs
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    OPERATING SYSTEM                          │
│         (File System, Kernel, I/O Operations)                │
└─────────────────────────────────────────────────────────────┘
```



---



## 2. DIRECTORY STRUCTURE

```
project-2-file-manager/
├── .cursorrules                      # Global AI coding rules
├── CLAUDE.md                         # Root context document
├── README.md                         # User-facing documentation
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript configuration
├── webpack.config.js                 # Build configuration
├── .gitignore                        # Git ignore rules
│
├── docs/                             # Documentation
│   ├── PRD.md                        # Product Requirements
│   ├── ARCHITECTURE.md               # This file
│   ├── DECISIONS.md                  # Technology decisions
│   └── backlog.md                    # Atomic micro-tasks
│
├── src/
│   ├── main/                         # Main Process (Node.js)
│   │   ├── main.ts                   # Electron entry point
│   │   ├── CLAUDE.md                 # Main process context
│   │   │
│   │   ├── services/                 # Business logic
│   │   │   ├── FileSystemService.ts  # Implements IFileSystemService
│   │   │   ├── DirectoryScanner.ts   # Recursive directory traversal
│   │   │   ├── FileWatcher.ts        # Chokidar integration
│   │   │   └── PathValidator.ts      # Security validation
│   │   │
│   │   ├── handlers/                 # IPC communication
│   │   │   ├── ipcHandlers.ts        # IPC channel definitions
│   │   │   └── securityMiddleware.ts # Request validation
│   │   │
│   │   └── dsa/                      # Data structures
│   │       ├── PathTrie.ts           # O(L) file search
│   │       ├── LRUCache.ts           # Thumbnail cache
│   │       ├── EventQueue.ts         # Priority queue (min-heap)
│   │       ├── HistoryStack.ts       # Doubly linked list
│   │       └── RingBuffer.ts         # Circular buffer
│   │
│   ├── renderer/                     # Renderer Process (React)
│   │   ├── index.tsx                 # React entry point
│   │   ├── App.tsx                   # Root component
│   │   ├── CLAUDE.md                 # Renderer context
│   │   │
│   │   ├── components/               # UI components
│   │   │   ├── FileExplorer/
│   │   │   │   ├── FileGrid.tsx      # Virtualized display
│   │   │   │   ├── FileListItem.tsx  # Individual file
│   │   │   │   └── Breadcrumb.tsx    # Path navigation
│   │   │   ├── Sidebar/
│   │   │   │   ├── DirectoryTree.tsx # Collapsible tree
│   │   │   │   └── QuickAccess.tsx   # Favorites/recent
│   │   │   ├── SearchBar/
│   │   │   │   ├── SearchInput.tsx   # Autocomplete
│   │   │   │   └── SearchResults.tsx # Results list
│   │   │   ├── ChatPanel/
│   │   │   │   ├── ChatInterface.tsx # LLM UI
│   │   │   │   └── MessageBubble.tsx # Individual message
│   │   │   └── ContextMenu/
│   │   │       └── FileContextMenu.tsx # Right-click menu
│   │   │
│   │   ├── hooks/                    # Custom React hooks
│   │   │   ├── useFileSystem.ts      # IPC wrapper
│   │   │   ├── useNavigation.ts      # History management
│   │   │   └── useLLM.ts             # Chat interface
│   │   │
│   │   └── utils/                    # Helper functions
│   │       ├── fileIcons.ts          # Icon mapping
│   │       └── formatters.ts         # Date/size formatting
│   │
│   ├── llm/                          # Intelligence Layer
│   │   ├── CLAUDE.md                 # LLM context
│   │   │
│   │   ├── services/                 # LLM services
│   │   │   ├── IndexingService.ts    # File chunking
│   │   │   ├── VectorStore.ts        # LanceDB wrapper
│   │   │   ├── RetrievalService.ts   # RAG pipeline
│   │   │   ├── LLMInterface.ts       # Ollama client
│   │   │   └── ContextManager.ts     # Context optimization
│   │   │
│   │   └── models/                   # LLM models
│   │       ├── EmbeddingModel.ts     # Embedding generation
│   │       └── PromptTemplates.ts    # System prompts
│   │
│   └── shared/                       # Shared code
│       ├── types/                    # Type definitions
│       │   └── index.ts              # Common types
│       ├── contracts.ts              # Interface contracts (CRITICAL)
│       └── utils/                    # Shared utilities
│           ├── pathUtils.ts          # Path manipulation
│           └── validators.ts         # Input validation
│
├── tests/                            # Test suites
│   ├── unit/                         # Unit tests
│   │   ├── PathTrie.test.ts
│   │   ├── LRUCache.test.ts
│   │   ├── EventQueue.test.ts
│   │   ├── HistoryStack.test.ts
│   │   └── RingBuffer.test.ts
│   ├── integration/                  # Integration tests
│   │   ├── ipc.test.ts
│   │   └── fileOperations.test.ts
│   └── e2e/                          # End-to-end tests
│       └── userFlows.test.ts
│
└── config/                           # Configuration
    ├── jest.config.js                # Jest configuration
    └── electron-builder.yml          # Packaging configuration
```



---



## 3. IPC CHANNEL DEFINITIONS



### 3.1 File System Channels



| Channel | Direction | Input | Output | Description |
|---------|-----------|-------|--------|-------------|
| `FS:READ_DIR` | Renderer → Main | `{ path: string }` | `FileNode[]` | Read directory contents |
| `FS:READ_FILE` | Renderer → Main | `{ path: string }` | `{ content: string, encoding: string }` | Read file content |
| `FS:WRITE_FILE` | Renderer → Main | `{ path: string, content: string }` | `{ success: boolean }` | Write file content |
| `FS:DELETE` | Renderer → Main | `{ path: string }` | `{ success: boolean }` | Delete file/directory |
| `FS:MOVE` | Renderer → Main | `{ source: string, dest: string }` | `{ success: boolean }` | Move file/directory |
| `FS:RENAME` | Renderer → Main | `{ path: string, newName: string }` | `{ success: boolean, newPath: string }` | Rename file/directory |
| `FS:CREATE_FILE` | Renderer → Main | `{ path: string, name: string }` | `{ success: boolean, path: string }` | Create new file |
| `FS:CREATE_DIR` | Renderer → Main | `{ path: string, name: string }` | `{ success: boolean, path: string }` | Create new directory |
| `FS:GET_STATS` | Renderer → Main | `{ path: string }` | `FileStats` | Get file metadata |



### 3.2 Navigation Channels



| Channel | Direction | Input | Output | Description |
|---------|-----------|-------|--------|-------------|
| `NAV:BACK` | Renderer → Main | `{}` | `{ path: string \| null }` | Navigate backward |
| `NAV:FORWARD` | Renderer → Main | `{}` | `{ path: string \| null }` | Navigate forward |
| `NAV:PUSH` | Renderer → Main | `{ path: string }` | `{ success: boolean }` | Add to history |
| `NAV:GET_STATE` | Renderer → Main | `{}` | `{ canGoBack: boolean, canGoForward: boolean }` | Get navigation state |



### 3.3 Search Channels



| Channel | Direction | Input | Output | Description |
|---------|-----------|-------|--------|-------------|
| `SEARCH:AUTOCOMPLETE` | Renderer → Main | `{ prefix: string, maxResults: number }` | `string[]` | Get autocomplete suggestions |
| `SEARCH:QUERY` | Renderer → Main | `{ query: string, path: string }` | `FileNode[]` | Search files |



### 3.4 LLM Channels



| Channel | Direction | Input | Output | Description |
|---------|-----------|-------|--------|-------------|
| `LLM:QUERY` | Renderer → Main | `{ query: string }` | Stream of `{ chunk: string, done: boolean }` | Query LLM (streaming) |
| `LLM:INDEX_STATUS` | Renderer → Main | `{}` | `{ indexed: number, total: number, inProgress: boolean }` | Get indexing status |
| `LLM:START_INDEXING` | Renderer → Main | `{ path: string }` | `{ success: boolean }` | Start indexing directory |
| `LLM:STOP_INDEXING` | Renderer → Main | `{}` | `{ success: boolean }` | Stop indexing |



---



## 4. DATA MODELS



### 4.1 Core Types (in src/shared/contracts.ts)

```typescript
/**
 * Represents a file or directory node in the file system.
 */
export interface FileNode {
  /** Absolute path to the file/directory */
  path: string;
  
  /** Name of the file/directory (without path) */
  name: string;
  
  /** Whether this is a directory */
  isDirectory: boolean;
  
  /** File size in bytes (0 for directories) */
  size: number;
  
  /** Last modified timestamp (Unix milliseconds) */
  modified: number;
  
  /** File extension (e.g., "txt", "pdf") or empty for directories */
  extension: string;
  
  /** MIME type (e.g., "text/plain", "image/png") */
  mimeType: string;
}

/**
 * Detailed file statistics (extended metadata).
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
 * Result of path validation.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: string;
}

/**
 * File system error with context.
 */
export interface FileSystemError {
  code: 'PATH_TRAVERSAL' | 'UNAUTHORIZED_ACCESS' | 'FILE_NOT_FOUND' | 'PERMISSION_DENIED' | 'UNKNOWN';
  message: string;
  path?: string;
  originalError?: Error;
}
```



### 4.2 LLM Types

```typescript
/**
 * Text chunk for embedding and indexing.
 */
export interface TextChunk {
  text: string;
  startChar: number;
  endChar: number;
  chunkIndex: number;
}

/**
 * File metadata for indexing.
 */
export interface FileMetadata {
  filePath: string;
  totalChunks: number;
  indexedAt: number;
  fileSize: number;
  language?: string;
}

/**
 * Vector database record.
 */
export interface VectorRecord {
  id: string;
  chunk_text: string;
  embedding: number[];
  file_path: string;
  chunk_index: number;
  indexed_at: number;
}

/**
 * Retrieval result from RAG pipeline.
 */
export interface RetrievalResult {
  context: string;
  sources: string[];
  tokenCount: number;
}

/**
 * LLM query options.
 */
export interface LLMQueryOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}
```



---



## 5. SECURITY ARCHITECTURE



### 5.1 Defense-in-Depth Strategy

```
Layer 1: Renderer Process Isolation
├── No direct fs access
├── Context isolation enabled
└── Preload script with contextBridge only

Layer 2: IPC Validation
├── All requests validated before processing
├── Type checking with TypeScript interfaces
└── Rate limiting on expensive operations

Layer 3: Path Validation (CRITICAL)
├── Normalize paths BEFORE checking for '..'
├── Validate against allowed root + path.sep
├── Reject system-critical paths
└── Log all validation failures

Layer 4: File System Operations
├── Use fs/promises (async, non-blocking)
├── Proper error handling
└── Atomic operations where possible

Layer 5: LLM Sandboxing
├── Ollama runs locally (no network access)
├── LanceDB in-process only
└── No user data sent to cloud
```



### 5.2 Path Validation Implementation (FIXED)

```typescript
/**
 * Validate file path for security.
 * FIXED: Check for '..' BEFORE resolve() and include path.sep in prefix check.
 */
export function validatePath(
  requestedPath: string,
  allowedRoot: string
): ValidationResult {
  // Step 1: Normalize to prevent directory traversal
  const normalized = path.normalize(requestedPath);
  
  // Step 2: Check for '..' BEFORE resolve (BUG FIX #2)
  if (normalized.includes('..')) {
    return {
      valid: false,
      error: 'PATH_TRAVERSAL',
      details: 'Relative paths with ".." are not allowed'
    };
  }
  
  // Step 3: Resolve to absolute path
  const resolved = path.resolve(normalized);
  
  // Step 4: Ensure within allowed root with path.sep (BUG FIX #3)
  const rootWithSep = allowedRoot.endsWith(path.sep) 
    ? allowedRoot 
    : allowedRoot + path.sep;
    
  if (!resolved.startsWith(rootWithSep) && resolved !== allowedRoot) {
    return {
      valid: false,
      error: 'UNAUTHORIZED_ACCESS',
      details: `Path "${resolved}" is outside allowed directory "${allowedRoot}"`
    };
  }
  
  // Step 5: Check against forbidden paths
  const forbiddenPaths = getForbiddenPaths();
  for (const forbidden of forbiddenPaths) {
    if (resolved.startsWith(forbidden)) {
      return {
        valid: false,
        error: 'UNAUTHORIZED_ACCESS',
        details: `Access to system path "${forbidden}" is forbidden`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Get OS-specific forbidden paths.
 */
function getForbiddenPaths(): string[] {
  const common = [
    path.join(os.homedir(), '.ssh'),
  ];
  
  if (process.platform === 'win32') {
    return [
      ...common,
      'C:\\Windows\\System32',
      'C:\\Windows\\SysWOW64',
    ];
  } else {
    return [
      ...common,
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/root',
    ];
  }
}
```



---



## 6. PERFORMANCE ARCHITECTURE



### 6.1 Renderer Performance

```typescript
// Use React virtualization for large lists
import { FixedSizeList } from 'react-window';

// Memoize expensive computations
const sortedFiles = useMemo(() => {
  return files.sort((a, b) => a.name.localeCompare(b.name));
}, [files]);

// Debounce search input
const debouncedSearch = useMemo(
  () => debounce((query: string) => performSearch(query), 300),
  []
);
```



### 6.2 Main Process Performance

```typescript
// Use Worker Threads for CPU-intensive tasks
import { Worker } from 'worker_threads';

async function indexLargeDirectory(path: string): Promise<IndexResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./workers/fileIndexer.js', {
      workerData: { path }
    });
    
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

// Use streams for large file operations
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

async function processLargeFile(path: string): Promise<void> {
  const readStream = createReadStream(path, { encoding: 'utf-8' });
  const ringBuffer = new RingBuffer<string>(100);
  
  await pipeline(
    readStream,
    new Transform({
      transform(chunk, encoding, callback) {
        ringBuffer.push(chunk.toString());
        callback();
      }
    })
  );
}
```



---



## 7. TESTING ARCHITECTURE



### 7.1 Test Pyramid

```
         /\
        /  \    E2E Tests (5%)
       /____\   - User flows
      /      \  - Full app testing
     /________\ - Playwright/Spectron
    /          \
   /            \ Integration Tests (15%)
  /______________\ - IPC channels
 /                \ - File operations
/__________________\ - Component integration

      Unit Tests (80%)
      - DSA implementations
      - Services
      - Utilities
      - Components (isolated)
```



### 7.2 Testing Strategy



| Test Type | Framework | Coverage Target | CI/CD |
|-----------|-----------|----------------|-------|
| Unit | Jest | >90% | Every commit |
| Integration | Jest + Electron | >80% | Every PR |
| E2E | Playwright | Critical paths only | Before release |



---



## 8. DEPLOYMENT ARCHITECTURE



### 8.1 Build Pipeline

```
┌─────────────────┐
│  Source Code    │
│  (TypeScript)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  TypeScript     │
│  Compilation    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Webpack        │
│  Bundling       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Electron       │
│  Packaging      │
│  (electron-     │
│   builder)      │
└────────┬────────┘
         │
         ├──────────────────┬──────────────────┐
         ▼                  ▼                  ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Windows   │   │    macOS    │   │    Linux    │
│   (NSIS)    │   │    (DMG)    │   │ (AppImage)  │
└─────────────┘   └─────────────┘   └─────────────┘
```



### 8.2 Package Outputs

```yaml
# electron-builder.yml
appId: com.project2.filemanager
productName: Project-2 File Manager

directories:
  output: dist
  buildResources: build

files:
  - src/**/*
  - node_modules/**/*
  - package.json

mac:
  target:
    - dmg
    - zip
  category: public.app-category.productivity

win:
  target:
    - nsis
    - portable
  icon: build/icon.ico

linux:
  target:
    - AppImage
    - deb
  category: FileManager
```



---



## 9. CONSTRAINTS & TRADE-OFFS



### 9.1 Architectural Decisions



| Decision | Chosen | Alternatives Considered | Trade-off |
|----------|--------|------------------------|-----------|
| Framework | Electron | Tauri, NW.js | Electron: mature ecosystem, clear process separation. Trade-off: larger bundle size |
| Frontend | React | Vue, Svelte | React: hooks for state, largest ecosystem. Trade-off: heavier than Svelte |
| Vector DB | LanceDB | Chroma, Qdrant | LanceDB: in-process, no server. Trade-off: less features than Qdrant |
| LLM Runtime | Ollama | llama.cpp, LocalAI | Ollama: simple API, model management. Trade-off: requires separate installation |
| Testing | Jest | Vitest, Mocha | Jest: best Electron support. Trade-off: slower than Vitest |



### 9.2 Known Limitations



1. **LLM Performance**: Local inference slower than cloud APIs (trade-off for privacy)
2. **Memory Usage**: LLM models require 4-8GB RAM (trade-off for offline capability)
3. **Index Size**: Vector embeddings grow with file count (trade-off for semantic search)
4. **Platform Differences**: File permissions work differently on Windows vs Unix (trade-off for cross-platform support)



---



**DOCUMENT APPROVAL**:

- [x] Architecture Review: Praneshrajan137 Date: December 4, 2025
- [ ] Security Review: _______________ Date: ______
- [ ] Performance Review: _______________ Date: ______



---

