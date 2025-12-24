# 🗂️ AI File Manager

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

> **Industrial-grade OS File Manager with Local AI Integration**
> 
> A privacy-first desktop file manager featuring **custom DSA implementations**, **local LLM chat** (via Ollama), and **semantic file search** powered by RAG.

---

## ✨ Features

### 🔒 Privacy-First Architecture
- **100% Local Processing** — No cloud APIs, no telemetry
- **Sandboxed Renderer** — Context isolation enabled, no direct fs access
- **Path Traversal Protection** — All paths validated before fs operations

### 🧠 AI-Powered File Intelligence
- **Chat with Your Files** — Ask questions about your codebase using local LLM
- **Semantic Search** — Find files by meaning, not just filename
- **RAG Pipeline** — Chunks, embeds, and retrieves file context automatically
- **PDF & Code Support** — Extracts content from PDFs, text files, and source code

### ⚡ Advanced Data Structures
Custom implementations demonstrating OS-level concepts:

| DSA | Purpose | Complexity |
|-----|---------|------------|
| **PathTrie** | File path autocomplete | O(L) search |
| **LRU Cache** | Thumbnail caching | O(1) access |
| **Priority Queue** | Event processing | O(log n) operations |
| **History Stack** | Back/Forward navigation | O(1) traversal |
| **Ring Buffer** | Log file preview | O(1) append |

### 🎨 Modern UI
- Dual view modes (Grid/List)
- Real-time file watching
- Keyboard shortcuts
- Context menus
- Drag-and-drop support

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Renderer Process (React 18)                │
│     UI Components • Hooks • No direct fs access         │
└───────────────────────┬─────────────────────────────────┘
                        │ IPC Bridge (preload.ts)
┌───────────────────────▼─────────────────────────────────┐
│                Main Process (Node.js)                   │
│  FileSystemService • PathValidator • FileWatcher        │
│  DSA Implementations • IPC Handlers                     │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│              Intelligence Layer (LLM)                   │
│  IndexingService • VectorStore (LanceDB) • Ollama       │
│  EmbeddingWorkerPool • RetrievalService                 │
└─────────────────────────────────────────────────────────┘
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

# Run all tests
npm run test:all
```

---

## 📊 Code Statistics

| Category | Files | Lines of Code |
|----------|-------|---------------|
| Source | 88 | 6,868 |
| Tests | 26 | 3,756 |
| **Total** | **114** | **10,624** |

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Electron 28 |
| **Language** | TypeScript 5.3 (strict) |
| **Frontend** | React 18 + Tailwind CSS |
| **Vector DB** | LanceDB (embedded) |
| **LLM** | Ollama (local) |
| **Embeddings** | @xenova/transformers |
| **Testing** | Jest + Playwright |
| **Build** | Webpack 5 |

---

## 🔐 Security Model

1. **Process Isolation** — Renderer has no Node.js access
2. **Context Isolation** — Preload script bridges IPC securely
3. **Path Validation** — All paths checked for traversal attacks
4. **No Remote Code Execution** — No eval(), no shell commands without validation

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
