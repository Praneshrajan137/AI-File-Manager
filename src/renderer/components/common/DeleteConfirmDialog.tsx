import React, { useEffect, useState } from 'react';
import { Trash2, Archive, AlertTriangle, Link2 } from 'lucide-react';
import { FileDeleteMode, GraphImpactCheckResult } from '@shared/contracts';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  targetPaths: string[];
  defaultMode?: 'vault' | 'trash';
  onConfirm: (mode: FileDeleteMode) => void;
  onCancel: () => void;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  isOpen,
  targetPaths,
  defaultMode = 'vault',
  onConfirm,
  onCancel,
}) => {
  const [mode, setMode] = useState<FileDeleteMode>(defaultMode);
  const [impact, setImpact] = useState<GraphImpactCheckResult | null>(null);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && mode !== 'permanent') {
        e.preventDefault();
        onConfirm(mode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mode, onConfirm, onCancel]);

  if (!isOpen || targetPaths.length === 0) {
    return null;
  }

  const firstName = targetPaths[0].split(/[\\/]/).pop() || targetPaths[0];
  const label =
    targetPaths.length === 1
      ? `"${firstName}"`
      : `${targetPaths.length} selected items`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
      data-testid="delete-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm Delete"
    >
      <div
        className="bg-white rounded-xl shadow-2xl p-6 w-[430px] max-w-[92vw] border border-gray-200"
        onClick={(e): void => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Delete {label}?
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Choose how to remove {targetPaths.length === 1 ? 'this item' : 'these items'}.
        </p>

        {impact && impact.totalAffectedFiles > 0 && (
          <div
            data-testid="delete-impact-warning"
            className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1"
          >
            <div className="font-semibold flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <span>
                Link Impact Warning: {impact.totalAffectedFiles} indexed file(s) reference this target
              </span>
            </div>
            <div className="text-[11px] text-amber-800 truncate">
              Examples:{' '}
              {impact.references
                .slice(0, 3)
                .map((r) => `${r.sourcePath.split(/[\\/]/).pop() ?? r.sourcePath}:L${r.lineNumber}`)
                .join(', ')}
            </div>
          </div>
        )}

        <div className="space-y-2 mb-5">
          <button
            type="button"
            onClick={() => setMode('vault')}
            data-testid="delete-mode-vault"
            className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
              mode === 'vault'
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Archive className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-gray-900">
                Move to Trash Vault (Undoable)
              </div>
              <div className="text-xs text-gray-500">
                Reversible immediately with Ctrl+Z or the Undo button.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode('trash')}
            data-testid="delete-mode-trash"
            className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
              mode === 'trash'
                ? 'border-amber-500 bg-amber-50'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Trash2 className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-gray-900">
                Send to OS Recycle Bin / Trash
              </div>
              <div className="text-xs text-gray-500">
                Hands the item to the operating system trash folder.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode('permanent')}
            data-testid="delete-mode-permanent"
            className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
              mode === 'permanent'
                ? 'border-error-500 bg-red-50'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <AlertTriangle className="w-5 h-5 text-error-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-error-700">
                Permanent Delete (Irreversible)
              </div>
              <div className="text-xs text-gray-500">
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
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(mode)}
            data-testid="delete-confirm-button"
            className={`px-4 py-2 text-sm text-white font-medium rounded-lg transition-colors ${
              mode === 'permanent'
                ? 'bg-error-600 hover:bg-error-700'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {mode === 'vault'
              ? 'Move to Vault'
              : mode === 'trash'
              ? 'Send to OS Trash'
              : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
};
