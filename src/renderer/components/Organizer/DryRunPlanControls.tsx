import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { OrganizeStrategy } from '@shared/contracts';

export const STRATEGY_LABELS: Array<{ value: OrganizeStrategy; label: string }> = [
  { value: 'auto', label: 'Auto (Smart + Extensions)' },
  { value: 'smart_category', label: 'Smart Categories' },
  { value: 'by_type', label: 'By File Type' },
  { value: 'by_date', label: 'By Month (YYYY-MM)' },
  { value: 'semantic_cluster', label: 'Semantic Content Clusters' },
  { value: 'deduplicate', label: 'Remove Redundant Duplicates' },
  { value: 'ai_suggested', label: 'Local AI Suggested' },
];

interface DryRunPlanControlsProps {
  strategy: OrganizeStrategy;
  useLLM: boolean;
  recursive: boolean;
  repairMarkdownLinks: boolean;
  disabled: boolean;
  loadingPlan: boolean;
  strategySelectRef: React.RefObject<HTMLSelectElement>;
  onStrategyChange: (strategy: OrganizeStrategy) => void;
  onUseLlmChange: (next: boolean) => void;
  onRecursiveChange: (next: boolean) => void;
  onRepairLinksChange: (next: boolean) => void;
  onRecompute: () => void;
}

/** Strategy selector, recursive/LLM/link-repair toggles, and recompute trigger for DryRunPlanModal. */
export const DryRunPlanControls: React.FC<DryRunPlanControlsProps> = ({
  strategy,
  useLLM,
  recursive,
  repairMarkdownLinks,
  disabled,
  loadingPlan,
  strategySelectRef,
  onStrategyChange,
  onUseLlmChange,
  onRecursiveChange,
  onRepairLinksChange,
  onRecompute,
}) => (
  <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3 flex-wrap">
      <label className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2">
        <span>Strategy:</span>
        <select
          ref={strategySelectRef}
          value={strategy}
          onChange={(e): void => onStrategyChange(e.target.value as OrganizeStrategy)}
          disabled={disabled}
          data-testid="plan-strategy-select"
          className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          {STRATEGY_LABELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
        <input
          type="checkbox"
          checked={useLLM}
          onChange={(e): void => onUseLlmChange(e.target.checked)}
          disabled={disabled}
          data-testid="plan-use-llm-checkbox"
          className="rounded border-slate-300 dark:border-slate-600 text-accent-600"
        />
        <span>Ask Ollama</span>
      </label>

      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
        <input
          type="checkbox"
          checked={recursive}
          onChange={(e): void => onRecursiveChange(e.target.checked)}
          disabled={disabled}
          data-testid="plan-recursive-checkbox"
          className="rounded border-slate-300 dark:border-slate-600 text-accent-600"
        />
        <span>Recursive</span>
      </label>

      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
        <input
          type="checkbox"
          checked={repairMarkdownLinks}
          onChange={(e): void => onRepairLinksChange(e.target.checked)}
          disabled={disabled}
          data-testid="plan-repair-links-checkbox"
          className="rounded border-slate-300 dark:border-slate-600 text-accent-600"
        />
        <span>Repair Markdown Links</span>
      </label>
    </div>

    <button
      type="button"
      onClick={onRecompute}
      disabled={disabled}
      data-testid="plan-refresh-button"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${loadingPlan ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>Recompute Plan</span>
    </button>
  </div>
);
