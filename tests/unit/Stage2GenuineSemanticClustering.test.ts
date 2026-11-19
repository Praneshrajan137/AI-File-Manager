import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clusterDocumentsByVector } from '../../src/llm/services/SemanticClustering';
import { VectorStore } from '../../src/llm/services/VectorStore';
import { WorkspaceKnowledgeGraph } from '../../src/main/services/WorkspaceKnowledgeGraph';
import { PathValidator } from '../../src/main/services/PathValidator';
import { FileSystemService } from '../../src/main/services/FileSystemService';
import { OperationJournal } from '../../src/main/services/OperationJournal';
import { AIOrganizerService } from '../../src/main/services/AIOrganizerService';
import { getWorkspaceRuntime } from '../../src/main/entry/WorkspaceRuntime';
import { SmartCollectionsLens } from '../../src/renderer/components/Spatial/SmartCollectionsLens';
import type { IpcMainInvokeEvent } from 'electron';

function makeBasisVector(dim: number, primaryAxis: number, secondaryAxis?: number, jitter = 0): number[] {
  const vec = new Array<number>(dim).fill(0);
  vec[primaryAxis] = 1;
  if (secondaryAxis !== undefined) {
    vec[secondaryAxis] = 0.2 + jitter;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}

describe('Stage 2: Genuine Vector Semantic Clustering, Centroids & Loopback Enforcement', () => {
  it('clusters documents by dense vector cosine similarity cleanly regardless of filenames or hardcoded regexes', () => {
    const { groups, averageCohesion } = clusterDocumentsByVector([
      {
        filePath: '/vault/item-01.txt',
        name: 'item-01.txt',
        fileType: 'txt',
        chunkCount: 2,
        vector: makeBasisVector(384, 10, 11, 0.01),
        topSymbols: ['PhotonWaveguide'],
        textSample: 'Silicon photonics optical resonator interferometer laser coupling.',
      },
      {
        filePath: '/vault/item-02.txt',
        name: 'item-02.txt',
        fileType: 'txt',
        chunkCount: 1,
        vector: makeBasisVector(384, 10, 11, 0.03),
        topSymbols: ['OpticalModulator'],
        textSample: 'Photonics waveguide optical bandwidth modulation efficiency.',
      },
      {
        filePath: '/vault/item-03.txt',
        name: 'item-03.txt',
        fileType: 'txt',
        chunkCount: 2,
        vector: makeBasisVector(384, 120, 121, 0.01),
        topSymbols: ['EstuarySalinity'],
        textSample: 'Marine kelp reef estuary salinity plankton survey data.',
      },
      {
        filePath: '/vault/item-04.txt',
        name: 'item-04.txt',
        fileType: 'txt',
        chunkCount: 1,
        vector: makeBasisVector(384, 120, 121, 0.02),
        topSymbols: ['PelagicCoral'],
        textSample: 'Marine plankton benthic survey coral reef estuary transects.',
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(averageCohesion).toBeGreaterThanOrEqual(0.95);
    expect(groups.every((g) => g.clusteringMode === 'vector_embeddings')).toBe(true);

    const groupPaths = groups.map((g) => g.files.map((f) => f.name).sort());
    expect(groupPaths).toContainEqual(['item-01.txt', 'item-02.txt']);
    expect(groupPaths).toContainEqual(['item-03.txt', 'item-04.txt']);

    const labels = groups.map((g) => g.label.toLowerCase()).join(' | ');
    expect(labels).toMatch(/optical|photonics/);
    expect(labels).toMatch(/marine|estuary|survey|reef|plankton/);
  });

  it('aggregates real LanceDB multi-chunk embeddings into L2-normalized document centroids', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pv-stage2-vec-'));
    const store = new VectorStore({
      modelId: 'Xenova/bge-small-en-v1.5',
      knowledgeGraphFactory: (kgPath) => new WorkspaceKnowledgeGraph(kgPath),
    });
    try {
      await store.initialize(tmpDir);
      const docA = path.join(tmpDir, 'alpha.md');
      const docB = path.join(tmpDir, 'beta.md');

      await store.addChunks(
        [
          {
            text: 'Alpha chunk one telemetry calibration',
            chunkIndex: 0,
            startChar: 0,
            endChar: 30,
          },
          {
            text: 'Alpha chunk two telemetry drift',
            chunkIndex: 1,
            startChar: 31,
            endChar: 60,
          },
        ],
        [makeBasisVector(384, 3), makeBasisVector(384, 3)],
        docA
      );
      await store.addChunks(
        [
          {
            text: 'Beta botanics taxonomy herbarium',
            chunkIndex: 0,
            startChar: 0,
            endChar: 30,
          },
        ],
        [makeBasisVector(384, 200)],
        docB
      );
      await store.flushPendingRecords();

      const centroids = await store.getDocumentCentroids();
      expect(centroids.size).toBe(2);
      const centroidA = centroids.get(docA);
      const centroidB = centroids.get(docB);
      expect(centroidA).toBeDefined();
      expect(centroidB).toBeDefined();
      expect(centroidA?.chunkCount).toBe(2);
      expect(centroidA?.vector[3]).toBeCloseTo(1, 5);
      expect(centroidB?.vector[200]).toBeCloseTo(1, 5);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('uses vector clustering in AIOrganizerService when embeddings exist and reports explicit fallback when absent', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pv-stage2-org-'));
    try {
      const vaultDir = path.join(tmpRoot, '.vault');
      const f1 = path.join(tmpRoot, 'alpha-1.md');
      const f2 = path.join(tmpRoot, 'alpha-2.md');
      const f3 = path.join(tmpRoot, 'beta-1.md');
      const f4 = path.join(tmpRoot, 'beta-2.md');

      await fs.writeFile(f1, 'Cryogenic superconductor qubits decoherence study', 'utf-8');
      await fs.writeFile(f2, 'Cryogenic microwave resonator qubits readout', 'utf-8');
      await fs.writeFile(f3, 'Sourdough fermentation starter hydration baking schedule', 'utf-8');
      await fs.writeFile(f4, 'Artisanal sourdough fermentation crust crumb crumb structure', 'utf-8');

      const validator = new PathValidator([tmpRoot]);
      const fsService = new FileSystemService([tmpRoot]);
      const journal = new OperationJournal({
        vaultDir,
        maxHistory: 10,
        maxVaultBytes: 10 * 1024 * 1024,
        validator,
        fileSystemService: fsService,
      });

      const vectorOrganizer = new AIOrganizerService({
        validator,
        operationJournal: journal,
        clusterVectors: (items) => clusterDocumentsByVector(items, { maxClusters: 6 }).groups,
        getDocumentVectors: async () =>
          new Map<string, number[]>([
            [f1, makeBasisVector(384, 5, 6, 0.01)],
            [f2, makeBasisVector(384, 5, 6, 0.02)],
            [f3, makeBasisVector(384, 150, 151, 0.01)],
            [f4, makeBasisVector(384, 150, 151, 0.02)],
          ]),
      });

      const vecPlan = await vectorOrganizer.proposeOrganizationPlan({
        targetDir: tmpRoot,
        strategy: 'semantic_cluster',
      });
      expect(vecPlan.degradedReason).toBeUndefined();
      expect(vecPlan.operations).toHaveLength(4);
      expect(vecPlan.operations.every((op) => op.classificationSource === 'semantic')).toBe(true);
      const op1 = vecPlan.operations.find((o) => o.sourcePath === f1)!;
      const op2 = vecPlan.operations.find((o) => o.sourcePath === f2)!;
      const op3 = vecPlan.operations.find((o) => o.sourcePath === f3)!;
      const op4 = vecPlan.operations.find((o) => o.sourcePath === f4)!;
      expect(op1.category).toBe(op2.category);
      expect(op3.category).toBe(op4.category);
      expect(op1.category).not.toBe(op3.category);
      expect(op1.reason).toContain('Vector embedding cluster');

      const offlineOrganizer = new AIOrganizerService({
        validator,
        operationJournal: journal,
      });
      const fallbackPlan = await offlineOrganizer.proposeOrganizationPlan({
        targetDir: tmpRoot,
        strategy: 'semantic_cluster',
      });
      expect(fallbackPlan.degradedReason).toMatch(/embedding vectors unavailable/i);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects non-loopback URLs in setLlmModelConfig and renders truthful SmartCollectionsLens mode badges', async () => {
    const fakeEvent = {} as IpcMainInvokeEvent;
    await expect(
      getWorkspaceRuntime().setLlmModelConfig(fakeEvent, { openAiBaseUrl: 'https://api.openai.com/v1' })
    ).rejects.toThrow(/Non-local LLM URL rejected/);
    await expect(
      getWorkspaceRuntime().setLlmModelConfig(fakeEvent, { ollamaUrl: 'http://192.168.1.50:11434' })
    ).rejects.toThrow(/Non-local LLM URL rejected/);

    const vecHtml = renderToStaticMarkup(
      React.createElement(SmartCollectionsLens, {
        collections: [
          {
            id: 'vec-test',
            label: 'Cryogenic Qubits',
            clusteringMode: 'vector_embeddings',
            reason: 'Vector similarity cluster (cosine cohesion 0.96)',
            files: [{ path: '/a.md', name: 'a.md', fileType: 'md', chunkCount: 2 }],
            dominantSymbols: ['QubitResonator'],
          },
        ],
        onSelectFile: () => undefined,
      })
    );
    expect(vecHtml).toContain('Vector Embedding Clusters');

    const heuristicHtml = renderToStaticMarkup(
      React.createElement(SmartCollectionsLens, {
        collections: [
          {
            id: 'docs',
            label: 'Docs',
            clusteringMode: 'structural_heuristic',
            reason: 'Structural grouping under Docs/ folder',
            files: [{ path: '/docs/a.md', name: 'a.md', fileType: 'md', chunkCount: 1 }],
            dominantSymbols: [],
          },
        ],
        onSelectFile: () => undefined,
      })
    );
    expect(heuristicHtml).toContain('Structural Grouping');
  });
});
