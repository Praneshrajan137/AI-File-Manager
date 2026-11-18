import React, { useId } from 'react';
import { FolderPlus, ShieldCheck, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { LLMModelsSnapshot, VaultConfigSnapshot } from '@shared/contracts';
import { ModalShell } from '@renderer/components/common/ModalShell';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
  vaultConfig: VaultConfigSnapshot | null;
  modelsSnapshot: LLMModelsSnapshot | null;
  onAddVaultRoot: () => Promise<void>;
  onIndexRoot: (rootPath: string) => Promise<void>;
  onOpenSettings: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onComplete,
  vaultConfig,
  modelsSnapshot,
  onAddVaultRoot,
  onIndexRoot,
  onOpenSettings,
}) => {
  const headingId = useId();
  const primaryRoot = vaultConfig?.allowedRoots?.[0] ?? '';

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onComplete}
      ariaLabelledBy={headingId}
      dataTestId="onboarding-modal"
      panelClassName="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 dark:border-slate-700"
    >
      <div className="px-6 py-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-medium text-indigo-200">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Zero-Cloud · Local First</span>
          </div>
          <h2 id={headingId} className="text-lg font-semibold tracking-tight">
            Welcome to PrivateVault AI
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Explore, edit, search, and safely organize local files with reversible Trash Vault undo,
            SecretGuard redaction, and optional local AI.
          </p>
        </div>
        <button
          type="button"
          onClick={onComplete}
          data-testid="onboarding-close"
          aria-label="Skip welcome setup"
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-6 space-y-4 bg-white dark:bg-slate-900 text-xs">
        {/* Step 1: Workspace Folder */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              1. Pick a Focused Workspace Folder
            </span>
            <button
              type="button"
              onClick={(): void => {
                void onAddVaultRoot();
              }}
              data-testid="onboarding-add-root-button"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-medium"
            >
              <FolderPlus className="w-3.5 h-3.5 text-accent-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Add Folder</span>
            </button>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            Active Vaults:{' '}
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {(vaultConfig?.allowedRoots ?? []).join(', ') || 'Home directory'}
            </span>
          </p>
        </div>

        {/* Step 2: Privacy & Local AI Choice */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              2. Local Search &amp; AI Runtime
            </span>
            <button
              type="button"
              onClick={(): void => {
                onComplete();
                onOpenSettings();
              }}
              data-testid="onboarding-open-settings-button"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-medium"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Configure Ollama / ONNX</span>
            </button>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            Local LLM:{' '}
            <strong>{modelsSnapshot?.available ? `Online (${modelsSnapshot.activeModel})` : 'Offline (Extractive Search Mode)'}</strong>
            {' · '}ONNX Embeddings:{' '}
            <strong>{modelsSnapshot?.embeddingCached ? 'Cached on disk' : 'Not yet downloaded (~45 MB optional)'}</strong>
          </p>
          {primaryRoot && (
            <button
              type="button"
              onClick={(): void => {
                void onIndexRoot(primaryRoot);
                onComplete();
              }}
              data-testid="onboarding-index-now-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-accent-700 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-medium"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Index &amp; Explore Active Folder Now</span>
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onComplete}
          data-testid="onboarding-complete-button"
          className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-xs font-semibold shadow-sm"
        >
          Start Using PrivateVault
        </button>
      </div>
    </ModalShell>
  );
};
