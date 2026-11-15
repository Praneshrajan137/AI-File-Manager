import React from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Columns,
  Command,
  Eye,
  FilePlus,
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
  chatOpen,
  onToggleChat
}) => (
  <div className="h-14 bg-white dark:bg-slate-900 border-b border-primary-200 dark:border-slate-800 px-4 flex items-center gap-2 shadow-elite">
    <NavigationButtons
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={onBack}
      onForward={onForward}
    />

    <Breadcrumb path={currentPath} onNavigate={onNavigate} />

    <div className="flex items-center gap-2 flex-shrink-0">
      <SearchBar onSearch={onSearch} onSelect={onSearchSelect ?? onNavigate} />

      <div className="h-6 w-px bg-primary-200" />

    {onNewFile && (
      <Button
        variant="ghost"
        size="sm"
        icon={<FilePlus className="w-4 h-4 text-primary-600" />}
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
        icon={<FolderPlus className="w-4 h-4 text-primary-600" />}
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
        icon={<Eye className="w-4 h-4 text-primary-600" />}
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
        icon={<Undo2 className="w-4 h-4 text-primary-600" />}
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
        icon={<Redo2 className="w-4 h-4 text-primary-600" />}
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
            <ArrowUp className="w-4 h-4 text-primary-600" />
          ) : (
            <ArrowDown className="w-4 h-4 text-primary-600" />
          )
        }
        onClick={onSortDirectionToggle}
        title={`Sort order: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
        aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
        data-testid="sort-direction-toggle"
      />
    )}

    <div className="h-6 w-px bg-primary-200 dark:bg-slate-700" />

    {onOpenOmnibar && (
      <Button
        variant="ghost"
        size="sm"
        icon={<Command className="w-4 h-4 text-indigo-500" />}
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
        icon={<Columns className={`w-4 h-4 ${splitPaneOpen ? 'text-indigo-500' : 'text-primary-600 dark:text-slate-300'}`} />}
        onClick={onToggleSplitPane}
        title="Toggle Split-Pane Dual Explorer (F6)"
        aria-label="Toggle Split-Pane"
        data-testid="split-pane-button"
        className={splitPaneOpen ? 'bg-indigo-50 dark:bg-indigo-950/60' : ''}
      />
    )}

    {onToggleTheme && (
      <Button
        variant="ghost"
        size="sm"
        icon={isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-primary-600" />}
        onClick={onToggleTheme}
        title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Obsidian Dark Slate'}
        aria-label="Toggle Theme"
        data-testid="theme-toggle-button"
      />
    )}

    {onOpenDiagnostics && (
      <Button
        variant="ghost"
        size="sm"
        icon={<Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
        onClick={onOpenDiagnostics}
        title="Kernel Runtime Diagnostics"
        aria-label="Runtime Diagnostics"
        data-testid="diagnostics-button"
      />
    )}

      <Button
        variant="ghost"
        icon={<MessageSquare className={`w-5 h-5 ${chatOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-primary-500 dark:text-slate-400'}`} />}
        onClick={onToggleChat}
        aria-label={chatOpen ? 'Close chat' : 'Open chat'}
        data-testid="chat-toggle-button"
        className={chatOpen ? 'bg-indigo-50 dark:bg-indigo-950/60' : ''}
      />
    </div>
  </div>
);
