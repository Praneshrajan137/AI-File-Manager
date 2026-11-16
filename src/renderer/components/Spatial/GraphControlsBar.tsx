import React from 'react';
import { Compass, ListTree, Network, RotateCcw, Search, ZoomIn, ZoomOut } from 'lucide-react';

interface GraphControlsBarProps {
  filteredCount: number;
  edgeCount: number;
  totalIndexed: number | undefined;
  viewKind: 'canvas' | 'table';
  hasPositionedNodes: boolean;
  zoom: number;
  scopeToFolder: boolean;
  nodeSearch: string;
  typeFilter: string;
  fileTypes: string[];
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetViewport: () => void;
  onToggleViewKind: () => void;
  onToggleScopeToFolder: (scoped: boolean) => void;
  onNodeSearchChange: (val: string) => void;
  onTypeFilterChange: (ext: string) => void;
}

/** Header bar for KnowledgeGraphCanvas with node search, zoom controls, scope toggle, and view switch. */
export const GraphControlsBar: React.FC<GraphControlsBarProps> = ({
  filteredCount,
  edgeCount,
  totalIndexed,
  viewKind,
  hasPositionedNodes,
  zoom,
  scopeToFolder,
  nodeSearch,
  typeFilter,
  fileTypes,
  onZoomOut,
  onZoomIn,
  onResetViewport,
  onToggleViewKind,
  onToggleScopeToFolder,
  onNodeSearchChange,
  onTypeFilterChange,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
    <div className="flex items-center gap-2 text-xs text-slate-800 dark:text-slate-100">
      <Network className="w-4 h-4 text-accent-600 dark:text-indigo-400" aria-hidden="true" />
      <span className="font-semibold">Knowledge Graph</span>
      <span className="text-slate-600 dark:text-slate-300 tabular-nums">
        {filteredCount} nodes / {edgeCount} links
        {totalIndexed !== undefined ? ` (${totalIndexed} indexed)` : ''}
      </span>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={nodeSearch}
          onChange={(e): void => onNodeSearchChange(e.target.value)}
          placeholder="Filter nodes..."
          aria-label="Filter graph nodes"
          data-testid="graph-node-search"
          className="pl-7 pr-2 py-1 text-[11px] w-32 sm:w-40 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      {viewKind === 'canvas' && hasPositionedNodes && (
        <div className="inline-flex items-center rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-hidden">
          <button
            type="button"
            onClick={onZoomOut}
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
            onClick={onZoomIn}
            aria-label="Zoom in graph"
            className="p-1 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onResetViewport}
            aria-label="Reset graph zoom and pan"
            className="p-1 border-l border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleViewKind}
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
          onChange={(e): void => onTypeFilterChange(e.target.value)}
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
);
