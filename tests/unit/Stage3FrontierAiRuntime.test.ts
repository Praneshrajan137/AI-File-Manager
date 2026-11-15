import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  _resetTransformersCacheForTesting,
  getCachedExecutionProvider,
  loadCrossEncoderReranker,
  loadFeatureExtractionPipeline,
  resolveExecutionDeviceCandidates,
} from '../../src/llm/models/transformersLoader';
import {
  assertLoopbackLocalUrl,
  LocalModelTransport,
} from '../../src/llm/services/LocalModelTransport';
import { OfflineSynthesisService } from '../../src/llm/services/OfflineSynthesisService';
import { RetrievalService } from '../../src/llm/services/RetrievalService';
import { VectorStore } from '../../src/llm/services/VectorStore';
import { ContextManager } from '../../src/llm/services/ContextManager';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import { WorkspaceReActAgent } from '../../src/llm/agent/WorkspaceReActAgent';
import { IPC_SCHEMAS } from '../../src/shared/ipc/contracts';
import {
  IEmbeddingModel,
  OrganizePlanResult,
  VectorRecord,
} from '../../src/shared/contracts';

function makeVec(seed: number, dims = 384): number[] {
  const vec = new Array<number>(dims).fill(0);
  vec[seed % dims] = 1;
  return vec;
}

