# Project-2: OS File Manager with Custom LLM

An industrial-grade File Manager application built with Electron, demonstrating mastery of Linux fundamentals and advanced data structures.

## Architecture

**Monolithic Electron Application**
- **Main Process**: Node.js/Electron Main - Exclusive file system access
- **Renderer Process**: React UI - User interface and interactions
- **Intelligence Layer**: LanceDB + Ollama - Local-first AI capabilities

## Tech Stack

- **Runtime**: Electron
- **Language**: TypeScript (strict mode)
- **Frontend**: React
- **Backend**: Node.js
- **Vector DB**: LanceDB
- **LLM**: Ollama (local)

## Advanced DSA Implementations

| Data Structure | Purpose | Complexity |
|---------------|---------|------------|
| **Trie (Prefix Tree)** | Fast file path search & autocomplete | O(L) |
| **LRU Cache** | File thumbnails, directory listings, metadata | O(1) |
| **Priority Queue (Min Heap)** | File system event handling | O(log n) |
| **Doubly Linked List** | Back/Forward navigation history | O(1) |
| **Ring Buffer** | Streaming log file preview | O(1) |

## Project Structure

```
project-2-file-manager/
├── docs/
│   ├── architecture/     # System architecture documentation
│   └── decisions/        # Architecture Decision Records (ADRs)
├── src/
│   ├── main/             # Electron main process
│   │   ├── services/     # File system services
│   │   ├── handlers/     # IPC handlers
│   │   └── dsa/          # Data structure implementations
│   ├── renderer/         # React frontend
│   │   ├── components/   # UI components
│   │   ├── hooks/        # Custom React hooks
│   │   └── utils/        # Frontend utilities
│   ├── llm/              # Intelligence layer
│   │   ├── services/     # LLM services
│   │   └── models/       # Model configurations
│   └── shared/           # Shared code
│       ├── types/        # TypeScript type definitions
│       ├── contracts/    # Interface contracts
│       └── utils/        # Shared utilities
├── tests/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── e2e/              # End-to-end tests
└── config/               # Configuration files
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- Git

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd project-2-file-manager

# Install dependencies
npm install

# Start development server
npm run dev
```

### Testing

```bash
# Run all tests
npm test

# Run unit tests
npm run test:unit

# Run with coverage
npm run test:coverage
```

## Core Principles

1. **Analysis First**: Never code immediately - understand requirements first
2. **TDD Mandatory**: Red-Green-Refactor cycle for all code
3. **SOLID Compliance**: Every line adheres to SOLID principles
4. **Zero Hallucination**: If ambiguous, ask - never guess
5. **Security First**: Validate all inputs, prevent path traversal

## Documentation

- [PRD.md](./PRD.md) - Product Requirements Document
- [ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) - System Architecture
- [DECISIONS.md](./docs/decisions/DECISIONS.md) - Architecture Decision Records

## License

ISC

