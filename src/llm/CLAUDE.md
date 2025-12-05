# INTELLIGENCE LAYER CONTEXT (Custom LLM Integration)

## 🎯 PURPOSE
This layer provides **"Chat with your File System"** functionality using a local LLM and vector database. It runs as a **background service** to avoid blocking the main UI thread.

## 🏗️ ARCHITECTURE

### Responsibilities
1. **File Indexing**: Chunk and embed file content
2. **Vector Storage**: Store embeddings in LanceDB
3. **Retrieval**: Semantic search over file content
4. **Query Processing**: Interface with local LLM (Ollama)
5. **Context Management**: RAG pipeline for relevant context retrieval

### Directory Structure
```
src/llm/
├── services/
│   ├── IndexingService.ts      # File content chunking & embedding
│   ├── VectorStore.ts          # LanceDB wrapper
│   ├── RetrievalService.ts     # RAG pipeline
│   ├── LLMInterface.ts         # Ollama client
│   └── ContextManager.ts       # Context window optimization
├── models/
│   ├── EmbeddingModel.ts       # Embedding generation
│   └── PromptTemplates.ts      # System prompts for LLM
└── CLAUDE.md                   # This file
```

## 🔐 PRIVACY-FIRST DESIGN

**CRITICAL**: All processing happens LOCALLY. No cloud APIs.

- ✅ LanceDB runs in-process (no external server)
- ✅ Ollama runs locally (models stored on disk)
- ✅ File content never leaves machine
- ✅ Embeddings stored locally
```typescript
// ✅ Correct - Local LLM
import Ollama from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });

// ❌ Wrong - Cloud API (violates privacy requirement)
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

## 📊 RAG PIPELINE ARCHITECTURE
```
┌────────────────────────────────────────────────┐
│  1. FILE WATCHER EVENT                         │
│     (New file created/modified)                │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  2. CHUNKING SERVICE                           │
│     - Split text into 500-token chunks         │
│     - 50-token overlap for context continuity  │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  3. EMBEDDING MODEL                            │
│     - Generate vectors (384 dimensions)        │
│     - Model: all-MiniLM-L6-v2 (local)          │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  4. VECTOR STORE (LanceDB)                     │
│     - Store: chunk_text, embedding, metadata   │
│     - Index: IVF-PQ for fast similarity search │
└────────────────────────────────────────────────┘

Query Time:
┌────────────────────────────────────────────────┐
│  5. USER QUERY                                 │
│     "What are the main functions in auth.ts?"  │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  6. RETRIEVAL SERVICE                          │
│     - Embed query                              │
│     - Similarity search (top 10 chunks)        │
│     - Re-rank by relevance                     │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  7. CONTEXT COMPRESSION                        │
│     - If tokens > 4000: summarize chunks       │
│     - Preserve most relevant information       │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  8. LLM PROMPT CONSTRUCTION                    │
│     System: "You are a code assistant..."      │
│     Context: [Retrieved chunks]                │
│     Query: [User question]                     │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│  9. OLLAMA LOCAL LLM                           │
│     Model: llama3.2 (3B parameters)            │
│     Streaming response to UI                   │
└────────────────────────────────────────────────┘
```

## 🧩 KEY COMPONENTS IMPLEMENTATION

### 1. Chunking Service
```typescript
// services/IndexingService.ts

interface ChunkResult {
  chunks: TextChunk[];
  metadata: FileMetadata;
}

interface TextChunk {
  text: string;
  startChar: number;
  endChar: number;
  chunkIndex: number;
}

export class IndexingService {
  private readonly CHUNK_SIZE = 500;  // tokens
  private readonly OVERLAP = 50;      // tokens
  
  /**
   * Chunk file content with overlap for context continuity.
   * Strategy: Sliding window with overlap to prevent losing context at boundaries.
   */
  async chunkFile(filePath: string): Promise<ChunkResult> {
    const content = await fs.readFile(filePath, 'utf-8');
    const tokens = this.tokenize(content);
    
    const chunks: TextChunk[] = [];
    let startIdx = 0;
    let chunkIndex = 0;
    
    while (startIdx < tokens.length) {
      const endIdx = Math.min(startIdx + this.CHUNK_SIZE, tokens.length);
      const chunkTokens = tokens.slice(startIdx, endIdx);
      
      chunks.push({
        text: this.detokenize(chunkTokens),
        startChar: this.getCharIndex(tokens, startIdx),
        endChar: this.getCharIndex(tokens, endIdx),
        chunkIndex: chunkIndex++,
      });
      
      // Move forward by CHUNK_SIZE - OVERLAP
      startIdx += this.CHUNK_SIZE - this.OVERLAP;
    }
    
    return {
      chunks,
      metadata: {
        filePath,
        totalChunks: chunks.length,
        indexedAt: Date.now(),
      },
    };
  }
  
  private tokenize(text: string): string[] {
    // Simple whitespace tokenization
    // In production, use proper tokenizer like tiktoken
    return text.split(/\s+/);
  }
}
```

### 2. Vector Store (LanceDB Wrapper)
```typescript
// services/VectorStore.ts
import lancedb from 'vectordb';

