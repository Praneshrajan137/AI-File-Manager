/**
 * LLMInterface - Ollama Client for Local LLM Queries
 * 
 * Connects to Ollama server running on localhost:11434.
 * Supports streaming responses for real-time UI updates.
 * 
 * Privacy-first: All processing happens locally, no cloud APIs.
 */
import { net } from 'electron';
import {
    LLMQueryOptions,
    RetrievalResult,
} from '../../shared/contracts';

// Use Electron's net.fetch which works in the main process
const electronFetch = net.fetch;

/**
 * Streaming chunk from Ollama API
 */
interface OllamaStreamChunk {
    model: string;
    message?: {
        role: string;
        content: string;
    };
    done: boolean;
}

export class LLMInterface {
    private readonly ollamaUrl: string;
    private readonly defaultModel = 'llama3.2';

    constructor(ollamaUrl: string = 'http://localhost:11434') {
        this.ollamaUrl = ollamaUrl;
    }

    /**
     * Query LLM with context (RAG-enhanced).
     * 
     * @param userQuery - User's question
     * @param retrievalResult - Context from RAG pipeline
     * @param options - Query options
     * @returns Async generator yielding response chunks
     */
    async *query(
        userQuery: string,
        retrievalResult: RetrievalResult,
        options?: LLMQueryOptions
    ): AsyncGenerator<string, void, unknown> {
        const model = options?.model || this.defaultModel;
        const temperature = options?.temperature ?? 0.7;
        const maxTokens = options?.maxTokens ?? 1000;

        // Build prompts
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(userQuery, retrievalResult);

        try {
            const response = await electronFetch(`${this.ollamaUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    stream: true,
                    options: {
                        temperature,
                        num_predict: maxTokens,
                    },
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama error (${response.status}): ${errorText}`);
            }

            // Stream response
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body from Ollama');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const data = JSON.parse(line) as OllamaStreamChunk;
                            if (data.message?.content) {
                                yield data.message.content;
                            }
                        } catch {
                            // Skip invalid JSON lines
                        }
                    }
                }
            }

            // Process remaining buffer
            if (buffer.trim()) {
                try {
                    const data = JSON.parse(buffer) as OllamaStreamChunk;
                    if (data.message?.content) {
                        yield data.message.content;
                    }
                } catch {
                    // Skip invalid JSON
                }
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`LLM query failed: ${msg}`);
        }
    }

    /**
     * Query LLM and return full response (non-streaming).
     * 
     * @param userQuery - User's question
     * @param retrievalResult - Context from RAG pipeline
     * @param options - Query options
     * @returns Complete response text
     */
    async queryFull(
        userQuery: string,
        retrievalResult: RetrievalResult,
        options?: LLMQueryOptions
    ): Promise<string> {
        const chunks: string[] = [];

        for await (const chunk of this.query(userQuery, retrievalResult, options)) {
            chunks.push(chunk);
        }

        return chunks.join('');
    }

    /**
     * Build system prompt for file assistant.
     */
    private buildSystemPrompt(): string {
        return `You are an intelligent file system assistant with access to the user's indexed files. Your role is to help users understand, navigate, and work with their file contents.

CAPABILITIES:
- Summarize and explain file contents (PDFs, documents, code, text files)
- Answer questions based on indexed file content
- Compare information across multiple files
- Extract key information, dates, names, and data points
- Help users find specific information within their files

CONTEXT INTERPRETATION:
- When context includes actual document text, provide detailed answers based on that content
- When context only shows file metadata (name, path, type), acknowledge you can see the file exists but the content wasn't extracted (may be scanned PDF or unsupported format)
- If a PDF shows only metadata, suggest the user check if it's a scanned/image-based PDF

RESPONSE RULES:
1. Answer ONLY based on the provided context - never make up file contents
2. Cite specific file names when referencing information
3. If context is insufficient, clearly state what information is missing
4. Be concise but thorough
5. Format responses for readability (use bullet points, headers when appropriate)

Your responses should help users efficiently access and understand information in their files.`;
    }

    /**
     * Build user prompt with RAG context.
     */
    private buildUserPrompt(
        query: string,
        retrievalResult: RetrievalResult
    ): string {
        if (!retrievalResult.context) {
            return `Question: ${query}

Note: No relevant files were found in the index. Please index some files first using the indexing feature.`;
        }

        return `Based on the following context from your files:

---
${retrievalResult.context}
---

Question: ${query}

Please provide a clear answer based on the context above. If the context doesn't contain relevant information, say so explicitly.`;
    }

    /**
     * Check if Ollama server is running.
     */
    async checkConnection(): Promise<boolean> {
        try {
            console.log('[LLMInterface] Checking Ollama connection at:', this.ollamaUrl);

            // Try multiple endpoints
            const endpoints = ['/api/tags', '/api/version', '/'];

            for (const endpoint of endpoints) {
                try {
                    const url = `${this.ollamaUrl}${endpoint}`;
                    console.log('[LLMInterface] Trying endpoint:', url);

                    const response = await electronFetch(url, {
                        method: 'GET',
                        signal: AbortSignal.timeout(5000),
                    });

                    console.log('[LLMInterface] Response status:', response.status, 'for', endpoint);

                    if (response.ok) {
                        console.log('[LLMInterface] Ollama is available!');
                        return true;
                    }
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.log('[LLMInterface] Endpoint failed:', endpoint, '-', msg);
                }
            }

            console.log('[LLMInterface] All endpoints failed, Ollama not available');
            return false;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log('[LLMInterface] checkConnection error:', msg);
            return false;
        }
    }

    /**
     * Get list of available models.
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            const response = await electronFetch(`${this.ollamaUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as { models?: Array<{ name: string }> };
            return data.models?.map((m) => m.name) || [];
        } catch {
            return [];
        }
    }

    /**
     * Check if a specific model is available.
     */
    async hasModel(modelName: string): Promise<boolean> {
        const models = await this.getAvailableModels();
        return models.some((m) => m.includes(modelName));
    }
}
