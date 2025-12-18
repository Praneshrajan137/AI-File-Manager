# Project-2: OS File Manager with Custom LLM

Industrial-grade file manager demonstrating Linux fundamentals, advanced DSA, and local LLM integration.

## Prerequisites

- Node.js 20.x LTS
- Ollama (for local LLM)

## Installation

```bash
# Install dependencies
npm install

# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull LLM model
ollama pull llama3.2
```

## Development

```bash
# Start dev server (hot reload)
npm run dev
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

## Building

```bash
# Build for production
npm run build

# Package for distribution
npm run package
```
