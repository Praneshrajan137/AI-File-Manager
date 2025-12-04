# Product Requirements Document (PRD)

## Project-2: OS File Manager with Custom LLM



**Version**: 1.0  
**Last Updated**: December 4, 2025  
**Status**: Approved  
**Product Manager**: Praneshrajan137



---



## 1. EXECUTIVE SUMMARY



### 1.1 Vision

Build an industrial-grade Operating System File Manager that demonstrates mastery of Linux fundamentals, advanced data structures & algorithms, and AI integration through a custom local LLM-powered chat interface.



### 1.2 Success Criteria

- ✅ All CRUD operations work reliably (<50ms latency)
- ✅ Advanced DSA implementations visible in architecture
- ✅ Local LLM chat functionality works offline
- ✅ >90% test coverage
- ✅ Zero security vulnerabilities
- ✅ Deployable across Linux, macOS, Windows



---



## 2. USER PERSONAS



### Persona 1: Software Developer

- **Name**: Alex, Senior Developer
- **Goals**: Manage project files efficiently, quickly find code snippets across large codebases
- **Pain Points**: Slow file search in IDEs, context switching between terminal and GUI
- **How Project-2 Helps**: Fast Trie-based search, LLM-powered code understanding



### Persona 2: Student Learning OS Concepts

- **Name**: Jordan, CS Student
- **Goals**: Understand how file systems work at kernel level
- **Pain Points**: Abstract concepts in textbooks, no hands-on experience
- **How Project-2 Helps**: See DSA implementations (Trie, LRU Cache) in real file manager



### Persona 3: Privacy-Conscious User

- **Name**: Sam, Security Researcher
- **Goals**: Manage sensitive documents without cloud dependencies
- **Pain Points**: Mistrust of cloud file managers, data breaches
- **How Project-2 Helps**: 100% local processing, no telemetry, open source



---



## 3. FUNCTIONAL REQUIREMENTS



### 3.1 Core File Operations (MVP - Phase 1)



#### FR-1.1: Directory Navigation

**User Story**: As a user, I want to navigate through directories so that I can browse my file system.



**Acceptance Criteria**:

- [ ] Display current directory path in breadcrumb format
- [ ] Double-click folder to open
- [ ] Back/Forward buttons work (O(1) using Doubly Linked List)
- [ ] Keyboard shortcuts: Arrow keys for navigation, Enter to open
- [ ] Display "empty folder" message when directory has no files



**DSA Requirement**: HistoryStack (Doubly Linked List) for O(1) back/forward navigation



---



#### FR-1.2: File Display

**User Story**: As a user, I want to see files with their metadata so that I can identify them quickly.



**Acceptance Criteria**:

- [ ] Display file name, size, type, last modified date
- [ ] Show appropriate icons for file types (.txt, .pdf, .js, etc.)
- [ ] Support grid view and list view
- [ ] Virtualize rendering for folders with 10,000+ files (react-window)
- [ ] Sort by name, size, date (ascending/descending)



**Performance Target**: Render 10,000 files in <200ms



---



#### FR-1.3: File Operations (CRUD)

**User Story**: As a user, I want to create, read, update, and delete files so that I can manage my file system.



**Acceptance Criteria**:

- [ ] **Create**: Right-click → "New File" → Enter name → File created
- [ ] **Read**: Double-click file → Opens in default application
- [ ] **Update**: Rename via right-click menu or F2 key
- [ ] **Delete**: Delete key or right-click → "Delete" → Confirmation dialog → File moved to trash
- [ ] Undo functionality for accidental deletes (store last 10 operations)



**Security**: All paths validated before fs operations



---



#### FR-1.4: Search Functionality

**User Story**: As a developer, I want to search for files by name so that I can find them quickly in large directories.



**Acceptance Criteria**:

- [ ] Search bar at top of window
- [ ] Real-time autocomplete suggestions (powered by Trie)
- [ ] Search supports wildcards: `*.js` finds all JavaScript files
- [ ] Search is case-insensitive by default
- [ ] Display search results in <100ms for 50,000 indexed files



**DSA Requirement**: PathTrie for O(L) search complexity where L = path length



**Performance Target**: Autocomplete suggestions in <50ms



---



### 3.2 Advanced Features (MVP - Phase 2)



#### FR-2.1: File Preview

**User Story**: As a user, I want to preview file content without opening the file so that I can quickly check its contents.



**Acceptance Criteria**:

- [ ] Preview pane on right side of window
- [ ] Support text files (.txt, .md, .json, .js, etc.)
- [ ] Syntax highlighting for code files
- [ ] For large log files, show last 100 lines (Ring Buffer implementation)
- [ ] Preview images (.png, .jpg) with dimensions



**DSA Requirement**: RingBuffer for efficient log file preview



---



#### FR-2.2: File Watcher (Real-Time Updates)

**User Story**: As a user, I want the file manager to update automatically when files change so that I always see current state.



**Acceptance Criteria**:

- [ ] Detect file creation, modification, deletion from external sources
- [ ] Update UI without full refresh
- [ ] Handle rapid-fire events (e.g., `npm install` creating 1000s of files)
- [ ] Priority queue ensures user actions processed before background events



**DSA Requirement**: EventQueue (Priority Queue/Min-Heap) for event handling



**Performance Target**: Process 100 events/second without UI lag



---



#### FR-2.3: Thumbnail Cache

**User Story**: As a user working with images, I want thumbnails to load quickly so that I can browse visual content efficiently.



**Acceptance Criteria**:

- [ ] Generate thumbnails for image files
- [ ] Cache thumbnails in memory (LRU eviction when limit reached)
- [ ] Cache size limit: 100MB
- [ ] Cache persists across sessions (saved to disk)



**DSA Requirement**: LRU Cache for O(1) thumbnail access



---



### 3.3 AI Features (MVP - Phase 3)



#### FR-3.1: LLM Chat Interface

**User Story**: As a developer, I want to ask questions about my codebase so that I can understand it faster.



**Acceptance Criteria**:

- [ ] Chat panel docked on right side (collapsible)
- [ ] Type question → Get answer from local LLM
- [ ] LLM has access to indexed file content via RAG
- [ ] Example queries:
  - "What does the auth.ts file do?"
  - "Find all functions that use the database"
  - "Explain the authentication flow"
- [ ] Streaming responses (word-by-word display)
- [ ] Cite source files in response



**Privacy Requirement**: All processing local (Ollama + LanceDB)



---



#### FR-3.2: File Indexing

**User Story**: As a user, I want my files to be indexed automatically so that the LLM can answer questions about them.



**Acceptance Criteria**:

- [ ] Background indexing starts on app launch
- [ ] Index text files only (.txt, .md, .js, .py, .java, etc.)
- [ ] Skip binary files and large files (>10MB)
- [ ] Show indexing progress (e.g., "Indexed 150/300 files")
- [ ] Indexing doesn't block UI (runs in background)
- [ ] Re-index modified files automatically



**Performance Target**: Index 1,000 files in <2 minutes



---



#### FR-3.3: Semantic Search

**User Story**: As a researcher, I want to find files by meaning, not just filename, so that I can discover relevant documents.



**Acceptance Criteria**:

- [ ] Search mode toggle: "Filename" vs "Content"
- [ ] Content search uses semantic similarity (vector search)
- [ ] Example: Query "machine learning papers" finds files containing ML content even if filename doesn't say "ML"
- [ ] Display relevance score for each result



---



## 4. NON-FUNCTIONAL REQUIREMENTS



### 4.1 Performance



| Metric | Target | Critical? | Measurement Method |
|--------|--------|-----------|-------------------|
| App launch time | <3s | ✅ | console.time() in main.ts |
| Directory navigation | <50ms | ✅ | React Profiler |
| File search (autocomplete) | <50ms | ✅ | console.time() in search handler |
| Directory scan (1,000 files) | <200ms | ✅ | Benchmark test |
| Large file preview (10MB log) | <500ms | - | Manual testing |
| LLM response start | <2s | - | Time to first token |
| Memory usage (idle) | <300MB | ✅ | Task Manager |
| Memory usage (10k files open) | <500MB | ✅ | Task Manager |
| Test coverage | >90% | ✅ | Jest --coverage |



### 4.2 Security



#### SEC-1: Path Traversal Prevention

**Requirement**: No user input can access files outside allowed directories.



**Implementation**:

- Validate ALL paths with `path.normalize()` and check for `..`
- Whitelist allowed root directories
- Reject paths to system-critical locations (`/etc/passwd`, `/System`, etc.)



**Test**: Attempt to access `../../etc/passwd` → Should be blocked



---



#### SEC-2: Sandboxing

**Requirement**: Renderer process cannot directly access file system.



