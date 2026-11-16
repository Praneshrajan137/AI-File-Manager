import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Activity, RefreshCw, X } from 'lucide-react';
import type { PersistedAgentTraceRecord } from '@shared/contracts';
import type { RuntimeDiagnosticsSnapshot } from '@shared/diagnostics';
import { ModalShell } from '@renderer/components/common/ModalShell';
import { DiagnosticsSections } from './DiagnosticsSections';

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
          args: ['dist/main/mcpServer.js', ...roots.flatMap((root) => ['--root', root])],
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
  const [traces, setTraces] = useState<PersistedAgentTraceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearingTraces, setClearingTraces] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const headingId = useId();
  const copiedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isOpenRef = useRef(isOpen);
  const requestSeqRef = useRef(0);
  isOpenRef.current = isOpen;

  useEffect(() => {
    return (): void => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const loadDiagnostics = useCallback(async (): Promise<void> => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [next, tracePayload] = await Promise.all([
        window.electronAPI.diagnostics.getSnapshot(),
        typeof window.electronAPI?.llm?.getTraces === 'function'
          ? window.electronAPI.llm.getTraces(12).catch(() => ({ traces: [] as PersistedAgentTraceRecord[] }))
          : Promise.resolve({ traces: [] as PersistedAgentTraceRecord[] }),
      ]);
      if (!isOpenRef.current || seq !== requestSeqRef.current) {
        return;
      }
      setSnapshot(next);
      setTraces(Array.isArray(tracePayload?.traces) ? tracePayload.traces : []);
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

  const handleClearTraces = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI?.llm?.clearTraces !== 'function') return;
    setClearingTraces(true);
    try {
      await window.electronAPI.llm.clearTraces();
      setTraces([]);
    } catch {
      // Non-fatal trace clear error
    } finally {
      setClearingTraces(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadDiagnostics();
  }, [isOpen, loadDiagnostics]);

  const handleCopyMcp = useCallback((): void => {
    if (!snapshot) return;
    const snippet = buildMcpSnippetJson(snapshot.allowedRoots);
    if (window.electronAPI?.clipboard?.writeText) {
      void window.electronAPI.clipboard.writeText(snippet);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(snippet);
    }
    setCopiedMcp(true);
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(() => setCopiedMcp(false), 2000);
  }, [snapshot]);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={headingId}
      dataTestId="diagnostics-modal"
      backdropClassName="fixed inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center z-50 p-4"
      panelClassName="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700"
    >
      {/* Header */}
      <div className="px-5 py-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          <div>
            <h2 id={headingId} className="text-base font-semibold">
              Kernel Runtime Diagnostics
            </h2>
            <p className="text-xs text-slate-300">
              Live telemetry across Watcher, EventQueue, PathTrie, LRUCache, RingBuffer, VectorStore &amp; IPC
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
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="diagnostics-close"
            aria-label="Close diagnostics"
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50 dark:bg-slate-950 scrollbar-thin">
        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {loading && !snapshot && !error && (
          <div className="p-6 text-center text-sm text-slate-600 dark:text-slate-300">
            Loading runtime diagnostics...
          </div>
        )}

        {snapshot && (
          <DiagnosticsSections
            snapshot={snapshot}
            traces={traces}
            copiedMcp={copiedMcp}
            clearingTraces={clearingTraces}
            mcpSnippet={buildMcpSnippetJson(snapshot.allowedRoots)}
            onCopyMcp={handleCopyMcp}
            onClearTraces={(): void => {
              void handleClearTraces();
            }}
          />
        )}
      </div>
    </ModalShell>
  );
};
