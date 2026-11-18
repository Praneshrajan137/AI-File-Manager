import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { LLMModelsSnapshot, VaultConfigSnapshot } from '@shared/contracts';
import { ModalShell } from '@renderer/components/common/ModalShell';
import { formatFileSize } from '@renderer/utils/formatters';

interface WorkspaceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vaultConfig: VaultConfigSnapshot | null;
  initialModelsSnapshot?: LLMModelsSnapshot | null;
  onModelsUpdated?: (snapshot: LLMModelsSnapshot) => void;
  onVaultConfigUpdated?: () => Promise<unknown>;
  onOpenOnboarding?: () => void;
  onToggleDeveloperBadges?: (enabled: boolean) => void;
  onChangeDeleteMode?: (mode: 'vault' | 'trash') => Promise<void>;
  showToast?: (toast: { type: 'success' | 'error' | 'warning' | 'info'; message: string }) => void;
}

export const WorkspaceSettingsModal: React.FC<WorkspaceSettingsModalProps> = ({
  isOpen,
  onClose,
  vaultConfig,
  initialModelsSnapshot = null,
  onModelsUpdated,
  onVaultConfigUpdated,
  onOpenOnboarding,
  onToggleDeveloperBadges,
  onChangeDeleteMode,
  showToast,
}) => {
  const headingId = useId();
  const [snapshot, setSnapshot] = useState<LLMModelsSnapshot | null>(initialModelsSnapshot);
  const [provider, setProvider] = useState<'ollama' | 'openai_compatible'>(
    initialModelsSnapshot?.provider ?? 'ollama'
  );
  const [ollamaUrl, setOllamaUrl] = useState<string>(
    initialModelsSnapshot?.ollamaUrl ?? 'http://localhost:11434'
  );
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState<string>(
    initialModelsSnapshot?.openAiBaseUrl ?? 'http://127.0.0.1:1234'
  );
  const [modelName, setModelName] = useState<string>(
    initialModelsSnapshot?.activeModel ?? 'llama3.2'
  );
  const [temperature, setTemperature] = useState<number>(
    initialModelsSnapshot?.temperature ?? 0.7
  );
  const [maxTokens, setMaxTokens] = useState<number>(
    initialModelsSnapshot?.maxTokens ?? 2048
  );
  const [embeddingDevice, setEmbeddingDevice] = useState<'auto' | 'cpu' | 'dml' | 'webgpu'>(
    initialModelsSnapshot?.embeddingDevice ?? 'auto'
  );
  const [allowRemoteModels, setAllowRemoteModels] = useState<boolean>(
    initialModelsSnapshot?.allowRemoteModels ?? true
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [downloadingModels, setDownloadingModels] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wasOpenRef = useRef<boolean>(false);
  const dirtyFieldsRef = useRef<boolean>(false);

  const hydrateFromSnapshot = useCallback(
    (next: LLMModelsSnapshot, forceFields: boolean = false): void => {
      setSnapshot(next);
      if (!forceFields && dirtyFieldsRef.current) {
        return;
      }
      setProvider(next.provider ?? 'ollama');
      setOllamaUrl(next.ollamaUrl ?? 'http://localhost:11434');
      setOpenAiBaseUrl(next.openAiBaseUrl ?? 'http://127.0.0.1:1234');
      setModelName(next.activeModel || 'llama3.2');
      setTemperature(next.temperature ?? 0.7);
      setMaxTokens(next.maxTokens ?? 2048);
      setEmbeddingDevice(next.embeddingDevice ?? 'auto');
      setAllowRemoteModels(next.allowRemoteModels ?? true);
    },
    []
  );

  const refreshSnapshot = useCallback(
    async (clearError: boolean = false): Promise<void> => {
      if (typeof window.electronAPI?.llm?.listModels !== 'function') {
        return;
      }
      setLoading(true);
      if (clearError) {
        setError(null);
      }
      try {
        const next = await window.electronAPI.llm.listModels();
        hydrateFromSnapshot(next, false);
        onModelsUpdated?.(next);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to query local AI runtime');
      } finally {
        setLoading(false);
      }
    },
    [hydrateFromSnapshot, onModelsUpdated]
  );

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      dirtyFieldsRef.current = false;
      return;
    }
    if (wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = true;
    dirtyFieldsRef.current = false;
    setError(null);
    if (initialModelsSnapshot) {
      hydrateFromSnapshot(initialModelsSnapshot, true);
    }
    void refreshSnapshot(false);
  }, [hydrateFromSnapshot, initialModelsSnapshot, isOpen, refreshSnapshot]);

  const handleSaveAiSettings = async (): Promise<void> => {
    if (typeof window.electronAPI?.llm?.setModelConfig !== 'function') return;
    setSaving(true);
    setError(null);
    try {
      const res = await window.electronAPI.llm.setModelConfig({
        provider,
        ollamaUrl: ollamaUrl.trim(),
        openAiBaseUrl: openAiBaseUrl.trim(),
        model: modelName.trim() || 'llama3.2',
        temperature: Math.max(0, Math.min(1, Number(temperature))),
        maxTokens: Math.max(64, Math.min(32768, Math.round(Number(maxTokens) || 2048))),
        embeddingDevice,
        allowRemoteModels,
      });
      dirtyFieldsRef.current = false;
      hydrateFromSnapshot(res.config, true);
      onModelsUpdated?.(res.config);
      showToast?.({ type: 'success', message: 'Local AI settings saved cleanly' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed saving AI settings';
      setError(msg);
      showToast?.({ type: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadOnnxModels = async (): Promise<void> => {
    if (typeof window.electronAPI?.llm?.downloadModels !== 'function') return;
    setDownloadingModels(true);
    setError(null);
    try {
      const res = await window.electronAPI.llm.downloadModels();
      hydrateFromSnapshot(res.snapshot);
      onModelsUpdated?.(res.snapshot);
      if (res.success) {
        showToast?.({
          type: 'success',
          message: 'Local ONNX embedding & reranker models cached on disk',
        });
      } else {
        const msg = res.error || 'ONNX model download failed';
        setError(msg);
        showToast?.({ type: 'warning', message: msg });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed downloading local ONNX models';
      setError(msg);
    } finally {
      setDownloadingModels(false);
    }
  };

  const deleteMode = vaultConfig?.defaultDeleteMode ?? 'vault';
  const developerBadges = Boolean(vaultConfig?.ui?.developerBadges);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={headingId}
      dataTestId="workspace-settings-modal"
      panelClassName="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700"
    >
      <div className="px-5 py-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="w-5 h-5 text-indigo-400" aria-hidden="true" />
          <div>
            <h2 id={headingId} className="text-base font-semibold">
              PrivateVault &amp; Local AI Settings
            </h2>
            <p className="text-xs text-slate-300">
              Configure loopback LLM runtimes, ONNX embeddings, safety &amp; workspace behavior
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="settings-close"
          aria-label="Close settings"
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {error && (
        <div
          role="alert"
          data-testid="settings-error-banner"
          className="mx-5 mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-200 flex-shrink-0"
        >
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50 dark:bg-slate-950 scrollbar-thin">
        {/* Section 1: Local LLM Runtime */}
        <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-accent-600 dark:text-indigo-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Local LLM Provider (Zero-Cloud Loopback Only)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                data-testid="settings-llm-connection-badge"
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  snapshot?.available
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                    : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200'
                }`}
              >
                {snapshot?.available ? 'Connected' : 'Offline (Extractive Synthesis Active)'}
              </span>
              <button
                type="button"
                onClick={(): void => {
                  void refreshSnapshot(true);
                }}
                disabled={loading}
                data-testid="settings-check-connection"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Probe</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-200 block">Provider Mode</span>
              <select
                value={provider}
                onChange={(e): void => {
                  dirtyFieldsRef.current = true;
                  setProvider(e.target.value as 'ollama' | 'openai_compatible');
                }}
                data-testid="settings-provider-select"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="ollama">Ollama (localhost:11434)</option>
                <option value="openai_compatible">OpenAI-Compatible (LM Studio / llama.cpp)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-200 block">
                {provider === 'ollama' ? 'Ollama Loopback URL' : 'OpenAI-Compatible Loopback URL'}
              </span>
              <input
                type="text"
                value={provider === 'ollama' ? ollamaUrl : openAiBaseUrl}
                onChange={(e): void => {
                  dirtyFieldsRef.current = true;
                  if (provider === 'ollama') setOllamaUrl(e.target.value);
                  else setOpenAiBaseUrl(e.target.value);
                }}
                data-testid="settings-endpoint-input"
                placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'http://127.0.0.1:1234'}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
              />
            </label>

            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-200 block">Chat / Agent Model ID</span>
              <input
                type="text"
                list="pv-discovered-models"
                value={modelName}
                onChange={(e): void => {
                  dirtyFieldsRef.current = true;
                  setModelName(e.target.value);
                }}
                data-testid="settings-model-input"
                placeholder="llama3.2"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
              />
              <datalist id="pv-discovered-models">
                {(snapshot?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-200 block">
                  Temp ({temperature.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e): void => {
                    dirtyFieldsRef.current = true;
                    setTemperature(parseFloat(e.target.value));
                  }}
                  data-testid="settings-temperature-range"
                  className="w-full"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-200 block">Max Tokens</span>
                <input
                  type="number"
                  min={128}
                  max={32768}
                  step={128}
                  value={maxTokens}
                  onChange={(e): void => {
                    dirtyFieldsRef.current = true;
                    setMaxTokens(parseInt(e.target.value, 10) || 2048);
                  }}
                  data-testid="settings-max-tokens-input"
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Section 2: Local ONNX Embeddings & Reranker */}
        <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Local ONNX Embeddings &amp; Reranker
            </h3>
            <button
              type="button"
              onClick={(): void => {
                void handleDownloadOnnxModels();
              }}
              disabled={downloadingModels}
              data-testid="settings-download-onnx-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-xs font-medium disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {downloadingModels
                  ? 'Downloading (~45 MB)...'
                  : snapshot?.embeddingCached && snapshot?.rerankerCached
                    ? 'Verify / Re-check Local ONNX Cache'
                    : 'Download ONNX Models (~45 MB)'}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                  {snapshot?.embeddingModel ?? 'Xenova/bge-small-en-v1.5'}
                </span>
                <span
                  data-testid="settings-embedding-cache-badge"
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    snapshot?.embeddingCached
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {snapshot?.embeddingCached
                    ? `Cached (${formatFileSize(snapshot.embeddingCacheBytes ?? 0)})`
                    : 'Not downloaded'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300 truncate">
                  {snapshot?.rerankerModel ?? 'Xenova/ms-marco-MiniLM-L-6-v2'}
                </span>
                <span
                  data-testid="settings-reranker-cache-badge"
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    snapshot?.rerankerCached
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {snapshot?.rerankerCached
                    ? `Cached (${formatFileSize(snapshot.rerankerCacheBytes ?? 0)})`
                    : 'Not downloaded'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="space-y-1 block">
                <span className="font-medium text-slate-700 dark:text-slate-200 block">
                  ONNX Execution Device ({(snapshot?.supportedEmbeddingDevices ?? ['cpu']).join(', ')})
                </span>
                <select
                  value={embeddingDevice}
                  onChange={(e): void => {
                    dirtyFieldsRef.current = true;
                    setEmbeddingDevice(e.target.value as 'auto' | 'cpu' | 'dml' | 'webgpu');
                  }}
                  data-testid="settings-device-select"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="auto">Auto (Probe GPU -&gt; CPU q8)</option>
                  <option value="cpu">CPU (Quantized INT8)</option>
                  <option value="dml">DirectML (Windows GPU if supported)</option>
                  <option value="webgpu">WebGPU</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!allowRemoteModels}
                  onChange={(e): void => {
                    dirtyFieldsRef.current = true;
                    setAllowRemoteModels(!e.target.checked);
                  }}
                  data-testid="settings-airgapped-checkbox"
                  className="rounded border-slate-300"
                />
                <span>Strict Air-Gapped Mode (block remote HF model pulls)</span>
              </label>
            </div>
          </div>

          {snapshot?.modelCacheDir && (
            <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate" title={snapshot.modelCacheDir}>
              Model Cache: {snapshot.modelCacheDir}
            </p>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={(): void => {
                void handleSaveAiSettings();
              }}
              disabled={saving}
              data-testid="settings-save-ai-button"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-accent-600 hover:bg-slate-800 dark:hover:bg-accent-700 text-white text-xs font-medium disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{saving ? 'Saving...' : 'Save AI Settings'}</span>
            </button>
          </div>
        </section>

        {/* Section 3: Workspace Safety & UX */}
        <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-sm text-xs">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Workspace Safety &amp; Experience
            </h3>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="space-y-1 flex-1 min-w-[200px]">
              <span className="font-medium text-slate-700 dark:text-slate-200 block">
                Default Delete Behavior
              </span>
              <select
                value={deleteMode}
                onChange={(e): void => {
                  const nextMode = e.target.value as 'vault' | 'trash';
                  if (onChangeDeleteMode) {
                    void onChangeDeleteMode(nextMode).then(() => onVaultConfigUpdated?.());
                  }
                }}
                data-testid="settings-delete-mode-select"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="vault">Move to Trash Vault (Reversible Undo + Restore UI)</option>
                <option value="trash">Move to OS Trash / Recycle Bin</option>
              </select>
            </label>

            {onOpenOnboarding && (
              <button
                type="button"
                onClick={(): void => {
                  onClose();
                  onOpenOnboarding();
                }}
                data-testid="settings-open-onboarding-button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium"
              >
                Open Setup Guide
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={developerBadges}
              onChange={(e): void => onToggleDeveloperBadges?.(e.target.checked)}
              data-testid="settings-dev-badges-checkbox"
              className="rounded border-slate-300"
            />
            <span>Show Developer DSA Badges in Preview Header (RingBuffer / LRUCache labels)</span>
          </label>
        </section>
      </div>
    </ModalShell>
  );
};
