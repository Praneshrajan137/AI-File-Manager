/**
 * LLMInterface - Ollama Client for Local LLM Queries
 * 
 * Connects to Ollama server running on localhost:11434.
 * Supports streaming responses for real-time UI updates.
 * 
 * Privacy-first: All processing happens locally, no cloud APIs.
 */
import {
    LLMQueryOptions,
    RetrievalResult,
} from '../../shared/contracts';

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
            const response = await fetch(`${this.ollamaUrl}/api/chat`, {
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
        return `You are a helpful file system assistant. Your purpose is to answer questions about the user's files based on the provided context.

CRITICAL RULES:
1. Answer ONLY based on the provided context
2. If context doesn't contain the answer, say "I don't have enough information in the indexed files"
3. Cite specific file names when relevant
4. Be concise but thorough
5. Do NOT make up information

Your responses should help users understand and navigate their file system.`;
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
            const response = await fetch(`${this.ollamaUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get list of available models.
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`);
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
