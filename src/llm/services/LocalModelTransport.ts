/**
 * LocalModelTransport - Unified loopback transport for local LLM runtimes.
 *
 * Supports:
 * - Ollama REST API (`/api/chat`, `/api/tags`, `/api/version`)
 * - OpenAI-compatible local runtimes (`/v1/chat/completions`, `/v1/models`)
 *   such as LM Studio, llama.cpp server, vLLM, LocalAI, and Ollama's `/v1` gateway.
 *
 * Enforces strict loopback URL verification to preserve PrivateVault's zero-cloud guarantee.
 */

export type LocalLLMProvider = 'ollama' | 'openai_compatible';

export interface ChatTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function: {
      name: string;
      arguments: Record<string, unknown> | string;
    };
  }>;
  tool_call_id?: string;
  usage?: ChatTokenUsage;
}

export interface LocalModelTransportOptions {
  provider?: LocalLLMProvider;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: unknown[];
}

let registeredDefaultFetch: typeof fetch | null = null;

/**
 * Registers the host-provided HTTP fetch implementation (e.g., Electron `net.fetch`
 * injected by `main/entry` at startup) without coupling `llm/` to `electron`.
 */
export function registerDefaultLocalFetchTransport(fetchFn: typeof fetch | null): void {
  registeredDefaultFetch = fetchFn;
}

export function assertLoopbackLocalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopback) {
      throw new Error(`Non-local LLM URL rejected for privacy: ${rawUrl}`);
    }
    return trimmed;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Non-local LLM URL')) {
      throw error;
    }
    throw new Error(`Invalid local LLM URL: ${rawUrl}`);
  }
}

export class LocalModelTransport {
  private provider: LocalLLMProvider;
  private baseUrl: string;
  private activeModel: string;
  private readonly customFetch?: typeof fetch;

  constructor(options: LocalModelTransportOptions = {}) {
    this.provider = options.provider ?? 'ollama';
    const defaultUrl =
      this.provider === 'openai_compatible'
        ? 'http://127.0.0.1:1234'
        : process.env.OLLAMA_URL || 'http://localhost:11434';
    this.baseUrl = assertLoopbackLocalUrl(options.baseUrl || defaultUrl);
    this.activeModel = (options.model || 'llama3.2').trim();
    this.customFetch = options.fetchImpl;
  }

