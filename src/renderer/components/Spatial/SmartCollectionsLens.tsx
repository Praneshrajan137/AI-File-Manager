import React from 'react';
import { Boxes, FileCode, FileText, Sparkles } from 'lucide-react';
import { WorkspaceCollectionGroup } from '@shared/contracts';

interface SmartCollectionsLensProps {
  collections: WorkspaceCollectionGroup[];
  loading?: boolean;
  onSelectFile: (filePath: string) => void;
  onOpenSemanticOrganize?: () => void;
}

export const SmartCollectionsLens: React.FC<SmartCollectionsLensProps> = ({
  collections,
  loading = false,
  onSelectFile,
  onOpenSemanticOrganize,
}) => {
  return (
    <div
      data-testid="smart-collections-lens"
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto p-4 space-y-4 scrollbar-thin"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
            <Boxes className="w-4 h-4 text-indigo-500" />
            <span>Semantic Workspace Collections</span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Virtual clusters grouped by code domain, documentation links, and extracted symbols.
          </p>
        </div>

        {onOpenSemanticOrganize && (
          <button
            type="button"
            onClick={onOpenSemanticOrganize}
            data-testid="collections-organize-button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Preview Semantic Organize</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-gray-500 dark:text-slate-400">
          Clustering workspace knowledge graph...
        </div>
      ) : collections.length === 0 ? (
        <div className="py-12 text-center bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
          <Boxes className="w-8 h-8 text-gray-300 dark:text-slate-700 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
            No semantic collections available yet
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            Enable AI indexing on this folder in the sidebar to group related documents automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {collections.map((group) => (
            <div
              key={group.id}
              data-testid={`collection-card-${group.id}`}
              className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-3.5 shadow-sm flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-800 dark:text-slate-100 truncate">
                    {group.label}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300">
                    {group.files.length}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">{group.reason}</p>
                {group.dominantSymbols.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {group.dominantSymbols.map((sym) => (
                      <span
                        key={sym}
                        className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono"
                      >
                        {sym}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1 border-t border-gray-100 dark:border-slate-800 pt-2">
                {group.files.slice(0, 5).map((file) => {
                  const isCode = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs'].includes(
                    file.fileType.toLowerCase()
                  );
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={(): void => onSelectFile(file.path)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-[11px] hover:bg-indigo-50 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-200"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {isCode ? (
                          <FileCode className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        )}
                        <span className="truncate font-medium">{file.name}</span>
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-slate-500 tabular-nums flex-shrink-0">
                        {file.chunkCount}c
                      </span>
                    </button>
                  );
                })}
                {group.files.length > 5 && (
                  <div className="text-[10px] text-gray-400 dark:text-slate-500 px-2 pt-0.5 tabular-nums">
                    +{group.files.length - 5} more file(s)
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
