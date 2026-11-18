import React, { useEffect, useState } from 'react';
import { QuickAccess } from './QuickAccess';
import { DirectoryTree } from './DirectoryTree';
import { FavoritesList } from './FavoritesList';
import { VaultSection } from './VaultSection';
import { UI_CONSTANTS } from '@renderer/utils/constants';
import { OperationJournalState, VaultConfigSnapshot, FileEvent } from '@shared/contracts';
import { Shield } from 'lucide-react';

interface SidebarProps {
  width: number;
  onResize: (width: number) => void;
  onNavigate: (path: string) => void;
  vaultConfig?: VaultConfigSnapshot | null;
  journalState?: OperationJournalState | null;
  lastWatcherEvent?: FileEvent | null;
  onAddVaultRoot?: () => Promise<void>;
  onRemoveVaultRoot?: (rootPath: string) => Promise<void>;
  onToggleIndexedRoot?: (rootPath: string, enabled: boolean) => Promise<void>;
  onToggleFavorite?: (targetPath: string) => Promise<void>;
  onEmptyTrashVault?: () => Promise<void>;
  onOpenTrashVault?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  width,
  onResize,
  onNavigate,
  vaultConfig = null,
  journalState = null,
  lastWatcherEvent = null,
  onAddVaultRoot,
  onRemoveVaultRoot,
  onToggleIndexedRoot,
  onToggleFavorite,
  onEmptyTrashVault,
  onOpenTrashVault,
}) => {
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (): void => {
    setIsResizing(true);
  };

  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 32 : 16;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onResize(Math.min(UI_CONSTANTS.SIDEBAR_MAX_WIDTH, width + step));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onResize(Math.max(UI_CONSTANTS.SIDEBAR_MIN_WIDTH, width - step));
    }
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent): void => {
      const newWidth = Math.max(
        UI_CONSTANTS.SIDEBAR_MIN_WIDTH,
        Math.min(UI_CONSTANTS.SIDEBAR_MAX_WIDTH, e.clientX)
      );
      onResize(newWidth);
    };

    const handleMouseUp = (): void => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

  return (
    <aside
      aria-label="Workspace sidebar"
      className="bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-full relative shadow-elite flex-shrink-0 max-w-[40vw]"
      style={{ width: `${width}px` }}
    >
      {/* Header - Brand & Privacy Badge */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-b from-white to-slate-50/40 dark:from-slate-900 dark:to-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
          PrivateVault
        </h1>
        <div className="flex items-center gap-1.5 mt-1">
          <Shield className="w-3 h-3 text-accent-600 dark:text-indigo-400" aria-hidden="true" />
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 tracking-wide uppercase">
            Local Knowledge OS
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-3 scrollbar-thin">
        <QuickAccess onNavigate={onNavigate} />
        {onAddVaultRoot && onRemoveVaultRoot && onToggleIndexedRoot && onEmptyTrashVault && (
          <VaultSection
            vaultConfig={vaultConfig}
            journalState={journalState}
            onNavigate={onNavigate}
            onAddRoot={onAddVaultRoot}
            onRemoveRoot={onRemoveVaultRoot}
            onToggleIndexed={onToggleIndexedRoot}
            onEmptyTrashVault={onEmptyTrashVault}
            onOpenTrashVault={onOpenTrashVault}
          />
        )}
        <DirectoryTree onNavigate={onNavigate} lastWatcherEvent={lastWatcherEvent} />
        <FavoritesList
          favorites={vaultConfig?.favorites ?? []}
          onNavigate={onNavigate}
          onUnpin={onToggleFavorite}
        />
      </div>

      {/* Keyboard + Pointer Accessible Resize Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={UI_CONSTANTS.SIDEBAR_MIN_WIDTH}
        aria-valuemax={UI_CONSTANTS.SIDEBAR_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize transition-colors focus-visible:outline-none focus-visible:bg-accent-500 ${
          isResizing ? 'bg-accent-500' : 'bg-transparent hover:bg-slate-300 dark:hover:bg-slate-600'
        }`}
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizeKeyDown}
      />
    </aside>
  );
};