describe('Stage 3 Frontier Local AI Runtime & Spatial Associative Retrieval', () => {
  afterEach(() => {
    _resetTransformersCacheForTesting();
    jest.restoreAllMocks();
  });

  describe('Hardware EP auto-probing & cached fallback', () => {
    it('resolves ordered EP candidates and skips heavy probing during NODE_ENV=test unless forced', () => {
      expect(resolveExecutionDeviceCandidates('auto', 'win32', false)).toEqual(['cpu']);
      expect(resolveExecutionDeviceCandidates('auto', 'win32', true)).toEqual(['dml', 'webgpu', 'cpu']);
      expect(resolveExecutionDeviceCandidates('auto', 'darwin', true)).toEqual(['webgpu', 'cpu']);
      expect(resolveExecutionDeviceCandidates('dml', 'win32', false)).toEqual(['dml', 'cpu']);
      expect(resolveExecutionDeviceCandidates('cpu', 'win32', true)).toEqual(['cpu']);
    });

    it('falls back dml -> webgpu -> cached cpu and reports fallbackReason', async () => {
      const calls: Array<{ device?: string; dtype?: string }> = [];
      jest.doMock('@huggingface/transformers', () => ({
        env: {
          useBrowserCache: true,
          useFSCache: false,
          backends: { onnx: { supportedDevices: ['dml', 'cpu'] } },
        },
        pipeline: jest.fn(async (_task: string, _model: string, opts?: { device?: string; dtype?: string }) => {
          calls.push({ device: opts?.device, dtype: opts?.dtype });
          if (opts?.device === 'dml') {
            throw new Error('DirectML driver unavailable');
          }
          if (opts?.device === 'webgpu') {
            throw new Error('WebGPU adapter missing');
          }
          return async (): Promise<{ data: Float32Array }> => ({ data: new Float32Array(384) });
        }),
        AutoTokenizer: {
          from_pretrained: jest.fn(async () => async (): Promise<Record<string, unknown>> => ({})),
        },
        AutoModelForSequenceClassification: {
          from_pretrained: jest.fn(async () => async (): Promise<{ logits: { data: Float32Array } }> => ({
            logits: { data: new Float32Array([0.1, 0.9]) },
          })),
        },
      }));

      const prevForce = process.env.FORCE_EP_PROBE;
      process.env.FORCE_EP_PROBE = '1';
      try {
        // Isolate module cache so jest.doMock intercepts require('@huggingface/transformers')
        let resolvedWin: { device: string; dtype: string; fallbackReason?: string } | null = null;
        await jest.isolateModulesAsync(async () => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require('../../src/llm/models/transformersLoader') as typeof import('../../src/llm/models/transformersLoader');
          await mod.loadFeatureExtractionPipeline({
            modelName: 'Xenova/bge-small-en-v1.5',
            dtype: 'q8',
            device: 'auto',
            platform: 'win32',
            onResolved: (info) => {
              resolvedWin = info;
            },
          });
          expect(mod.getCachedExecutionProvider()).toBe('cpu');
        });

        expect(calls.map((c) => c.device)).toEqual(['dml', 'webgpu', 'cpu']);
        expect(resolvedWin).toEqual({
          device: 'cpu',
          dtype: 'q8',
          fallbackReason: 'WebGPU adapter missing',
        });

        calls.length = 0;
        let resolvedLinux: { device: string; dtype: string; fallbackReason?: string } | null = null;
        await jest.isolateModulesAsync(async () => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require('../../src/llm/models/transformersLoader') as typeof import('../../src/llm/models/transformersLoader');
          await mod.loadFeatureExtractionPipeline({
            modelName: 'Xenova/bge-small-en-v1.5',
            dtype: 'q8',
            device: 'auto',
            platform: 'linux',
            onResolved: (info) => {
              resolvedLinux = info;
            },
          });
          expect(mod.getCachedExecutionProvider()).toBe('cpu');
        });

        expect(calls.map((c) => c.device)).toEqual(['webgpu', 'cpu']);
        expect(resolvedLinux).toEqual({
          device: 'cpu',
          dtype: 'q8',
          fallbackReason: 'WebGPU adapter missing',
        });
      } finally {
        if (prevForce === undefined) delete process.env.FORCE_EP_PROBE;
        else process.env.FORCE_EP_PROBE = prevForce;
        jest.dontMock('@huggingface/transformers');
      }

      // Ensure outer import helpers still remain consistent
      expect(getCachedExecutionProvider()).toBe('cpu');
      expect(typeof loadFeatureExtractionPipeline).toBe('function');
      expect(typeof loadCrossEncoderReranker).toBe('function');
    });

    it('enforces local_files_only and env.allowRemoteModels=false when allowRemoteModels is disabled', async () => {
      const pipelineOpts: Array<Record<string, unknown> | undefined> = [];
      const tokenizerOpts: Array<Record<string, unknown> | undefined> = [];
      const rerankerModelOpts: Array<Record<string, unknown> | undefined> = [];
      const mockEnv = {
        useBrowserCache: true,
        useFSCache: false,
        allowRemoteModels: true,
        backends: { onnx: { supportedDevices: ['cpu'] } },
      };

      jest.doMock('@huggingface/transformers', () => ({
        env: mockEnv,
        pipeline: jest.fn(async (_task: string, _model: string, opts?: Record<string, unknown>) => {
          pipelineOpts.push(opts);
          return async (): Promise<{ data: Float32Array }> => ({ data: new Float32Array(384) });
        }),
        AutoTokenizer: {
          from_pretrained: jest.fn(async (_model: string, opts?: Record<string, unknown>) => {
            tokenizerOpts.push(opts);
            return async (): Promise<Record<string, unknown>> => ({});
          }),
        },
        AutoModelForSequenceClassification: {
          from_pretrained: jest.fn(async (_model: string, opts?: Record<string, unknown>) => {
            rerankerModelOpts.push(opts);
            return async (): Promise<{ logits: { data: Float32Array } }> => ({
              logits: { data: new Float32Array([0.1, 0.9]) },
            });
          }),
        },
      }));

      try {
        await jest.isolateModulesAsync(async () => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require('../../src/llm/models/transformersLoader') as typeof import('../../src/llm/models/transformersLoader');
          await mod.loadFeatureExtractionPipeline({
            modelName: 'Xenova/bge-small-en-v1.5',
            dtype: 'q8',
            device: 'cpu',
            allowRemoteModels: false,
          });
          await mod.loadCrossEncoderReranker({
            modelName: 'Xenova/ms-marco-MiniLM-L-6-v2',
            dtype: 'q8',
            device: 'cpu',
            allowRemoteModels: false,
          });
        });

        expect(mockEnv.allowRemoteModels).toBe(false);
        expect(pipelineOpts[0]).toMatchObject({ dtype: 'q8', device: 'cpu', local_files_only: true });
        expect(tokenizerOpts[0]).toEqual({ local_files_only: true });
        expect(rerankerModelOpts[0]).toMatchObject({ dtype: 'q8', device: 'cpu', local_files_only: true });
      } finally {
        jest.dontMock('@huggingface/transformers');
      }
    });
  });

  describe('LocalModelTransport (Ollama + OpenAI-Compatible /v1 SSE + SSRF Loopback Guard)', () => {
    it('rejects non-loopback external hosts cleanly for zero-cloud privacy', () => {
      expect(() => assertLoopbackLocalUrl('https://api.openai.com')).toThrow(/Non-local LLM URL rejected/);
      expect(() => assertLoopbackLocalUrl('http://169.254.169.254/latest')).toThrow(/Non-local LLM URL rejected/);
      expect(() => assertLoopbackLocalUrl('http://192.168.1.40:1234')).toThrow(/Non-local LLM URL rejected/);
      expect(assertLoopbackLocalUrl('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234');
      expect(assertLoopbackLocalUrl('http://localhost:11434')).toBe('http://localhost:11434');
    });

    it('streams OpenAI-compatible SSE chunks and lists /v1/models cleanly', async () => {
      const encoder = new TextEncoder();
      const ssePayload = [
        'data: {"choices":[{"delta":{"content":"Local "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"OpenAI SSE"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      const fetchMock = jest.fn(async (url: string | URL | Request) => {
        const target = String(url);
        if (target.endsWith('/v1/models')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: 'qwen2.5-coder-7b' }, { id: 'llama-3.2-3b' }],
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          body: {
            getReader: () => {
              let done = false;
              return {
                read: async (): Promise<{ done: boolean; value: Uint8Array | undefined }> => {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: encoder.encode(ssePayload) };
                },
                releaseLock: (): void => undefined,
              };
            },
          },
        } as unknown as Response;
      });

      const transport = new LocalModelTransport({
        provider: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1234',
        model: 'qwen2.5-coder-7b',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      expect(await transport.checkConnection()).toBe(true);
      expect(await transport.listModels()).toEqual(['qwen2.5-coder-7b', 'llama-3.2-3b']);

      const tokens: string[] = [];
      for await (const delta of transport.streamChat([{ role: 'user', content: 'hi' }])) {
        tokens.push(delta);
      }
      expect(tokens.join('')).toBe('Local OpenAI SSE');
    });
  });

  describe('OfflineSynthesisService & 2-Hop Graph + Scoped Retrieval', () => {
    it('synthesizes grounded citations and connected KG neighbors when local LLM is offline', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osfm-offline-synth-'));
      const kg = new WorkspaceKnowledgeGraph(path.join(tmpDir, 'graph.sqlite'));
      try {
        const hub = path.join(tmpDir, 'docs', 'architecture-hub.md');
        const neighbor = path.join(tmpDir, 'docs', 'vault-crypto.md');
        kg.upsertDocument({
          filePath: hub,
          sha256: 'a1',
          size: 120,
          mtimeMs: 1000,
          chunks: [{ id: 'h-0', chunkIndex: 0, text: 'hub spec', startChar: 0, endChar: 8 }],
          symbols: [],
          links: [{ targetRef: './vault-crypto.md', lineNumber: 4, kind: 'mdlink' }],
        });
        kg.upsertDocument({
          filePath: neighbor,
          sha256: 'b2',
          size: 80,
          mtimeMs: 1000,
          chunks: [{ id: 'n-0', chunkIndex: 0, text: 'vault crypto spec', startChar: 0, endChar: 17 }],
          symbols: [],
          links: [],
        });

        const service = new OfflineSynthesisService();
        const result = service.synthesize({
          query: 'vault architecture',
          retrievalResult: {
            context: '',
            sources: [hub],
            structuredSources: [
              {
                filePath: hub,
                startLine: 1,
                endLine: 12,
                heading: 'Architecture Overview',
                score: 0.92,
                snippet: 'Primary vault kernel design links to vault-crypto spec.',
              },
            ],
            tokenCount: 40,
          },
          knowledgeGraph: kg,
        });

        expect(result.answer).toContain('Offline Retrieval Synthesis');
        expect(result.answer).toContain('[architecture-hub.md#L1-L12]');
        expect(result.answer).toContain('vault-crypto.md');
        expect(result.sources).toHaveLength(1);
      } finally {
        kg.close();
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    });

    it('forwards deep @folder pre-filter into VectorStore, injects 2-hop KG neighbors, and caps MMR file monopoly', async () => {
      const hubPath = path.resolve('/workspace/deep/security/hub.md');
      const keysPath = path.resolve('/workspace/deep/security/keys.md');
      const linkedPath = path.resolve('/workspace/deep/security/audit-trail.md');
      const searchSpy = jest.fn(async (): Promise<VectorRecord[]> => [
        // 4 chunks from one monopolizing file inside folder + 1 from companion
        ...Array.from({ length: 4 }, (_, idx) => ({
          id: `hub-${idx}`,
          file_path: hubPath,
          chunk_index: idx,
          chunk_text: `Rotation schedule chunk ${idx} for hardware security module`,
          embedding: makeVec(1),
          file_type: '.md',
          modified_time: 1000,
          file_size: 200,
          indexed_at: Date.now(),
          start_line: idx * 10 + 1,
          end_line: idx * 10 + 9,
          heading: `Section ${idx}`,
        })),
        {
          id: 'alt-0',
          file_path: keysPath,
          chunk_index: 0,
          chunk_text: 'Hardware security module key escrow procedure',
          embedding: makeVec(1),
          file_type: '.md',
          modified_time: 1000,
          file_size: 150,
          indexed_at: Date.now(),
          start_line: 1,
          end_line: 8,
          heading: 'Escrow',
        },
      ]);

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osfm-mmr-graph-'));
      const kg = new WorkspaceKnowledgeGraph(path.join(tmpDir, 'kg.sqlite'));
      try {
        kg.upsertDocument({
          filePath: linkedPath,
          sha256: 'aud1',
          size: 90,
          mtimeMs: 1000,
          chunks: [{ id: 'aud-0', chunkIndex: 0, text: 'audit trail', startChar: 0, endChar: 11 }],
          symbols: [],
          links: [],
        });
        kg.upsertDocument({
          filePath: hubPath,
          sha256: 'h1',
          size: 200,
          mtimeMs: 1000,
          chunks: [{ id: 'hub-0', chunkIndex: 0, text: 'hub', startChar: 0, endChar: 3 }],
          symbols: [],
          links: [{ targetRef: './audit-trail.md', lineNumber: 3, kind: 'mdlink' }],
        });

        const mockStore = {
          search: searchSpy,
          searchLexical: jest.fn(() => []),
          getKnowledgeGraph: () => kg,
          getChunksForFile: jest.fn((fp: string) =>
            path.resolve(fp) === linkedPath
              ? [
                  {
                    id: 'audit-0',
                    file_path: linkedPath,
                    chunk_index: 0,
                    chunk_text: 'Connected audit trail verifying key escrow rotation events',
                    embedding: makeVec(1),
                    file_type: '.md',
                    modified_time: 1000,
                    file_size: 90,
                    indexed_at: Date.now(),
                    start_line: 1,
                    end_line: 6,
                    heading: 'Audit Trail',
                  },
                ]
              : []
          ),
        } as unknown as VectorStore;

        const embedder: IEmbeddingModel = {
          initialize: async () => undefined,
          embed: async () => makeVec(1),
          embedBatch: async (texts) => texts.map(() => makeVec(1)),
          similarity: () => 0.9,
          getDimensions: () => 384,
        };

        const retrieval = new RetrievalService(mockStore, embedder, new ContextManager());
        const scopedFolder = path.resolve('/workspace/deep/security');
        const res = await retrieval.retrieve('hardware security rotation', {
          useFolder: true,
          currentPath: scopedFolder,
        });

        expect(searchSpy).toHaveBeenCalledWith(expect.any(Array), 25, {
          folderPath: scopedFolder,
        });
        expect(mockStore.searchLexical).toHaveBeenCalledWith('hardware security rotation', 25, {
          folderPath: scopedFolder,
        });

        // 2-hop KG neighbor inside scope was pulled in cleanly
        expect(res.sources.map((s) => path.resolve(s))).toContain(linkedPath);
        // MMR prevented hub.md from taking all first 3 citations ahead of keys.md / audit-trail.md
        const firstThreeFiles = (res.structuredSources ?? []).slice(0, 3).map((s) => path.basename(s.filePath));
        expect(new Set(firstThreeFiles).size).toBeGreaterThanOrEqual(2);
      } finally {
        kg.close();
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  });

  describe('WorkspaceReActAgent propose_organize_plan, multi-turn history & AbortSignal', () => {
    function createStubAgentDeps(
      fetchImpl: typeof fetch,
      overrides: Partial<ConstructorParameters<typeof WorkspaceReActAgent>[0]> = {}
    ): ConstructorParameters<typeof WorkspaceReActAgent>[0] {
      return {
        provider: 'ollama',
        ollamaUrl: 'http://127.0.0.1:11434',
        model: 'llama3.2',
        fetchFn: fetchImpl,
        searchFiles: async (): Promise<string[]> => [],
        searchContent: () => [],
        readFileRange: async () => ({
          path: '',
          name: '',
          startLine: 1,
          endLine: 1,
          totalLines: 1,
          lines: [],
          truncated: false,
        }),
        queryGraph: () => ({
          stats: {
            totalFiles: 0,
            totalChunks: 0,
            totalTokens: 0,
            lastIndexed: 0,
            duplicateClusters: [],
            totalWastedBytes: 0,
            topHubs: [],
            recentFiles: [],
          },
          symbolMatches: [],
          backlinks: [],
        }),
        validatePath: async (p: string): Promise<{ valid: boolean; canonicalPath?: string; error?: string }> => ({
          valid: true,
          canonicalPath: path.resolve(p),
        }),
        ...overrides,
      };
    }

    it('executes gated propose_organize_plan, forwards history, and returns attached proposedPlan', async () => {
      const mockPlan: OrganizePlanResult = {
        planId: 'plan-1',
        targetDir: path.resolve('/vault'),
        strategy: 'smart_category',
        usedLLM: false,
        createdAt: Date.now(),
        operations: [
          {
            id: 'op-1',
            action: 'move',
            sourcePath: path.resolve('/vault/a.md'),
            destinationPath: path.resolve('/vault/docs/a.md'),
            sourceSha256: 'deadbeef',
            size: 120,
            category: 'Documents',
            reason: 'Markdown docs',
          },
        ],
        skippedFiles: 0,
        summary: 'Group 1 markdown file into docs/',
      };
      const proposeSpy = jest.fn(async () => mockPlan);
      const capturedBodies: Array<Record<string, unknown>> = [];

      let turn = 0;
      const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        turn += 1;
        if (turn === 1) {
          return {
            ok: true,
            json: async () => ({
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    function: {
                      name: 'propose_organize_plan',
                      arguments: { targetDir: '/vault', strategy: 'smart_category' },
                    },
                  },
                ],
              },
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({
            message: {
              role: 'assistant',
              content: 'Prepared a dry-run organization proposal for 2 files.',
            },
          }),
        } as unknown as Response;
      });

      const agent = new WorkspaceReActAgent(
        createStubAgentDeps(fetchMock as unknown as typeof fetch, {
          proposeOrganizePlan: proposeSpy,
        })
      );

      const result = await agent.run('Organize my vault by category', {
        history: [
          { role: 'user', content: 'Hello assistant' },
          { role: 'assistant', content: 'Hello, ready to inspect your workspace.' },
        ],
      });

      expect(proposeSpy).toHaveBeenCalledWith(path.resolve('/vault'), 'smart_category');
      expect(result.proposedPlan).toEqual(mockPlan);
      expect(result.steps.some((s) => s.tool === 'propose_organize_plan')).toBe(true);
      const firstReqMessages = capturedBodies[0].messages as Array<{ role: string; content: string }>;
      expect(firstReqMessages.some((m) => m.content === 'Hello assistant')).toBe(true);
    });

    it('honors AbortSignal mid-run without hanging', async () => {
      const controller = new AbortController();
      const abortFetch = jest.fn(async () => {
        controller.abort();
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }) as unknown as typeof fetch;
      const agent = new WorkspaceReActAgent(createStubAgentDeps(abortFetch));

      await expect(agent.run('Cancel mid flight', { signal: controller.signal })).rejects.toThrow();
    });
  });

  describe('IPC Stage 3 Contracts', () => {
    it('validates LLM:ABORT_QUERY and expanded LLM:SET_MODEL_CONFIG schemas cleanly', () => {
      expect(IPC_SCHEMAS['LLM:ABORT_QUERY'].parse({ channel: 'LLM:QUERY:req-42' })).toEqual({
        channel: 'LLM:QUERY:req-42',
      });
      expect(() => IPC_SCHEMAS['LLM:ABORT_QUERY'].parse({ channel: 'invalid-channel' })).toThrow();
      expect(() => IPC_SCHEMAS['LLM:ABORT_QUERY'].parse({ channel: '' })).toThrow();

      expect(
        IPC_SCHEMAS['LLM:SET_MODEL_CONFIG'].parse({
          provider: 'openai_compatible',
          openAiBaseUrl: 'http://127.0.0.1:1234',
          embeddingDevice: 'auto',
          enableVisionCaptioning: true,
        })
      ).toMatchObject({
        provider: 'openai_compatible',
        openAiBaseUrl: 'http://127.0.0.1:1234',
        embeddingDevice: 'auto',
        enableVisionCaptioning: true,
      });
    });
  });
});
