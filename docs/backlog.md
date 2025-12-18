# Micro-Task Backlog

**Project**: OS File Manager with Custom LLM  
**Created**: December 6, 2025  
**Total Tasks**: 247  
**Estimated Duration**: 5-6 Weeks

---

## Legend

- `[ ]` Not started
- `[/]` In progress
- `[x]` Completed
- `🔴` Critical path
- `🧪` Requires test first (TDD)

---

## Phase 2: Core Setup (Week 1)

### 2.1 Project Infrastructure

#### Build Configuration
- [ ] 🔴 Create `webpack.main.config.js` for Main process bundling
- [ ] 🔴 Create `webpack.renderer.config.js` for Renderer process bundling
- [ ] Create `postcss.config.js` for Tailwind CSS processing
- [ ] Create `electron-builder.yml` for packaging configuration
- [ ] Create `.editorconfig` for consistent code style
- [ ] Create `.nvmrc` with Node.js version specification
- [ ] Create `.prettierrc` for code formatting rules

#### Entry Points
- [ ] 🔴 Create `src/main/main.ts` - Electron main entry point
- [ ] 🔴 Create `src/main/preload.ts` - Context bridge for IPC
- [ ] 🔴 Create `src/renderer/index.tsx` - React entry point
- [ ] 🔴 Create `src/renderer/App.tsx` - Root React component
- [ ] Create `src/renderer/index.html` - HTML template
- [ ] Create `src/renderer/styles/index.css` - Global styles with Tailwind

---

### 2.2 Shared Contracts (`src/shared/`)

#### Core Interfaces (contracts.ts already exists - validate/extend)
- [ ] Validate `FileNode` interface completeness
- [ ] Validate `FileStats` interface completeness
- [ ] Validate `ValidationResult` interface completeness
- [ ] Validate `FileSystemError` interface completeness
- [ ] Validate `IFileSystemService` interface completeness
- [ ] Validate `INavigationService` interface completeness
- [ ] Validate `ISearchService` interface completeness
- [ ] Validate `ILLMService` interface completeness

#### Shared Types (`src/shared/types/`)
- [ ] Create `src/shared/types/index.ts` - Type exports
- [ ] Create `src/shared/types/events.ts` - Event type definitions
- [ ] Create `src/shared/types/ipc.ts` - IPC message types

#### Shared Utilities (`src/shared/utils/`)
- [ ] Create `src/shared/utils/pathUtils.ts` - Path manipulation helpers
- [ ] 🧪 Write test for `normalizePath()` function
- [ ] 🧪 Write test for `getExtension()` function
- [ ] 🧪 Write test for `getBasename()` function
- [ ] Create `src/shared/utils/validators.ts` - Input validation
- [ ] 🧪 Write test for `isValidFilename()` function
- [ ] 🧪 Write test for `isValidPath()` function
- [ ] Create `src/shared/utils/formatters.ts` - Display formatters
- [ ] 🧪 Write test for `formatFileSize()` function
- [ ] 🧪 Write test for `formatDate()` function
- [ ] Create `src/shared/utils/mimeTypes.ts` - MIME type detection
- [ ] 🧪 Write test for `getMimeType()` function

---

### 2.3 Main Process - Security (`src/main/services/`)

#### Path Validator
- [ ] 🔴 Create `src/main/services/PathValidator.ts`
- [ ] Implement `validatePath()` with 4 security fixes
- [ ] Implement `getForbiddenPaths()` for OS-specific paths
- [ ] Implement `isWithinBoundary()` helper
- [ ] 🧪 Write test: Path traversal with `../` blocked
- [ ] 🧪 Write test: Path traversal with `..\\` blocked (Windows)
- [ ] 🧪 Write test: Normalized path traversal blocked
- [ ] 🧪 Write test: Prefix escape attack blocked (`/home/user` vs `/home/user2`)
- [ ] 🧪 Write test: Forbidden paths blocked (`/etc/passwd`)
- [ ] 🧪 Write test: Valid paths within boundary allowed
- [ ] 🧪 Write test: Root directory itself is allowed
- [ ] 🧪 Write test: Cross-platform path separators handled

