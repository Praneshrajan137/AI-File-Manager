import React, { useCallback, useEffect, useId, useState } from 'react';
import { File, Folder, RotateCcw, Trash2, X } from 'lucide-react';
import type { TrashVaultEntry } from '@shared/contracts';
import { ModalShell } from '@renderer/components/common/ModalShell';
import { formatFileSize } from '@renderer/utils/formatters';

interface TrashVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoredOrPurged: () => Promise<void>;
  onEmptyAll: () => Promise<void>;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) => void;
}

export const TrashVaultModal: React.FC<TrashVaultModalProps> = ({
  isOpen,
  onClose,
  onRestoredOrPurged,
  onEmptyAll,
  showToast,
}) => {
  const headingId = useId();
  const [items, setItems] = useState<TrashVaultEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI?.fs?.listTrashVault !== 'function') {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await window.electronAPI.fs.listTrashVault();
      setItems(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Trash Vault items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadItems();
    }
  }, [isOpen, loadItems]);

  const handleRestore = async (entry: TrashVaultEntry): Promise<void> => {
    if (typeof window.electronAPI?.fs?.restoreTrashItem !== 'function') return;
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await window.electronAPI.fs.restoreTrashItem(entry.id);
      if (res.success) {
        showToast({ type: 'success', message: `Restored "${entry.name}"` });
        await loadItems();
        await onRestoredOrPurged();
      } else {
        showToast({ type: 'warning', message: `"${entry.name}" is no longer staged in Vault` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Failed restoring "${entry.name}"`;
      setError(msg);
      showToast({ type: 'error', message: msg });
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (entry: TrashVaultEntry): Promise<void> => {
    if (typeof window.electronAPI?.fs?.purgeTrashItem !== 'function') return;
    setBusyId(entry.id);
    setError(null);
    try {
      await window.electronAPI.fs.purgeTrashItem(entry.id);
      showToast({ type: 'info', message: `Permanently removed "${entry.name}"` });
      await loadItems();
      await onRestoredOrPurged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Failed removing "${entry.name}"`;
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={headingId}
      dataTestId="trash-vault-modal"
      panelClassName="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[84vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700"
    >
      <div className="px-5 py-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <Trash2 className="w-5 h-5 text-amber-400" aria-hidden="true" />
          <div>
            <h2 id={headingId} className="text-base font-semibold">
              Trash Vault Recovery
            </h2>
            <p className="text-xs text-slate-300">
              Restore individually deleted files/folders to their original location or purge permanently
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="trash-modal-close"
          aria-label="Close Trash Vault modal"
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950 scrollbar-thin">
        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-200"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-xs text-slate-600 dark:text-slate-300">
            Loading Trash Vault payloads...
          </div>
        ) : items.length === 0 ? (
          <div
            data-testid="trash-vault-empty-state"
            className="py-12 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6"
          >
            <Trash2 className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Trash Vault is empty
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Soft-deleted items appear here for 30 days (up to 512 MB) before automatic eviction.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const busy = busyId === item.id;
              return (
                <div
                  key={item.id}
                  data-testid={`trash-vault-row-${item.name}`}
                  className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {item.isDirectory ? (
                      <Folder className="w-4 h-4 text-accent-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <File className="w-4 h-4 text-slate-600 dark:text-slate-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {item.name}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          {formatFileSize(item.size)}
                        </span>
                      </div>
                      <p
                        className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate"
                        title={item.originalPath}
                      >
                        {item.originalPath}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        Deleted {new Date(item.deletedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(): void => {
                        void handleRestore(item);
                      }}
                      data-testid={`trash-restore-${item.name}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 text-xs font-medium disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Restore</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(): void => {
                        void handlePurge(item);
                      }}
                      data-testid={`trash-purge-${item.name}`}
                      aria-label={`Delete ${item.name} permanently`}
                      className="px-2 py-1 rounded border border-red-200 dark:border-red-900 text-error-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/70 text-xs font-medium disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="px-5 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
            {items.length} recoverable item(s)
          </span>
          <button
            type="button"
            onClick={(): void => {
              void onEmptyAll().then(() => loadItems());
            }}
            data-testid="trash-modal-empty-all"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Empty Entire Vault</span>
          </button>
        </div>
      )}
    </ModalShell>
  );
};
