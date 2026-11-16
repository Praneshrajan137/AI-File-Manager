import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FolderKanban, ShieldCheck, X, AlertTriangle, Link2 } from 'lucide-react';
import {
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
} from '@shared/contracts';
import { ModalShell } from '@renderer/components/common/ModalShell';
import { getErrorMessage } from '@renderer/utils/formatters';
import { DryRunOperationRow } from './DryRunOperationRow';
import { DryRunPlanControls } from './DryRunPlanControls';
import { DryRunPlanFooter } from './DryRunPlanFooter';

interface DryRunPlanModalProps {
  isOpen: boolean;
  targetDir: string;
  initialStrategy?: OrganizeStrategy;
  initialPlan?: OrganizePlanResult | null;
  onClose: () => void;
  onApplied: (result: OrganizeApplyResult) => Promise<void> | void;
}

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
  const headingId = useId();
  const strategySelectRef = useRef<HTMLSelectElement>(null);
  const consumedInitialPlanRef = useRef<string | null>(null);
  const planSeqRef = useRef<number>(0);

  const loadPlan = useCallback(
    async (nextStrategy: OrganizeStrategy, nextUseLLM: boolean, nextRecursive: boolean): Promise<void> => {
      if (!targetDir || !window.electronAPI?.ai?.planOrganize) return;
      const seq = ++planSeqRef.current;
      setLoadingPlan(true);
      setErrorMessage(null);
      setPlan(null);
      setCheckedIds(new Set());
      try {
        const result = await window.electronAPI.ai.planOrganize(targetDir, nextStrategy, nextUseLLM, nextRecursive);
        if (seq !== planSeqRef.current) return;
        setPlan(result);
        setCheckedIds(new Set(result.operations.map((op) => op.id)));
      } catch (err: unknown) {
        if (seq !== planSeqRef.current) return;
        setPlan(null);
        setErrorMessage(getErrorMessage(err, 'Failed to compute organization dry-run plan'));
      } finally {
        if (seq === planSeqRef.current) setLoadingPlan(false);
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
    if (!targetDir || (initialPlan && consumedInitialPlanRef.current === initialPlan.planId)) return;
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async (): Promise<void> => {
    if (!plan || selectedOperations.length === 0 || !window.electronAPI?.ai?.applyOrganize) return;
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
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={headingId}
      dataTestId="dry-run-plan-modal"
      initialFocusRef={strategySelectRef}
      backdropClassName="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-center justify-center p-4"
      panelClassName="w-full max-w-4xl max-h-[88vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-accent-600 to-accent-700 text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <FolderKanban className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold">AI Organize — Dry-Run Preview</h2>
            <p className="text-xs text-white/95 font-mono truncate" title={targetDir}>{targetDir}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Organize Preview"
          data-testid="plan-close-button"
          className="p-2 rounded-lg hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <DryRunPlanControls
        strategy={strategy}
        useLLM={useLLM}
        recursive={recursive}
        repairMarkdownLinks={repairMarkdownLinks}
        disabled={loadingPlan || applying}
        loadingPlan={loadingPlan}
        strategySelectRef={strategySelectRef}
        onStrategyChange={(next): void => {
          const nextUseLLM = next === 'ai_suggested' ? true : useLLM;
          setStrategy(next);
          if (next === 'ai_suggested') setUseLLM(true);
          void loadPlan(next, nextUseLLM, recursive);
        }}
        onUseLlmChange={(nextUseLLM): void => {
          setUseLLM(nextUseLLM);
          void loadPlan(strategy, nextUseLLM, recursive);
        }}
        onRecursiveChange={(nextRecursive): void => {
          setRecursive(nextRecursive);
          void loadPlan(strategy, useLLM, nextRecursive);
        }}
        onRepairLinksChange={setRepairMarkdownLinks}
        onRecompute={(): void => {
          void loadPlan(strategy, useLLM, recursive);
        }}
      />

      {plan?.linkImpact && plan.linkImpact.totalAffectedFiles > 0 && (
        <div
          data-testid="plan-link-impact-banner"
          className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5"
        >
          <Link2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span>
            {plan.linkImpact.totalAffectedFiles} referencing file(s) found ({plan.linkImpact.markdownRepairableCount} repairable Markdown link(s) will update atomically)
          </span>
        </div>
      )}

      {plan?.degradedReason && (
        <div
          data-testid="plan-degraded-banner"
          className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2"
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{plan.degradedReason}</span>
        </div>
      )}

      {errorMessage && (
        <div
          data-testid="plan-error"
          role="alert"
          className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div
        role="region"
        aria-label="Planned file operations"
        tabIndex={0}
        className="flex-1 overflow-y-auto px-5 py-3 space-y-2 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset"
      >
        {loadingPlan ? (
          <div className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            Computing SHA-256 hashes &amp; destination plan...
          </div>
        ) : !plan || plan.operations.length === 0 ? (
          <div data-testid="plan-empty-state" className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            {plan?.summary || 'No files eligible for reorganization in this directory.'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 pb-1">
              <span data-testid="plan-summary">{plan.summary}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={(): void => setCheckedIds(new Set(plan.operations.map((op) => op.id)))}
                  disabled={applying}
                  className="underline hover:text-accent-600 dark:hover:text-indigo-300 font-medium"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={(): void => setCheckedIds(new Set())}
                  disabled={applying}
                  className="underline hover:text-accent-600 dark:hover:text-indigo-300 font-medium"
                >
                  Select none
                </button>
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>SHA-256 verified · Undoable</span>
                </span>
              </div>
            </div>

            {plan.operations.map((op) => (
              <DryRunOperationRow
                key={op.id}
                op={op}
                checked={checkedIds.has(op.id)}
                disabled={applying}
                onToggle={toggleOperation}
              />
            ))}
          </>
        )}
      </div>

      <DryRunPlanFooter
        selectedCount={selectedOperations.length}
        totalCount={plan?.operations.length ?? 0}
        loadingPlan={loadingPlan}
        applying={applying}
        onClose={onClose}
        onApply={(): void => {
          void handleApply();
        }}
      />
    </ModalShell>
  );
};
