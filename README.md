# 🗂️ PrivateVault OS File Manager

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-45.3-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

> **Local-First Spatial Knowledge & Agentic File OS**
>
> A privacy-first desktop file manager and local knowledge operating system combining **custom OS data structures**, **hybrid SQLite FTS5 + LanceDB vector RAG**, **spatial knowledge lenses**, **atomic link-safe file organization**, **offline synthesis resilience**, and an **opt-in read-only MCP server**.

---

## ✨ Features

### 🔒 Privacy-First Vault & Crash-Safe Operations
- **100% Local Processing** — No mandatory cloud APIs or telemetry; zero-trust prompt fencing for untrusted file contents
- **Sandboxed Renderer & Strict Guards** — `contextIsolation: true`, `PathValidator` canonical/symlink enforcement, and `SecretGuard` blocking/redacting `.env`, keys, and tokens across preview, search, indexing, and MCP
- **Crash-Safe `OperationJournal`** — Transactional undo/redo for moves, renames, deletes, and multi-file AI organize batches (with OS Trash staging and clean restoration)

### 🧭 Spatial Workspace Explorer
- **Four Workspace Lenses** — `Files` (virtualized Grid/List + `F6` Split-Pane Dual Explorer), `Graph` (interactive SVG knowledge topology & backlinks), `Collections` (topic & symbol clusters), and `Duplicates` (exact SHA-256 reclaim)
- **Universal Command Omnibar (`Ctrl+K` / `Cmd+K`)** — Cross-mode fuzzy filename, lexical content `#Lx-Ly`, symbol, and quick-action search
- **Line-Range Quick Preview** — Clickable `#Lx-Ly` citations jump straight into highlighted lines alongside outgoing links, backlinks, and associative neighbors

### 🧠 Hybrid Local Intelligence & Offline Resilience
- **Three-Layer Hybrid Retrieval** — SQLite WAL + FTS5 lexical BM25 + LanceDB `@huggingface/transformers` (`Xenova/bge-small-en-v1.5`) dense vectors + 2-hop Personalized PageRank (PPR) graph boost + RRF & optional Cross-Encoder reranking
- **Dual-Provider Local LLM + Deterministic Fallback** — Works with `Ollama` or OpenAI-compatible local endpoints (`LM Studio`, `llama.cpp`), and automatically falls back to grounded `OfflineSynthesisService` answers when no LLM server is running
- **Multi-Turn ReAct Copilot & Link-Safe Organizer** — Dry-run previews (`auto`, `type`, `date`, `deduplicate`, `semantic_cluster`), atomic relative Markdown link repair on file moves, and transactional batch undo

### 🔌 Opt-In Read-Only MCP Server (`stdio`)
- Standalone pure-Node JSON-RPC 2.0 server (`dist/main/mcpServer.js`) exposing 6 read-only tools (`list_directory`, `search_files`, `search_content`, `read_file_range`, `graph_lookup`, `organize_dry_run`) gated by `PathValidator` and `SecretGuard`
- Copyable `mcp.json` configuration snippet directly inside Runtime Diagnostics (`Claude Desktop` / `Cursor`)

