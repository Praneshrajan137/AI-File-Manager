# PROJECT-2: OS File Manager with Custom LLM



## 🎯 NORTH STAR - PROJECT VISION



This is an **industrial-grade Operating System File Manager** that demonstrates:

1. **Linux Fundamentals**: Direct OS kernel interaction via Node.js fs module

2. **Advanced DSA Mastery**: Custom implementation of Trie, LRU Cache, Priority Queue, Doubly Linked List, Ring Buffer

3. **AI Intelligence**: Local LLM integration for "Chat with your File System" using RAG pipeline



**Philosophy**: This is NOT a simple CRUD wrapper around fs.readdir. This is a **DSA Masterpiece** showcasing deep OS understanding.



## 🏗️ HIGH-LEVEL ARCHITECTURE



### Monolithic Three-Layer Design (Electron Framework)

```
┌─────────────────────────────────────────────────┐
│         Renderer Process (React/UI)             │
│  - Pure visualization, NO disk access           │
│  - Sends IPC requests to Main Process           │
│  - Uses virtualization for large directories    │
└────────────────┬────────────────────────────────┘
                 │ IPC Bridge (secure serialization)
                 │
┌────────────────▼────────────────────────────────┐
│         Main Process (Node.js/Kernel)           │
│  - EXCLUSIVE fs module access                   │
│  - Validates all paths (security)               │
│  - Worker Threads for heavy operations          │
│  - Hosts DSA implementations                    │
└────────────────┬────────────────────────────────┘
                 │ File System Events (chokidar)
                 │
┌────────────────▼────────────────────────────────┐
│      Intelligence Layer (Local LLM)             │
│  - LanceDB vector storage                       │
│  - Ollama local model interface                 │
│  - Background indexing (async)                  │
│  - RAG pipeline for file content search         │
└─────────────────────────────────────────────────┘
```



## 📦 TECH STACK (Final Approved)



| Layer | Technology | Reasoning (from DECISIONS.md) |
|-------|-----------|-------------------------------|
| Runtime | Electron | Hardware-enforced Main/Renderer separation |
| Language | TypeScript (strict) | Type safety, interface contracts |
| Frontend | React 18 + Tailwind | Component reusability, rapid UI development |
| File System | Node.js fs/promises | Non-blocking I/O, streams support |
| Vector DB | LanceDB | In-process, no external server, local-first |
| LLM Interface | Ollama | Local model execution, privacy-focused |
| Testing | Vitest + React Testing Library | Fast, TypeScript-native, good DX |
| Build | Webpack + electron-builder | Standard Electron toolchain |



## 🎨 CRITICAL ARCHITECTURAL PRINCIPLES



### 1. Separation of Concerns (SoC)

- **Main Process**: OS interaction ONLY

- **Renderer Process**: Visualization ONLY

- **Intelligence Layer**: Background processing ONLY



**Violation Example**: Renderer directly accessing fs module ❌

**Correct Pattern**: Renderer → IPC request → Main → fs operation ✅



### 2. Dependency Inversion Principle (DIP)

All modules depend on abstractions (interfaces in `src/shared/contracts.ts`), NOT concrete implementations.



**Example**:

```typescript
// ✅ Correct: Service depends on interface
class FileIndexer {
  constructor(private fileSystem: IFileSystemService) {}
}

// ❌ Wrong: Service depends on concrete class
class FileIndexer {
  constructor(private fileSystem: NodeFileSystem) {}
}
```



### 3. Code Contracts First

**Before writing ANY implementation:**

1. Define TypeScript interface in `contracts.ts`

2. Write failing test using the interface

3. Implement minimal code to pass test

4. Refactor while maintaining green tests



## 📊 REQUIRED DSA DEMONSTRATIONS



### Why Each DSA? (OS-Level Justification)



| DSA | OS Concept | Real-World Analogy | Implementation Location |
|-----|-----------|-------------------|------------------------|
| **Trie** | Inode lookup | How OS kernels search file paths | `src/main/dsa/PathTrie.ts` |
| **LRU Cache** | Page replacement | How OS manages memory caching | `src/main/dsa/LRUCache.ts` |
| **Priority Queue** | Process scheduling | How OS prioritizes tasks | `src/main/dsa/EventQueue.ts` |
| **Doubly Linked List** | History stack | Browser back/forward buttons | `src/main/dsa/HistoryStack.ts` |
| **Ring Buffer** | Log streaming | `tail -f` command implementation | `src/main/dsa/RingBuffer.ts` |



## 🔒 SECURITY MODEL



### Path Validation (CRITICAL)

Every path from Renderer MUST be validated in Main Process:

