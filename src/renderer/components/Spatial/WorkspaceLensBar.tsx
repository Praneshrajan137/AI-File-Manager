import React, { useRef } from 'react';
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
    icon: <FolderTree className="w-3.5 h-3.5" aria-hidden="true" />,
  },
  {
    id: 'graph',
    label: 'Graph',
    description: 'Semantic & Link Topology',
    icon: <Network className="w-3.5 h-3.5" aria-hidden="true" />,
  },
  {
    id: 'collections',
    label: 'Collections',
    description: 'Topic & Symbol Clusters',
    icon: <Boxes className="w-3.5 h-3.5" aria-hidden="true" />,
  },
  {
    id: 'duplicates',
    label: 'Duplicates',
    description: 'SHA-256 Storage Reclaim',
    icon: <CopyCheck className="w-3.5 h-3.5" aria-hidden="true" />,
  },
];

export const WorkspaceLensBar: React.FC<WorkspaceLensBarProps> = ({
  activeLens,
  onChangeLens,
  totalFiles,
  duplicateClustersCount,
  onRefresh,
}) => {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number): void => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % LENS_TABS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + LENS_TABS.length) % LENS_TABS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = LENS_TABS.length - 1;
    }

    if (nextIndex !== -1) {
      e.preventDefault();
      const targetTab = LENS_TABS[nextIndex];
      onChangeLens(targetTab.id);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div
      data-testid="workspace-lens-bar"
      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/95 backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Workspace Lenses">
        {LENS_TABS.map((tab, index) => {
          const isActive = activeLens === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`lens-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={isActive ? 'workspace-lens-tabpanel' : undefined}
              tabIndex={isActive ? 0 : -1}
              title={tab.description}
              data-testid={`lens-tab-${tab.id}`}
              onClick={(): void => onChangeLens(tab.id)}
              onKeyDown={(e): void => handleTabKeyDown(e, index)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                isActive
                  ? 'bg-accent-600 text-white shadow-sm'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-800'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === 'duplicates' && typeof duplicateClustersCount === 'number' && duplicateClustersCount > 0 && (
                <span
                  data-testid="lens-duplicates-badge"
                  className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-semibold ${
                    isActive
                      ? 'bg-accent-700 text-white'
                      : 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {duplicateClustersCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
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
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            title="Refresh spatial view"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
};
