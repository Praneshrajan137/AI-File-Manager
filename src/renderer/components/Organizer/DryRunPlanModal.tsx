import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderKanban, RefreshCw, ShieldCheck, X, AlertTriangle, ArrowRight, Link2 } from 'lucide-react';
import {
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
} from '@shared/contracts';
import { getErrorMessage } from '@renderer/utils/formatters';

interface DryRunPlanModalProps {
  isOpen: boolean;
  targetDir: string;
  initialStrategy?: OrganizeStrategy;
  initialPlan?: OrganizePlanResult | null;
  onClose: () => void;
  onApplied: (result: OrganizeApplyResult) => Promise<void> | void;
}

const STRATEGY_LABELS: Array<{ value: OrganizeStrategy; label: string }> = [
  { value: 'auto', label: 'Auto (Smart + Extensions)' },
  { value: 'smart_category', label: 'Smart Categories' },
  { value: 'by_type', label: 'By File Type' },
  { value: 'by_date', label: 'By Month (YYYY-MM)' },
  { value: 'semantic_cluster', label: 'Semantic Content Clusters' },
  { value: 'deduplicate', label: 'Remove Redundant Duplicates' },
  { value: 'ai_suggested', label: 'Local AI Suggested' },
];

export const DryRunPlanModal: React.FC<DryRunPlanModalProps> = ({
  isOpen,
  targetDir,
  initialStrategy = 'auto',
  initialPlan = null,
  onClose,
  onApplied,
}) => {
  const [strategy, setStrategy] = useState<OrganizeStrategy>(initialStrategy);
  const [useLLM, setUseLLM] = useState<boolean>(false);
  const [recursive, setRecursive] = useState<boolean>(false);
  const [repairMarkdownLinks, setRepairMarkdownLinks] = useState<boolean>(true);
  const [plan, setPlan] = useState<OrganizePlanResult | null>(initialPlan);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loadingPlan, setLoadingPlan] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const consumedInitialPlanRef = useRef<string | null>(null);
  const planSeqRef = useRef<number>(0);

  const loadPlan = useCallback(
    async (
      nextStrategy: OrganizeStrategy,
      nextUseLLM: boolean,
      nextRecursive: boolean
    ): Promise<void> => {
      if (!targetDir || !window.electronAPI?.ai?.planOrganize) return;
      const seq = ++planSeqRef.current;
      setLoadingPlan(true);
      setErrorMessage(null);
      setPlan(null);
      setCheckedIds(new Set());
      try {
        const result = await window.electronAPI.ai.planOrganize(
          targetDir,
          nextStrategy,
          nextUseLLM,
          nextRecursive
        );
        if (seq !== planSeqRef.current) return;
        setPlan(result);
        setCheckedIds(new Set(result.operations.map((op) => op.id)));
      } catch (err: unknown) {
        if (seq !== planSeqRef.current) return;
        setPlan(null);
        setErrorMessage(getErrorMessage(err, 'Failed to compute organization dry-run plan'));
      } finally {
        if (seq === planSeqRef.current) {
          setLoadingPlan(false);
        }
      }
    },
    [targetDir]
  );

  useEffect(() => {
    if (!isOpen) {
      consumedInitialPlanRef.current = null;
      ++planSeqRef.current;
      return;
    }
    if (initialPlan && consumedInitialPlanRef.current !== initialPlan.planId) {
      consumedInitialPlanRef.current = initialPlan.planId;
      ++planSeqRef.current;
      setStrategy(initialPlan.strategy);
      setUseLLM(initialPlan.usedLLM);
      setPlan(initialPlan);
      setCheckedIds(new Set(initialPlan.operations.map((op) => op.id)));
      setLoadingPlan(false);
      return;
    }
    if (!targetDir || (initialPlan && consumedInitialPlanRef.current === initialPlan.planId)) {
      return;
    }
    const nextUseLLM = initialStrategy === 'ai_suggested';
    setStrategy(initialStrategy);
    setUseLLM(nextUseLLM);
    setRecursive(false);
    void loadPlan(initialStrategy, nextUseLLM, false);
  }, [isOpen, targetDir, initialStrategy, initialPlan, loadPlan]);

  const selectedOperations = useMemo<OrganizePlanOperation[]>(() => {
    if (!plan) return [];
    return plan.operations.filter((op) => checkedIds.has(op.id));
  }, [plan, checkedIds]);

  const toggleOperation = (id: string): void => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleApply = async (): Promise<void> => {
    if (!plan || selectedOperations.length === 0 || !window.electronAPI?.ai?.applyOrganize) {
      return;
    }
    setApplying(true);
    setErrorMessage(null);
    try {
      const res = await window.electronAPI.ai.applyOrganize({
        planId: plan.planId,
        targetDir: plan.targetDir,
        operations: selectedOperations,
        repairMarkdownLinks,
      });
      await onApplied(res);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to apply organization plan'));
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI Organize Dry-Run Preview"
      data-testid="dry-run-plan-modal"
    >
      <div className="w-full max-w-4xl max-h-[88vh] bg-white dark:bg-slate-900 border border-primary-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-primary-200 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderKanban className="w-5 h-5 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">AI Organize — Dry-Run Preview</h2>
              <p className="text-xs opacity-85 font-mono truncate" title={targetDir}>
                {targetDir}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Organize Preview"
            data-testid="plan-close-button"
            className="p-1.5 rounded-lg hover:bg-white/15 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-primary-100 dark:border-slate-800 bg-primary-50/50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-medium text-primary-700 dark:text-slate-300 flex items-center gap-2">
              <span>Strategy:</span>
              <select
                value={strategy}
                onChange={(e): void => {
                  const next = e.target.value as OrganizeStrategy;
                  const nextUseLLM = next === 'ai_suggested' ? true : useLLM;
                  setStrategy(next);
                  if (next === 'ai_suggested') {
                    setUseLLM(true);
                  }
                  void loadPlan(next, nextUseLLM, recursive);
                }}
                disabled={loadingPlan || applying}
                data-testid="plan-strategy-select"
                className="px-2.5 py-1 rounded border border-primary-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-primary-900 dark:text-slate-100"
              >
                {STRATEGY_LABELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-primary-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={useLLM}
                onChange={(e): void => {
                  const nextUseLLM = e.target.checked;
                  setUseLLM(nextUseLLM);
                  void loadPlan(strategy, nextUseLLM, recursive);
                }}
                disabled={loadingPlan || applying}
                data-testid="plan-use-llm-checkbox"
                className="rounded border-primary-300 dark:border-slate-600"
              />
              <span>Ask Ollama</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-primary-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e): void => {
                  const nextRecursive = e.target.checked;
                  setRecursive(nextRecursive);
                  void loadPlan(strategy, useLLM, nextRecursive);
                }}
                disabled={loadingPlan || applying}
                data-testid="plan-recursive-checkbox"
                className="rounded border-primary-300 dark:border-slate-600"
              />
              <span>Recursive</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-primary-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={repairMarkdownLinks}
                onChange={(e): void => setRepairMarkdownLinks(e.target.checked)}
                disabled={loadingPlan || applying}
                data-testid="plan-repair-links-checkbox"
                className="rounded border-primary-300 dark:border-slate-600"
              />
              <span>Repair Markdown Links</span>
            </label>
          </div>

          <button
            type="button"
            onClick={(): void => {
              void loadPlan(strategy, useLLM, recursive);
            }}
            disabled={loadingPlan || applying}
            data-testid="plan-refresh-button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-primary-200 dark:border-slate-700 text-xs font-medium text-primary-700 dark:text-slate-200 hover:bg-primary-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPlan ? 'animate-spin' : ''}`} />
            <span>Recompute Plan</span>
          </button>
        </div>

        {plan?.linkImpact && plan.linkImpact.totalAffectedFiles > 0 && (
          <div
            data-testid="plan-link-impact-banner"
            className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2"
          >
            <span className="inline-flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                {plan.linkImpact.totalAffectedFiles} referencing file(s) found ({plan.linkImpact.markdownRepairableCount} repairable Markdown link(s) will update atomically)
              </span>
            </span>
          </div>
        )}

        {/* Summary & Error Banner */}
        {errorMessage && (
          <div
            data-testid="plan-error"
            className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Operations List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loadingPlan ? (
            <div className="py-10 text-center text-sm text-primary-500 dark:text-slate-400">
              Computing SHA-256 hashes &amp; destination plan...
            </div>
          ) : !plan || plan.operations.length === 0 ? (
            <div
              data-testid="plan-empty-state"
              className="py-10 text-center text-sm text-primary-500 dark:text-slate-400"
            >
              {plan?.summary || 'No files eligible for reorganization in this directory.'}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-primary-600 dark:text-slate-400 pb-1">
                <span data-testid="plan-summary">{plan.summary}</span>
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>SHA-256 verified before apply • 1-Click Batch Undo</span>
                </span>
              </div>

              {plan.operations.map((op) => {
                const checked = checkedIds.has(op.id);
                return (
                  <label
                    key={op.id}
                    data-testid="plan-op-row"
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      checked
                        ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/25'
                        : 'border-primary-200 dark:border-slate-800 bg-white dark:bg-slate-900 opacity-65'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(): void => toggleOperation(op.id)}
                      disabled={applying}
                      className="mt-1 rounded border-primary-300 dark:border-slate-600"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200">
                          {op.category}
                        </span>
                        <span className="text-[11px] font-mono text-primary-500 dark:text-slate-400">
                          sha256:{op.sourceSha256.slice(0, 8)}
                        </span>
                        <span className="text-[11px] text-primary-600 dark:text-slate-400">
                          {op.reason}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-primary-800 dark:text-slate-200 flex flex-wrap items-center gap-1.5 break-all">
                        <span data-testid="plan-op-source">{op.sourcePath}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                        <span
                          data-testid="plan-op-destination"
                          className="text-indigo-700 dark:text-indigo-300 font-semibold"
                        >
                          {op.destinationPath}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-primary-200 dark:border-slate-800 bg-primary-50/40 dark:bg-slate-950/60 flex items-center justify-between gap-3">
          <span className="text-xs text-primary-500 dark:text-slate-400">
            Selected: {selectedOperations.length} / {plan?.operations.length ?? 0} moves
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              data-testid="plan-cancel-button"
              className="px-3.5 py-1.5 rounded-lg border border-primary-300 dark:border-slate-700 text-xs font-medium text-primary-700 dark:text-slate-300 hover:bg-primary-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(): void => {
                void handleApply();
              }}
              disabled={loadingPlan || applying || selectedOperations.length === 0}
              data-testid="plan-apply-button"
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applying
                ? 'Applying Batch...'
                : `Apply ${selectedOperations.length} Move${selectedOperations.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
