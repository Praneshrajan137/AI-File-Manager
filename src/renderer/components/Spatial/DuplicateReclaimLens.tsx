import React from 'react';
import { CopyCheck, FileWarning, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { GraphInsightsResponse } from '@shared/contracts';
import { formatFileSize } from '@renderer/utils/formatters';
import { extractBasename } from '@renderer/utils/pathHelpers';

type DuplicateCluster = GraphInsightsResponse['stats']['duplicateClusters'][number];

interface DuplicateReclaimLensProps {
  duplicateClusters: DuplicateCluster[];
  totalWastedBytes: number;
  loading?: boolean;
  onPreviewFile: (filePath: string) => void;
  onQuarantineDuplicates: () => void;
}

export const DuplicateReclaimLens: React.FC<DuplicateReclaimLensProps> = ({
  duplicateClusters,
  totalWastedBytes,
  loading = false,
  onPreviewFile,
  onQuarantineDuplicates,
}) => {
  return (
    <div
      data-testid="duplicate-reclaim-lens"
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-4 space-y-4 scrollbar-thin"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
            <CopyCheck className="w-4 h-4 text-amber-500" />
            <span>Exact SHA-256 Duplicate Clusters</span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {duplicateClusters.length} cluster{duplicateClusters.length === 1 ? '' : 's'} detected ·{' '}
            <span className="font-semibold text-amber-700 dark:text-amber-300">
              {formatFileSize(totalWastedBytes)}
            </span>{' '}
            reclaimable without touching canonical originals
          </p>
        </div>

        <button
          type="button"
          onClick={onQuarantineDuplicates}
          data-testid="quarantine-duplicates-button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Quarantine Duplicates Safely (Dry-Run)</span>
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-gray-500 dark:text-slate-400">
          Scanning SHA-256 content hashes...
        </div>
      ) : duplicateClusters.length === 0 ? (
        <div className="py-12 text-center bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
          <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700 dark:text-slate-200">
            Zero duplicate file waste detected
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            You can still run &ldquo;Quarantine Duplicates Safely&rdquo; above to scan the current folder
            directly with content hashing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {duplicateClusters.map((cluster) => (
            <div
              key={cluster.sha256}
              data-testid="duplicate-cluster-card"
              className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <FileWarning className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="font-mono text-[11px] text-gray-700 dark:text-slate-200">
                    sha256:{cluster.sha256.slice(0, 12)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 tabular-nums">
                    {cluster.files.length} copies · {formatFileSize(cluster.fileSize)} each
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  Reclaim {formatFileSize(cluster.wastedBytes)}
                </span>
              </div>

              <div className="space-y-1">
                {cluster.files.map((filePath, idx) => {
                  const isPrimary = idx === 0;
                  return (
                    <button
                      key={filePath}
                      type="button"
                      onClick={(): void => onPreviewFile(filePath)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-gray-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:bg-indigo-50/40 dark:hover:bg-slate-800/70 text-left text-[11px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                            isPrimary
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {isPrimary ? 'Primary Keep' : 'Duplicate'}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-slate-100 truncate">
                          {extractBasename(filePath)}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 font-mono truncate hidden md:inline">
                          {filePath}
                        </span>
                      </div>
                      <ArrowUpRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
