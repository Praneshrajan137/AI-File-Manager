# 🗂️ PrivateVault AI — Local Spatial Knowledge & File OS

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-45.3-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-339933?logo=node.js)](https://nodejs.org/)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

> **Local-First Spatial Knowledge & Agentic File Operating System**
>
> **PrivateVault AI** combines **custom OS data structures**, **hybrid SQLite FTS5 + LanceDB vector RAG**, **spatial knowledge lenses**, **reversible Trash Vault recovery & atomic link-safe file organization**, **full-file inline editing**, **offline synthesis resilience**, and a **packaged standalone read-only MCP server**.

---

## ✨ Key Capabilities

### 🔒 Privacy-First Vault, Trash Vault Recovery & Crash-Safe Operations
- **100% Local Processing & Loopback Enforcement** — Zero cloud APIs or telemetry; AI endpoints (`Ollama` / `OpenAI-compatible`) strictly enforce loopback URLs (`localhost`, `127.0.0.1`, `[::1]`) plus strict zero-trust prompt fencing for untrusted workspace content
- **Sandboxed Renderer & Canonical Security Boundary** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `PathValidator` canonical/symlink/ADS containment, and `SecretGuard` blocking & redacting `.env`, keys, and token patterns across preview, `vault-asset://` streaming, indexing, search, and MCP
- **Crash-Safe `OperationJournal` & Individual Trash Vault Browser** — WAL-backed transactional undo/redo (`Ctrl+Z` / `Ctrl+Y`) plus the **Trash Vault Recovery modal** to inspect, individually restore (with collision safety), or permanently purge soft-deleted files and folders (30-day TTL / 512 MB cap)
- **Canonical Vault Storage** — State lives under `~/.privatevault/` (`config.json`, `vectordb/`, `trash-vault/`, `logs/`), with automatic non-destructive migration from legacy `~/.file-manager/` or `~/.project2-file-manager/` installations

### 🧭 Spatial Workspace Explorer, Quick Edit & External Drag-and-Drop
- **Four Spatial Workspace Lenses** —
  - `Files`: Virtualized Grid/List views, `F6` Split-Pane Dual Explorer, and **External OS Drag-and-Drop import** via Electron `webUtils.getPathForFile`
  - `Graph`: Interactive SVG knowledge topology, clickable neighbor jumps, and sortable topology inspector
  - `Collections`: Genuine **384-D spherical k-means vector clustering** (`Xenova/bge-small-en-v1.5` centroids via LanceDB) when indexed, with an explicit **`Structural Grouping` (`structural_heuristic`)** fallback badge when unindexed or cold
  - `Duplicates`: Exact SHA-256 duplicate detection and safe 1-click quarantine/reclaim
- **Universal Command Omnibar (`Ctrl+K` / `Cmd+K`)** — Cross-mode fuzzy filename, lexical content `#Lx-Ly`, symbol, and workspace quick actions
- **Line-Range Preview & Full-File Inline Quick Edit** — Stream media/PDFs via `vault-asset://`, jump straight to `#Lx-Ly` citations, or click **Edit** (`Ctrl+S` to save) to load and edit the full file safely (up to 512 KB in-app editor cap) with automatic cache & index refresh; opt into **Developer DSA Badges** (`RingBuffer(100)`, `LRUCache HIT`) in Settings

### 🧠 Hybrid Local Intelligence, Settings Control & Onboarding
- **Three-Layer Hybrid Retrieval** — SQLite WAL + FTS5 lexical BM25 (`node:sqlite`) + LanceDB `@huggingface/transformers` v4 (`Xenova/bge-small-en-v1.5`) dense vectors + 2-hop Personalized PageRank (PPR) graph boost + RRF & optional Cross-Encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) reranking
- **Workspace & AI Settings Modal + Offline ONNX Cache** — Configure Ollama / OpenAI-compatible loopback URLs, inspect or download local ONNX embedding & reranker weights into a writable `userData/models/` (`~/.privatevault/models/`) cache directory, toggle Strict Air-Gapped Mode, switch default Delete Policy (`Trash Vault` vs `OS Trash`), or revisit the **First-Run Guided Onboarding**
- **Deterministic Offline Synthesis** — Automatically degrades gracefully to grounded `OfflineSynthesisService` answers when no local LLM server is running
- **Multi-Turn ReAct Copilot & Link-Safe Organizer** — Dry-run organization previews (`auto`, `type`, `date`, `deduplicate`, `semantic_cluster`), atomic Markdown relative link repair, and single-click transactional batch undo

