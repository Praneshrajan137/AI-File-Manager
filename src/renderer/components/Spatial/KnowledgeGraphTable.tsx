import React from 'react';
import { WorkspaceGraphNode } from '@shared/contracts';

interface KnowledgeGraphTableProps {
  nodes: WorkspaceGraphNode[];
  selectedNodePath: string | null;
  onSelectNode: (node: WorkspaceGraphNode) => void;
  onOpenPreview: (filePath: string) => void;
}

export const KnowledgeGraphTable: React.FC<KnowledgeGraphTableProps> = ({
  nodes,
  selectedNodePath,
  onSelectNode,
  onOpenPreview,
}) => (
  <div className="w-full h-full overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
    <table className="w-full text-left border-collapse text-xs" data-testid="knowledge-graph-table">
      <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
        <tr>
          <th className="px-3 py-2 font-semibold">File</th>
          <th className="px-3 py-2 font-semibold">Type</th>
          <th className="px-3 py-2 font-semibold tabular-nums">Degree</th>
          <th className="px-3 py-2 font-semibold">Top Symbols</th>
          <th className="px-3 py-2 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {nodes.map((node) => {
          const isSelected = selectedNodePath === node.path;
          return (
            <tr
              key={node.path}
              className={
                isSelected
                  ? 'bg-indigo-50/90 dark:bg-indigo-950/50'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }
            >
              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                <button
                  type="button"
                  onClick={(): void => onSelectNode(node)}
                  className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded"
                >
                  {node.name}
                </button>
              </td>
              <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
                .{node.fileType || 'file'}
              </td>
              <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-200">
                {node.inDegree} in / {node.outDegree} out
              </td>
              <td className="px-3 py-2 text-slate-600 dark:text-slate-300 truncate max-w-[220px]">
                {node.topSymbols.slice(0, 4).join(', ') || '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={(): void => onOpenPreview(node.path)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-accent-600 hover:bg-accent-700 text-white font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <span>Inspect</span>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
