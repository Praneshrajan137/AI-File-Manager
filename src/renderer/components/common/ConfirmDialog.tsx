import React, { useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ModalShell } from './ModalShell';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  dataTestId?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Accessible non-blocking confirmation dialog replacing native window.confirm prompts.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  dataTestId = 'confirm-dialog',
  onConfirm,
  onCancel,
}) => {
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      role="alertdialog"
      ariaLabelledBy={headingId}
      dataTestId={dataTestId}
      initialFocusRef={destructive ? cancelRef : undefined}
      panelClassName="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-6 w-[420px] max-w-[92vw]"
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded-lg flex-shrink-0 ${
            destructive
              ? 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300'
              : 'bg-accent-100 dark:bg-accent-950/70 text-accent-700 dark:text-accent-300'
          }`}
        >
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{description}</p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={busy}
          data-testid={`${dataTestId}-cancel`}
          className="px-4 py-2 min-h-[36px] text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={(): void => {
            void onConfirm();
          }}
          disabled={busy}
          data-testid={`${dataTestId}-confirm`}
          className={`px-4 py-2 min-h-[36px] text-sm font-medium rounded-lg text-white disabled:opacity-50 ${
            destructive
              ? 'bg-error-700 hover:bg-error-600'
              : 'bg-accent-600 hover:bg-accent-700'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
};