interface VectorRecord {
  id: string;
  chunk_text: string;
  embedding: number[];
  file_path: string;
  chunk_index: number;
  indexed_at: number;
}

export class VectorStore {
  private db: lancedb.Connection;
  private table: lancedb.Table;
  
  async initialize(dbPath: string): Promise<void> {
    this.db = await lancedb.connect(dbPath);
    
    // Create table if not exists
    try {
      this.table = await this.db.openTable('file_chunks');
    } catch {
      this.table = await this.db.createTable('file_chunks', [
        {
          id: 'example',
          chunk_text: '',
          embedding: new Array(384).fill(0),
          file_path: '',
          chunk_index: 0,
          indexed_at: Date.now(),
        },
      ]);
    }
  }
  
  /**
   * Add file chunks to vector store.
   */
  async addChunks(
    chunks: TextChunk[],
    embeddings: number[][],
    filePath: string
  ): Promise<void> {
    const records: VectorRecord[] = chunks.map((chunk, i) => ({
      id: `${filePath}:${chunk.chunkIndex}`,
      chunk_text: chunk.text,
      embedding: embeddings[i],
      file_path: filePath,
      chunk_index: chunk.chunkIndex,
      indexed_at: Date.now(),
    }));
    
    await this.table.add(records);
  }
  
  /**
   * Semantic search using vector similarity.
   * Returns top K most relevant chunks.
   */
  async search(
    queryEmbedding: number[],
    topK: number = 10
  ): Promise<VectorRecord[]> {
    return await this.table
      .search(queryEmbedding)
      .limit(topK)
      .execute();
  }
  
  /**
   * Delete all chunks for a file (e.g., when file is deleted).
   * Security: Manual escaping is used as LanceDB's filter() method requires string syntax.
   * Note: This is not true parameterized queries - it's defense-in-depth escaping.
   * Future: Migrate to object-based delete when LanceDB supports it.
   */
  async deleteFile(filePath: string): Promise<void> {
    // Escape single quotes to prevent injection (manual escaping pattern)
    // WARNING: This is NOT parameterized queries - it's string-based escaping
    const escapedPath = filePath.replace(/'/g, "''");
    
    await this.table
      .filter(`file_path = '${escapedPath}'`)
      .delete()
      .execute();
    
    // TODO: Replace with true parameterized pattern when LanceDB supports:
    // await this.table.delete({ file_path: filePath }).execute();
  }
}
```

### 3. Retrieval Service (RAG Core)
```typescript
// services/RetrievalService.ts

export class RetrievalService {
  private vectorStore: VectorStore;
  private embeddingModel: EmbeddingModel;
  private contextManager: ContextManager;
  
  /**
   * Retrieve relevant context for user query.
   * Implements: Retrieve → Rerank → Compress → Return
   */
  async retrieveContext(query: string): Promise<RetrievalResult> {
    // 1. Embed query
    const queryEmbedding = await this.embeddingModel.embed(query);
    
    // 2. Similarity search (retrieve top 10)
    const candidates = await this.vectorStore.search(queryEmbedding, 10);
    
    // 3. Re-rank by relevance (optional: use cross-encoder)
    const reranked = this.rerank(query, candidates);
    
    // 4. Check total token count
    const totalTokens = this.countTokens(reranked);
    
    // 5. Compress if needed (context window management)
    let finalContext: string;
    if (totalTokens > 4000) {
      finalContext = await this.contextManager.compress(reranked);
    } else {
      finalContext = reranked.map(r => r.chunk_text).join('\n\n');
    }
    
    return {
      context: finalContext,
      sources: reranked.map(r => r.file_path),
      tokenCount: this.countTokens(finalContext),
    };
  }
  
  /**
   * Simple re-ranking using BM25 (keyword relevance).
   * Production: Use cross-encoder model for semantic reranking.
   */
  private rerank(query: string, candidates: VectorRecord[]): VectorRecord[] {
    // Calculate BM25 scores
    const scores = candidates.map(candidate => ({
      candidate,
      score: this.bm25Score(query, candidate.chunk_text),
    }));
    
    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    return scores.map(s => s.candidate);
  }
  
  private bm25Score(query: string, document: string): number {
    // Simplified BM25 implementation
    // Production: Use proper BM25 library
    const queryTerms = query.toLowerCase().split(/\s+/);
    const docTerms = document.toLowerCase().split(/\s+/);
    
    let score = 0;
    for (const term of queryTerms) {
      const termFreq = docTerms.filter(t => t === term).length;
      score += termFreq > 0 ? Math.log(1 + termFreq) : 0;
    }
    
    return score;
  }
}
```

### 4. Context Manager (Compression)
```typescript
// services/ContextManager.ts

export class ContextManager {
  private llmInterface: LLMInterface;
  
