import React from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Columns,
  Command,
  Eye,
  FilePlus,
  FolderKanban,
  FolderPlus,
  MessageSquare,
  Moon,
  Redo2,
  Sun,
  Undo2,
} from 'lucide-react';
import { NavigationButtons } from './NavigationButtons';
import { Breadcrumb } from './Breadcrumb';
import { ViewToggle } from './ViewToggle';
import { SortDropdown } from './SortDropdown';
import { SearchBar } from '@renderer/components/SearchBar/SearchBar';
import { Button } from '@renderer/components/common/Button';

interface ToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  currentPath: string;
  onNavigate: (path: string) => void;
  onSearch: (query: string) => void;
  onSearchSelect?: (path: string) => void;
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  sortBy: 'name' | 'size' | 'modified' | 'type';
  onSortChange: (sortBy: 'name' | 'size' | 'modified' | 'type') => void;
  sortDirection?: 'asc' | 'desc';
  onSortDirectionToggle?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  canPreviewSelected?: boolean;
  onPreviewSelected?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenDiagnostics?: () => void;
  onOpenOmnibar?: () => void;
  splitPaneOpen?: boolean;
  onToggleSplitPane?: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  onOpenOrganize?: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  currentPath,
  onNavigate,
  onSearch,
  onSearchSelect,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  sortDirection = 'asc',
  onSortDirectionToggle,
  onNewFile,
  onNewFolder,
  canPreviewSelected = false,
  onPreviewSelected,
  canUndo = false,
  canRedo = false,
  undoDescription,
  redoDescription,
  onUndo,
  onRedo,
  onOpenDiagnostics,
  onOpenOmnibar,
  splitPaneOpen = false,
  onToggleSplitPane,
  isDarkMode = false,
  onToggleTheme,
  onOpenOrganize,
  chatOpen,
  onToggleChat,
}) => (
  <header
    data-testid="main-toolbar"
    className="min-h-[3.5rem] py-1.5 px-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shadow-elite"
  >
    <div className="flex items-center gap-2 min-w-0 flex-1 basis-[220px]">
      <NavigationButtons
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={onBack}
        onForward={onForward}
      />

      <Breadcrumb path={currentPath} onNavigate={onNavigate} />
    </div>

    <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
      <SearchBar onSearch={onSearch} onSelect={onSearchSelect ?? onNavigate} />

      <div className="hidden sm:block h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

      {onNewFile && (
        <Button
          variant="ghost"
          size="sm"
          icon={<FilePlus className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
          onClick={onNewFile}
          disabled={!currentPath}
          title="New File"
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
          title="New Folder"
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
          title="Quick Preview Selected File (Alt+P)"
          aria-label="Quick Preview"
          data-testid="preview-button"
        />
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

      <div className="hidden sm:block h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

      {onOpenOmnibar && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Command className="w-4 h-4 text-accent-600 dark:text-indigo-400" aria-hidden="true" />}
          onClick={onOpenOmnibar}
          title="Command & Content Omnibar (Ctrl+K)"
          aria-label="Command Omnibar"
          data-testid="omnibar-trigger-button"
        />
      )}

      {onToggleSplitPane && (
        <Button
          variant="ghost"
          size="sm"
          icon={
            <Columns
              className={`w-4 h-4 ${splitPaneOpen ? 'text-accent-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}
              aria-hidden="true"
            />
          }
          onClick={onToggleSplitPane}
          title="Toggle Split-Pane Dual Explorer (F6)"
          aria-label="Toggle Split-Pane"
          aria-pressed={splitPaneOpen}
          data-testid="split-pane-button"
          className={splitPaneOpen ? 'bg-indigo-50 dark:bg-indigo-950/60' : ''}
        />
      )}

      {onToggleTheme && (
        <Button
          variant="ghost"
          size="sm"
          icon={
            isDarkMode ? (
              <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" aria-hidden="true" />
            )
          }
          onClick={onToggleTheme}
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Obsidian Dark Slate'}
          aria-label="Toggle Theme"
          aria-pressed={isDarkMode}
          data-testid="theme-toggle-button"
        />
      )}

      {onOpenOrganize && (
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
      )}

      {onOpenDiagnostics && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />}
          onClick={onOpenDiagnostics}
          title="Kernel Runtime Diagnostics"
          aria-label="Runtime Diagnostics"
          data-testid="diagnostics-button"
        />
      )}

      <Button
        variant="ghost"
        size="sm"
        icon={
          <MessageSquare
            className={`w-4 h-4 ${chatOpen ? 'text-accent-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}
            aria-hidden="true"
          />
        }
        onClick={onToggleChat}
        aria-label={chatOpen ? 'Close chat' : 'Open chat'}
        aria-pressed={chatOpen}
        data-testid="chat-toggle-button"
        className={chatOpen ? 'bg-indigo-50 dark:bg-indigo-950/60' : ''}
      />
    </div>
  </header>
);
