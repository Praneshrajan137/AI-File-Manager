import React from 'react';
import { ArrowRight } from 'lucide-react';
import { OrganizePlanOperation } from '@shared/contracts';

interface DryRunOperationRowProps {
  op: OrganizePlanOperation;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}

/**
 * Single selectable file-move row rendered inside the AI Organize dry-run preview modal.
 */
export const DryRunOperationRow: React.FC<DryRunOperationRowProps> = ({
  op,
  checked,
  disabled,
  onToggle,
}) => (
  <label
    data-testid="plan-op-row"
    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
      checked
        ? 'border-accent-200 dark:border-accent-800 bg-accent-50/60 dark:bg-accent-950/30'
        : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60'
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(): void => onToggle(op.id)}
      disabled={disabled}
      className="mt-1 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-accent-500"
    />
    <div className="flex-1 min-w-0 space-y-1">
      <div className="flex items-center flex-wrap gap-2">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-accent-100 dark:bg-accent-900 text-accent-800 dark:text-accent-200">
          {op.category}
        </span>
        {op.classificationSource && (
          <span
            data-testid="plan-op-source-badge"
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            {op.classificationSource}
            {op.confidence !== undefined ? ` · ${Math.round(op.confidence * 100)}%` : ''}
          </span>
        )}
        <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
          sha256:{op.sourceSha256.slice(0, 8)}
        </span>
        <span className="text-[11px] text-slate-600 dark:text-slate-300">{op.reason}</span>
      </div>
      <div className="text-xs font-mono text-slate-800 dark:text-slate-200 flex flex-wrap items-center gap-1.5 break-all">
        <span data-testid="plan-op-source">{op.sourcePath}</span>
        <ArrowRight className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400 flex-shrink-0" aria-hidden="true" />
        <span
          data-testid="plan-op-destination"
          className="text-accent-700 dark:text-accent-300 font-semibold"
        >
          {op.destinationPath}
        </span>
      </div>
    </div>
  </label>
);