---

## Phase 3: DSA Implementations (Week 2)

### 3.1 PathTrie (`src/main/dsa/PathTrie.ts`)

#### Structure Setup
- [ ] Create `src/main/dsa/PathTrie.ts`
- [ ] Define `PathTrieNode` interface with children Map
- [ ] Create `PathTrie` class with root node
- [ ] Add JSDoc complexity annotations

#### Insert Operation - O(L)
- [ ] 🧪 Write test: Insert single path
- [ ] Implement `insert(path, metadata)` method
- [ ] 🧪 Write test: Insert nested paths
- [ ] 🧪 Write test: Insert duplicate path (should update metadata)
- [ ] 🧪 Write test: Insert with empty segments filtered
- [ ] 🧪 Write test: Insert preserves existing children

#### Search Operation - O(L)
- [ ] 🧪 Write test: Search existing path returns metadata
- [ ] Implement `search(path)` method
- [ ] 🧪 Write test: Search non-existing path returns null
- [ ] 🧪 Write test: Search partial path returns null
- [ ] 🧪 Write test: Search is case-sensitive

#### Autocomplete Operation
- [ ] 🧪 Write test: Autocomplete with matching prefix
- [ ] Implement `autocomplete(prefix, maxResults)` method
- [ ] 🧪 Write test: Autocomplete with no matches returns empty
- [ ] 🧪 Write test: Autocomplete respects maxResults limit
- [ ] 🧪 Write test: Autocomplete returns sorted results
- [ ] Implement helper `collectPaths()` for DFS traversal

#### Delete Operation - O(L)
- [ ] 🧪 Write test: Delete existing path
- [ ] Implement `delete(path)` method
- [ ] 🧪 Write test: Delete non-existing path (no-op)
- [ ] 🧪 Write test: Delete cleans up empty parent nodes

#### Clear Operation
- [ ] 🧪 Write test: Clear removes all paths
- [ ] Implement `clear()` method
- [ ] 🧪 Write test: Clear resets size to 0

---

### 3.2 LRUCache (`src/main/dsa/LRUCache.ts`)

#### Structure Setup
- [ ] Create `src/main/dsa/LRUCache.ts`
- [ ] Define `CacheNode<T>` interface with prev/next pointers
- [ ] Create `LRUCache<T>` class with capacity
- [ ] Initialize head/tail sentinel nodes
- [ ] Initialize HashMap for O(1) access

#### Get Operation - O(1)
- [ ] 🧪 Write test: Get existing key returns value
- [ ] Implement `get(key)` method
- [ ] 🧪 Write test: Get moves item to front (most recent)
- [ ] 🧪 Write test: Get non-existing key returns null
- [ ] Implement `moveToFront(node)` helper

#### Put Operation - O(1)
- [ ] 🧪 Write test: Put new key-value pair
- [ ] Implement `put(key, value)` method
- [ ] 🧪 Write test: Put existing key updates value
- [ ] 🧪 Write test: Put moves item to front
- [ ] 🧪 Write test: Put evicts LRU when at capacity
- [ ] Implement `evictTail()` helper
- [ ] Implement `addToFront(node)` helper

#### Delete Operation - O(1)
- [ ] 🧪 Write test: Delete existing key
- [ ] Implement `delete(key)` method
- [ ] 🧪 Write test: Delete non-existing key (no-op)
- [ ] Implement `removeNode(node)` helper

#### Utility Methods
- [ ] 🧪 Write test: Size returns correct count
- [ ] Implement `size()` method
- [ ] 🧪 Write test: Clear removes all entries
- [ ] Implement `clear()` method
- [ ] 🧪 Write test: Has returns correct boolean
- [ ] Implement `has(key)` method

---

### 3.3 EventQueue (`src/main/dsa/EventQueue.ts`)

#### Structure Setup
- [ ] Create `src/main/dsa/EventQueue.ts`
- [ ] Define `FileEvent` interface with priority
- [ ] Define `EventPriority` enum (USER=1, WATCHER=5, INDEX=10)
- [ ] Create `EventQueue` class with heap array

