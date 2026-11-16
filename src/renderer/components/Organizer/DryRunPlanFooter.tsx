import React from 'react';

interface DryRunPlanFooterProps {
  selectedCount: number;
  totalCount: number;
  loadingPlan: boolean;
  applying: boolean;
  onClose: () => void;
  onApply: () => void;
}

/** Action footer bar for DryRunPlanModal displaying selection count, Cancel, and Apply moves button. */
export const DryRunPlanFooter: React.FC<DryRunPlanFooterProps> = ({
  selectedCount,
  totalCount,
  loadingPlan,
  applying,
  onClose,
  onApply,
}) => (
  <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-3">
    <span className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
      Selected: {selectedCount} / {totalCount} moves
    </span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={applying}
        data-testid="plan-cancel-button"
        className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onApply}
        disabled={loadingPlan || applying || selectedCount === 0}
        data-testid="plan-apply-button"
        className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {applying ? 'Applying Batch...' : `Apply ${selectedCount} Move${selectedCount === 1 ? '' : 's'}`}
      </button>
    </div>
  </div>
);
