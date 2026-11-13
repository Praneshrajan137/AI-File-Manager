import React from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Eye,
  FilePlus,
  FolderPlus,
  MessageSquare,
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
  onOpenDiagnostics?: () => void;
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
  onOpenDiagnostics,
  chatOpen,
  onToggleChat
}) => (
  <div className="h-14 bg-white border-b border-primary-200 px-4 flex items-center gap-2.5 shadow-elite">
    <NavigationButtons
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={onBack}
      onForward={onForward}
    />

    <Breadcrumb path={currentPath} onNavigate={onNavigate} />

    <div className="flex-1" />

    <SearchBar onSearch={onSearch} onSelect={onNavigate} />

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

    <div className="h-6 w-px bg-primary-200" />

    {onOpenDiagnostics && (
      <Button
        variant="ghost"
        size="sm"
        icon={<Activity className="w-4 h-4 text-emerald-600" />}
        onClick={onOpenDiagnostics}
        title="Kernel Runtime Diagnostics"
        aria-label="Runtime Diagnostics"
        data-testid="diagnostics-button"
      />
    )}

    <Button
      variant="ghost"
      icon={<MessageSquare className={`w-5 h-5 ${chatOpen ? 'text-indigo-600' : 'text-primary-500'}`} />}
      onClick={onToggleChat}
      aria-label={chatOpen ? 'Close chat' : 'Open chat'}
      data-testid="chat-toggle-button"
      className={chatOpen ? 'bg-indigo-50' : ''}
    />
  </div>
);