#### Enqueue Operation - O(log n)
- [ ] 🧪 Write test: Enqueue single event
- [ ] Implement `enqueue(event)` method
- [ ] 🧪 Write test: Enqueue maintains heap property
- [ ] Implement `heapifyUp(index)` helper
- [ ] 🧪 Write test: Events ordered by priority
- [ ] 🧪 Write test: Same priority ordered by timestamp (FIFO)

#### Dequeue Operation - O(log n)
- [ ] 🧪 Write test: Dequeue returns highest priority
- [ ] Implement `dequeue()` method
- [ ] 🧪 Write test: Dequeue from empty returns null
- [ ] Implement `heapifyDown(index)` helper
- [ ] 🧪 Write test: Dequeue maintains heap property
- [ ] 🧪 Write test: USER_ACTION processed before FILE_WATCHER

#### Peek Operation - O(1)
- [ ] 🧪 Write test: Peek returns next without removing
- [ ] Implement `peek()` method
- [ ] 🧪 Write test: Peek on empty returns null

#### Utility Methods
- [ ] Implement `size()` method
- [ ] Implement `isEmpty()` method
- [ ] Implement `clear()` method
- [ ] 🧪 Write test for each utility method

---

### 3.4 HistoryStack (`src/main/dsa/HistoryStack.ts`)

#### Structure Setup
- [ ] Create `src/main/dsa/HistoryStack.ts`
- [ ] Define `HistoryNode` interface with prev/next pointers
- [ ] Create `HistoryStack` class with current pointer
- [ ] Define max size constant (50)

#### Push Operation - O(1)
- [ ] 🧪 Write test: Push adds new path to history
- [ ] Implement `push(path)` method
- [ ] 🧪 Write test: Push clears forward history
- [ ] 🧪 Write test: Push at max size evicts oldest
- [ ] Implement `evictOldest()` helper
- [ ] 🧪 Write test: Push updates canGoBack state

#### Back Operation - O(1)
- [ ] 🧪 Write test: Back returns previous path
- [ ] Implement `back()` method
- [ ] 🧪 Write test: Back at start returns null
- [ ] 🧪 Write test: Back updates canGoForward state
- [ ] 🧪 Write test: Multiple back operations work correctly

#### Forward Operation - O(1)
- [ ] 🧪 Write test: Forward returns next path
- [ ] Implement `forward()` method
- [ ] 🧪 Write test: Forward at end returns null
- [ ] 🧪 Write test: Forward updates canGoBack state

#### State Methods
- [ ] Implement `canGoBack()` method
- [ ] Implement `canGoForward()` method
- [ ] Implement `getCurrentPath()` method
- [ ] 🧪 Write test: State methods return correct values

---

### 3.5 RingBuffer (`src/main/dsa/RingBuffer.ts`)

#### Structure Setup
- [ ] Create `src/main/dsa/RingBuffer.ts`
- [ ] Create `RingBuffer<T>` class with fixed capacity
- [ ] Initialize buffer array and write index
- [ ] Define default capacity constant (100)

#### Push Operation - O(1)
- [ ] 🧪 Write test: Push adds item to buffer
- [ ] Implement `push(item)` method
- [ ] 🧪 Write test: Push overwrites oldest when full
- [ ] 🧪 Write test: Write index wraps around correctly
- [ ] 🧪 Write test: Size capped at capacity

#### Get Items Operation - O(n)
- [ ] 🧪 Write test: GetItems returns all items in order
- [ ] Implement `getItems(count?)` method
- [ ] 🧪 Write test: GetItems with count limit
- [ ] 🧪 Write test: GetItems handles wrap-around correctly
- [ ] 🧪 Write test: GetItems on empty returns empty array

#### Utility Methods
- [ ] Implement `size()` method
- [ ] Implement `capacity()` method
- [ ] Implement `isFull()` method
- [ ] Implement `clear()` method
- [ ] 🧪 Write test for each utility method

---

## Phase 4: File System Operations (Week 2-3)

### 4.1 FileSystemService (`src/main/services/FileSystemService.ts`)

