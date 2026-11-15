import React, { useEffect, useId, useRef, useState } from 'react';
import { Trash2, Archive, AlertTriangle, Link2 } from 'lucide-react';
import { FileDeleteMode, GraphImpactCheckResult } from '@shared/contracts';
import { ModalShell } from './ModalShell';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  targetPaths: string[];
  defaultMode?: 'vault' | 'trash';
  onConfirm: (mode: FileDeleteMode) => void;
  onCancel: () => void;
}

const DELETE_MODES: FileDeleteMode[] = ['vault', 'trash', 'permanent'];

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  isOpen,
  targetPaths,
  defaultMode = 'vault',
  onConfirm,
  onCancel,
}) => {
  const [mode, setMode] = useState<FileDeleteMode>(defaultMode);
  const [impact, setImpact] = useState<GraphImpactCheckResult | null>(null);
  const headingId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setImpact(null);
      return;
    }
    setMode(defaultMode);

    const checkImpact = window.electronAPI?.graph?.checkImpact;
    if (typeof checkImpact !== 'function' || targetPaths.length === 0) {
      return;
    }

    let cancelled = false;
    void checkImpact(targetPaths)
      .then((res) => {
        if (!cancelled) {
          setImpact(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImpact(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, defaultMode, targetPaths]);

  if (targetPaths.length === 0) {
    return null;
  }

  const firstName = targetPaths[0].split(/[\\/]/).pop() || targetPaths[0];
  const label =
    targetPaths.length === 1
      ? `"${firstName}"`
      : `${targetPaths.length} selected items`;

  const handleRadioKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const idx = DELETE_MODES.indexOf(mode);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      setMode(DELETE_MODES[(idx + 1) % DELETE_MODES.length]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setMode(DELETE_MODES[(idx - 1 + DELETE_MODES.length) % DELETE_MODES.length]);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      role="alertdialog"
      ariaLabelledBy={headingId}
      dataTestId="delete-confirm-dialog"
      initialFocusRef={confirmButtonRef}
      panelClassName="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 w-[430px] max-w-[92vw] border border-slate-200 dark:border-slate-700"
    >
      <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
        Delete {label}?
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
        Choose how to remove {targetPaths.length === 1 ? 'this item' : 'these items'}.
      </p>

      {impact && impact.totalAffectedFiles > 0 && (
        <div
          data-testid="delete-impact-warning"
          className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1"
        >
          <div className="font-semibold flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
            <span>
              Link Impact Warning: {impact.totalAffectedFiles} indexed file(s) reference this target
            </span>
          </div>
          <div className="text-[11px] text-amber-800 dark:text-amber-300 truncate">
            Examples:{' '}
            {impact.references
              .slice(0, 3)
              .map((r) => `${r.sourcePath.split(/[\\/]/).pop() ?? r.sourcePath}:L${r.lineNumber}`)
              .join(', ')}
          </div>
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Delete method"
        onKeyDown={handleRadioKeyDown}
        className="space-y-2 mb-5"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'vault'}
          onClick={(): void => setMode('vault')}
          data-testid="delete-mode-vault"
          className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
            mode === 'vault'
              ? 'border-accent-500 bg-accent-50/70 dark:bg-accent-950/40'
              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
          }`}
        >
          <Archive className="w-5 h-5 text-accent-600 dark:text-accent-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Move to Trash Vault (Undoable)
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Reversible immediately with Ctrl+Z or the Undo button.
            </div>
          </div>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'trash'}
          onClick={(): void => setMode('trash')}
          data-testid="delete-mode-trash"
          className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
            mode === 'trash'
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40'
              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
          }`}
        >
          <Trash2 className="w-5 h-5 text-amber-700 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Send to OS Recycle Bin / Trash
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Hands the item to the operating system trash folder.
            </div>
          </div>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={mode === 'permanent'}
          onClick={(): void => setMode('permanent')}
          data-testid="delete-mode-permanent"
          className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
            mode === 'permanent'
              ? 'border-error-600 bg-red-50 dark:bg-red-950/40'
              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70'
          }`}
        >
          <AlertTriangle className="w-5 h-5 text-error-700 dark:text-red-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium text-error-700 dark:text-red-300">
              Permanent Delete (Irreversible)
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Bypass recovery vaults and unlink immediately from disk.
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          data-testid="delete-cancel-button"
          className="px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          ref={confirmButtonRef}
          type="button"
          onClick={(): void => onConfirm(mode)}
          data-testid="delete-confirm-button"
          className={`px-4 py-2 text-sm text-white font-medium rounded-lg transition-colors ${
            mode === 'permanent'
              ? 'bg-error-700 hover:bg-error-600'
              : 'bg-accent-600 hover:bg-accent-700'
          }`}
        >
          {mode === 'vault'
            ? 'Move to Vault'
            : mode === 'trash'
              ? 'Send to OS Trash'
              : 'Delete Permanently'}
        </button>
      </div>
    </ModalShell>
  );
};
