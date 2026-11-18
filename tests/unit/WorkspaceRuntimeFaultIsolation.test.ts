/**
 * WorkspaceRuntimeFaultIsolation.test.ts - Verifies Tier A (FTS5/KG/OfflineSynthesis) vs
 * Tier B (ONNX/LanceDB) fault containment using WorkspaceRuntime Composition Root.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { ConfigManager } from '@shared/config';
import { VaultRootAuthority } from '@main/platform/VaultRootAuthority';
import { RuntimeDiagnostics } from '@main/services/RuntimeDiagnostics';
import { WorkspaceKnowledgeGraph } from '@main/services/WorkspaceKnowledgeGraph';
import { resetReactiveWorkspaceKernel } from '@main/services/ReactiveWorkspaceKernel';
import { WorkspaceRuntime } from '@main/entry/WorkspaceRuntime';

function createFakeInvokeEvent(): {
  event: IpcMainInvokeEvent;
  chunks: string[];
  steps: unknown[];
  endPayload: Record<string, unknown> | null;
} {
  const chunks: string[] = [];
  const steps: unknown[] = [];
  let endPayload: Record<string, unknown> | null = null;
  const sender = {
    isDestroyed: (): boolean => false,
    send: jest.fn((channel: string, payload: unknown) => {
      if (channel.endsWith(':end')) {
        endPayload = (payload as Record<string, unknown>) ?? null;
      } else if (channel.endsWith(':step')) {
        steps.push(payload);
      } else if (typeof payload === 'string') {
        chunks.push(payload);
      }
    }),
    once: jest.fn(),
    removeListener: jest.fn(),
  };
  return {
    event: { sender } as unknown as IpcMainInvokeEvent,
    get chunks(): string[] {
      return chunks;
    },
    get steps(): unknown[] {
      return steps;
    },
    get endPayload(): Record<string, unknown> | null {
      return endPayload;
    },
  };
}

describe('WorkspaceRuntime Composition Root — Tier A vs Tier B Fault Isolation', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let dbDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pv-tier-isolation-'));
    workspaceDir = path.join(tmpDir, 'vault');
    dbDir = path.join(tmpDir, 'vectordb');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(dbDir, { recursive: true });

    await fs.writeFile(
      path.join(workspaceDir, 'architecture-notes.md'),
      '# Resilience Architecture\n\nToken TIER_ISOLATION_TOKEN verifies FTS5 offline synthesis survives ONNX failure.',
      'utf-8'
    );

    RuntimeDiagnostics.resetForTesting();
    ConfigManager.resetForTesting();
    ConfigManager.initialize({
      configPath: path.join(tmpDir, 'cfg', 'config.json'),
      watchConfig: false,
    });
    ConfigManager.getInstance().set('fileSystem.allowedRoots', [workspaceDir], true);
    VaultRootAuthority.getInstance().applyAllowedRoots([workspaceDir]);

    const kg = new WorkspaceKnowledgeGraph(path.join(dbDir, 'knowledge-graph.sqlite'));
    try {
      kg.upsertDocument({
        filePath: path.join(workspaceDir, 'architecture-notes.md'),
        sha256: 'abc123',
        size: 120,
        mtimeMs: Date.now(),
        fileType: 'md',
        chunks: [
          {
            id: `${path.join(workspaceDir, 'architecture-notes.md')}:0`,
            chunkIndex: 0,
            text: 'Token TIER_ISOLATION_TOKEN verifies FTS5 offline synthesis survives ONNX failure.',
            startChar: 0,
            endChar: 82,
            startLine: 3,
            endLine: 3,
            heading: 'Resilience Architecture',
          },
        ],
        symbols: [{ name: 'Resilience Architecture', kind: 'heading', lineNumber: 1 }],
        links: [],
      });
    } finally {
      kg.close();
    }
  });

  afterEach(async () => {
    await resetReactiveWorkspaceKernel().catch(() => undefined);
    VaultRootAuthority.getInstance().invalidate();
    ConfigManager.resetForTesting();
    RuntimeDiagnostics.resetForTesting();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('keeps Tier A FTS5 search, Knowledge Graph insights, and Offline Copilot alive when Tier B ONNX init throws', async () => {
    const runtime = new WorkspaceRuntime({
      resolveVectorDbDir: () => dbDir,
      embeddingPoolFactory: () =>
        ({
          initialize: jest.fn().mockRejectedValue(new Error('ONNX native backend unavailable')),
          terminate: jest.fn().mockResolvedValue(undefined),
          getExecutionProvider: () => 'cpu',
          getSupportedDevices: () => ['cpu'],
        }) as unknown as import('../../src/llm/workers/EmbeddingWorkerPool').EmbeddingWorkerPool,
    });

    try {
      // Point local model client to unreachable loopback port so offline fallback triggers cleanly
      await runtime.setLlmModelConfig(createFakeInvokeEvent().event, {
        provider: 'ollama',
        ollamaUrl: 'http://127.0.0.1:19999',
        model: 'llama3.2',
      });

      const ragFake = createFakeInvokeEvent();
      const ragRes = await runtime.executeCopilotQuery(ragFake.event, {
        query: 'TIER_ISOLATION_TOKEN',
        channel: 'LLM:QUERY:tier-test-1',
        mode: 'rag',
      });

      expect(ragRes.success).toBe(true);
      expect(ragRes.offlineSynthesis).toBe(true);
      expect(ragRes.terminationReason).toBe('offline_fallback');
      expect(ragRes.sanitizedAnswer).toContain('architecture-notes.md');

      const health = runtime.getTierHealth();
      expect(health.tierA).toBe('ready');
      expect(health.tierB).toBe('unavailable');
      expect(health.tierBError).toContain('ONNX native backend unavailable');

      const diag = RuntimeDiagnostics.getInstance().getSnapshot().vectorStore;
      expect(diag.tierAStatus).toBe('ready');
      expect(diag.tierBStatus).toBe('unavailable');
      expect(diag.tierBError).toContain('ONNX native backend unavailable');

      // Tier A FTS5 content search & graph insights remain operational
      const hits = runtime.searchWorkspaceContent('TIER_ISOLATION_TOKEN', 5);
      expect(hits).toHaveLength(1);
      expect(hits[0].fileName).toBe('architecture-notes.md');

      const insights = runtime.queryWorkspaceGraphInsights({ symbolQuery: 'Resilience' });
      expect(insights.stats.totalFiles).toBe(1);
      expect(insights.symbolMatches?.length).toBeGreaterThanOrEqual(1);

      // Explicit semantic index operation reports clear Tier B failure without corrupting Tier A
      const idxRes = await runtime.indexSingleFile(createFakeInvokeEvent().event, {
        filePath: path.join(workspaceDir, 'architecture-notes.md'),
      });
      expect(idxRes.success).toBe(false);
      expect(idxRes.error).toContain('ONNX native backend unavailable');
    } finally {
      await runtime.cleanup();
    }
  });
});