#### Service Setup
- [ ] Create `src/main/services/FileSystemService.ts`
- [ ] Implement `IFileSystemService` interface
- [ ] Inject `PathValidator` dependency
- [ ] Add constructor with configuration options

#### Read Directory
- [ ] 🧪 Write test: Read directory returns FileNode array
- [ ] Implement `readDirectory(path)` method
- [ ] 🧪 Write test: Read directory validates path first
- [ ] 🧪 Write test: Read non-existent directory throws
- [ ] 🧪 Write test: Read file as directory throws
- [ ] 🧪 Write test: Hidden files detected correctly

#### Read File
- [ ] 🧪 Write test: Read file returns content string
- [ ] Implement `readFile(path, encoding?)` method
- [ ] 🧪 Write test: Read with different encodings
- [ ] 🧪 Write test: Read non-existent file throws
- [ ] 🧪 Write test: Read directory as file throws

#### Write File
- [ ] 🧪 Write test: Write file creates new file
- [ ] Implement `writeFile(path, content)` method
- [ ] 🧪 Write test: Write file overwrites existing
- [ ] 🧪 Write test: Write validates path first
- [ ] 🧪 Write test: Write to read-only throws

#### Delete
- [ ] 🧪 Write test: Delete file removes it
- [ ] Implement `delete(path, recursive?)` method
- [ ] 🧪 Write test: Delete directory non-recursive throws if not empty
- [ ] 🧪 Write test: Delete directory recursive removes all
- [ ] 🧪 Write test: Delete non-existent throws

#### Move/Rename
- [ ] 🧪 Write test: Move file to new location
- [ ] Implement `move(source, destination)` method
- [ ] 🧪 Write test: Move validates both paths
- [ ] 🧪 Write test: Rename file in same directory
- [ ] 🧪 Write test: Move to existing destination throws

#### Get Stats
- [ ] 🧪 Write test: Get stats returns FileStats
- [ ] Implement `getStats(path)` method
- [ ] 🧪 Write test: Stats includes permissions
- [ ] 🧪 Write test: Stats for directory vs file

---

### 4.2 DirectoryScanner (`src/main/services/DirectoryScanner.ts`)

#### Service Setup
- [ ] Create `src/main/services/DirectoryScanner.ts`
- [ ] Inject `FileSystemService` and `PathTrie`
- [ ] Add max depth configuration

#### Recursive Scan
- [ ] 🧪 Write test: Scan populates PathTrie
- [ ] Implement `scan(rootPath)` method
- [ ] 🧪 Write test: Scan respects max depth
- [ ] 🧪 Write test: Scan skips hidden files (optional)
- [ ] 🧪 Write test: Scan handles permission errors gracefully

#### Incremental Update
- [ ] Implement `addPath(path)` method
- [ ] Implement `removePath(path)` method
- [ ] 🧪 Write tests for incremental updates

---

### 4.3 FileWatcher (`src/main/services/FileWatcher.ts`)

#### Service Setup
- [ ] Create `src/main/services/FileWatcher.ts`
- [ ] Inject `EventQueue` for event handling
- [ ] Configure chokidar options

#### Watch Operations
- [ ] Implement `watch(path)` method
- [ ] Implement `unwatch(path)` method
- [ ] Implement `unwatchAll()` method

#### Event Handling
- [ ] Handle 'add' events with USER/WATCHER priority
- [ ] Handle 'change' events
- [ ] Handle 'unlink' events
- [ ] Handle 'addDir' events
- [ ] Handle 'unlinkDir' events
- [ ] 🧪 Write tests for each event type
- [ ] 🧪 Write test: Events queued with correct priority

---

### 4.4 IPC Handlers (`src/main/handlers/`)

#### Handler Setup
- [ ] Create `src/main/handlers/ipcHandlers.ts`
- [ ] Create `src/main/handlers/securityMiddleware.ts`
- [ ] Implement request validation middleware

