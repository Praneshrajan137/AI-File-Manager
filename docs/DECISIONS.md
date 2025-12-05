# Technology Decisions Log

## Project-2: OS File Manager with Custom LLM



**Purpose**: This document records all significant technology choices and architectural decisions. Each entry explains WHAT was decided, WHY it was chosen, and what ALTERNATIVES were considered.



---



## Decision Log Format

```
Decision ID: [Unique identifier]
Date: [YYYY-MM-DD]
Status: [Approved | Deprecated | Superseded]
Category: [Technology | Architecture | Process]
Context: [What problem are we solving?]
Decision: [What did we choose?]
Rationale: [Why this choice?]
Alternatives: [What else did we consider?]
Consequences: [Trade-offs and implications]
```



---



## DECISION-001: Use Electron Framework



**Date**: 2024-01-15  
**Status**: Approved  
**Category**: Technology - Runtime



### Context

Need a cross-platform desktop framework that provides:
- Native file system access (Node.js fs module)
- Hardware-enforced process separation (security)
- Mature ecosystem for production apps



### Decision

Use **Electron 28.x** as the runtime framework.



### Rationale

1. **Process Separation**: Electron's Main/Renderer architecture provides hardware-enforced isolation, perfect for our security model
2. **Native Access**: Main process runs Node.js, giving full fs module access
3. **Proven at Scale**: Used by VS Code, Slack, Discord, Figma
4. **IPC Bridge**: Built-in contextBridge for secure communication
5. **Ecosystem**: Massive library support, electron-builder for packaging



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Tauri | Smaller bundle (Rust + WebView), better performance | Immature ecosystem, smaller community, less documentation | Too risky for industrial-grade requirement |
| NW.js | Simpler API, single process | No process separation (security concern), declining community | Fails security requirement |
| Native (Qt/Electron) | Best performance | Slower development, no web tech reuse | Project timeline too short |



### Consequences

