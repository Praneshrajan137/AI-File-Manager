import React from 'react';
import { Activity, Columns, Command, MessageSquare, Moon, Settings, Sun } from 'lucide-react';
import { NavigationButtons } from './NavigationButtons';
import { Breadcrumb } from './Breadcrumb';
import { ToolbarActionsRow } from './ToolbarActionsRow';
import { SearchBar } from '@renderer/components/SearchBar/SearchBar';
import { Button } from '@renderer/components/common/Button';
import { Kbd } from '@renderer/components/common/Kbd';

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
  onOpenSettings?: () => void;
  onOpenOmnibar?: () => void;
  splitPaneOpen?: boolean;
  onToggleSplitPane?: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
  onOpenOrganize?: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

/**
 * Structured two-tier workspace header preventing narrow/laptop chrome wrapping while keeping
 * location + search + global utility toggles separated cleanly from contextual file/view actions.
 */
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
  onOpenSettings,
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
    className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-elite flex flex-col"
  >
    <div className="min-h-[3.25rem] px-3 py-1.5 flex flex-wrap md:flex-nowrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <NavigationButtons
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={onBack}
          onForward={onForward}
        />
        <Breadcrumb path={currentPath} onNavigate={onNavigate} />
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0 max-w-full">
        <SearchBar onSearch={onSearch} onSelect={onSearchSelect ?? onNavigate} />

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
          >
            <Kbd className="hidden xl:inline-flex">Ctrl+K</Kbd>
          </Button>
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

        {onOpenSettings && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Settings className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />}
            onClick={onOpenSettings}
            title="Workspace & AI Settings"
            aria-label="Workspace Settings"
            data-testid="settings-button"
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
    </div>

    <ToolbarActionsRow
      currentPath={currentPath}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      sortBy={sortBy}
      onSortChange={onSortChange}
      sortDirection={sortDirection}
      onSortDirectionToggle={onSortDirectionToggle}
      onNewFile={onNewFile}
      onNewFolder={onNewFolder}
      canPreviewSelected={canPreviewSelected}
      onPreviewSelected={onPreviewSelected}
      canUndo={canUndo}
      canRedo={canRedo}
      undoDescription={undoDescription}
      redoDescription={redoDescription}
      onUndo={onUndo}
      onRedo={onRedo}
      onOpenOrganize={onOpenOrganize}
    />
  </header>
);
