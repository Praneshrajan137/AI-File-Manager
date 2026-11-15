import React, { useState, useEffect } from 'react';
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
}) => {
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = () => {
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(
        UI_CONSTANTS.SIDEBAR_MIN_WIDTH,
        Math.min(UI_CONSTANTS.SIDEBAR_MAX_WIDTH, e.clientX)
      );
      onResize(newWidth);
    };

    const handleMouseUp = () => {
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
    <div
      className="bg-white dark:bg-slate-900 border-r border-primary-200 dark:border-slate-800 flex flex-col h-full relative shadow-elite"
      style={{ width: `${width}px` }}
    >
      {/* Header - Elite branding */}
      <div className="px-5 py-4 border-b border-primary-100 dark:border-slate-800 bg-gradient-to-b from-white to-primary-50/30 dark:from-slate-900 dark:to-slate-900">
        <h1 className="text-lg font-semibold text-primary-900 dark:text-slate-100 tracking-tight">
          File Manager
        </h1>
        <div className="flex items-center gap-1.5 mt-1">
          <Shield className="w-3 h-3 text-primary-500 dark:text-indigo-400" />
          <span className="text-[11px] font-medium text-primary-500 dark:text-slate-400 tracking-wide uppercase">
            PrivateVault AI
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
          />
        )}
        <DirectoryTree onNavigate={onNavigate} lastWatcherEvent={lastWatcherEvent} />
        <FavoritesList
          favorites={vaultConfig?.favorites ?? []}
          onNavigate={onNavigate}
          onUnpin={onToggleFavorite}
        />
      </div>

      {/* Resize handle */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors ${isResizing ? 'bg-primary-400' : 'bg-transparent hover:bg-primary-300'
          }`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

