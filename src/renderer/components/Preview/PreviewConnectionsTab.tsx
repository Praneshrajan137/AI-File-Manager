import React from 'react';
import type { FileConnectionsSummary } from '@shared/contracts';
import { extractBasename } from '@renderer/utils/pathHelpers';

interface PreviewConnectionsTabProps {
  filePath: string;
  fileConnections: FileConnectionsSummary | null;
  connectionsLoading: boolean;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
}

export const PreviewConnectionsTab: React.FC<PreviewConnectionsTabProps> = ({
  filePath,
  fileConnections,
  connectionsLoading,
  onOpenCitation,
}) => (
  <div className="space-y-4 font-sans text-xs text-slate-200" data-testid="preview-connections-panel">
    {connectionsLoading ? (
      <div className="py-8 text-center text-slate-300" role="status" aria-live="polite">
        Loading graph connections...
      </div>
    ) : !fileConnections ? (
      <div className="py-8 text-center text-slate-300">
        Index this workspace to inspect symbols, outgoing references, backlinks, and 2-hop associative neighbors.
      </div>
    ) : (
      <>
        <section className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Symbols ({fileConnections.symbols.length})
          </h4>
          {fileConnections.symbols.length === 0 ? (
            <p className="text-slate-400 text-[11px]">No symbols extracted.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fileConnections.symbols.map((sym, idx) => (
                <button
                  key={`${sym.name}-${sym.lineNumber}-${idx}`}
                  type="button"
                  onClick={(): void => onOpenCitation?.(filePath, sym.lineNumber, sym.lineNumber)}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-900 border border-slate-700 text-indigo-200 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  {sym.name} :L{sym.lineNumber}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Inbound Backlinks ({fileConnections.backlinks.length})
          </h4>
          {fileConnections.backlinks.length === 0 ? (
            <p className="text-slate-400 text-[11px]">No incoming references detected.</p>
          ) : (
            <div className="space-y-1">
              {fileConnections.backlinks.map((bl, idx) => (
                <button
                  key={`${bl.sourcePath}-${bl.lineNumber}-${idx}`}
                  type="button"
                  onClick={(): void => onOpenCitation?.(bl.sourcePath, bl.lineNumber, bl.lineNumber)}
                  className="w-full text-left px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <span className="truncate font-medium text-emerald-300">
                    {extractBasename(bl.sourcePath)}
                  </span>
                  <span className="text-[10px] font-mono text-slate-300 tabular-nums">
                    L{bl.lineNumber} ({bl.kind})
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Outgoing Links ({fileConnections.outgoingLinks.length})
          </h4>
          {fileConnections.outgoingLinks.length === 0 ? (
            <p className="text-slate-400 text-[11px]">No outgoing references detected.</p>
          ) : (
            <div className="space-y-1">
              {fileConnections.outgoingLinks.map((out, idx) => (
                <button
                  key={`${out.targetRef}-${out.lineNumber}-${idx}`}
                  type="button"
                  disabled={!out.targetPath}
                  onClick={(): void => {
                    if (out.targetPath) onOpenCitation?.(out.targetPath, 1, 20);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <span className="truncate font-mono text-sky-300">{out.targetRef}</span>
                  <span className="text-[10px] font-mono text-slate-300">
                    L{out.lineNumber}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {fileConnections.associativeNeighbors.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              2-Hop Associative Neighbors
            </h4>
            <div className="space-y-1">
              {fileConnections.associativeNeighbors.map((nb) => (
                <button
                  key={nb.filePath}
                  type="button"
                  onClick={(): void => onOpenCitation?.(nb.filePath, 1, 20)}
                  className="w-full text-left px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <span className="truncate text-indigo-200">{extractBasename(nb.filePath)}</span>
                  <span className="text-[10px] font-mono text-slate-300 tabular-nums">
                    {nb.hopDistance}h · {nb.score.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </>
    )}
  </div>
);