#### File System Channels
- [ ] Implement `FS:READ_DIR` handler
- [ ] Implement `FS:READ_FILE` handler
- [ ] Implement `FS:WRITE_FILE` handler
- [ ] Implement `FS:DELETE` handler
- [ ] Implement `FS:MOVE` handler
- [ ] Implement `FS:CREATE_FILE` handler
- [ ] Implement `FS:CREATE_DIR` handler
- [ ] Implement `FS:GET_STATS` handler
- [ ] 🧪 Write integration test for each handler

#### Navigation Channels
- [ ] Implement `NAV:BACK` handler
- [ ] Implement `NAV:FORWARD` handler
- [ ] Implement `NAV:PUSH` handler
- [ ] Implement `NAV:GET_STATE` handler
- [ ] 🧪 Write integration tests for navigation

#### Search Channels
- [ ] Implement `SEARCH:AUTOCOMPLETE` handler
- [ ] Implement `SEARCH:QUERY` handler
- [ ] 🧪 Write integration tests for search

---

## Phase 5: UI Components (Week 3-4)

### 5.1 Core Hooks (`src/renderer/hooks/`)

#### useFileSystem Hook
- [ ] Create `src/renderer/hooks/useFileSystem.ts`
- [ ] Implement `readDirectory()` wrapper
- [ ] Implement `deleteFile()` wrapper
- [ ] Implement `createFile()` wrapper
- [ ] Implement `renameFile()` wrapper
- [ ] Add loading/error state management
- [ ] 🧪 Write tests with mocked IPC

#### useNavigation Hook
- [ ] Create `src/renderer/hooks/useNavigation.ts`
- [ ] Implement `goBack()` wrapper
- [ ] Implement `goForward()` wrapper
- [ ] Implement `navigateTo()` wrapper
- [ ] Track canGoBack/canGoForward state
- [ ] 🧪 Write tests for navigation state

#### useLLM Hook
- [ ] Create `src/renderer/hooks/useLLM.ts`
- [ ] Implement `query()` with streaming
- [ ] Implement `getIndexingStatus()`
- [ ] Add loading/error state management
- [ ] 🧪 Write tests with mocked IPC

---

### 5.2 File Explorer Components

#### FileGrid Component
- [ ] Create `src/renderer/components/FileExplorer/FileGrid.tsx`
- [ ] Implement virtualized list with react-window
- [ ] Add keyboard navigation (arrow keys)
- [ ] Add selection state (single/multi)
- [ ] 🧪 Write test: Renders file list
- [ ] 🧪 Write test: Keyboard navigation works

#### FileListItem Component
- [ ] Create `src/renderer/components/FileExplorer/FileListItem.tsx`
- [ ] Display file icon based on type
- [ ] Display name, size, modified date
- [ ] Handle click/double-click events
- [ ] 🧪 Write test: Displays file info correctly

#### Breadcrumb Component
- [ ] Create `src/renderer/components/FileExplorer/Breadcrumb.tsx`
- [ ] Parse path into segments
- [ ] Make each segment clickable
- [ ] Handle path navigation
- [ ] 🧪 Write test: Renders path segments

---

### 5.3 Sidebar Components

#### DirectoryTree Component
- [ ] Create `src/renderer/components/Sidebar/DirectoryTree.tsx`
- [ ] Implement collapsible tree structure
- [ ] Lazy load children on expand
- [ ] Highlight current directory
- [ ] 🧪 Write test: Expands/collapses correctly

#### QuickAccess Component
- [ ] Create `src/renderer/components/Sidebar/QuickAccess.tsx`
- [ ] Display favorites list
- [ ] Display recent files
- [ ] Handle add/remove favorites
- [ ] 🧪 Write test: Renders quick access items

---

### 5.4 Search Components

#### SearchInput Component
- [ ] Create `src/renderer/components/SearchBar/SearchInput.tsx`
- [ ] Implement controlled input
- [ ] Add debounced autocomplete trigger
- [ ] Handle keyboard shortcuts (Ctrl+F)
- [ ] 🧪 Write test: Input value updates

#### SearchResults Component
- [ ] Create `src/renderer/components/SearchBar/SearchResults.tsx`
- [ ] Display autocomplete suggestions
- [ ] Handle keyboard selection
- [ ] Handle click navigation
- [ ] 🧪 Write test: Displays results