  /**
   * Compress context when it exceeds token limit.
   * Strategy: Use smaller local model to summarize chunks.
   */
  async compress(chunks: VectorRecord[]): Promise<string> {
    const summaries: string[] = [];
    
    // Summarize each chunk individually
    for (const chunk of chunks) {
      const summary = await this.llmInterface.summarize(chunk.chunk_text, {
        maxTokens: 100,
        model: 'llama3.2:1b',  // Use smaller model for summarization
      });
      
      summaries.push(`[${chunk.file_path}]: ${summary}`);
    }
    
    return summaries.join('\n\n');
  }
  
  /**
   * Estimate token count (rough approximation).
   * Production: Use tiktoken library for accurate counting.
   */
  countTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}
```

### 5. LLM Interface (Ollama Client)
```typescript
// services/LLMInterface.ts
import Ollama from 'ollama';

export class LLMInterface {
  private ollama: Ollama;
  
  constructor() {
    this.ollama = new Ollama({
      host: 'http://localhost:11434',
    });
  }
  
  /**
   * Query LLM with retrieved context.
   * Implements streaming for better UX.
   */
  async *query(
    userQuery: string,
    context: string,
    systemPrompt?: string
  ): AsyncGenerator<string> {
    const prompt = this.constructPrompt(userQuery, context, systemPrompt);
    
    const stream = await this.ollama.chat({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: systemPrompt || this.defaultSystemPrompt() },
        { role: 'user', content: prompt },
      ],
      stream: true,
    });
    
    for await (const chunk of stream) {
      yield chunk.message.content;
    }
  }
  
  /**
   * Summarize text (for context compression).
   */
  async summarize(text: string, options: { maxTokens: number; model: string }): Promise<string> {
    const response = await this.ollama.chat({
      model: options.model,
      messages: [
        {
          role: 'system',
          content: 'Summarize the following text concisely, preserving key information.',
        },
        { role: 'user', content: text },
      ],
      options: {
        num_predict: options.maxTokens,
      },
    });
    
    return response.message.content;
  }
  
  private constructPrompt(query: string, context: string, systemPrompt?: string): string {
    return `Based on the following context from your file system:

${context}

Answer this question: ${query}

If the context doesn't contain enough information to answer, say so explicitly.`;
  }
  
  private defaultSystemPrompt(): string {
    return `You are a helpful assistant that answers questions about the user's files and code. 

Key behaviors:
1. Base your answers ONLY on the provided context
2. If context is insufficient, say "I don't have enough information in the indexed files"
3. Cite specific file names when relevant
4. Be concise but thorough
5. For code questions, explain logic and purpose`;
  }
}
```

## ⚡ BACKGROUND INDEXING STRATEGY

### Async Processing to Avoid Blocking UI
```typescript
// main.ts (Main Process)
import { FileWatcher } from './services/FileWatcher';
import { IndexingService } from '../llm/services/IndexingService';

const fileWatcher = new FileWatcher();
const indexingService = new IndexingService();

fileWatcher.on('fileChanged', async (filePath: string) => {
  // Don't block - queue for background processing
  queueIndexing(filePath);
});

const indexingQueue: string[] = [];
let isIndexing = false;

async function queueIndexing(filePath: string): Promise<void> {
  indexingQueue.push(filePath);
  
  if (!isIndexing) {
    processIndexingQueue();
  }
}

async function processIndexingQueue(): Promise<void> {
  isIndexing = true;
  
  while (indexingQueue.length > 0) {
    const filePath = indexingQueue.shift()!;
    
    try {
      await indexingService.indexFile(filePath);
    } catch (error) {
      console.error(`Failed to index ${filePath}:`, error);
    }
  }
  
  isIndexing = false;
}
```

## 🧪 TESTING LLM LAYER

### Mock Ollama for Tests
```typescript
// tests/unit/LLMInterface.test.ts
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      message: { content: 'Mocked response' },
    }),
  })),
}));

describe('LLMInterface', () => {
  it('should construct prompt with context', async () => {
    const llm = new LLMInterface();
    const context = 'File auth.ts contains login function';
    const query = 'How does authentication work?';
    
    // Spy on Ollama.chat to verify prompt construction
    const chatSpy = jest.spyOn(llm['ollama'], 'chat');
    
    await llm.query(query, context);
    
    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining(context),
          }),
        ]),
      })
    );
  });
});
```

## 🚨 ANTI-PATTERNS (LLM Layer Specific)

1. **❌ Blocking Main Thread**: Indexing large files synchronously
2. **❌ No Error Handling**: Not catching Ollama connection failures
3. **❌ Cloud Dependencies**: Using OpenAI API (violates privacy)
4. **❌ No Token Limits**: Sending 10,000+ token contexts to LLM
5. **❌ Ignoring File Types**: Trying to index binary files as text

## 📚 REFERENCES

- `docs/ARCHITECTURE.md` - Integration with Main/Renderer processes
- LanceDB Docs: https://lancedb.github.io/lancedb/
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md

---

**CONTEXT SCOPE**: Intelligence Layer development ONLY
**LAST UPDATED**: December 4, 2025