```typescript
// MANDATORY security check
function validatePath(requestedPath: string, allowedRoot: string): ValidationResult {
  // Step 1: Normalize to collapse relative segments
  const normalized = path.normalize(requestedPath);
  
  // Step 2: Check for traversal attempts BEFORE resolving
  if (normalized.includes('..')) {
    return { valid: false, error: 'Path traversal detected' };
  }
  
  // Step 3: Resolve to absolute path for boundary check
  const resolved = path.resolve(normalized);
  
  // Step 4: Normalize allowedRoot to ensure it ends with separator
  const normalizedRoot = allowedRoot.endsWith(path.sep) 
    ? allowedRoot 
    : allowedRoot + path.sep;
  
  // Step 5: Ensure within allowed directories using resolved absolute path
  // Check with separator to prevent prefix attacks (e.g., /home/user vs /home/user2)
  // Allow accessing the allowedRoot directory itself (resolved === allowedRoot)
  if (!resolved.startsWith(normalizedRoot) && resolved !== allowedRoot) {
    return { valid: false, error: 'Unauthorized directory access' };
  }
  
  return { valid: true };
}
```



### Sandboxing

- Renderer runs in isolated context

- Main Process is the **security gate**

- No shell.openExternal without validation



## 📈 PERFORMANCE TARGETS (Non-Functional Requirements)



| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Navigation latency | <50ms | React Profiler |
| Directory scan (1000 files) | <200ms | console.time() |
| Memory usage (idle) | <300MB | Task Manager |
| Memory usage (10k files) | <500MB | Task Manager |
| Test coverage | >90% | Vitest --coverage |
| Build time | <60s | Webpack stats |



## 🧪 TESTING STRATEGY



### Test Pyramid

```
    /\
   /  \  E2E Tests (Few) - Critical user journeys
  /____\
 /      \ Integration Tests (Some) - IPC channels, file operations
/__________\ Unit Tests (Many) - Individual functions, DSA logic
```



### TDD Workflow (MANDATORY)

1. **Write test first** (it should FAIL)

2. **Implement minimal code** to pass

3. **Refactor** while keeping green

4. **Commit** with descriptive message



## 📚 CURRENT PHASE & CONTEXT



**Phase**: Phase 0 - Project Setup & Foundation

**Current Sprint Goal**: Initialize project structure, configure TypeScript, set up Electron

**Active Blocker**: None

**Last 3 Commits**: Initial project setup



## 🔄 WORKFLOW INTEGRATION



### Before Starting Any Work

1. Read relevant layer CLAUDE.md (`@src/main/CLAUDE.md` etc.)

2. Check `DECISIONS.md` for constraints

3. Review `PRD.md` for requirements

4. Verify contracts in `src/shared/contracts.ts`



### Git Workflow

```bash
# Start feature
git checkout -b feature/path-trie-implementation

# After each micro-task
git add src/main/dsa/PathTrie.ts tests/unit/PathTrie.test.ts
git commit -m "Add PathTrie insert method with O(L) complexity

- Implements recursive insert for file paths
- Maintains HashMap of children for fast lookup
- Required for autocomplete feature (PRD 3.2)
- Passes test_path_trie_insert
- AI-generated, manually reviewed"

# Tag milestones
git tag v0.1.0-trie-complete
```



## 🚨 COMMON ANTI-PATTERNS (AVOID)



1. **❌ Vibe Coding**: Writing code without clear requirements

2. **❌ Context Pollution**: Loading irrelevant files into AI context

3. **❌ God Classes**: Single class doing multiple responsibilities

4. **❌ Premature Optimization**: Optimizing before profiling

5. **❌ Test-After Development**: Writing tests after implementation

6. **❌ Magic Numbers**: Hardcoding values without constants

7. **❌ Over-Engineering**: Building features not in PRD



## 🎓 REFERENCE DOCUMENTS



- `docs/PRD.md` - Product Requirements (source of truth)

- `docs/ARCHITECTURE.md` - Detailed system design

- `docs/DECISIONS.md` - Technology choices and reasoning

- `docs/backlog.md` - Atomic micro-tasks for implementation

- `src/shared/contracts.ts` - TypeScript interface contracts



## 🆘 WHEN UNCERTAIN



**Do This**:

1. Stop code generation

2. Ask specific question: "Should the Trie support case-insensitive search?"

3. Reference PRD section: "PRD.md section 3.2 doesn't specify..."

4. Propose options with trade-offs



**Don't Do This**:

- Guess and implement

- Copy patterns from internet without understanding

- Introduce new technologies not approved in DECISIONS.md



---



**LAST UPDATED**: December 4, 2025

**MAINTAINED BY**: Project Director

**AI ASSISTANT**: Claude (Anthropic) via Cursor IDE

---

## 💻 HARDWARE & REMOTE-FIRST CI RULE (MANDATORY — 12 GB RAM / RTX 3050 LAPTOP)

- **Never run heavy CI, full `npm run test:coverage`, full Playwright Electron E2E (`npm run test:e2e` / `test:all`), `npm run package`, heavy `10k` scale suites, or multi-model ONNX/Ollama benchmarks locally.**
- **Locally:** Restrict verification to `npm run type-check`, targeted `npx eslint <files>`, and single/targeted fast unit test files (`npx jest <path> --runInBand --maxWorkers=1`).
- **Remotely:** Run all heavy CI, full coverage, production builds, and cross-platform Playwright Electron E2E exclusively in **GitHub Actions** (`.github/workflows/`), wait for run completion via `gh run watch` / `gh run view`, and fix forward based on cloud logs.