  getProvider(): LocalLLMProvider {
    return this.provider;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getModel(): string {
    return this.activeModel;
  }

  setConfig(updates: {
    provider?: LocalLLMProvider;
    baseUrl?: string;
    model?: string;
  }): void {
    if (updates.provider) {
      this.provider = updates.provider;
    }
    if (updates.baseUrl && updates.baseUrl.trim().length > 0) {
      this.baseUrl = assertLoopbackLocalUrl(updates.baseUrl);
    }
    if (updates.model && updates.model.trim().length > 0) {
      this.activeModel = updates.model.trim();
    }
  }

  private doFetch(url: string, init?: RequestInit): Promise<Response> {
    const safeInit: RequestInit = {
      ...init,
      redirect: init?.redirect ?? 'error',
    };
    if (this.customFetch) {
      return this.customFetch(url, safeInit);
    }
    if (registeredDefaultFetch) {
      return registeredDefaultFetch(url, safeInit);
    }
    if (typeof globalThis.fetch === 'function') {
      return globalThis.fetch(url, safeInit);
    }
    throw new Error('No fetch implementation available');
  }

  private resolveOpenAiEndpoint(suffix: 'chat/completions' | 'models'): string {
    const clean = this.baseUrl.replace(/\/+$/, '');
    if (clean.endsWith('/v1')) {
      return `${clean}/${suffix}`;
    }
    return `${clean}/v1/${suffix}`;
  }

  async checkConnection(): Promise<boolean> {
    const endpoints =
      this.provider === 'openai_compatible'
        ? [this.resolveOpenAiEndpoint('models'), `${this.baseUrl}/health`, `${this.baseUrl}/`]
        : [`${this.baseUrl}/api/tags`, `${this.baseUrl}/api/version`, `${this.baseUrl}/`];

    for (const endpoint of endpoints) {
      try {
        const res = await this.doFetch(endpoint, {
          method: 'GET',
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          return true;
        }
      } catch {
        // Probe next endpoint
      }
    }
    return false;
  }

  async listModels(): Promise<string[]> {
    try {
      if (this.provider === 'openai_compatible') {
        const res = await this.doFetch(this.resolveOpenAiEndpoint('models'), {
          method: 'GET',
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        return (data.data ?? [])
          .map((item) => item.id?.trim() ?? '')
          .filter(Boolean);
      }

      const res = await this.doFetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      return (data.models ?? [])
        .map((m) => m.name?.trim() ?? '')
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async *streamChat(
    messages: LocalChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const model = options.model || this.activeModel;
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 1000;

    if (this.provider === 'openai_compatible') {
      const response = await this.doFetch(this.resolveOpenAiEndpoint('chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages: this.formatOpenAiMessages(messages),
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI-compatible runtime error (${response.status}): ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body from local runtime');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const parseSseLine = (rawLine: string): { content?: string; errorMsg?: string } | null => {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return null;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') return null;
        try {
          const parsed = JSON.parse(jsonStr) as {
            error?: { message?: string } | string;
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          if (parsed.error) {
            const errMsg =
              typeof parsed.error === 'string'
                ? parsed.error
                : parsed.error.message || 'OpenAI-compatible runtime error';
            return { errorMsg: errMsg };
          }
          const piece =
            parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
          return piece ? { content: piece } : null;
        } catch {
          return null;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const parsed = parseSseLine(rawLine);
            if (parsed?.errorMsg) {
              throw new Error(parsed.errorMsg);
            }
            if (parsed?.content) {
              yield parsed.content;
            }
          }
        }

        if (buffer.trim()) {
          for (const rawLine of buffer.split('\n')) {
            const parsed = parseSseLine(rawLine);
            if (parsed?.errorMsg) {
              throw new Error(parsed.errorMsg);
            }
            if (parsed?.content) {
              yield parsed.content;
            }
          }
        }
      } finally {
        reader.releaseLock?.();
      }
      return;
    }

    // Ollama NDJSON streaming
    const response = await this.doFetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model,
        messages,
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

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from Ollama');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as { error?: string; message?: { content?: string } };
            if (data.error) {
              throw new Error(typeof data.error === 'string' ? data.error : 'Ollama stream error');
            }
            if (data.message?.content) {
              yield data.message.content;
            }
          } catch (parseOrStreamErr: unknown) {
            if (
              parseOrStreamErr instanceof Error &&
              !(parseOrStreamErr instanceof SyntaxError)
            ) {
              throw parseOrStreamErr;
            }
          }
        }
      }

      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer) as { error?: string; message?: { content?: string } };
          if (data.error) {
            throw new Error(typeof data.error === 'string' ? data.error : 'Ollama stream error');
          }
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch (parseOrStreamErr: unknown) {
          if (
            parseOrStreamErr instanceof Error &&
            !(parseOrStreamErr instanceof SyntaxError)
          ) {
            throw parseOrStreamErr;
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  async completeChat(
    messages: LocalChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<LocalChatMessage> {
    const model = options.model || this.activeModel;
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens ?? 1024;

    if (this.provider === 'openai_compatible') {
      const res = await this.doFetch(this.resolveOpenAiEndpoint('chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages: this.formatOpenAiMessages(messages),
          temperature,
          max_tokens: maxTokens,
          stream: false,
          ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI-compatible agent request failed with status ${res.status}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: LocalChatMessage['tool_calls'];
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const msg = data.choices?.[0]?.message;
      const usage: ChatTokenUsage | undefined =
        data.usage &&
        (typeof data.usage.prompt_tokens === 'number' ||
          typeof data.usage.completion_tokens === 'number' ||
          typeof data.usage.total_tokens === 'number')
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens:
                data.usage.total_tokens ??
                (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
            }
          : undefined;
      return {
        role: 'assistant',
        content: msg?.content ?? '',
        tool_calls: msg?.tool_calls,
        ...(usage ? { usage } : {}),
      };
    }

    const res = await this.doFetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama agent request failed with status ${res.status}`);
    }

    const data = (await res.json()) as {
      message?: LocalChatMessage;
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const ollamaUsage: ChatTokenUsage | undefined =
      typeof data.prompt_eval_count === 'number' || typeof data.eval_count === 'number'
        ? {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count,
            totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
          }
        : undefined;
    if (data.message) {
      return {
        role: 'assistant',
        content: data.message.content ?? '',
        tool_calls: data.message.tool_calls,
        ...(ollamaUsage ? { usage: ollamaUsage } : {}),
      };
    }
    return {
      role: 'assistant',
      content: data.response ?? '',
      ...(ollamaUsage ? { usage: ollamaUsage } : {}),
    };
  }

  private formatOpenAiMessages(messages: LocalChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      if (msg.images && msg.images.length > 0) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            ...msg.images.map((img) => ({
              type: 'image_url',
              image_url: {
                url: img.startsWith('data:') ? img : `data:image/png;base64,${img}`,
              },
            })),
          ],
        };
      }
      return {
        role: msg.role,
        content: msg.content,
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
        ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
      };
    });
  }
}
