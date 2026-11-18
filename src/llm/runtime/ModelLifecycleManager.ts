/**
 * ModelLifecycleManager.ts - Local LLM transport settings, Ollama/OpenAI-compatible
 * runtime health checks, model configuration updates, and ONNX cache downloads.
 */

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_RERANKER_MODEL,
  LLMModelsSnapshot,
} from '../../shared/contracts';
import { resolveDefaultModelCacheDir } from '../../shared/config';
import { LLMLogger } from '../../shared/logging';
import {
  detectSupportedTransformersDevices,
  inspectLocalModelCache,
  loadCrossEncoderReranker,
  loadFeatureExtractionPipeline,
} from '../models/transformersLoader';
import { LLMInterface } from '../services/LLMInterface';
import { assertLoopbackLocalUrl, LocalLLMProvider } from '../services/LocalModelTransport';
import { IDiagnosticsSink, ILlmConfigPort } from '../ports/IntelligencePorts';

export interface ActiveTransportSettings {
  provider: LocalLLMProvider;
  baseUrl: string;
  model: string;
}

export interface SetLlmModelConfigInput {
  provider?: LocalLLMProvider;
  ollamaUrl?: string;
  openAiBaseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  embeddingModel?: string;
  rerankerModel?: string;
  embeddingDevice?: 'auto' | 'cpu' | 'dml' | 'webgpu';
  allowRemoteModels?: boolean;
}

export class ModelLifecycleManager {
  constructor(
    private readonly configPort: ILlmConfigPort,
    private readonly diagnostics: IDiagnosticsSink,
    private readonly sanitizeError: (raw: string) => string
  ) {}

