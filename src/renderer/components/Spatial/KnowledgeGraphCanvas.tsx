import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Compass,
  FileText,
  ListTree,
  Network,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { WorkspaceGraphEdge, WorkspaceGraphMap, WorkspaceGraphNode } from '@shared/contracts';
import {
  GRAPH_CANVAS_HEIGHT,
  GRAPH_CANVAS_WIDTH,
  PositionedNode,
  clampGraphZoom,
  computeGraphLayout,
} from '@renderer/utils/graphLayout';
import { KnowledgeGraphTable } from './KnowledgeGraphTable';

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
  const [viewKind, setViewKind] = useState<'canvas' | 'table'>('canvas');
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);

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

  const filteredPathSet = useMemo(() => new Set(filteredNodes.map((n) => n.path)), [filteredNodes]);

  const filteredEdges = useMemo(
    () =>
      (graphMap?.edges ?? []).filter(
        (e: WorkspaceGraphEdge) => filteredPathSet.has(e.source) && filteredPathSet.has(e.target)
      ),
    [filteredPathSet, graphMap]
  );

  const positioned = useMemo(
    () => computeGraphLayout(filteredNodes, filteredEdges),
    [filteredEdges, filteredNodes]
  );

  const positionLookup = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const item of positioned) {
      map.set(item.node.path, item);
    }
    return map;
  }, [positioned]);

  const activeFocusPath = hoveredPath || selectedNodePath || null;

  const selectedNode = useMemo(
    () => filteredNodes.find((n) => n.path === selectedNodePath) ?? null,
    [filteredNodes, selectedNodePath]
  );

  const resetViewport = (): void => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const viewWidth = GRAPH_CANVAS_WIDTH / zoom;
  const viewHeight = GRAPH_CANVAS_HEIGHT / zoom;
  const viewMinX = (GRAPH_CANVAS_WIDTH - viewWidth) / 2 - pan.x;
  const viewMinY = (GRAPH_CANVAS_HEIGHT - viewHeight) / 2 - pan.y;

  return (
    <div
      data-testid="knowledge-graph-canvas"
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden"
    >
      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2 text-xs text-slate-800 dark:text-slate-100">
          <Network className="w-4 h-4 text-accent-600 dark:text-indigo-400" aria-hidden="true" />
          <span className="font-semibold">Knowledge Graph</span>
          <span className="text-slate-600 dark:text-slate-300 tabular-nums">
            {filteredNodes.length} nodes / {filteredEdges.length} links
            {graphMap ? ` (${graphMap.totalFilesIndexed} indexed)` : ''}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {viewKind === 'canvas' && positioned.length > 0 && (
            <div className="inline-flex items-center rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden">
              <button
                type="button"
                onClick={(): void => setZoom((z) => clampGraphZoom(z - 0.25))}
                aria-label="Zoom out graph"
                className="p-1 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="px-1.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={(): void => setZoom((z) => clampGraphZoom(z + 0.25))}
                aria-label="Zoom in graph"
                className="p-1 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={resetViewport}
                aria-label="Reset graph zoom and pan"
                className="p-1 border-l border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={(): void => setViewKind((v) => (v === 'canvas' ? 'table' : 'canvas'))}
            data-testid="graph-view-toggle"
            aria-pressed={viewKind === 'table'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <ListTree className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{viewKind === 'canvas' ? 'Topology Table' : 'Graph Canvas'}</span>
          </button>

          <button
            type="button"
            onClick={(): void => onToggleScopeToFolder(!scopeToFolder)}
            data-testid="graph-scope-toggle"
            aria-pressed={scopeToFolder}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
              scopeToFolder
                ? 'bg-indigo-50 dark:bg-indigo-950/60 border-accent-600 dark:border-indigo-700 text-accent-700 dark:text-indigo-200'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            <Compass className="w-3 h-3" aria-hidden="true" />
            <span>{scopeToFolder ? 'Current Folder Only' : 'Entire Vault'}</span>
          </button>

          {fileTypes.length > 0 && (
            <select
              aria-label="Filter graph file type"
              value={typeFilter}
              onChange={(e): void => setTypeFilter(e.target.value)}
              className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="all">All types</option>
              {fileTypes.map((ext) => (
                <option key={ext} value={ext}>.{ext}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main canvas or accessible table view */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center p-3">
        {loading ? (
          <div className="text-xs text-slate-600 dark:text-slate-300" role="status" aria-live="polite">
            Building workspace link topology...
          </div>
        ) : positioned.length === 0 ? (
          <div className="text-center max-w-sm space-y-2">
            <Network className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              No indexed graph nodes in this scope yet
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Enable AI indexing on a Workspace Vault in the sidebar or toggle &ldquo;Entire Vault&rdquo;
              above to inspect code imports and Markdown backlinks.
            </p>
          </div>
        ) : viewKind === 'table' ? (
          <KnowledgeGraphTable
            nodes={filteredNodes}
            selectedNodePath={selectedNodePath}
            onSelectNode={onSelectNode}
            onOpenPreview={onOpenPreview}
          />
        ) : (
          <svg
            viewBox={`${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}`}
            className={`w-full h-full max-h-full ${dragOrigin ? 'cursor-grabbing' : 'cursor-grab'}`}
            data-testid="knowledge-graph-svg"
            role="img"
            aria-label={`Workspace knowledge graph with ${filteredNodes.length} files and ${filteredEdges.length} links`}
            onWheel={(e): void => {
              e.preventDefault();
              setZoom((z) => clampGraphZoom(z + (e.deltaY < 0 ? 0.15 : -0.15)));
            }}
            onMouseDown={(e): void => {
              if (e.target === e.currentTarget) {
                setDragOrigin({ x: e.clientX, y: e.clientY });
              }
            }}
            onMouseMove={(e): void => {
              if (!dragOrigin) return;
              const dx = (e.clientX - dragOrigin.x) / zoom;
              const dy = (e.clientY - dragOrigin.y) / zoom;
              setDragOrigin({ x: e.clientX, y: e.clientY });
              setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
            }}
            onMouseUp={(): void => setDragOrigin(null)}
            onMouseLeave={(): void => setDragOrigin(null)}
          >
            <defs>
              <marker id="graph-arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
              </marker>
              <marker id="graph-arrow-active" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#4f46e5" />
              </marker>
            </defs>

            {filteredEdges.map((edge, idx) => {
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
                  stroke={isHighlighted ? '#4f46e5' : '#94a3b8'}
                  strokeOpacity={activeFocusPath && !isHighlighted ? 0.25 : 0.78}
                  strokeWidth={isHighlighted ? 2.2 : 1.15}
                  markerEnd={isHighlighted ? 'url(#graph-arrow-active)' : 'url(#graph-arrow)'}
                />
              );
            })}

            {positioned.map(({ node, x, y, radius, color }) => {
              const isSelected = selectedNodePath === node.path;
              const isHovered = hoveredPath === node.path;
              return (
                <g
                  key={node.path}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${node.name}: ${node.inDegree} incoming, ${node.outDegree} outgoing links`}
                  transform={`translate(${x}, ${y})`}
                  onMouseEnter={(): void => setHoveredPath(node.path)}
                  onMouseLeave={(): void => setHoveredPath(null)}
                  onClick={(): void => onSelectNode(node)}
                  onDoubleClick={(): void => onOpenPreview(node.path)}
                  onKeyDown={(e): void => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectNode(node);
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                  data-testid={`graph-node-${node.name}`}
                >
                  <circle
                    r={radius + (isSelected ? 4 : 0)}
                    fill={color}
                    fillOpacity={isSelected ? 0.2 : 0}
                    stroke={isSelected || isHovered ? '#4f46e5' : 'transparent'}
                    strokeWidth={2}
                  />
                  <circle r={radius} fill={color} stroke="#ffffff" strokeWidth={1.75} className="transition-transform" />
                  <text y={radius + 14} textAnchor="middle" className="fill-slate-800 dark:fill-slate-200 text-[10px] font-medium pointer-events-none">
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
          className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="min-w-0 flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-accent-600 dark:text-indigo-400 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{selectedNode.name}</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
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
      )}
    </div>
  );
};