---

### 5.5 Chat Panel Components

#### ChatInterface Component
- [ ] Create `src/renderer/components/ChatPanel/ChatInterface.tsx`
- [ ] Implement message list
- [ ] Implement input field
- [ ] Handle streaming responses
- [ ] 🧪 Write test: Sends messages

#### MessageBubble Component
- [ ] Create `src/renderer/components/ChatPanel/MessageBubble.tsx`
- [ ] Style user vs assistant messages
- [ ] Support markdown rendering
- [ ] Display source citations
- [ ] 🧪 Write test: Renders message correctly

---

### 5.6 Context Menu Component

#### FileContextMenu Component
- [ ] Create `src/renderer/components/ContextMenu/FileContextMenu.tsx`
- [ ] Display on right-click
- [ ] Include: Open, Rename, Delete, Copy Path
- [ ] Handle menu item clicks
- [ ] 🧪 Write test: Menu opens on right-click

---

### 5.7 Preview Components

#### FilePreview Component
- [ ] Create `src/renderer/components/Preview/FilePreview.tsx`
- [ ] Detect file type and render appropriate preview
- [ ] Handle text files with syntax highlighting
- [ ] Handle images with dimensions
- [ ] Handle unsupported types gracefully
- [ ] 🧪 Write test: Preview renders for each type

#### LogPreview Component
- [ ] Create `src/renderer/components/Preview/LogPreview.tsx`
- [ ] Use RingBuffer for large log display
- [ ] Show last 100 lines
- [ ] Auto-scroll to bottom
- [ ] 🧪 Write test: Shows last N lines

---

### 5.8 Utility Components

#### ConfirmDialog Component
- [ ] Create `src/renderer/components/shared/ConfirmDialog.tsx`
- [ ] Accept title, message, onConfirm, onCancel
- [ ] Handle keyboard (Enter/Escape)
- [ ] 🧪 Write test: Calls correct callback

#### Toast Component
- [ ] Create `src/renderer/components/shared/Toast.tsx`
- [ ] Support success/error/info variants
- [ ] Auto-dismiss after timeout
- [ ] 🧪 Write test: Displays and dismisses

#### LoadingSpinner Component
- [ ] Create `src/renderer/components/shared/LoadingSpinner.tsx`
- [ ] Accept size prop
- [ ] 🧪 Write test: Renders correctly

---

## Phase 6: LLM Integration (Week 4-5)

### 6.1 Indexing Service (`src/llm/services/`)

#### IndexingService
- [ ] Create `src/llm/services/IndexingService.ts`
- [ ] Implement file content chunking (500 tokens)
- [ ] Implement chunk overlap (50 tokens)
- [ ] Implement `chunkFile(path)` method
- [ ] Implement `indexFile(path)` method
- [ ] 🧪 Write test: Chunking produces correct segments
- [ ] 🧪 Write test: Overlap maintained between chunks

#### Background Indexing
- [ ] Implement indexing queue
- [ ] Implement `startIndexing(directory)` method
- [ ] Implement `stopIndexing()` method
- [ ] Implement progress tracking
- [ ] 🧪 Write test: Non-blocking indexing

---

### 6.2 Vector Store (`src/llm/services/VectorStore.ts`)

#### Database Setup
- [ ] Create `src/llm/services/VectorStore.ts`
- [ ] Implement LanceDB connection
- [ ] Create/open 'file_chunks' table
- [ ] Define VectorRecord schema

#### CRUD Operations
- [ ] Implement `addChunks(chunks, embeddings, path)` method
- [ ] Implement `search(embedding, topK)` method
- [ ] Implement `deleteFile(path)` method (secure)
- [ ] 🧪 Write test: Add and retrieve chunks
- [ ] 🧪 Write test: Delete removes all file chunks

---

### 6.3 Embedding Model (`src/llm/models/`)

#### EmbeddingModel
- [ ] Create `src/llm/models/EmbeddingModel.ts`
- [ ] Implement `embed(text)` method using Ollama
- [ ] Implement batch embedding for efficiency
- [ ] Handle embedding errors gracefully
- [ ] 🧪 Write test: Embeddings have correct dimensions

