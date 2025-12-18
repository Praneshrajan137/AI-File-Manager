/**
 * App.tsx - Root React Component (Phase 5 Complete Integration)
 * 
 * Main application layout with complete UI implementation:
 * - Sidebar with DirectoryTree, QuickAccess, Favorites
 * - Toolbar with Navigation, Breadcrumb, Search, ViewToggle, Sort
 * - FileExplorer with virtualized FileGrid
 * - ChatPanel with LLM streaming
 * - Context menus and Toast notifications
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as os from 'os';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { FileGrid } from './components/FileExplorer/FileGrid';
import { ChatInterface } from './components/ChatPanel/ChatInterface';
import { FileContextMenu } from './components/ContextMenu/FileContextMenu';
import { Toast } from './components/common/Toast';
import { useFileSystem } from './hooks/useFileSystem';
import { useNavigation } from './hooks/useNavigation';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { UI_CONSTANTS } from './utils/constants';
import { FileNode } from '@shared/contracts';

const App: React.FC = () => {
  // File system state
  const {
    files,
    loading,
    error,
    readDirectory,
    currentPath,
    deleteFile,
    moveFile,
  } = useFileSystem();

  // Navigation state
  const {
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    navigateTo,
  } = useNavigation();

  // UI state
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sidebarWidth, setSidebarWidth] = useState<number>(UI_CONSTANTS.SIDEBAR_DEFAULT_WIDTH);
  const [contextMenu, setContextMenu] = useState<{ file: FileNode; x: number; y: number } | null>(null);

  // Toast notifications
  const { toasts, showToast, removeToast } = useToast();

  // Event handlers - wrapped in useCallback to create stable references
  const handleDelete = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    try {
      for (const filePath of selectedFiles) {
        await deleteFile(filePath);
      }
      showToast({
        type: 'success',
        message: `Deleted ${selectedFiles.length} file(s)`
      });
      setSelectedFiles([]);
      await readDirectory(currentPath);
    } catch (error: any) {
      showToast({
        type: 'error',
        message: error.message || 'Delete failed'
      });
    }
  }, [selectedFiles, deleteFile, showToast, readDirectory, currentPath]);

  const handleBack = useCallback(async () => {
    const prevPath = await goBack();
    if (prevPath) {
      await readDirectory(prevPath);
    }
  }, [goBack, readDirectory]);

  const handleForward = useCallback(async () => {
    const nextPath = await goForward();
    if (nextPath) {
      await readDirectory(nextPath);
    }
  }, [goForward, readDirectory]);

  const handleToggleChat = useCallback(() => {
    setChatOpen(prev => !prev);
  }, []);

  const handleDeleteShortcut = useCallback(() => {
    if (selectedFiles.length > 0) {
      handleDelete();
    }
  }, [selectedFiles.length, handleDelete]);

  // File watcher updates - memoized callback to prevent listener churn
  const handleFileWatcherEvent = useCallback((event: any) => {
    if (currentPath && event.path.startsWith(currentPath)) {
      readDirectory(currentPath); // Auto-refresh
      showToast({
        type: 'info',
        message: `File ${event.type}: ${event.path.split('/').pop()}`,
        duration: 2000
      });
    }
  }, [currentPath, readDirectory, showToast]);

  useFileWatcher(handleFileWatcherEvent);

  // Keyboard shortcuts - memoize shortcuts object to prevent effect churn
  const shortcuts = useMemo(() => ({
    'Ctrl+Shift+L': handleToggleChat,
    'Alt+Left': handleBack,
    'Alt+Right': handleForward,
    'Delete': handleDeleteShortcut,
  }), [handleToggleChat, handleBack, handleForward, handleDeleteShortcut]);
  
  useKeyboardShortcuts(shortcuts);

  // Load home directory on mount
  useEffect(() => {
    const homeDir = os.homedir();
    navigateTo(homeDir).then(() => {
      readDirectory(homeDir);
    });
  }, [navigateTo, readDirectory]);

  // Additional event handlers (after keyboard shortcut handlers)
  const handleFileClick = (file: FileNode) => {
    setSelectedFiles([file.path]);
  };

  const handleFileDoubleClick = async (file: FileNode) => {
    if (file.isDirectory) {
      await navigateTo(file.path);
      await readDirectory(file.path); // Await for consistency and proper error handling
    } else {
      showToast({
        type: 'info',
        message: `Opening ${file.name}...`
      });
      // TODO: Implement file opening with default application
    }
  };

  const handleFileContextMenu = (file: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ file, x: e.clientX, y: e.clientY });
  };

  const handleNavigate = async (path: string) => {
    await navigateTo(path);
    await readDirectory(path);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar
        width={sidebarWidth}
        onResize={setSidebarWidth}
        onNavigate={handleNavigate}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={handleBack}
          onForward={handleForward}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          onSearch={(query) => {
            // Search functionality (integrated with PathTrie)
            console.log('Search:', query);
          }}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortBy={sortBy}
          onSortChange={setSortBy}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen(!chatOpen)}
        />

        {/* File Explorer */}
        <div className="flex-1 overflow-hidden p-4">
          <FileGrid
            files={files}
            selectedFiles={selectedFiles}
            onFileClick={handleFileClick}
            onFileDoubleClick={handleFileDoubleClick}
            onFileContextMenu={handleFileContextMenu}
            sortBy={sortBy}
            sortDirection={sortDirection}
            viewMode={viewMode}
            loading={loading}
            error={error}
          />
        </div>
      </div>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="w-96 bg-white border-l border-gray-200">
          <ChatInterface />
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onOpen={() => handleFileDoubleClick(contextMenu.file)}
          onRename={async () => {
            showToast({ type: 'info', message: 'Rename feature coming soon!' });
            setContextMenu(null);
          }}
          onDelete={async () => {
            await deleteFile(contextMenu.file.path);
            await readDirectory(currentPath);
            setContextMenu(null);
          }}
          onCopyPath={() => {
            navigator.clipboard.writeText(contextMenu.file.path);
            showToast({ type: 'success', message: 'Path copied to clipboard' });
            setContextMenu(null);
          }}
        />
      )}

      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default App;
