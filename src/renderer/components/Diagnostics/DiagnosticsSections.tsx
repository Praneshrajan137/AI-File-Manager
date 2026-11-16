import React from 'react';
import { ShieldCheck, Cpu, Database, Layers } from 'lucide-react';
import type { PersistedAgentTraceRecord } from '@shared/contracts';
import type { RuntimeDiagnosticsSnapshot } from '@shared/diagnostics';
import { DiagnosticsTelemetrySection } from './DiagnosticsTelemetrySection';

interface DiagnosticsBodyProps {
  snapshot: RuntimeDiagnosticsSnapshot;
  traces: PersistedAgentTraceRecord[];
  copiedMcp: boolean;
  clearingTraces: boolean;
  mcpSnippet: string;
  onCopyMcp: () => void;
  onClearTraces: () => void;
}

/**
 * Renders the telemetry metric cards and composes detailed IPC/trace ledgers
 * inside DiagnosticsModal with dark-mode WCAG AA contrast.
 */
export const DiagnosticsSections: React.FC<DiagnosticsBodyProps> = ({
  snapshot,
  traces,
  copiedMcp,
  clearingTraces,
  mcpSnippet,
  onCopyMcp,
  onClearTraces,
}) => (
  <>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
      {/* Watcher & EventQueue */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400" aria-hidden="true" />
            Watcher &amp; EventQueue
          </span>
          <span
            data-testid="diagnostics-watcher-status"
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
              snapshot.watcher.status === 'watching'
                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                : snapshot.watcher.status === 'error'
                  ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            {snapshot.watcher.status}
          </span>
        </div>
        <dl className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex justify-between gap-2">
            <dt>Watched Root:</dt>
            <dd
              className="font-mono text-slate-900 dark:text-slate-100 truncate max-w-[180px]"
              title={snapshot.watcher.watchedPath ?? ''}
            >
              {snapshot.watcher.watchedPath ?? 'none'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>OS Events:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">{snapshot.watcher.eventsReceived}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Queue Processed / Coalesced:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.eventQueue.processed} / {snapshot.eventQueue.coalesced}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Last Flush:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.eventQueue.lastFlushDurationMs} ms
            </dd>
          </div>
        </dl>
      </div>

      {/* PathTrie & LRUCache & RingBuffer */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            Trie, Cache &amp; RingBuffer
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
            {(snapshot.cache.hitRate * 100).toFixed(0)}% hit
          </span>
        </div>
        <dl className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex justify-between">
            <dt>PathTrie Entries:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100" data-testid="diagnostics-trie-entries">
              {snapshot.pathTrie.entryCount} ({snapshot.pathTrie.indexedRoots.length} roots)
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>LRU Cache:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.cache.entries}/{snapshot.cache.capacity} ({(snapshot.cache.currentBytes / 1024).toFixed(1)} KB)
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Hits / Misses / Inv:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.cache.hits} / {snapshot.cache.misses} / {snapshot.cache.invalidations}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Preview RingBuffer({snapshot.preview.capacityPerFile}):</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100" data-testid="diagnostics-preview-count">
              {snapshot.preview.previewsServed} served ({snapshot.preview.cacheHits} hits)
            </dd>
          </div>
        </dl>
      </div>

      {/* Hybrid RAG & Security */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Hybrid RAG &amp; Security
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {snapshot.allowedRoots.length} root(s)
          </span>
        </div>
        <dl className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex justify-between">
            <dt>VectorStore Status:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.vectorStore.initialized ? 'ready' : 'lazy-idle'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Indexed Files / Chunks:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.vectorStore.indexedFiles} / {snapshot.vectorStore.totalChunks}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>BM25 Lexical Docs:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">{snapshot.vectorStore.lexicalDocs}</dd>
          </div>
          <div className="flex justify-between">
            <dt>ONNX Execution Provider:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100" data-testid="diagnostics-onnx-ep">
              {snapshot.vectorStore.activeExecutionProvider || 'cpu'}
              {snapshot.vectorStore.supportedDevices && snapshot.vectorStore.supportedDevices.length > 0
                ? ` (${snapshot.vectorStore.supportedDevices.join(', ')})`
                : ''}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Active Local LLM:</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100" data-testid="diagnostics-llm-provider">
              {snapshot.llm.activeProvider || 'ollama'}
              {snapshot.llm.activeModel ? ` · ${snapshot.llm.activeModel}` : ''}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>LLM Queries (ok/err):</dt>
            <dd className="font-mono text-slate-900 dark:text-slate-100">
              {snapshot.llm.successfulQueries}/{snapshot.llm.failedQueries} ({snapshot.llm.avgRetrievalMs}ms ret)
            </dd>
          </div>
          {(snapshot.llm.agentRuns ||
            snapshot.llm.parallelToolBatches ||
            snapshot.llm.cyclesPrevented ||
            snapshot.llm.ungroundedCitationsBlocked) ? (
            <div className="flex justify-between">
              <dt>Orchestrator (runs/par/cyc/blk):</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-100" data-testid="diagnostics-orchestrator-counts">
                {snapshot.llm.agentRuns ?? 0} / {snapshot.llm.parallelToolBatches ?? 0} /{' '}
                {snapshot.llm.cyclesPrevented ?? 0} / {snapshot.llm.ungroundedCitationsBlocked ?? 0}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>

    <DiagnosticsTelemetrySection
      snapshot={snapshot}
      traces={traces}
      copiedMcp={copiedMcp}
      clearingTraces={clearingTraces}
      mcpSnippet={mcpSnippet}
      onCopyMcp={onCopyMcp}
      onClearTraces={onClearTraces}
    />
  </>
);
