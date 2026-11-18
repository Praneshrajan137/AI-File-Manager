import React, { Suspense } from 'react';
import { FileContextMenu } from './ContextMenu/FileContextMenu';
import { FileOperationDialogs } from './FileOperationDialogs';
import { Toast } from './common/Toast';
import type { ToastMessage } from '@renderer/hooks/useToast';
import type { UseExplorerActionsReturn } from '@renderer/hooks/useExplorerActions';
import type { UseLLMReturn } from '@renderer/hooks/useLLM';
import type { UseWorkspaceVaultReturn } from '@renderer/hooks/useWorkspaceVault';
import { extractBasename } from '@renderer/utils/pathHelpers';
import type {
  FileNode,
  OrganizeApplyResult,
  OrganizePlanResult,
  OrganizeStrategy,
} from '@shared/contracts';

const LazyDiagnosticsModal = React.lazy(() =>
  import('./Diagnostics/DiagnosticsModal').then((m) => ({ default: m.DiagnosticsModal }))
);
const LazyWorkspaceSettingsModal = React.lazy(() =>
  import('./Settings/WorkspaceSettingsModal').then((m) => ({ default: m.WorkspaceSettingsModal }))
);
const LazyTrashVaultModal = React.lazy(() =>
  import('./Vault/TrashVaultModal').then((m) => ({ default: m.TrashVaultModal }))
);
const LazyOnboardingModal = React.lazy(() =>
  import('./Onboarding/OnboardingModal').then((m) => ({ default: m.OnboardingModal }))
);
const LazyCommandOmnibar = React.lazy(() =>
  import('./SearchBar/CommandOmnibar').then((m) => ({ default: m.CommandOmnibar }))
);
const LazyDryRunPlanModal = React.lazy(() =>
  import('./Organizer/DryRunPlanModal').then((m) => ({ default: m.DryRunPlanModal }))
);

export interface ContextMenuState {
  file: FileNode;
  position: { x: number; y: number };
  fromSecondary?: boolean;
}

interface WorkspaceDialogsProps {
  currentPath: string;
  vault: UseWorkspaceVaultReturn;
  explorer: UseExplorerActionsReturn;
  llmState: UseLLMReturn;
  favoritesSet: Set<string>;
  normalizePathKey: (p: string) => string;
  contextMenu: ContextMenuState | null;
  onCloseContextMenu: () => void;
  renameFile: FileNode | null;
  onCloseRename: () => void;
  createEntryMode: 'file' | 'directory' | null;
  onCloseCreateEntry: () => void;
  pendingDeletePaths: string[] | null;
  onClosePendingDelete: () => void;
  diagnosticsOpen: boolean;
  onCloseDiagnostics: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onOpenSettings: () => void;
  trashVaultOpen: boolean;
  onCloseTrashVault: () => void;
  onboardingOpen: boolean;
  onOpenOnboarding: () => void;
  onCompleteOnboarding: () => void;
  omnibarOpen: boolean;
  onCloseOmnibar: () => void;
  organizeTargetDir: string | null;
  organizeInitialStrategy: OrganizeStrategy;
  organizeInitialPlan: OrganizePlanResult | null;
  onCloseOrganize: () => void;
  toasts: ToastMessage[];
  onRemoveToast: (id: number) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  onFileDoubleClick: (file: FileNode) => Promise<void>;
  onPreviewFile: (file: FileNode) => Promise<void>;
  onOpenRename: (file: FileNode) => void;
  onRequestDelete: (paths: string[]) => void;
  onSearchSelect: (targetPath: string) => Promise<void>;
  onOpenCitation: (filePath: string, startLine?: number, endLine?: number) => Promise<void>;
  onToggleSplitPane: () => void;
  onToggleChat: () => void;
  onStartIndexing: (dirPath: string) => Promise<void>;
  onOpenOrganize: (targetDir: string) => void;
  onRefreshSpatialData: () => Promise<void>;
}

