import React, { useState } from 'react';
import { FolderLock, FolderPlus, Sparkles, Trash2, X } from 'lucide-react';
import { OperationJournalState, VaultConfigSnapshot } from '@shared/contracts';
import { formatFileSize } from '@renderer/utils/formatters';

interface VaultSectionProps {
  vaultConfig: VaultConfigSnapshot | null;
  journalState: OperationJournalState | null;
  onNavigate: (path: string) => void;
  onAddRoot: () => Promise<void>;
  onRemoveRoot: (rootPath: string) => Promise<void>;
  onToggleIndexed: (rootPath: string, enabled: boolean) => Promise<void>;
  onEmptyTrashVault: () => Promise<void>;
}

function normalizePathKey(target: string): string {
  return target.replace(/[\\/]+$/, '').toLowerCase();
}

export const VaultSection: React.FC<VaultSectionProps> = ({
  vaultConfig,
  journalState,
  onNavigate,
  onAddRoot,
  onRemoveRoot,
  onToggleIndexed,
  onEmptyTrashVault,
}) => {
  const [busy, setBusy] = useState(false);

  if (!vaultConfig) {
    return null;
  }

  const indexedKeys = new Set(vaultConfig.indexedRoots.map(normalizePathKey));

  const runAction = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 px-3" data-testid="vault-section">
      <div className="flex items-center justify-between px-2 mb-2">
        <div className="flex items-center gap-1.5">
          <FolderLock className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
          <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Workspace Vaults
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void runAction(onAddRoot)}
          disabled={busy}
          data-testid="vault-add-root-button"
          title="Add Workspace Folder"
          aria-label="Add Workspace Folder"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Add</span>
        </button>
      </div>

      <div className="space-y-1">
        {vaultConfig.allowedRoots.map((rootPath) => {
          const baseName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
          const isIndexed = indexedKeys.has(normalizePathKey(rootPath));

          return (
            <div
              key={rootPath}
              data-testid={`vault-root-${baseName}`}
              className="group flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <button
                type="button"
                onClick={() => onNavigate(rootPath)}
                title={rootPath}
                className="flex-1 min-w-0 text-left truncate font-medium text-slate-700 dark:text-slate-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                {baseName}
              </button>

              <button
                type="button"
                onClick={() => void runAction(() => onToggleIndexed(rootPath, !isIndexed))}
                disabled={busy}
                title={
                  isIndexed
                    ? 'AI Semantic Indexing enabled (click to opt out)'
                    : 'Click to opt into AI Semantic Indexing'
                }
                aria-label={isIndexed ? `Disable AI index for ${baseName}` : `Enable AI index for ${baseName}`}
                aria-pressed={isIndexed}
                data-testid={`vault-index-toggle-${baseName}`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  isIndexed
                    ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-200 hover:bg-indigo-200 dark:hover:bg-indigo-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-700 dark:hover:text-indigo-200'
                }`}
              >
                <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
                <span>{isIndexed ? 'AI On' : 'AI Off'}</span>
              </button>

              {vaultConfig.allowedRoots.length > 1 && (
                <button
                  type="button"
                  onClick={() => void runAction(() => onRemoveRoot(rootPath))}
                  disabled={busy}
                  title={`Remove ${baseName} from Vaults`}
                  aria-label={`Remove ${baseName}`}
                  data-testid={`vault-remove-root-${baseName}`}
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 p-1 min-w-[24px] min-h-[24px] inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-error-700 dark:hover:text-red-300 rounded transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {journalState && journalState.vaultItemCount > 0 && (
        <div
          className="mt-2 px-2 py-1.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-lg flex items-center justify-between text-[11px] text-amber-900 dark:text-amber-200"
          data-testid="trash-vault-summary"
        >
          <span className="truncate">
            Vault: {journalState.vaultItemCount} ({formatFileSize(journalState.vaultTotalBytes)})
          </span>
          <button
            type="button"
            onClick={() => void runAction(onEmptyTrashVault)}
            disabled={busy}
            data-testid="empty-trash-vault-button"
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/70 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100 rounded font-medium flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            <span>Empty</span>
          </button>
        </div>
      )}
    </div>
  );
};
