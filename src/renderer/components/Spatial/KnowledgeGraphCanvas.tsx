import React, { useMemo, useState } from 'react';
import { Network } from 'lucide-react';
import type { WorkspaceGraphEdge, WorkspaceGraphMap, WorkspaceGraphNode } from '@shared/contracts';
import {
  GRAPH_CANVAS_HEIGHT,
  GRAPH_CANVAS_WIDTH,
  PositionedNode,
  clampGraphZoom,
  computeGraphLayout,
} from '@renderer/utils/graphLayout';
import { GraphControlsBar } from './GraphControlsBar';
import { GraphNodeInspector } from './GraphNodeInspector';
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
  const [nodeSearch, setNodeSearch] = useState<string>('');
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
    const needle = nodeSearch.trim().toLowerCase();
    return (graphMap?.nodes ?? []).filter((n) => {
      if (typeFilter !== 'all' && n.fileType.toLowerCase() !== typeFilter) return false;
      if (needle && !n.name.toLowerCase().includes(needle) && !n.topSymbols.some((s) => s.toLowerCase().includes(needle))) {
        return false;
      }
      return true;
    });
  }, [graphMap, nodeSearch, typeFilter]);

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
    for (const item of positioned) map.set(item.node.path, item);
    return map;
  }, [positioned]);

  const activeFocusPath = hoveredPath || selectedNodePath || null;
  const selectedNode = useMemo(
    () => filteredNodes.find((n) => n.path === selectedNodePath) ?? null,
    [filteredNodes, selectedNodePath]
  );

  const { incomingNeighbors, outgoingNeighbors } = useMemo(() => {
    if (!selectedNodePath) return { incomingNeighbors: [], outgoingNeighbors: [] };
    const nodeByPath = new Map(filteredNodes.map((n) => [n.path, n]));
    const incoming: WorkspaceGraphNode[] = [];
    const outgoing: WorkspaceGraphNode[] = [];
    for (const edge of filteredEdges) {
      if (edge.target === selectedNodePath) {
        const src = nodeByPath.get(edge.source);
        if (src) incoming.push(src);
      }
      if (edge.source === selectedNodePath) {
        const tgt = nodeByPath.get(edge.target);
        if (tgt) outgoing.push(tgt);
      }
    }
    return { incomingNeighbors: incoming, outgoingNeighbors: outgoing };
  }, [filteredEdges, filteredNodes, selectedNodePath]);

  const resetViewport = (): void => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleJumpToNode = (target: WorkspaceGraphNode): void => {
    onSelectNode(target);
    const pos = positionLookup.get(target.path);
    if (pos) {
      setPan({ x: GRAPH_CANVAS_WIDTH / 2 - pos.x, y: GRAPH_CANVAS_HEIGHT / 2 - pos.y });
    }
  };

  const handleViewportKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (viewKind !== 'canvas' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom((z) => clampGraphZoom(z + 0.25));
    } else if (e.key === '-') {
      e.preventDefault();
      setZoom((z) => clampGraphZoom(z - 0.25));
    } else if (e.key === '0') {
      e.preventDefault();
      resetViewport();
    }
  };

  const viewWidth = GRAPH_CANVAS_WIDTH / zoom;
  const viewHeight = GRAPH_CANVAS_HEIGHT / zoom;
  const viewMinX = (GRAPH_CANVAS_WIDTH - viewWidth) / 2 - pan.x;
  const viewMinY = (GRAPH_CANVAS_HEIGHT - viewHeight) / 2 - pan.y;

  return (
    <div
      data-testid="knowledge-graph-canvas"
      onKeyDown={handleViewportKeyDown}
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden"
    >
      <GraphControlsBar
        filteredCount={filteredNodes.length}
        edgeCount={filteredEdges.length}
        totalIndexed={graphMap?.totalFilesIndexed}
        viewKind={viewKind}
        hasPositionedNodes={positioned.length > 0}
        zoom={zoom}
        scopeToFolder={scopeToFolder}
        nodeSearch={nodeSearch}
        typeFilter={typeFilter}
        fileTypes={fileTypes}
        onZoomOut={(): void => setZoom((z) => clampGraphZoom(z - 0.25))}
        onZoomIn={(): void => setZoom((z) => clampGraphZoom(z + 0.25))}
        onResetViewport={resetViewport}
        onToggleViewKind={(): void => setViewKind((v) => (v === 'canvas' ? 'table' : 'canvas'))}
        onToggleScopeToFolder={onToggleScopeToFolder}
        onNodeSearchChange={setNodeSearch}
        onTypeFilterChange={setTypeFilter}
      />

      <div className="flex-1 relative overflow-hidden flex items-center justify-center p-3">
        {loading ? (
          <div className="text-xs text-slate-600 dark:text-slate-300" role="status" aria-live="polite">
            Building workspace link topology...
          </div>
        ) : positioned.length === 0 ? (
          <div className="text-center max-w-sm space-y-2">
            <Network className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              No indexed graph nodes match this view
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Enable AI indexing on a Workspace Vault in the sidebar, clear filters, or toggle &ldquo;Entire Vault&rdquo;.
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
            role="group"
            aria-label={`Workspace knowledge graph with ${filteredNodes.length} files and ${filteredEdges.length} links`}
            onWheel={(e): void => {
              e.preventDefault();
              setZoom((z) => clampGraphZoom(z + (e.deltaY < 0 ? 0.15 : -0.15)));
            }}
            onMouseDown={(e): void => {
              if (e.target === e.currentTarget) setDragOrigin({ x: e.clientX, y: e.clientY });
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
              const isHighlighted = activeFocusPath !== null && (edge.source === activeFocusPath || edge.target === activeFocusPath);
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

      {selectedNode && (
        <GraphNodeInspector
          selectedNode={selectedNode}
          incomingNeighbors={incomingNeighbors}
          outgoingNeighbors={outgoingNeighbors}
          onJumpToNode={handleJumpToNode}
          onOpenPreview={onOpenPreview}
          onFocusInChat={onFocusInChat}
        />
      )}
    </div>
  );
};