**Implementation**:

- Renderer communicates ONLY via IPC
- Main process validates all requests
- Context isolation enabled in Electron



**Test**: Try to `import fs` in Renderer → Should fail



---



#### SEC-3: No Remote Code Execution

**Requirement**: App cannot be used to execute arbitrary code.



**Implementation**:

- No `eval()` or `Function()` calls
- Sanitize all user input
- No shell command execution without validation



---



### 4.3 Usability



#### US-1: Keyboard Shortcuts

**Requirement**: All common operations accessible via keyboard.



| Action | Shortcut | Platform |
|--------|----------|----------|
| New file | Ctrl+N | Windows/Linux |
| New file | Cmd+N | macOS |
| Delete | Delete | All |
| Rename | F2 | All |
| Search | Ctrl+F / Cmd+F | All |
| Open LLM chat | Ctrl+Shift+L | All |
| Navigate up | Backspace | All |
| Go back | Alt+Left | All |
| Go forward | Alt+Right | All |



---



#### US-2: Accessibility

**Requirement**: App usable by keyboard only (no mouse).



**Implementation**:

- Focus indicators visible
- Tab navigation through all interactive elements
- Screen reader support (ARIA labels)
- High contrast mode support



---



### 4.4 Maintainability



#### MAINT-1: Code Documentation

**Requirement**: All public APIs have JSDoc comments.



**Example**:

```typescript
/**
 * Search for files matching the given prefix.
 * 
 * @param prefix - The search query (e.g., "doc" for "documents")
 * @param maxResults - Maximum number of results to return (default: 10)
 * @returns Array of matching file paths sorted by relevance
 * @throws {ValidationError} If prefix contains invalid characters
 * 
 * @example
 * const results = await pathTrie.autocomplete("src/comp", 5);
 * // Returns: ["src/components", "src/compiler", ...]
 */
```



---



#### MAINT-2: Test Coverage

**Requirement**: >90% code coverage with meaningful tests.



**Test Types**:

- Unit tests: Individual functions and classes
- Integration tests: IPC channels, file operations
- E2E tests: User workflows (navigate, search, delete)



---



### 4.5 Portability



#### PORT-1: Cross-Platform Support

**Requirement**: Works on Windows, macOS, Linux.



**Implementation**:

- Use Node.js `path` module for cross-platform paths
- Handle platform-specific file permissions
- Test on all three platforms before release



---



#### PORT-2: No Hard-Coded Paths

**Requirement**: No assumptions about file system structure.



**Bad**: `const homeDir = '/home/user'`  
**Good**: `const homeDir = os.homedir()`



---



## 5. TECHNICAL CONSTRAINTS



### 5.1 Technology Stack (IMMUTABLE)



| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Runtime | Electron | 28.x | Hardware-enforced process separation |
| Language | TypeScript | 5.x | Type safety, interfaces for contracts |
| Frontend | React | 18.x | Component model, hooks |
| Styling | Tailwind CSS | 3.x | Utility-first, rapid development |
| Backend | Node.js | 20.x LTS | Native fs module access |
| Vector DB | LanceDB | Latest | In-process, no external server |
| LLM Runtime | Ollama | Latest | Local model execution |
| Testing | Vitest | Latest | TypeScript support, fast |
| Build | Webpack | 5.x | Electron standard |
| Packaging | electron-builder | Latest | Cross-platform builds |



### 5.2 Development Constraints



- **No external npm packages** without explicit approval in DECISIONS.md
- **No cloud APIs** (OpenAI, Anthropic, etc.) → Must be 100% local
- **No localStorage/sessionStorage** in Renderer (not supported in this context)
- **Strict TypeScript** mode enabled (`strict: true` in tsconfig.json)



---



## 6. OUT OF SCOPE (Future Releases)



These features are **explicitly excluded** from MVP:



- ❌ Cloud storage integration (Google Drive, Dropbox)
- ❌ File sharing/collaboration features
- ❌ Encryption at rest
- ❌ Git integration
- ❌ FTP/SSH remote file management
- ❌ Compressed archive support (.zip, .tar.gz)
- ❌ Network drive mounting
- ❌ Batch file operations (select 100 files → delete)
- ❌ Custom file associations
- ❌ Plugins/extensions system



---



## 7. USER FLOWS



### Flow 1: Navigate and Delete File

