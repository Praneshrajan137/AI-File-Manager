import React from 'react';
import { FolderTree, Network, Boxes, CopyCheck, RefreshCw } from 'lucide-react';
import { ExplorerLens } from '@shared/contracts';

interface WorkspaceLensBarProps {
  activeLens: ExplorerLens;
  onChangeLens: (lens: ExplorerLens) => void;
  totalFiles?: number;
  duplicateClustersCount?: number;
  onRefresh?: () => void;
}

interface LensDefinition {
  id: ExplorerLens;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const LENS_TABS: LensDefinition[] = [
  {
    id: 'files',
    label: 'Files',
    description: 'Interactive Explorer',
    icon: <FolderTree className="w-3.5 h-3.5" />,
  },
  {
    id: 'graph',
    label: 'Graph',
    description: 'Semantic & Link Topology',
    icon: <Network className="w-3.5 h-3.5" />,
  },
  {
    id: 'collections',
    label: 'Collections',
    description: 'Topic & Symbol Clusters',
    icon: <Boxes className="w-3.5 h-3.5" />,
  },
  {
    id: 'duplicates',
    label: 'Duplicates',
    description: 'SHA-256 Storage Reclaim',
    icon: <CopyCheck className="w-3.5 h-3.5" />,
  },
];

export const WorkspaceLensBar: React.FC<WorkspaceLensBarProps> = ({
  activeLens,
  onChangeLens,
  totalFiles,
  duplicateClustersCount,
  onRefresh,
}) => {
  return (
    <div
      data-testid="workspace-lens-bar"
      className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-slate-800 bg-gray-50/80 dark:bg-slate-900/90 backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Workspace Lenses">
        {LENS_TABS.map((tab) => {
          const isActive = activeLens === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-pressed={isActive}
              title={tab.description}
              data-testid={`lens-tab-${tab.id}`}
              onClick={(): void => onChangeLens(tab.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-slate-300 hover:bg-gray-200/80 dark:hover:bg-slate-800'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === 'duplicates' && typeof duplicateClustersCount === 'number' && duplicateClustersCount > 0 && (
                <span
                  data-testid="lens-duplicates-badge"
                  className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-semibold ${
                    isActive
                      ? 'bg-indigo-500 text-white'
                      : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {duplicateClustersCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-slate-400">
        {typeof totalFiles === 'number' && (
          <span className="tabular-nums hidden sm:inline">
            {totalFiles} item{totalFiles === 1 ? '' : 's'}
          </span>
        )}
        {onRefresh && activeLens !== 'files' && (
          <button
            type="button"
            onClick={onRefresh}
            data-testid="lens-refresh-button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
            title="Refresh spatial view"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
};