### 🔌 Packaged Standalone Read-Only MCP Server (`stdio`)
- Compiled separately as a self-contained Node bundle (`dist/main/mcpServer.js`, unpacked outside `app.asar` at `resources/app.asar.unpacked/dist/main/mcpServer.js` in desktop builds)
- Exposes 6 read-only JSON-RPC 2.0 (`2025-06-18`) tools (`list_directory`, `search_files`, `search_content`, `read_file_range`, `graph_lookup`, `organize_dry_run`) gated by `PathValidator` and `SecretGuard`
- Includes a copy-ready `mcp.json` configuration snippet inside Runtime Diagnostics

### ⚡ Core Data Structures
| DSA | Purpose | Complexity |
|-----|---------|------------|
| **PathTrie** | Prefix file path autocomplete | `O(L)` search |
| **LRU Cache** | Bounded file/preview caching with live hit-rate telemetry | `O(1)` access |
| **Priority Queue** | Coalescing background watcher & indexing event scheduler | `O(log n)` ops |
| **History Stack** | Back/Forward navigation | `O(1)` traversal |
| **Ring Buffer** | Bounded tailing & preview line buffer | `O(1)` append |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Renderer Process (React 18, Sandbox)               │
│  SpatialWorkspacePane • KnowledgeGraphCanvas • SmartCollectionsLens   │
│  FilePreviewDrawer (Quick Edit) • Settings / TrashVault / Onboarding  │
│  CommandOmnibar (Ctrl+K) • DryRunPlanModal • DiagnosticsModal         │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ Typed IPCEnvelope Bridge (preload.ts)
┌────────────────────────────────▼───────────────────────────────────────┐
│                  Main Process Kernel (Electron 45 / Node)             │
│  PathValidator • SecretGuard • OperationJournal (Trash Vault & WAL)   │
│  ReactiveWorkspaceKernel • AIOrganizerService (Atomic Link Repair)    │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────────────┐
│                Intelligence & Interoperability Layer                   │
│  SQLite WAL/FTS5 KnowledgeGraph • LanceDB + SemanticClustering        │
│  EmbeddingWorkerPool (`embeddingWorker.js` unpacked) • ONNX Cache     │
│  Dual LLM (Loopback Ollama/OpenAI) + OfflineSynthesisService          │
│  Standalone JSON-RPC 2.0 MCP Server (`mcpServer.js` unpacked)         │
└────────────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── main/                       # Electron Main Process Kernel
│   ├── dsa/                    # PathTrie, LRUCache, EventQueue, HistoryStack, RingBuffer
│   ├── handlers/               # Zod-validated IPC handlers & security middleware
│   ├── services/               # FileSystemService, PathValidator, OperationJournal,
│   │                           # WorkspaceKnowledgeGraph, AIOrganizerService, LlmWorkspaceService
│   ├── main.ts                 # Desktop entry + --smoke-packaged-boot verification hook
│   └── preload.ts              # Sandboxed IPC + webUtils.getPathForFile drag-drop bridge
│
├── renderer/                   # React 18 UI (Tailwind CSS)
│   ├── components/
│   │   ├── ChatPanel/          # Multi-turn Copilot, IndexingPanel, Citations
│   │   ├── FileExplorer/       # Virtualized Grid/List, Split-Pane, External Drop
│   │   ├── Preview/            # FilePreviewDrawer (Quick Preview, Full-File Edit, Connections)
│   │   ├── Settings/           # WorkspaceSettingsModal (AI providers, ONNX cache, Safety/UX)
│   │   ├── Vault/              # TrashVaultModal (individual item restore & purge)
│   │   ├── Onboarding/         # OnboardingModal (first-run setup & folder opt-in)
│   │   ├── Spatial/            # WorkspaceLensBar, KnowledgeGraphCanvas, SmartCollectionsLens, Duplicates
│   │   ├── Diagnostics/        # DiagnosticsModal & live kernel/MCP telemetry
│   │   ├── Organizer/          # DryRunPlanModal
│   │   └── Sidebar/, Toolbar/, SearchBar/
│   ├── hooks/                  # useWorkspaceController, useWorkspaceVault, usePreviewDrawer, useLLM
│   └── App.tsx
│
├── llm/                        # Local AI, Vectors & Clustering
│   ├── models/                 # transformersLoader (writable userData/models cache), EmbeddingModel
│   ├── services/               # IndexingService, VectorStore, SemanticClustering, RetrievalService,
│   │                           # WorkspaceReActAgent, GroundingVerifier, OfflineSynthesisService
│   └── workers/                # embeddingWorker.ts & EmbeddingWorkerPool.ts
│
├── mcp/
│   └── WorkspaceMcpServer.ts   # Standalone pure-Node JSON-RPC 2.0 MCP server entry
│
└── shared/                     # Contracts, ConfigManager, appPaths (~/.privatevault), Security, Errors
    ├── config/                 # appPaths.ts, ConfigManager.ts, schema.ts, defaults.ts
    ├── ipc/                    # Declarative Zod IPC contracts & envelopes
    └── security/               # SecretGuard.ts

