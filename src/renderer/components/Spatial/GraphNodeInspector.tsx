import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, FileText, Sparkles } from 'lucide-react';
import type { WorkspaceGraphNode } from '@shared/contracts';

interface GraphNodeInspectorProps {
  selectedNode: WorkspaceGraphNode;
  incomingNeighbors: WorkspaceGraphNode[];
  outgoingNeighbors: WorkspaceGraphNode[];
  onJumpToNode: (node: WorkspaceGraphNode) => void;
  onOpenPreview: (filePath: string) => void;
  onFocusInChat?: (node: WorkspaceGraphNode) => void;
}

/** Selected graph node details footer with clickable inbound/outgoing neighbor traversal chips. */
export const GraphNodeInspector: React.FC<GraphNodeInspectorProps> = ({
  selectedNode,
  incomingNeighbors,
  outgoingNeighbors,
  onJumpToNode,
  onOpenPreview,
  onFocusInChat,
}) => (
  <div
    data-testid="graph-node-inspector"
    className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 flex items-center gap-2.5">
        <FileText className="w-4 h-4 text-accent-600 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{selectedNode.name}</div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate tabular-nums">
            {selectedNode.inDegree} in / {selectedNode.outDegree} out
            {selectedNode.topSymbols.length > 0 && ` · Symbols: ${selectedNode.topSymbols.join(', ')}`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(): void => onOpenPreview(selectedNode.path)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-accent-600 hover:bg-accent-700 text-white text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          <span>Inspect File</span>
          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
        </button>
        {onFocusInChat && (
          <button
            type="button"
            onClick={(): void => onFocusInChat(selectedNode)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-accent-700 dark:text-indigo-200 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            <span>Summarize</span>
          </button>
        )}
      </div>
    </div>

    {(incomingNeighbors.length > 0 || outgoingNeighbors.length > 0) && (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="graph-neighbor-jumps">
        {incomingNeighbors.slice(0, 4).map((nb) => (
          <button
            key={`in-${nb.path}`}
            type="button"
            onClick={(): void => onJumpToNode(nb)}
            title={`Jump to referencing file: ${nb.name}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <ArrowLeft className="w-2.5 h-2.5" aria-hidden="true" />
            <span className="truncate max-w-[140px]">{nb.name}</span>
          </button>
        ))}
        {outgoingNeighbors.slice(0, 4).map((nb) => (
          <button
            key={`out-${nb.path}`}
            type="button"
            onClick={(): void => onJumpToNode(nb)}
            title={`Jump to linked file: ${nb.name}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-accent-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <span className="truncate max-w-[140px]">{nb.name}</span>
            <ArrowRight className="w-2.5 h-2.5" aria-hidden="true" />
          </button>
        ))}
      </div>
    )}
  </div>
);
