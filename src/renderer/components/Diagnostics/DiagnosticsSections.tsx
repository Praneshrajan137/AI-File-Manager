import React from 'react';
import {
  ShieldCheck,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Terminal,
  Copy,
  Check,
} from 'lucide-react';
import type { PersistedAgentTraceRecord } from '@shared/contracts';
import type { RuntimeDiagnosticsSnapshot } from '@shared/diagnostics';

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
 * Renders the telemetry metric cards, local MCP snippet, IPC breakdown table,
 * and persisted agent trace ledger inside DiagnosticsModal with dark-mode WCAG contrast.
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

    {/* Opt-In Local MCP Server (Claude Desktop / Cursor) */}
    <div
      data-testid="diagnostics-mcp-section"
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm space-y-2"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400" aria-hidden="true" />
          Opt-In Local MCP Server (Read-Only Stdio + SecretGuard)
        </span>
        <button
          type="button"
          data-testid="copy-mcp-config-button"
          onClick={onCopyMcp}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300 hover:bg-accent-100 dark:hover:bg-accent-900 text-xs font-medium"
        >
          {copiedMcp ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          <span>{copiedMcp ? 'Copied MCP JSON' : 'Copy Claude/Cursor Config'}</span>
        </button>
      </div>
      <pre
        data-testid="diagnostics-mcp-snippet"
        className="text-[11px] font-mono bg-slate-950 text-slate-100 p-2.5 rounded overflow-x-auto leading-relaxed border border-slate-800"
      >
        {mcpSnippet}
      </pre>
    </div>

    {/* IPC Channels Table */}
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400" aria-hidden="true" />
          Contract-Enforced IPC Telemetry ({snapshot.ipc.registeredChannels} registered channels)
        </span>
        <span className="text-xs text-slate-600 dark:text-slate-300 font-mono" data-testid="diagnostics-ipc-totals">
          {snapshot.ipc.totalCalls} calls · {snapshot.ipc.totalErrors} errors
        </span>
      </div>
      <div className="max-h-60 overflow-y-auto scrollbar-thin">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 sticky top-0">
            <tr>
              <th className="px-4 py-2 font-medium">Channel</th>
              <th className="px-4 py-2 font-medium text-right">Calls</th>
              <th className="px-4 py-2 font-medium text-right">Errors</th>
              <th className="px-4 py-2 font-medium text-right">Avg Latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {snapshot.ipc.channels.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-slate-600 dark:text-slate-300">
                  No IPC calls recorded yet.
                </td>
              </tr>
            ) : (
              snapshot.ipc.channels.map((ch) => (
                <tr key={ch.channel} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-1.5 font-mono text-slate-900 dark:text-slate-100">{ch.channel}</td>
                  <td className="px-4 py-1.5 font-mono text-right text-slate-700 dark:text-slate-200">{ch.calls}</td>
                  <td
                    className={`px-4 py-1.5 font-mono text-right ${
                      ch.errors > 0
                        ? 'text-error-700 dark:text-red-400 font-semibold'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {ch.errors}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-right text-slate-600 dark:text-slate-300">
                    {ch.avgDurationMs} ms
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* Agent Trace Ledger */}
    <div
      data-testid="diagnostics-traces-section"
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
          Agent Orchestration Trace Ledger ({traces.length} recent)
        </span>
        {traces.length > 0 &&
          typeof window !== 'undefined' &&
          typeof window.electronAPI?.llm?.clearTraces === 'function' && (
            <button
              type="button"
              data-testid="diagnostics-clear-traces-button"
              disabled={clearingTraces}
              onClick={onClearTraces}
              className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {clearingTraces ? 'Clearing...' : 'Clear Ledger'}
            </button>
          )}
      </div>
      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 scrollbar-thin">
        {traces.length === 0 ? (
          <div className="px-4 py-3 text-xs text-center text-slate-600 dark:text-slate-300">
            No persisted agent or RAG traces yet.
          </div>
        ) : (
          traces.map((tr) => (
            <div
              key={tr.traceId}
              data-testid="diagnostics-trace-row"
              className="px-4 py-2 text-xs flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{tr.queryPreview}</div>
                <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  {tr.mode} · {tr.model} · {tr.stepCount} step(s) · {tr.verifiedCitations} verified
                  {tr.ungroundedCitationsCount > 0 ? ` · ${tr.ungroundedCitationsCount} blocked` : ''}
                  {tr.redactionsApplied > 0 ? ` · ${tr.redactionsApplied} redacted` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 font-mono text-[11px]">
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    tr.status === 'answered'
                      ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                      : 'bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {tr.status}
                </span>
                <span className="text-slate-600 dark:text-slate-300">{tr.durationMs}ms</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </>
);
