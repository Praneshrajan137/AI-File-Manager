import React from 'react';
import { MessageSquare } from 'lucide-react';
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
  chatOpen,
  onToggleChat
}) => (
  <div className="h-14 bg-white border-b border-primary-200 px-4 flex items-center gap-4 shadow-elite">
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

    <ViewToggle mode={viewMode} onChange={onViewModeChange} />
    <SortDropdown value={sortBy} onChange={onSortChange} />

    <div className="h-6 w-px bg-primary-200" />

    <Button
      variant="ghost"
      icon={<MessageSquare className={`w-5 h-5 ${chatOpen ? 'text-indigo-600' : 'text-primary-500'}`} />}
      onClick={onToggleChat}
      aria-label={chatOpen ? 'Close chat' : 'Open chat'}
      className={chatOpen ? 'bg-indigo-50' : ''}
    />
  </div>
);
