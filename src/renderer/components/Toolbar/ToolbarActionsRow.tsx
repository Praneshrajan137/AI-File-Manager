import React from 'react';
import { ArrowDown, ArrowUp, Eye, FilePlus, FolderKanban, FolderPlus, Redo2, Undo2 } from 'lucide-react';
import { Button } from '@renderer/components/common/Button';
import { ViewToggle } from './ViewToggle';
import { SortDropdown } from './SortDropdown';

interface ToolbarActionsRowProps {
  currentPath: string;
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  sortBy: 'name' | 'size' | 'modified' | 'type';
  onSortChange: (sortBy: 'name' | 'size' | 'modified' | 'type') => void;
  sortDirection: 'asc' | 'desc';
  onSortDirectionToggle?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  canPreviewSelected: boolean;
  onPreviewSelected?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoDescription?: string;
  redoDescription?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenOrganize?: () => void;
}

/** Secondary explorer strip housing file creation, quick preview, undo/redo, AI organize, view & sort controls. */
export const ToolbarActionsRow: React.FC<ToolbarActionsRowProps> = ({
  currentPath,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  sortDirection,
  onSortDirectionToggle,
  onNewFile,
  onNewFolder,
  canPreviewSelected,
  onPreviewSelected,
  canUndo,
  canRedo,
  undoDescription,
  redoDescription,
  onUndo,
  onRedo,
  onOpenOrganize,
}) => (
  <div className="px-3 py-1 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-1 flex-wrap">
      {onNewFile && (
        <Button
          variant="ghost"
          size="sm"
          icon={<FilePlus className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
          onClick={onNewFile}
          disabled={!currentPath}
          title="New File (Ctrl+N)"
          aria-label="New File"
          data-testid="new-file-button"
        />
      )}

      {onNewFolder && (
        <Button
          variant="ghost"
          size="sm"
          icon={<FolderPlus className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
          onClick={onNewFolder}
          disabled={!currentPath}
          title="New Folder (Ctrl+Shift+N)"
          aria-label="New Folder"
          data-testid="new-folder-button"
        />
      )}

      {onPreviewSelected && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Eye className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
          onClick={onPreviewSelected}
          disabled={!canPreviewSelected}
          title="Quick Preview Selected File (Space / Alt+P)"
          aria-label="Quick Preview"
          data-testid="preview-button"
        />
      )}

      {(onUndo || onRedo) && (
        <div className="hidden sm:block h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />
      )}

      {onUndo && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Undo2 className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
          onClick={onUndo}
          disabled={!canUndo}
          title={undoDescription ? `Undo: ${undoDescription} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
          aria-label="Undo"
          data-testid="undo-button"
        />
      )}

      {onRedo && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Redo2 className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
          onClick={onRedo}
          disabled={!canRedo}
          title={redoDescription ? `Redo: ${redoDescription} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
          aria-label="Redo"
          data-testid="redo-button"
        />
      )}

      {onOpenOrganize && (
        <>
          <div className="hidden sm:block h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderKanban className="w-4 h-4 text-accent-600 dark:text-indigo-400" aria-hidden="true" />}
            onClick={onOpenOrganize}
            disabled={!currentPath}
            title="AI Organize Folder (Dry-Run Preview)"
            aria-label="AI Organize Folder"
            data-testid="toolbar-organize-button"
          />
        </>
      )}
    </div>

    <div className="flex items-center gap-1.5">
      <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      <SortDropdown value={sortBy} onChange={onSortChange} />

      {onSortDirectionToggle && (
        <Button
          variant="ghost"
          size="sm"
          icon={
            sortDirection === 'asc' ? (
              <ArrowUp className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
            ) : (
              <ArrowDown className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
            )
          }
          onClick={onSortDirectionToggle}
          title={`Sort order: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
          aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
          data-testid="sort-direction-toggle"
        />
      )}
    </div>
  </div>
);
