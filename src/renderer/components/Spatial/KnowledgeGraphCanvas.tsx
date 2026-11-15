import React, { useMemo, useState } from 'react';
import { Network, Sparkles, FileText, ArrowUpRight, Compass } from 'lucide-react';
import { WorkspaceGraphEdge, WorkspaceGraphMap, WorkspaceGraphNode } from '@shared/contracts';

interface KnowledgeGraphCanvasProps {
  graphMap: WorkspaceGraphMap | null;
  loading?: boolean;
  selectedNodePath?: string | null;
  scopeToFolder: boolean;
  onToggleScopeToFolder: (scoped: boolean) => void;
  onSelectNode: (node: WorkspaceGraphNode) => void;
  onOpenPreview: (filePath: string) => void;
  onFocusInChat?: (node: WorkspaceGraphNode) => void;
}

interface PositionedNode {
  node: WorkspaceGraphNode;
  x: number;
  y: number;
  radius: number;
  color: string;
}

const CANVAS_WIDTH = 840;
const CANVAS_HEIGHT = 480;

function getNodeColor(fileType: string): string {
  const ext = fileType.toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java'].includes(ext)) return '#6366f1';
  if (['md', 'markdown', 'mdx', 'txt'].includes(ext)) return '#10b981';
  if (['json', 'yaml', 'yml', 'toml', 'sql', 'csv'].includes(ext)) return '#f59e0b';
  if (['pdf', 'docx'].includes(ext)) return '#ec4899';
  return '#64748b';
}

function computeRadialLayout(nodes: WorkspaceGraphNode[]): PositionedNode[] {
  if (nodes.length === 0) return [];
  const cx = CANVAS_WIDTH / 2;
  const cy = CANVAS_HEIGHT / 2;

  return nodes.map((node, index) => {
    const degree = node.inDegree + node.outDegree;
    if (index === 0 && nodes.length > 2) {
      return {
        node,
        x: cx,
        y: cy,
        radius: Math.min(24, 13 + Math.min(degree, 8)),
        color: getNodeColor(node.fileType),
      };
    }

    const innerCount = Math.min(nodes.length - 1, 8);
    const isInner = index <= innerCount;
    const ringIndex = isInner ? index - 1 : index - innerCount - 1;
    const ringTotal = Math.max(1, isInner ? innerCount : nodes.length - innerCount - 1);
    const ringRadius = isInner ? 128 : 206;
    const angle = (ringIndex / ringTotal) * Math.PI * 2 - Math.PI / 2;

    return {
      node,
      x: Math.round(cx + Math.cos(angle) * ringRadius * (isInner ? 1.15 : 1.4)),
      y: Math.round(cy + Math.sin(angle) * ringRadius * 0.85),
      radius: Math.min(22, 11 + Math.min(degree, 8)),
      color: getNodeColor(node.fileType),
    };
  });
}