tests/
├── unit/                       # Jest unit, handler, security, clustering, & jsdom+jest-axe UI tests
├── integration/                # Hybrid RAG & LanceDB pipeline tests
├── e2e/                        # Playwright real Electron UI, security, vault & workflow E2E specs
├── eval/                       # Retrieval / agent evaluation tests
└── perf/                       # Scale benchmarks
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 24 LTS (`24.x` — tested in CI across Linux & Windows; includes `node:sqlite`)
- **npm** 10+ / 11+
- **Optional Local LLM Server**: [Ollama](https://ollama.ai) (`ollama serve` + `ollama pull llama3.2`) or any loopback OpenAI-compatible runtime (`LM Studio`, `llama.cpp`). All explorer, editing, Trash Vault, FTS5 search, MCP, and `OfflineSynthesisService` features run cleanly without Ollama running.

### Installation & Running

```bash
# Clone the repository
git clone https://github.com/Praneshrajan137/AI-File-Manager.git
cd AI-File-Manager

# Install dependencies
npm install

# Start development mode (main + renderer hot reload)
npm run dev

# Build production main, worker, mcpServer, and renderer bundles
npm run build

# Package desktop app (ASAR + unpacked mcpServer.js & embeddingWorker.js)
npm run package
```

### Local ONNX Models (Optional Semantic Search & Clustering)

- Open **Settings (`Workspace & AI Settings`)** inside PrivateVault AI and click **Download Offline Models**, OR run indexing with remote model fetching enabled (`allowRemoteModels: true`) once.
- Weights (`Xenova/bge-small-en-v1.5` and `Xenova/ms-marco-MiniLM-L-6-v2`) cache in your writable app model cache (`<userData>/models/` or `~/.privatevault/models/`).
- Toggle **Strict Air-Gapped Mode** in Settings afterward to force local-cache-only inference with zero outbound model requests.

---

## 🧪 Verification & Quality Gates

- **Fast Local Sanity Checks**:
  ```bash
  npm run type-check
  npm run lint
  npx jest tests/unit/Stage3UXAndRecovery.test.ts --runInBand
  ```
- **CI & Cross-Platform Matrix (`.github/workflows/ci.yml`)**:
  - `quality-and-unit` (`ubuntu-latest`, Node 24): `type-check`, `lint` (`--max-warnings=0`), and full `jest --coverage --runInBand` enforcing `jest.config.js` thresholds (global 56% branches / 66% functions / 70% lines / 70% statements, plus higher per-file gates on `SecretGuard.ts`, `PathValidator.ts`, and `MarkdownLinkRepair.ts`).
  - `build-and-e2e` (`ubuntu-24.04` & `windows-latest`, Node 24): full `npm run build`, `npm run package` (dir target), unpacked desktop smoke boot + standalone `mcpServer.js` stdio JSON-RPC check (`scripts/verify-unpacked-build.mjs`), and real Electron Playwright E2E suite (`npx playwright test`).
- **Retrieval Benchmark**: `npm run eval:rag` (`scripts/eval-real-rag.mjs`) measures BM25 vs. Dense (`Xenova/bge-small-en-v1.5`) vs. Hybrid RRF + Cross-Encoder Recall@5, MRR@5, NDCG@5, and latency percentiles using the writable model cache.

See [TEST_REPORT.md](./TEST_REPORT.md) for current verification policy and CI suite coverage.

---

## 🔐 Security Model

1. **Process & Context Isolation** — Sandboxed renderer (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) + Electron Fuses (`RunAsNode` disabled, ASAR integrity).
2. **Canonical Path & Symlink Validation** — `PathValidator` confines all FS, preview, edit, external drag-drop, organize, and MCP operations strictly to configured Vault roots.
3. **SecretGuard Redaction & Exclusion** — Excludes `.env`, credentials, keys, and token patterns across preview, indexing, `vault-asset://`, chat context, and MCP outputs.
4. **Loopback-Only AI & Prompt-Injection Fencing** — Remote non-loopback AI URLs are blocked before persistence; untrusted file snippets are fenced inside agent prompts; standalone MCP is strictly read-only.

---

## 📝 License

**CC BY-NC 4.0** — Licensed under Creative Commons Attribution-NonCommercial 4.0 International. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/Praneshrajan137">Praneshrajan</a>
</p>
