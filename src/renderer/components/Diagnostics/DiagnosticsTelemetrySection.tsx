import React from 'react';
import { Cpu, HardDrive, Terminal, Copy, Check } from 'lucide-react';
import type { PersistedAgentTraceRecord } from '@shared/contracts';
import type { RuntimeDiagnosticsSnapshot } from '@shared/diagnostics';

interface DiagnosticsTelemetrySectionProps {
  snapshot: RuntimeDiagnosticsSnapshot;
  traces: PersistedAgentTraceRecord[];
  copiedMcp: boolean;
  clearingTraces: boolean;
  mcpSnippet: string;
  onCopyMcp: () => void;
  onClearTraces: () => void;
}

/**
 * Renders the MCP server JSON snippet, IPC channel latency ledger, and recent agent
 * execution traces with focusable scroll regions for full WCAG 2.2 AA compliance.
 */
export const DiagnosticsTelemetrySection: React.FC<DiagnosticsTelemetrySectionProps> = ({
  snapshot,
  traces,
  copiedMcp,
  clearingTraces,
  mcpSnippet,
  onCopyMcp,
  onClearTraces,
}) => (
  <>
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
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300 hover:bg-accent-100 dark:hover:bg-accent-900 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          {copiedMcp ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          <span>{copiedMcp ? 'Copied MCP JSON' : 'Copy Claude/Cursor Config'}</span>
        </button>
      </div>
      <pre
        data-testid="diagnostics-mcp-snippet"
        tabIndex={0}
        aria-label="Opt-in local MCP server JSON configuration"
        className="text-[11px] font-mono bg-slate-950 text-slate-100 p-2.5 rounded overflow-x-auto leading-relaxed border border-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
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
      <div
        role="region"
        aria-label="Contract-Enforced IPC Telemetry Table"
        tabIndex={0}
        className="max-h-60 overflow-y-auto scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset"
      >
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
                      ch.errors > 0 ? 'text-error-700 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300'
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
      <div
        role="region"
        aria-label="Agent Orchestration Trace Ledger"
        tabIndex={0}
        className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset"
      >
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