---

### 6.4 Retrieval Service (`src/llm/services/RetrievalService.ts`)

#### RAG Pipeline
- [ ] Create `src/llm/services/RetrievalService.ts`
- [ ] Implement `retrieveContext(query)` method
- [ ] Implement similarity search
- [ ] Implement BM25 re-ranking
- [ ] Implement context compression
- [ ] 🧪 Write test: Retrieves relevant chunks

---

### 6.5 LLM Interface (`src/llm/services/LLMInterface.ts`)

#### Ollama Client
- [ ] Create `src/llm/services/LLMInterface.ts`
- [ ] Implement streaming `query()` method
- [ ] Implement `summarize()` for compression
- [ ] Handle connection errors
- [ ] 🧪 Write test with mocked Ollama

#### Prompt Templates
- [ ] Create `src/llm/models/PromptTemplates.ts`
- [ ] Define system prompt for code assistant
- [ ] Define context template
- [ ] Define summarization prompt
- [ ] 🧪 Write test: Templates format correctly

---

### 6.6 LLM IPC Handlers

#### Handler Implementation
- [ ] Implement `LLM:QUERY` handler with streaming
- [ ] Implement `LLM:INDEX_STATUS` handler
- [ ] Implement `LLM:START_INDEXING` handler
- [ ] Implement `LLM:STOP_INDEXING` handler
- [ ] 🧪 Write integration tests for LLM channels

---

## Phase 7: Testing & Polish (Week 5-6)

### 7.1 Integration Tests

#### IPC Integration Tests
- [ ] Create `tests/integration/ipc.test.ts`
- [ ] Test full request/response cycle
- [ ] Test error propagation
- [ ] Test concurrent requests

#### File Operations Integration Tests
- [ ] Create `tests/integration/fileOperations.test.ts`
- [ ] Test CRUD operations end-to-end
- [ ] Test with real file system (temp directory)
- [ ] Test edge cases (permissions, large files)

---

### 7.2 E2E Tests

#### User Flow Tests
- [ ] Create `tests/e2e/userFlows.test.ts`
- [ ] Test: Navigate and delete file flow
- [ ] Test: Search and preview file flow
- [ ] Test: Ask LLM about code flow
- [ ] Test: Back/forward navigation flow

---

### 7.3 Performance Tests

#### Benchmark Tests
- [ ] Test directory scan <200ms for 1000 files
- [ ] Test navigation latency <50ms
- [ ] Test autocomplete <50ms
- [ ] Test memory usage <500MB with 10k files
- [ ] Test render 10000 files <200ms

---

### 7.4 Security Audit

#### Security Validation
- [ ] Audit all path validation usage
- [ ] Verify no direct fs import in renderer
- [ ] Review IPC channel security
- [ ] Run dependency vulnerability scan

---

### 7.5 Documentation

#### Code Documentation
- [ ] Add JSDoc to all public APIs
- [ ] Verify complexity annotations on DSA methods
- [ ] Update README with final instructions
- [ ] Create CONTRIBUTING.md

---

### 7.6 Build & Package

#### Final Build
- [ ] Test production build
- [ ] Test Windows package
- [ ] Test macOS package
- [ ] Test Linux package
- [ ] Verify all platforms work

---

## Summary

| Phase | Task Count | Status |
|-------|------------|--------|
| Phase 2: Core Setup | 47 | Not Started |
| Phase 3: DSA Implementations | 84 | Not Started |
| Phase 4: File System Operations | 52 | Not Started |
| Phase 5: UI Components | 41 | Not Started |
| Phase 6: LLM Integration | 23 | Not Started |
| Phase 7: Testing & Polish | 20 | Not Started |
| **TOTAL** | **247** | **0% Complete** |

---

**Critical Path Items** (🔴):
1. webpack.main.config.js
2. webpack.renderer.config.js
3. src/main/main.ts
4. src/main/preload.ts
5. src/renderer/index.tsx
6. PathValidator.ts

**Next Action**: Start with Phase 2.1 (Project Infrastructure) to unblock development.
