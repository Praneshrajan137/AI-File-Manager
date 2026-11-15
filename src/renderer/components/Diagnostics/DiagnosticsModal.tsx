import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  RefreshCw,
  X,
  ShieldCheck,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Terminal,
  Copy,
  Check,
} from 'lucide-react';
import type { RuntimeDiagnosticsSnapshot } from '@shared/diagnostics';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSnapshot?: RuntimeDiagnosticsSnapshot;
}

export function buildMcpSnippetJson(allowedRoots: string[]): string {
  const roots = allowedRoots.length > 0 ? allowedRoots : ['<workspace-root-path>'];
  return JSON.stringify(
    {
      mcpServers: {
        'privatevault-workspace': {
          command: 'node',
          args: ['dist/main/mcpServer.js', '--roots', roots.join(',')],
        },
      },
    },
    null,
    2
  );
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  initialSnapshot,
}) => {
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    initialSnapshot ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const isOpenRef = useRef(isOpen);
  const requestSeqRef = useRef(0);
  isOpenRef.current = isOpen;

  const loadDiagnostics = useCallback(async (): Promise<void> => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await window.electronAPI.diagnostics.getSnapshot();
      if (!isOpenRef.current || seq !== requestSeqRef.current) {
        return;
      }
      setSnapshot(next);
    } catch (err: unknown) {
      if (!isOpenRef.current || seq !== requestSeqRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      if (isOpenRef.current && seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadDiagnostics();
  }, [isOpen, loadDiagnostics]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      data-testid="diagnostics-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Kernel Runtime Diagnostics"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden border border-gray-200"
        onClick={(e): void => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold">Kernel Runtime Diagnostics</h2>
              <p className="text-xs text-slate-300">
                Live telemetry across Watcher, EventQueue, PathTrie, LRUCache, RingBuffer, VectorStore & IPC
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(): void => {
                void loadDiagnostics();
              }}
              disabled={loading}
              data-testid="diagnostics-refresh"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="diagnostics-close"
              aria-label="Close diagnostics"
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && !snapshot && !error && (
            <div className="p-6 text-center text-sm text-gray-500">
              Loading runtime diagnostics...
            </div>
          )}

          {snapshot && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {/* Watcher & EventQueue */}
                <div className="bg-white rounded-lg border border-gray-200 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                      Watcher & EventQueue
                    </span>
                    <span
                      data-testid="diagnostics-watcher-status"
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        snapshot.watcher.status === 'watching'
                          ? 'bg-emerald-100 text-emerald-700'
                          : snapshot.watcher.status === 'error'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {snapshot.watcher.status}
                    </span>
                  </div>
                  <dl className="space-y-1 text-xs text-gray-600">
                    <div className="flex justify-between gap-2">
                      <dt>Watched Root:</dt>
                      <dd className="font-mono text-gray-900 truncate max-w-[180px]" title={snapshot.watcher.watchedPath ?? ''}>
                        {snapshot.watcher.watchedPath ?? 'none'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>OS Events:</dt>
                      <dd className="font-mono text-gray-900">{snapshot.watcher.eventsReceived}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Queue Processed / Coalesced:</dt>
                      <dd className="font-mono text-gray-900">
                        {snapshot.eventQueue.processed} / {snapshot.eventQueue.coalesced}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Last Flush:</dt>
                      <dd className="font-mono text-gray-900">{snapshot.eventQueue.lastFlushDurationMs} ms</dd>
                    </div>
                  </dl>
                </div>

                {/* PathTrie & LRUCache & RingBuffer */}
                <div className="bg-white rounded-lg border border-gray-200 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-amber-500" />
                      Trie, Cache & RingBuffer
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700">
                      {(snapshot.cache.hitRate * 100).toFixed(0)}% hit
                    </span>
                  </div>
                  <dl className="space-y-1 text-xs text-gray-600">
                    <div className="flex justify-between">
                      <dt>PathTrie Entries:</dt>
                      <dd className="font-mono text-gray-900" data-testid="diagnostics-trie-entries">
                        {snapshot.pathTrie.entryCount} ({snapshot.pathTrie.indexedRoots.length} roots)
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>LRU Cache:</dt>
                      <dd className="font-mono text-gray-900">
                        {snapshot.cache.entries}/{snapshot.cache.capacity} ({(snapshot.cache.currentBytes / 1024).toFixed(1)} KB)
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Hits / Misses / Inv:</dt>
                      <dd className="font-mono text-gray-900">
                        {snapshot.cache.hits} / {snapshot.cache.misses} / {snapshot.cache.invalidations}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Preview RingBuffer({snapshot.preview.capacityPerFile}):</dt>
                      <dd className="font-mono text-gray-900" data-testid="diagnostics-preview-count">
                        {snapshot.preview.previewsServed} served ({snapshot.preview.cacheHits} hits)
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Hybrid RAG & Security */}
                <div className="bg-white rounded-lg border border-gray-200 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-600" />
                      Hybrid RAG & Security
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 inline-flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      {snapshot.allowedRoots.length} root(s)
                    </span>
                  </div>
                  <dl className="space-y-1 text-xs text-gray-600">
                    <div className="flex justify-between">
                      <dt>VectorStore Status:</dt>
                      <dd className="font-mono text-gray-900">
                        {snapshot.vectorStore.initialized ? 'ready' : 'lazy-idle'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Indexed Files / Chunks:</dt>
                      <dd className="font-mono text-gray-900">
                        {snapshot.vectorStore.indexedFiles} / {snapshot.vectorStore.totalChunks}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>BM25 Lexical Docs:</dt>
                      <dd className="font-mono text-gray-900">{snapshot.vectorStore.lexicalDocs}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>ONNX Execution Provider:</dt>
                      <dd className="font-mono text-gray-900" data-testid="diagnostics-onnx-ep">
                        {snapshot.vectorStore.activeExecutionProvider || 'cpu'}
                        {snapshot.vectorStore.supportedDevices && snapshot.vectorStore.supportedDevices.length > 0
                          ? ` (${snapshot.vectorStore.supportedDevices.join(', ')})`
                          : ''}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Active Local LLM:</dt>
                      <dd className="font-mono text-gray-900" data-testid="diagnostics-llm-provider">
                        {snapshot.llm.activeProvider || 'ollama'}
                        {snapshot.llm.activeModel ? ` · ${snapshot.llm.activeModel}` : ''}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>LLM Queries (ok/err):</dt>
                      <dd className="font-mono text-gray-900">
                        {snapshot.llm.successfulQueries}/{snapshot.llm.failedQueries} ({snapshot.llm.avgRetrievalMs}ms ret)
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Opt-In Local MCP Server (Claude Desktop / Cursor) */}
              <div
                data-testid="diagnostics-mcp-section"
                className="bg-white rounded-lg border border-gray-200 p-3.5 shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                    Opt-In Local MCP Server (Read-Only Stdio + SecretGuard)
                  </span>
                  <button
                    type="button"
                    data-testid="copy-mcp-config-button"
                    onClick={(): void => {
                      const snippet = buildMcpSnippetJson(snapshot.allowedRoots);
                      if (window.electronAPI?.clipboard?.writeText) {
                        void window.electronAPI.clipboard.writeText(snippet);
                      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        void navigator.clipboard.writeText(snippet);
                      }
                      setCopiedMcp(true);
                      setTimeout(() => setCopiedMcp(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium"
                  >
                    {copiedMcp ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedMcp ? 'Copied MCP JSON' : 'Copy Claude/Cursor Config'}</span>
                  </button>
                </div>
                <pre
                  data-testid="diagnostics-mcp-snippet"
                  className="text-[11px] font-mono bg-slate-900 text-slate-100 p-2.5 rounded overflow-x-auto leading-relaxed"
                >
                  {buildMcpSnippetJson(snapshot.allowedRoots)}
                </pre>
              </div>

              {/* IPC Channels Table */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-blue-600" />
                    Contract-Enforced IPC Telemetry ({snapshot.ipc.registeredChannels} registered channels)
                  </span>
                  <span className="text-xs text-gray-500 font-mono" data-testid="diagnostics-ipc-totals">
                    {snapshot.ipc.totalCalls} calls · {snapshot.ipc.totalErrors} errors
                  </span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium">Channel</th>
                        <th className="px-4 py-2 font-medium text-right">Calls</th>
                        <th className="px-4 py-2 font-medium text-right">Errors</th>
                        <th className="px-4 py-2 font-medium text-right">Avg Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {snapshot.ipc.channels.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-4 text-center text-gray-400">
                            No IPC calls recorded yet.
                          </td>
                        </tr>
                      ) : (
                        snapshot.ipc.channels.map((ch) => (
                          <tr key={ch.channel} className="hover:bg-gray-50">
                            <td className="px-4 py-1.5 font-mono text-gray-800">{ch.channel}</td>
                            <td className="px-4 py-1.5 font-mono text-right text-gray-700">{ch.calls}</td>
                            <td className={`px-4 py-1.5 font-mono text-right ${ch.errors > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                              {ch.errors}
                            </td>
                            <td className="px-4 py-1.5 font-mono text-right text-gray-600">{ch.avgDurationMs} ms</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