export const KnowledgeGraphCanvas: React.FC<KnowledgeGraphCanvasProps> = ({
  graphMap,
  loading = false,
  selectedNodePath = null,
  scopeToFolder,
  onToggleScopeToFolder,
  onSelectNode,
  onOpenPreview,
  onFocusInChat,
}) => {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fileTypes = useMemo(() => {
    const set = new Set<string>();
    for (const n of graphMap?.nodes ?? []) {
      if (n.fileType) set.add(n.fileType.toLowerCase());
    }
    return Array.from(set).sort();
  }, [graphMap]);

  const filteredNodes = useMemo(() => {
    const nodes = graphMap?.nodes ?? [];
    if (typeFilter === 'all') return nodes;
    return nodes.filter((n) => n.fileType.toLowerCase() === typeFilter);
  }, [graphMap, typeFilter]);

  const positioned = useMemo(() => computeRadialLayout(filteredNodes), [filteredNodes]);

  const positionLookup = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const item of positioned) {
      map.set(item.node.path, item);
    }
    return map;
  }, [positioned]);

  const activeFocusPath = hoveredPath || selectedNodePath || null;

  const visibleEdges = useMemo(() => {
    return (graphMap?.edges ?? []).filter(
      (e: WorkspaceGraphEdge) => positionLookup.has(e.source) && positionLookup.has(e.target)
    );
  }, [graphMap, positionLookup]);

  const selectedNode = useMemo(
    () => filteredNodes.find((n) => n.path === selectedNodePath) ?? null,
    [filteredNodes, selectedNodePath]
  );

  return (
    <div
      data-testid="knowledge-graph-canvas"
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden"
    >
      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
          <Network className="w-4 h-4 text-indigo-500" />
          <span className="font-semibold">Knowledge Graph</span>
          <span className="text-gray-400 dark:text-slate-500 tabular-nums">
            {filteredNodes.length} nodes / {visibleEdges.length} links
            {graphMap ? ` (${graphMap.totalFilesIndexed} indexed)` : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(): void => onToggleScopeToFolder(!scopeToFolder)}
            data-testid="graph-scope-toggle"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border ${
              scopeToFolder
                ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300'
            }`}
          >
            <Compass className="w-3 h-3" />
            <span>{scopeToFolder ? 'Current Folder Only' : 'Entire Vault'}</span>
          </button>

          {fileTypes.length > 0 && (
            <select
              aria-label="Filter graph file type"
              value={typeFilter}
              onChange={(e): void => setTypeFilter(e.target.value)}
              className="px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200"
            >
              <option value="all">All types</option>
              {fileTypes.map((ext) => (
                <option key={ext} value={ext}>
                  .{ext}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main canvas */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center p-3">
        {loading ? (
          <div className="text-xs text-gray-500 dark:text-slate-400">
            Building workspace link topology...
          </div>
        ) : positioned.length === 0 ? (
          <div className="text-center max-w-sm space-y-2">
            <Network className="w-8 h-8 text-gray-300 dark:text-slate-700 mx-auto" />
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              No indexed graph nodes in this scope yet
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Enable AI indexing on a Workspace Vault in the sidebar or toggle &ldquo;Entire Vault&rdquo;
              above to inspect code imports and Markdown backlinks.
            </p>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            className="w-full h-full max-h-full select-none"
            data-testid="knowledge-graph-svg"
          >
            <defs>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="18"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
              </marker>
              <marker
                id="graph-arrow-active"
                viewBox="0 0 10 10"
                refX="18"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#6366f1" />
              </marker>
            </defs>

            {/* Edges */}
            {visibleEdges.map((edge, idx) => {
              const src = positionLookup.get(edge.source);
              const tgt = positionLookup.get(edge.target);
              if (!src || !tgt) return null;
              const isHighlighted =
                activeFocusPath !== null &&
                (edge.source === activeFocusPath || edge.target === activeFocusPath);

              return (
                <line
                  key={`${edge.source}-${edge.target}-${idx}`}
                  x1={src.x}
                  y1={src.y}
                  x2={tgt.x}
                  y2={tgt.y}
                  stroke={isHighlighted ? '#6366f1' : '#cbd5e1'}
                  strokeOpacity={activeFocusPath && !isHighlighted ? 0.25 : 0.78}
                  strokeWidth={isHighlighted ? 2.2 : 1.15}
                  markerEnd={isHighlighted ? 'url(#graph-arrow-active)' : 'url(#graph-arrow)'}
                />
              );
            })}

            {/* Nodes */}
            {positioned.map(({ node, x, y, radius, color }) => {
              const isSelected = selectedNodePath === node.path;
              const isHovered = hoveredPath === node.path;
              return (
                <g
                  key={node.path}
                  transform={`translate(${x}, ${y})`}
                  onMouseEnter={(): void => setHoveredPath(node.path)}
                  onMouseLeave={(): void => setHoveredPath(null)}
                  onClick={(): void => onSelectNode(node)}
                  onDoubleClick={(): void => onOpenPreview(node.path)}
                  className="cursor-pointer"
                  data-testid={`graph-node-${node.name}`}
                >
                  <circle
                    r={radius + (isSelected ? 4 : 0)}
                    fill={color}
                    fillOpacity={isSelected ? 0.2 : 0}
                    stroke={isSelected || isHovered ? '#4f46e5' : 'transparent'}
                    strokeWidth={2}
                  />
                  <circle
                    r={radius}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={1.75}
                    className="transition-transform"
                  />
                  <text
                    y={radius + 14}
                    textAnchor="middle"
                    className="fill-slate-700 dark:fill-slate-200 text-[10px] font-medium pointer-events-none"
                  >
                    {node.name.length > 20 ? `${node.name.slice(0, 18)}...` : node.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Selected node details bar */}
      {selectedNode && (
        <div
          data-testid="graph-node-inspector"
          className="px-4 py-2.5 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="min-w-0 flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-gray-800 dark:text-slate-100 truncate">
                {selectedNode.name}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                {selectedNode.inDegree} in / {selectedNode.outDegree} out
                {selectedNode.topSymbols.length > 0 &&
                  ` · Symbols: ${selectedNode.topSymbols.join(', ')}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(): void => onOpenPreview(selectedNode.path)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium"
            >
              <span>Inspect File</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
            {onFocusInChat && (
              <button
                type="button"
                onClick={(): void => onFocusInChat(selectedNode)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium"
              >
                <Sparkles className="w-3 h-3" />
                <span>Summarize</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