```
1. User launches app
2. App displays home directory
3. User double-clicks "Documents" folder
4. Files in Documents displayed
5. User right-clicks "old_draft.txt"
6. Context menu appears with "Delete" option
7. User clicks "Delete"
8. Confirmation dialog appears: "Delete old_draft.txt?"
9. User clicks "Yes"
10. File moved to trash
11. File removed from display
12. Success toast: "old_draft.txt deleted"
```



### Flow 2: Search and Preview File

```
1. User clicks search bar (Ctrl+F)
2. User types "auth"
3. Autocomplete suggestions appear: "auth.ts", "authenticate.js", "auth-utils/"
4. User clicks "auth.ts"
5. File preview pane opens on right
6. Syntax-highlighted code displayed
7. User scrolls through preview
8. User closes preview pane (X button)
```



### Flow 3: Ask LLM About Code

```
1. User clicks LLM chat icon (Ctrl+Shift+L)
2. Chat panel opens on right side
3. User types: "What does the auth.ts file do?"
4. Message sent to LLM
5. Loading indicator appears
6. LLM response streams word-by-word:
   "The auth.ts file implements JWT-based authentication.
   It exports:
   - login() function that validates credentials
   - generateToken() for creating JWTs
   - verifyToken() for validating tokens
   
   Source: /src/auth.ts"
7. User asks follow-up: "Show me the login function"
8. LLM provides code snippet with explanation
```



---



## 8. ACCEPTANCE TESTING



### AT-1: Core Functionality Test

**Goal**: Verify all CRUD operations work reliably.



**Steps**:

1. Create new file "test.txt"
2. Write content to file
3. Read file content
4. Rename file to "renamed.txt"
5. Delete file



**Pass Criteria**: All operations complete without errors in <2 seconds total



---



### AT-2: Performance Test

**Goal**: Verify app handles large directories.



**Steps**:

1. Navigate to directory with 10,000 files
2. Measure time to display files
3. Scroll through list
4. Search for file by name
5. Measure search response time



**Pass Criteria**:

- Display time <200ms
- Scrolling smooth (60 FPS)
- Search results <50ms



---



### AT-3: DSA Demonstration Test

**Goal**: Verify advanced data structures are implemented and visible.



**Steps**:

1. Code reviewer inspects `src/main/dsa/` directory
2. Verify PathTrie.ts implements Trie with insert/search/autocomplete
3. Verify LRUCache.ts implements DoublyLinkedList + HashMap
4. Verify EventQueue.ts implements Min-Heap
5. Verify HistoryStack.ts implements Doubly Linked List
6. Verify RingBuffer.ts implements circular buffer
7. Unit tests exist for each DSA with complexity analysis in comments



**Pass Criteria**: All 5 DSAs implemented correctly with >90% test coverage



---



### AT-4: LLM Integration Test

**Goal**: Verify local LLM can answer questions about indexed files.



**Steps**:

1. Launch app, wait for indexing to complete
2. Open LLM chat
3. Ask: "List all TypeScript files"
4. Verify response lists files from index
5. Ask: "What does auth.ts do?"
6. Verify response contains relevant information from file
7. Verify response cites source file



**Pass Criteria**: LLM provides accurate answers based on indexed content within 5 seconds



---



## 9. DEPENDENCIES



### 9.1 External Services

- **Ollama Server**: Must be running locally on port 11434
  - Installation: `curl -fsSL https://ollama.ai/install.sh | sh`
  - Model: `ollama pull llama3.2`



### 9.2 System Requirements

- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **RAM**: Minimum 8GB (16GB recommended for LLM)
- **Disk**: 10GB free space (5GB for Ollama models)
- **CPU**: Multi-core processor (LLM inference)



---



## 10. RELEASE CRITERIA



**MVP Release Checklist**:

- [ ] All FR-1.x requirements met (Core file operations)
- [ ] All FR-2.x requirements met (Advanced features)
- [ ] All FR-3.x requirements met (AI features)
- [ ] All non-functional requirements met (Performance, Security, Usability)
- [ ] All 5 DSAs implemented and tested
- [ ] Test coverage >90%
- [ ] Zero critical security vulnerabilities
- [ ] User documentation complete (README.md)
- [ ] Installation tested on all three platforms
- [ ] All acceptance tests passing



---



**Document Approval**:

- [x] Product Manager: Praneshrajan137 Date: December 4, 2025
- [ ] Tech Lead: _______________ Date: ______
- [ ] QA Lead: _______________ Date: ______



---