- ✅ Benefit: Clear architectural boundaries between layers
- ✅ Benefit: Massive ecosystem and tooling
- ❌ Trade-off: Larger bundle size (~150MB vs Tauri's ~10MB)
- ❌ Trade-off: Higher memory usage baseline (~100MB)



---



## DECISION-002: TypeScript with Strict Mode



**Date**: 2024-01-15  
**Status**: Approved  
**Category**: Technology - Language



### Context

Need type safety to prevent runtime errors and enable "Code Contracts First" approach.



### Decision

Use **TypeScript 5.x** with `strict: true` in tsconfig.json.



### Rationale

1. **Type Safety**: Catch bugs at compile time, not runtime
2. **Interface Contracts**: Define IFileSystemService, ILLMService as strict contracts
3. **AI Guardrails**: TypeScript compiler validates AI-generated code against contracts
4. **Refactoring**: Safe refactoring with IDE support
5. **Documentation**: Types serve as inline documentation



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| JavaScript | Faster prototyping, no compilation | No type safety, runtime errors | Unacceptable for industrial-grade system |
| Flow | Similar to TypeScript | Smaller ecosystem, Meta-only support | Less adoption, weaker tooling |
| ReScript | Stronger type system | Steep learning curve, small community | Timeline constraint |



### Consequences

- ✅ Benefit: AI cannot hallucinate methods not in interfaces
- ✅ Benefit: IDE autocomplete and type checking
- ❌ Trade-off: Compilation step adds build time (~30s)
- ❌ Trade-off: Learning curve for developers unfamiliar with TS



---



## DECISION-003: React for UI Layer



**Date**: 2024-01-15  
**Status**: Approved  
**Category**: Technology - Frontend



### Context

Need component-based UI framework for Renderer process.



### Decision

Use **React 18** with functional components and hooks.



### Rationale

1. **Hooks**: useState, useReducer, useMemo for clean state management
2. **Ecosystem**: Largest component library (react-window for virtualization)
3. **Performance**: React 18's concurrent features for smooth UI
4. **Team Familiarity**: Most widely known framework
5. **Testing**: React Testing Library for component tests



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Vue 3 | Simpler API, smaller bundle | Smaller ecosystem for desktop apps | Less Electron integration examples |
| Svelte | Fastest runtime, smallest bundle | Smaller ecosystem, less mature | Risk for production timeline |
| Solid.js | Fine-grained reactivity, very fast | Very small ecosystem | Too cutting-edge, lacks libraries we need |



### Consequences

- ✅ Benefit: Massive library ecosystem (react-window, react-dnd)
- ✅ Benefit: Excellent TypeScript support
- ❌ Trade-off: Larger bundle than Svelte (~45KB vs ~5KB)
- ❌ Trade-off: Virtual DOM overhead (mitigated by React 18)



---



## DECISION-004: Tailwind CSS for Styling



**Date**: 2024-01-15  
**Status**: Approved  
**Category**: Technology - Styling



### Context

Need rapid UI development without CSS bloat.



### Decision

Use **Tailwind CSS 3.x** with utility-first approach.



### Rationale

1. **Speed**: No context switching between HTML/CSS files
2. **Consistency**: Design system built-in (spacing, colors)
3. **Tree-shaking**: Unused classes purged from production bundle
4. **Responsive**: Mobile-first breakpoints out of box
5. **No Naming**: No need for BEM, SMACSS, etc.



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| CSS Modules | Scoped styles, familiar CSS | Manual class naming, more files | Slower development |
| Styled Components | Co-located styles, dynamic | Runtime cost, larger bundle | Performance concern |
| Vanilla CSS | Simple, no dependencies | Hard to maintain, no design system | Inconsistent UI likely |



### Consequences

- ✅ Benefit: Rapid UI iteration
- ✅ Benefit: Consistent design language
- ❌ Trade-off: HTML becomes verbose with many classes
- ❌ Trade-off: Learning curve for developers used to semantic CSS



---



## DECISION-005: LanceDB for Vector Storage



**Date**: 2024-01-16  
**Status**: Approved  
**Category**: Technology - Database



### Context

Need vector database for LLM's semantic search over file content. Must be local (privacy requirement).



### Decision

Use **LanceDB** (latest stable version) as vector database.



### Rationale

1. **In-Process**: No external server, runs in Node.js process
2. **Local First**: All data stored locally in Lance file format
3. **Performance**: Optimized for disk-based vectors (SSD-friendly)
4. **Easy Setup**: No Docker, no configuration
5. **TypeScript Support**: Official Node.js client



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Chroma | More features, better docs | Requires Python server | Added complexity, cross-process communication |
| Qdrant | Production-ready, clustering | Requires external server | Violates "in-process" requirement |
| Milvus | Enterprise features | Heavy infrastructure | Massive overkill for desktop app |
| In-memory (Map) | Simplest | No persistence, no similarity search | Need semantic search capability |



### Consequences

- ✅ Benefit: Zero external dependencies
- ✅ Benefit: Privacy-preserving (all local)
- ❌ Trade-off: Fewer features than Qdrant (no filtering, etc.)
- ❌ Trade-off: Less battle-tested than Pinecone



---



## DECISION-006: Ollama for LLM Runtime



**Date**: 2024-01-16  
**Status**: Approved  
**Category**: Technology - AI



### Context

Need local LLM runtime that's easy to install and use. Privacy requirement: no cloud APIs.



### Decision

Use **Ollama** with **llama3.2** (3B parameter) model.



### Rationale

1. **Simple Installation**: One-line install script
2. **Model Management**: `ollama pull llama3.2` downloads model
3. **REST API**: Clean HTTP API (no gRPC complexity)
4. **Performance**: Optimized for Apple Silicon and CUDA
5. **Models**: Access to Llama, Mistral, CodeLlama, etc.



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| llama.cpp | No dependencies, pure C++ | Manual model quantization, complex API | Too low-level, harder to use |
| LocalAI | OpenAI-compatible API | Requires Docker, heavier | Added complexity |
| Transformers.js | Runs in browser | Limited model support, slower | Not suitable for desktop |
| GPT-4 API | Best quality | Costs money, violates privacy | Privacy requirement |



### Consequences

- ✅ Benefit: User-friendly installation
- ✅ Benefit: Easy model switching (llama3.2, codellama, etc.)
- ❌ Trade-off: Requires separate installation (not bundled)
- ❌ Trade-off: User needs 8GB+ RAM for good performance



---



## DECISION-007: Jest for Testing



**Date**: 2024-01-16  
**Status**: Approved  
**Category**: Technology - Testing



### Context

Need test framework with Electron + TypeScript support. Must support unit, integration, and E2E tests.



### Decision

Use **Jest 29.x** with TypeScript support.



### Rationale

1. **Electron Support**: Best integration with electron-testing-library
2. **TypeScript**: Native TS support with ts-jest
3. **Mocking**: Excellent mocking capabilities for fs, IPC
4. **Coverage**: Built-in code coverage with Istanbul
5. **Snapshots**: Snapshot testing for UI components



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Vitest | Faster, Vite integration | Less mature Electron support | Risk for production |
| Mocha + Chai | Flexible, modular | More setup, less batteries-included | Slower development |
| Playwright | Excellent E2E | Not designed for unit tests | Would need separate unit test framework |



### Consequences

- ✅ Benefit: Comprehensive testing in single framework
- ✅ Benefit: Huge community, many examples
- ❌ Trade-off: Slower than Vitest (~2x)
- ❌ Trade-off: Configuration complexity for Electron



---



## DECISION-008: Monolithic Architecture (Not Microservices)



**Date**: 2024-01-17  
**Status**: Approved  
**Category**: Architecture



### Context

Project requirement: "Monolithic Architecture" demonstrating clear internal boundaries.



### Decision

Build as **single Electron application** with three well-separated layers (Main, Renderer, Intelligence), NOT microservices.



### Rationale

1. **OS Tool Nature**: File manager needs low-latency kernel access
2. **Shared Memory**: LRU cache, Trie benefit from in-process memory
3. **No Network Overhead**: IPC faster than HTTP calls
4. **Simpler Deployment**: Single executable, not orchestration
5. **Requirement**: PRD explicitly asks for monolithic architecture



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Microservices | Scalability, independent deployment | Network latency, complex orchestration | Desktop app doesn't need horizontal scaling |
| Plugin Architecture | Extensibility | Complex plugin API, IPC overhead | Out of MVP scope |



### Consequences

- ✅ Benefit: Simplicity, single deployment unit
- ✅ Benefit: Low latency (<50ms for operations)
- ❌ Trade-off: All code in one repo (requires discipline)
- ❌ Trade-off: Harder to scale horizontally (not relevant for desktop)



---



## DECISION-009: Worker Threads for Heavy Operations



**Date**: 2024-01-17  
**Status**: Approved  
**Category**: Architecture - Concurrency



### Context

Need to prevent blocking Node.js event loop during CPU-intensive tasks (large directory indexing, file chunking).



### Decision

Use **Node.js Worker Threads** for CPU-bound operations exceeding 50ms.



### Rationale

1. **Non-Blocking**: Keeps main thread responsive
2. **True Parallelism**: Runs on separate CPU cores
3. **Shared Memory**: Can use SharedArrayBuffer for efficiency
4. **Node.js Native**: No external dependencies



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Child Processes | Stronger isolation | Higher overhead, complex IPC | Overkill for CPU tasks |
| Async/Await Only | Simpler code | Doesn't help with CPU-bound tasks | Would block event loop |
| Web Workers | Familiar API | Not available in Main process | Wrong environment |



### Consequences

- ✅ Benefit: Smooth UI during heavy operations
- ✅ Benefit: Utilize multi-core CPUs
- ❌ Trade-off: More complex code (message passing)
- ❌ Trade-off: Debugging harder (separate threads)



---



## DECISION-010: No localStorage in Renderer



**Date**: 2024-01-17  
**Status**: Approved  
**Category**: Architecture - Storage



### Context

Electron Renderer with context isolation cannot use localStorage/sessionStorage reliably. Data must be persisted properly.



### Decision

**NEVER use localStorage/sessionStorage** in Renderer. Use React state + IPC to save to disk via Main process.



### Rationale

1. **Incompatibility**: localStorage not supported in context-isolated Renderer
2. **Security**: Main process should control all persistence
3. **Reliability**: IPC + fs guarantees data integrity



### Implementation

```typescript
// ❌ WRONG - localStorage not supported
localStorage.setItem('theme', 'dark');

// ✅ CORRECT - IPC to Main process
await ipcRenderer.invoke('SETTINGS:SAVE', { theme: 'dark' });
```



### Consequences

- ✅ Benefit: Consistent persistence model
- ✅ Benefit: Main process can validate and backup data
- ❌ Trade-off: More code (IPC handlers)



---



## DECISION-011: Chokidar for File Watching



**Date**: 2024-01-18  
**Status**: Approved  
**Category**: Technology - File System



### Context

Need reliable file system watcher that works cross-platform and handles rapid events (npm install).



### Decision

Use **chokidar** library for file watching.



### Rationale

1. **Cross-Platform**: Handles differences between fs.watch and fs.watchFile
2. **Robust**: Handles rapid-fire events (debouncing, polling fallback)
3. **Battle-Tested**: Used by Webpack, Vite, Parcel
4. **Events**: Unified API for add, change, unlink events



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Node.js fs.watch | Native, no dependency | Unreliable on some platforms, no debouncing | Inconsistent behavior |
| node-watch | Simpler API | Less robust, smaller community | Less battle-tested |



### Consequences

- ✅ Benefit: Reliable file watching across platforms
- ✅ Benefit: Automatic handling of edge cases
- ❌ Trade-off: Additional dependency (~100KB)



---



## DECISION-012: Priority Queue for Event Processing



**Date**: 2024-01-18  
**Status**: Approved  
**Category**: Architecture - DSA



### Context

File watcher can emit thousands of events during `npm install`. User actions (delete, rename) must be prioritized over background indexing.



### Decision

Implement **Min-Heap Priority Queue** to process events by priority.



### Rationale

1. **User Responsiveness**: High-priority events (user actions) processed first
2. **Efficient**: O(log n) enqueue/dequeue operations
3. **DSA Requirement**: Demonstrates advanced data structure understanding
4. **Prevents UI Freeze**: Background tasks don't block user actions



### Event Priority Levels

```typescript
enum EventPriority {
  USER_ACTION = 1,      // Highest - user delete, rename
  FILE_WATCHER = 5,     // Medium - external file changes
  BACKGROUND_INDEX = 10 // Lowest - LLM indexing
}
```



### Consequences

- ✅ Benefit: UI remains responsive during heavy operations
- ✅ Benefit: Demonstrates OS-level scheduling understanding
- ❌ Trade-off: More complex event handling logic



---



## DECISION-013: Trie for File Path Search



**Date**: 2024-01-19  
**Status**: Approved  
**Category**: Architecture - DSA



### Context

Need fast autocomplete for file search. Linear search over 50,000 files too slow.



### Decision

Implement **Prefix Trie (PathTrie)** for O(L) search complexity where L = path length.



### Rationale

1. **Performance**: O(L) vs O(N) for linear search
2. **Autocomplete**: Natural fit for prefix matching
3. **OS Analogy**: Mimics how OS kernels look up inodes
4. **DSA Requirement**: Core data structure demonstration



### Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| Binary Search | O(log n) search | Requires sorted array, doesn't support prefix | Not optimal for autocomplete |
| Hash Map | O(1) exact lookup | No prefix search | Doesn't solve autocomplete problem |
| Database Index | Persistent | Overkill, slower than in-memory | In-memory faster for desktop |



### Consequences

- ✅ Benefit: <50ms autocomplete for 50,000 files
- ✅ Benefit: Clear demonstration of DSA mastery
- ❌ Trade-off: Memory usage (~200 bytes per file path)



---



## DECISION-014: LRU Cache for Thumbnails



**Date**: 2024-01-19  
**Status**: Approved  
**Category**: Architecture - DSA



### Context

Generating thumbnails expensive. Need memory-bounded cache with automatic eviction.



### Decision

Implement **LRU Cache** using Doubly Linked List + HashMap for O(1) operations.



### Rationale

1. **OS Analogy**: Mimics page replacement algorithms (LRU page eviction)
2. **Bounded Memory**: Prevents memory leaks with max capacity
3. **Performance**: O(1) get/put operations
4. **DSA Requirement**: Demonstrates understanding of cache algorithms



### Cache Configuration

```typescript
const thumbnailCache = new LRUCache({
  capacity: 100,      // Max 100 thumbnails
  maxMemory: 100_000_000 // 100MB limit
});
```



### Consequences

- ✅ Benefit: Fast thumbnail access (no regeneration)
- ✅ Benefit: Bounded memory (no leaks)
- ❌ Trade-off: Cold start (cache empty initially)



---



## DECISION-015: Semantic Versioning for Releases



**Date**: 2024-01-20  
**Status**: Approved  
**Category**: Process



### Context

Need versioning strategy for releases and breaking changes.



### Decision

Use **Semantic Versioning (SemVer)**: MAJOR.MINOR.PATCH



### Rationale

1. **Clear Communication**: Breaking changes = major version bump
2. **Industry Standard**: Universally understood
3. **Automation**: Can automate changelog generation



### Versioning Rules

- **MAJOR**: Breaking changes (API changes, removed features)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes only



### Consequences

- ✅ Benefit: Clear expectations for users
- ✅ Benefit: Can use semantic-release for automation
- ❌ Trade-off: Must carefully manage breaking changes



---



## DECISION-016: Git Branching Strategy



**Date**: 2024-01-20  
**Status**: Approved  
**Category**: Process



### Context

Need branching strategy for feature development and releases.



### Decision

Use **Feature Branch Workflow** with protected main branch.



### Rules

1. **Main Branch**: Always production-ready, protected
2. **Feature Branches**: `feature/trie-implementation`, `feature/llm-chat`
3. **Hotfix Branches**: `hotfix/path-traversal-fix`
4. **Tiny Commits**: Atomic, one change per commit
5. **Tags**: `v0.1.0`, `v0.2.0` for releases



### Consequences

- ✅ Benefit: Safe main branch
- ✅ Benefit: Easy rollback (tags)
- ❌ Trade-off: More Git overhead than trunk-based



---



## DECISION-017: No Premature Optimization



**Date**: 2024-01-20  
**Status**: Approved  
**Category**: Process



### Context

Risk of over-engineering before measuring performance.



### Decision

Follow **"Make it work, make it right, make it fast"** philosophy. Optimize only after profiling.



### Rules

1. **First**: Make it work (pass tests)
2. **Second**: Make it clean (refactor, SOLID)
3. **Third**: Make it fast (profile first, then optimize)



### Exceptions (Optimize from start)

- Path validation (security critical)
- Large list rendering (use virtualization from start)



### Consequences

- ✅ Benefit: Faster development velocity
- ✅ Benefit: Avoid over-engineering
- ❌ Trade-off: Might need refactoring later



---



## DEPRECATED DECISIONS



### DEP-001: Initially Considered Rust for DSA

**Date**: 2024-01-12  
**Status**: Deprecated (superseded by DECISION-002)  
**Reason**: TypeScript sufficient, no need for FFI complexity



---



**DOCUMENT MAINTENANCE**:
- Add new decisions as they arise
- Never delete, only deprecate with reason
- Link to PRD/Architecture docs for context
- Review quarterly for obsolete decisions



---