export const WorkspaceDialogs: React.FC<WorkspaceDialogsProps> = ({
  currentPath,
  vault,
  explorer,
  llmState,
  favoritesSet,
  normalizePathKey,
  contextMenu,
  onCloseContextMenu,
  renameFile,
  onCloseRename,
  createEntryMode,
  onCloseCreateEntry,
  pendingDeletePaths,
  onClosePendingDelete,
  diagnosticsOpen,
  onCloseDiagnostics,
  settingsOpen,
  onCloseSettings,
  onOpenSettings,
  trashVaultOpen,
  onCloseTrashVault,
  onboardingOpen,
  onOpenOnboarding,
  onCompleteOnboarding,
  omnibarOpen,
  onCloseOmnibar,
  organizeTargetDir,
  organizeInitialStrategy,
  organizeInitialPlan,
  onCloseOrganize,
  toasts,
  onRemoveToast,
  showToast,
  onFileDoubleClick,
  onPreviewFile,
  onOpenRename,
  onRequestDelete,
  onSearchSelect,
  onOpenCitation,
  onToggleSplitPane,
  onToggleChat,
  onStartIndexing,
  onOpenOrganize,
  onRefreshSpatialData,
}) => {
  const handleRefreshAll = async (): Promise<void> => {
    await explorer.refreshActiveDirectories();
    await vault.refreshWorkspaceMetadata();
    await onRefreshSpatialData();
  };

  const activeTargets = contextMenu
    ? contextMenu.fromSecondary
      ? explorer.secondarySelectedFiles.includes(contextMenu.file.path)
        ? explorer.secondarySelectedFiles
        : [contextMenu.file.path]
      : explorer.selectedFiles.includes(contextMenu.file.path)
        ? explorer.selectedFiles
        : [contextMenu.file.path]
    : [];

  const pasteDir = contextMenu?.fromSecondary ? explorer.secondaryPath : currentPath;

  return (
    <>
      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          selectedCount={activeTargets.length}
          position={contextMenu.position}
          onClose={onCloseContextMenu}
          onOpen={(): void => {
            if (contextMenu.fromSecondary && contextMenu.file.isDirectory) {
              void explorer.loadSecondaryDirectory(contextMenu.file.path);
            } else {
              void onFileDoubleClick(contextMenu.file);
            }
          }}
          onPreview={
            !contextMenu.file.isDirectory
              ? (): void => {
                  void onPreviewFile(contextMenu.file);
                }
              : undefined
          }
          onRename={(): void => onOpenRename(contextMenu.file)}
          onCopyFiles={(): void => explorer.copyToClipboard(activeTargets)}
          onCutFiles={(): void => explorer.cutToClipboard(activeTargets)}
          canPaste={Boolean(explorer.clipboard && explorer.clipboard.paths.length > 0 && pasteDir)}
          onPasteFiles={
            pasteDir
              ? (): void => {
                  void explorer.pasteFromClipboard(pasteDir);
                }
              : undefined
          }
          onDuplicate={(): void => {
            void explorer.handleDuplicatePaths(activeTargets);
          }}
          onCopyToOtherPane={
            vault.splitPaneOpen && explorer.secondaryPath && !contextMenu.fromSecondary
              ? (): void => {
                  void explorer.handleCopyPathsToDirectory(activeTargets, explorer.secondaryPath);
                }
              : undefined
          }
          onToggleFavorite={(): void => {
            void vault.handleToggleFavorite(contextMenu.file.path);
          }}
          isFavorite={favoritesSet.has(normalizePathKey(contextMenu.file.path))}
          onDelete={(): void => onRequestDelete(activeTargets)}
          onCopyPath={(): void => {
            void window.electronAPI.clipboard.writeText(contextMenu.file.path);
            showToast({ type: 'success', message: 'Path copied to clipboard' });
          }}
        />
      )}

      <FileOperationDialogs
        currentPath={currentPath}
        defaultDeleteMode={vault.vaultConfig?.defaultDeleteMode ?? 'vault'}
        renameFile={renameFile}
        onCloseRename={onCloseRename}
        createEntryMode={createEntryMode}
        onCloseCreateEntry={onCloseCreateEntry}
        pendingDeletePaths={pendingDeletePaths}
        onClosePendingDelete={onClosePendingDelete}
        onExecuteDelete={explorer.executeDeletePaths}
        onRefreshAll={handleRefreshAll}
        showToast={showToast}
      />

      {diagnosticsOpen && (
        <Suspense fallback={null}>
          <LazyDiagnosticsModal isOpen={diagnosticsOpen} onClose={onCloseDiagnostics} />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <LazyWorkspaceSettingsModal
            isOpen={settingsOpen}
            onClose={onCloseSettings}
            vaultConfig={vault.vaultConfig}
            initialModelsSnapshot={llmState.modelsSnapshot}
            onModelsUpdated={llmState.applyModelsSnapshot}
            onVaultConfigUpdated={vault.refreshWorkspaceMetadata}
            onOpenOnboarding={onOpenOnboarding}
            onToggleDeveloperBadges={vault.setDeveloperBadges}
            onChangeDeleteMode={vault.handleSetDefaultDeleteMode}
            showToast={showToast}
          />
        </Suspense>
      )}

      {trashVaultOpen && (
        <Suspense fallback={null}>
          <LazyTrashVaultModal
            isOpen={trashVaultOpen}
            onClose={onCloseTrashVault}
            onRestoredOrPurged={handleRefreshAll}
            onEmptyAll={vault.handleEmptyTrashVault}
            showToast={showToast}
          />
        </Suspense>
      )}

      {onboardingOpen && (
        <Suspense fallback={null}>
          <LazyOnboardingModal
            isOpen={onboardingOpen}
            onComplete={onCompleteOnboarding}
            vaultConfig={vault.vaultConfig}
            modelsSnapshot={llmState.modelsSnapshot}
            onAddVaultRoot={vault.handleAddVaultRoot}
            onIndexRoot={llmState.startIndexing}
            onOpenSettings={(): void => {
              onCompleteOnboarding();
              onOpenSettings();
            }}
          />
        </Suspense>
      )}

      {omnibarOpen && (
        <Suspense fallback={null}>
          <LazyCommandOmnibar
            isOpen={omnibarOpen}
            onClose={onCloseOmnibar}
            currentPath={currentPath}
            onNavigateFile={onSearchSelect}
            onOpenCitation={onOpenCitation}
            isDarkMode={vault.isDarkMode}
            onToggleTheme={vault.toggleDarkMode}
            splitPaneOpen={vault.splitPaneOpen}
            onToggleSplitPane={onToggleSplitPane}
            onToggleChat={onToggleChat}
            onIndexCurrentDir={async (): Promise<void> => {
              if (currentPath) {
                await onStartIndexing(currentPath);
                showToast({
                  type: 'info',
                  message: `Indexing started for ${extractBasename(currentPath)}`,
                });
              }
            }}
            onOrganizeCurrentDir={(): void => {
              if (currentPath) onOpenOrganize(currentPath);
            }}
          />
        </Suspense>
      )}

      {organizeTargetDir !== null && (
        <Suspense fallback={null}>
          <LazyDryRunPlanModal
            isOpen={true}
            targetDir={organizeTargetDir}
            initialStrategy={organizeInitialStrategy}
            initialPlan={organizeInitialPlan}
            onClose={onCloseOrganize}
            onApplied={async (result: OrganizeApplyResult): Promise<void> => {
              onCloseOrganize();
              await handleRefreshAll();
              showToast({
                type: 'success',
                message: `Organized ${result.appliedCount} file(s)${
                  result.repairedLinksCount ? ` & repaired ${result.repairedLinksCount} link(s)` : ''
                }`,
                actionLabel: 'Undo',
                onAction: (): void => {
                  void explorer.handleUndo();
                },
              });
            }}
          />
        </Suspense>
      )}

      <div
        className="fixed bottom-9 right-4 z-50 space-y-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        <div className="pointer-events-auto space-y-2">
          {toasts.map((toast) => (
            <Toast key={toast.id} {...toast} onClose={(): void => onRemoveToast(toast.id)} />
          ))}
        </div>
      </div>
    </>
  );
};