### ⚡ Core Data Structures
| DSA | Purpose | Complexity |
|-----|---------|------------|
| **PathTrie** | Prefix file path autocomplete | O(L) search |
| **LRU Cache** | Bounded file/preview caching with live hit-rate telemetry | O(1) access |
| **Priority Queue** | Scheduling background embedding & watcher tasks | O(log n) ops |
| **History Stack** | Back/Forward navigation | O(1) traversal |
| **Ring Buffer** | Bounded log & telemetry stream preview | O(1) append |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                   Renderer Process (React 18, Dark Slate)           │
│  SpatialWorkspacePane • KnowledgeGraphCanvas • SplitPaneExplorer    │
│  CommandOmnibar (Ctrl+K) • DryRunPlanModal • DiagnosticsModal       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ Typed IPC Bridge (preload.ts)
┌──────────────────────────────▼───────────────────────────────────────┐
│                 Main Process Kernel (Electron 45 / Node)            │
│  PathValidator • SecretGuard • OperationJournal • FileWatcher       │
│  AIOrganizerService (Atomic Markdown Link Repair + Batch Undo)      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│               Intelligence & Interoperability Layer                  │
│  SQLite WAL + FTS5 KnowledgeGraph • LanceDB • EmbeddingWorkerPool   │
│  Dual LLM (Ollama / OpenAI-Compat) + OfflineSynthesisService         │
│  Standalone JSON-RPC 2.0 MCP Server (dist/main/mcpServer.js)        │
└──────────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── main/                   # Electron Main Process
│   ├── dsa/                # Data Structure implementations
│   │   ├── PathTrie.ts     # Prefix tree for file search
│   │   ├── LRUCache.ts     # Least Recently Used cache
│   │   ├── EventQueue.ts   # Priority queue for events
│   │   ├── HistoryStack.ts # Doubly linked list
│   │   └── RingBuffer.ts   # Circular buffer
│   ├── handlers/           # IPC request handlers
│   ├── services/           # Core services
│   │   ├── FileSystemService.ts
│   │   ├── PathValidator.ts
│   │   ├── FileWatcher.ts
│   │   └── DirectoryScanner.ts
│   ├── main.ts             # Entry point
│   └── preload.ts          # Secure IPC bridge
│
├── renderer/               # React UI
│   ├── components/
│   │   ├── ChatPanel/      # AI chat interface
│   │   ├── FileExplorer/   # File grid/list views
│   │   ├── Sidebar/        # Directory tree, favorites
│   │   ├── Toolbar/        # Navigation, search, sort
│   │   └── common/         # Shared UI components
│   ├── hooks/              # React hooks
│   └── App.tsx             # Root component
│
├── llm/                    # AI/LLM Layer
│   ├── services/
│   │   ├── IndexingService.ts    # File chunking
│   │   ├── VectorStore.ts        # LanceDB wrapper
│   │   ├── LLMInterface.ts       # Ollama client
│   │   ├── RetrievalService.ts   # RAG retrieval
│   │   └── FileContentExtractor.ts
│   └── workers/            # Embedding workers
│
├── shared/                 # Shared code
│   ├── contracts.ts        # TypeScript interfaces
│   ├── errors/             # Error classes
│   ├── config/             # Configuration
│   └── logging/            # Winston logger
│
tests/
├── unit/                   # Unit tests
├── integration/            # Integration tests
└── e2e/                    # Playwright E2E tests
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20.x LTS
- **npm** 10.x
- **Ollama** (for AI features) — [Install Ollama](https://ollama.ai)

### Installation

```bash
# Clone the repository
git clone https://github.com/Praneshrajan137/AI-File-Manager.git
cd AI-File-Manager

# Install dependencies
npm install

# Start development server
npm run dev
```

### Running the App

```bash
# Development mode (hot reload)
npm run dev

# Production build
npm run build

# Package for distribution
npm run package
```

### AI Setup (Optional)

```bash
# Start Ollama server
ollama serve

# Pull a model (e.g., llama3.2)
ollama pull llama3.2
```

---

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e

# Typecheck, lint, and evaluate local RAG benchmark
npm run type-check
npm run lint
npm run eval:rag
```

---

## 🧪 Evaluation & Verification

- **Lightweight Local Checks:** `npm run type-check`, `npm run lint`, and targeted `npx jest <spec> --runInBand`
- **Retrieval Benchmark:** `npm run eval:rag` measures BM25 vs. Dense (`Xenova/bge-small-en-v1.5`) vs. Hybrid RRF + Cross-Encoder Recall@5, MRR@5, NDCG@5, and embed/rerank latency percentiles
- **Cloud CI & Cross-Platform Matrix (`.github/workflows/ci.yml`):** Full thresholded Jest coverage gate + Webpack production bundle + ASAR/unpacked verification + real Electron Playwright E2E across `ubuntu-24.04` and `windows-latest`

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Electron 45 |
| **Language** | TypeScript 5.3 (strict) |
| **Frontend** | React 18 + Tailwind CSS (`react-window` virtualization) |
| **Knowledge & Vector DB** | SQLite WAL + FTS5 (Node built-in `node:sqlite`) + LanceDB (embedded) |
| **LLM Runtimes** | Ollama + OpenAI-Compatible Local (`LM Studio` / `llama.cpp`) + Offline Synthesis |
| **Agent Orchestration** | State-Machine ReAct (`WorkspaceReActAgent`), Parallel Read Batching, `GroundingVerifier` & `TraceLedger` |
| **Embeddings & Rerank** | `@huggingface/transformers` v4 (`bge-small-en-v1.5`, Cross-Encoder, ONNX Runtime EP) |
| **Agent Interop** | Standalone JSON-RPC 2.0 MCP `2025-06-18` Server (`dist/main/mcpServer.js`) |
| **Testing** | Jest + Playwright Electron E2E |
| **Build** | Webpack 5 + Electron Builder |

---

## 🔐 Security Model

1. **Process & Context Isolation** — Sandboxed renderer with zero direct Node.js or `fs` access
2. **Canonical Path & Symlink Validation** — `PathValidator` confines all fs, preview, organize, and MCP operations to configured vault roots
3. **SecretGuard Redaction & Exclusion** — Excludes keys, `.env`, credentials, and token patterns across preview, indexing, chat context, and MCP outputs
4. **Prompt-Injection Fencing & Read-Only MCP** — Untrusted workspace snippets are structurally fenced inside agent prompts, and the stdio MCP server exposes read-only inspection & dry-run planning tools only

---

## 📝 License

**CC BY-NC 4.0** — This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License.

- ✅ Free for personal and educational use
- ✅ Modification and sharing allowed with attribution
- ❌ **Commercial use is NOT permitted**

See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Electron](https://www.electronjs.org/) — Cross-platform desktop apps
- [Ollama](https://ollama.ai/) — Local LLM runtime
- [LanceDB](https://lancedb.com/) — Embedded vector database
- [Lucide Icons](https://lucide.dev/) — Beautiful icons

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Praneshrajan137">Praneshrajan</a>
</p>