  resolveOllamaUrl(): string | undefined {
    if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.trim().length > 0) {
      return process.env.OLLAMA_URL.trim();
    }
    return this.configPort.readLlmConfig()?.ollamaUrl;
  }

  resolveActiveTransportSettings(): ActiveTransportSettings {
    const llmCfg = this.configPort.readLlmConfig();
    const provider: LocalLLMProvider = llmCfg?.provider ?? 'ollama';
    const baseUrl =
      provider === 'openai_compatible'
        ? llmCfg?.openAiBaseUrl?.trim() || 'http://127.0.0.1:1234'
        : this.resolveOllamaUrl() || 'http://localhost:11434';
    const model = llmCfg?.model?.trim() || 'llama3.2';
    return { provider, baseUrl, model };
  }

  createTransientClient(transport: ActiveTransportSettings): LLMInterface {
    return new LLMInterface(transport.baseUrl, {
      provider: transport.provider,
      model: transport.model,
    });
  }

  async checkOllamaStatus(
    existingClient?: LLMInterface | null
  ): Promise<{ available: boolean; models: string[] }> {
    try {
      const transportCfg = this.resolveActiveTransportSettings();
      const client = existingClient ?? this.createTransientClient(transportCfg);
      const available = await client.checkConnection();
      const models = available ? await client.getAvailableModels() : [];
      return { available, models };
    } catch {
      return { available: false, models: [] };
    }
  }

  async buildModelsSnapshot(options: {
    existingClient?: LLMInterface | null;
    activeExecutionProvider?: string;
    supportedEmbeddingDevices?: string[];
  }): Promise<LLMModelsSnapshot> {
    const llmCfg = this.configPort.readLlmConfig();
    const transportCfg = this.resolveActiveTransportSettings();
    const embModel = llmCfg?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    const rerankModel = llmCfg?.rerankerModel ?? DEFAULT_RERANKER_MODEL;

    let available = false;
    let models: string[] = [];
    try {
      const client = options.existingClient ?? this.createTransientClient(transportCfg);
      available = await client.checkConnection();
      models = available ? await client.getAvailableModels() : [];
    } catch {
      available = false;
      models = [];
    }

    const cacheInfo = inspectLocalModelCache([embModel, rerankModel]);
    const embCache = cacheInfo.models[0];
    const rerankCache = cacheInfo.models[1];
    const supportedEmbeddingDevices =
      options.supportedEmbeddingDevices ??
      (await detectSupportedTransformersDevices().catch(() => ['cpu']));

    return {
      available,
      models,
      activeModel: llmCfg?.model ?? options.existingClient?.getModel() ?? 'llama3.2',
      embeddingModel: embModel,
      rerankerModel: rerankModel,
      temperature: llmCfg?.temperature ?? 0.7,
      maxTokens: llmCfg?.maxTokens ?? 2048,
      provider: transportCfg.provider,
      ollamaUrl: this.resolveOllamaUrl() || 'http://localhost:11434',
      openAiBaseUrl: llmCfg?.openAiBaseUrl ?? 'http://127.0.0.1:1234',
      embeddingDevice: llmCfg?.embeddingDevice ?? 'auto',
      activeExecutionProvider: options.activeExecutionProvider ?? 'cpu',
      supportedEmbeddingDevices,
      allowRemoteModels: llmCfg?.allowRemoteModels ?? true,
      modelCacheDir: cacheInfo.cacheDir,
      embeddingCached: embCache?.cached ?? false,
      embeddingCacheBytes: embCache?.bytes ?? 0,
      rerankerCached: rerankCache?.cached ?? false,
      rerankerCacheBytes: rerankCache?.bytes ?? 0,
    };
  }

  async setLlmModelConfig(
    input: SetLlmModelConfigInput,
    hooks: {
      activeClient: LLMInterface | null;
      onEmbeddingPipelineDirty: () => Promise<void>;
      getSnapshot: () => Promise<LLMModelsSnapshot>;
    }
  ): Promise<{ success: boolean; config: LLMModelsSnapshot }> {
    const updates: Array<[string, unknown]> = [];
    if (input.provider !== undefined) updates.push(['llm.provider', input.provider]);
    if (input.ollamaUrl !== undefined) {
      updates.push(['llm.ollamaUrl', assertLoopbackLocalUrl(input.ollamaUrl)]);
    }
    if (input.openAiBaseUrl !== undefined) {
      updates.push(['llm.openAiBaseUrl', assertLoopbackLocalUrl(input.openAiBaseUrl)]);
    }
    if (input.model !== undefined) updates.push(['llm.model', input.model.trim()]);
    if (input.temperature !== undefined) updates.push(['llm.temperature', input.temperature]);
    if (input.maxTokens !== undefined) updates.push(['llm.maxTokens', input.maxTokens]);
    if (input.embeddingModel !== undefined) {
      updates.push(['llm.embeddingModel', input.embeddingModel.trim()]);
    }
    if (input.rerankerModel !== undefined) {
      updates.push(['llm.rerankerModel', input.rerankerModel.trim()]);
    }
    if (input.embeddingDevice !== undefined) {
      updates.push(['llm.embeddingDevice', input.embeddingDevice]);
    }
    if (input.allowRemoteModels !== undefined) {
      updates.push(['llm.allowRemoteModels', input.allowRemoteModels]);
    }

    if (updates.length > 0) {
      this.configPort.updateLlmConfig(updates);
    }

    if (hooks.activeClient) {
      const nextTransport = this.resolveActiveTransportSettings();
      hooks.activeClient.setTransportConfig({
        provider: nextTransport.provider,
        baseUrl: nextTransport.baseUrl,
        model: input.model?.trim() || nextTransport.model,
      });
    }

    const embeddingPipelineDirty =
      input.embeddingModel !== undefined ||
      input.rerankerModel !== undefined ||
      input.embeddingDevice !== undefined ||
      input.allowRemoteModels !== undefined;

    if (embeddingPipelineDirty) {
      await hooks.onEmbeddingPipelineDirty();
    }

    LLMLogger.info('Updated LLM configuration', {
      provider: input.provider,
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });

    return {
      success: true,
      config: await hooks.getSnapshot(),
    };
  }

  async downloadLlmModels(
    getSnapshot: () => Promise<LLMModelsSnapshot>
  ): Promise<{ success: boolean; snapshot: LLMModelsSnapshot; error?: string }> {
    const llmCfg = this.configPort.readLlmConfig();
    const embModel = llmCfg?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    const rerankModel = llmCfg?.rerankerModel ?? DEFAULT_RERANKER_MODEL;
    const device = llmCfg?.embeddingDevice ?? 'auto';
    const cacheDir = resolveDefaultModelCacheDir();

    try {
      if (llmCfg?.allowRemoteModels === false) {
        this.configPort.updateLlmConfig([['llm.allowRemoteModels', true]]);
      }

      let resolvedEp = 'cpu';
      await loadFeatureExtractionPipeline({
        modelName: embModel,
        dtype: 'q8',
        device,
        allowRemoteModels: true,
        cacheDir,
        onResolved: (info) => {
          resolvedEp = info.device;
        },
      });
      await loadCrossEncoderReranker({
        modelName: rerankModel,
        dtype: 'q8',
        device,
        allowRemoteModels: true,
        cacheDir,
      });

      const supportedDevices = await detectSupportedTransformersDevices().catch(() => ['cpu']);
      this.diagnostics.setVectorStoreStats({
        activeExecutionProvider: resolvedEp,
        supportedDevices,
      });

      return {
        success: true,
        snapshot: await getSnapshot(),
      };
    } catch (error: unknown) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const sanitized = this.sanitizeError(rawMsg);
      LLMLogger.warn('Failed downloading ONNX models into cacheDir', { cacheDir, error: rawMsg });
      return {
        success: false,
        snapshot: await getSnapshot(),
        error: sanitized,
      };
    }
  }
}
