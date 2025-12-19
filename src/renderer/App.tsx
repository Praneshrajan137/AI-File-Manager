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
import { Sidebar } from './components/Sidebar/Sidebar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { FileGrid } from './components/FileExplorer/FileGrid';
import { ChatInterface } from './components/ChatPanel/ChatInterface';
import { FileContextMenu } from './components/ContextMenu/FileContextMenu';
import { Toast } from './components/common/Toast';
import { RenameDialog } from './components/common/RenameDialog';
import { useFileSystem } from './hooks/useFileSystem';
import { useNavigation } from './hooks/useNavigation';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { UI_CONSTANTS } from './utils/constants';
import { FileNode } from '@shared/contracts';

// Browser compatibility warning component
const BrowserWarning: React.FC = () => (
  <div className="flex items-center justify-center h-screen bg-gray-100">
    <div className="text-center p-8 bg-white rounded-lg shadow-lg max-w-md">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        ⚡ Electron Required
      </h1>
      <p className="text-gray-600 mb-4">
        This application requires Electron to run. It cannot run in a standard web browser.
      </p>
      <div className="bg-gray-50 p-4 rounded border border-gray-200">
        <p className="text-sm text-gray-700 mb-2 font-semibold">To run the app:</p>
        <code className="block bg-gray-800 text-green-400 px-3 py-2 rounded text-sm">
          npx electron .
        </code>
      </div>
      <p className="text-xs text-gray-400 mt-4">
        window.electronAPI is not available in browser context
      </p>
    </div>
  </div>
);

// Main application component (assumes electronAPI exists)
const FileManagerApp: React.FC = () => {
  // Toast notifications (must be before useFileSystem)
  const { toasts, showToast, removeToast } = useToast();

  // File system state with shared toast handlers
  const {
    files,
    loading,
    error,
    readDirectory,
    currentPath,
    deleteFile,
    moveFile,
  } = useFileSystem({
    onError: (message) => showToast({ type: 'error', message }),
    onSuccess: (message) => showToast({ type: 'success', message }),
  });

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
  const [renameFile, setRenameFile] = useState<FileNode | null>(null);

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

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
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

  // Load home directory on mount (ONCE only)
  // Using empty dependency array because we only want this to run on initial mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Async IIFE to handle the initial navigation
    (async () => {
      try {
        // Fetch home directory from main process via IPC (not os-browserify polyfill)
        const systemPaths = await window.electronAPI.fs.getSystemPaths();
        const homeDir = systemPaths.home;
        await navigateTo(homeDir);
        await readDirectory(homeDir);
      } catch (error) {
        console.error('Failed to load home directory:', error);
      }
    })();
  }, []); // Empty deps - run only on mount

  // Additional event handlers (after keyboard shortcut handlers)
  const handleFileClick = (file: FileNode) => {
    setSelectedFiles([file.path]);
  };

  const handleFileDoubleClick = async (file: FileNode) => {
    if (file.isDirectory) {
      await navigateTo(file.path);
      await readDirectory(file.path);
    } else {
      // Open file with default OS application
      try {
        const result = await window.electronAPI.shell.openPath(file.path);
        if (!result.success) {
          showToast({
            type: 'error',
            message: result.error || 'Failed to open file'
          });
        }
      } catch (error: any) {
        showToast({
          type: 'error',
          message: error.message || 'Failed to open file'
        });
      }
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
          onSearch={async (query) => {
            // Search functionality using PathTrie-backed SEARCH:QUERY API
            try {
              const searchResults = await window.electronAPI.search.query(query, currentPath);
              if (searchResults.length > 0) {
                // Update file list to show search results
                // Note: This temporarily replaces the current directory listing
                showToast({ type: 'info', message: `Found ${searchResults.length} result(s) for "${query}"` });
              } else {
                showToast({ type: 'info', message: `No results found for "${query}"` });
              }
            } catch (error: any) {
              console.error('Search error:', error);
              showToast({ type: 'error', message: 'Search failed' });
            }
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
          onClose={handleCloseContextMenu}
          onOpen={() => handleFileDoubleClick(contextMenu.file)}
          onRename={() => {
            setRenameFile(contextMenu.file);
            handleCloseContextMenu();
          }}
          onDelete={async () => {
            await deleteFile(contextMenu.file.path);
            await readDirectory(currentPath);
            handleCloseContextMenu();
          }}
          onCopyPath={async () => {
            try {
              await window.electronAPI.clipboard.writeText(contextMenu.file.path);
              showToast({ type: 'success', message: 'Path copied to clipboard' });
            } catch (error: any) {
              showToast({ type: 'error', message: 'Failed to copy path' });
            }
            handleCloseContextMenu();
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

      {/* Rename Dialog */}
      <RenameDialog
        isOpen={renameFile !== null}
        currentName={renameFile?.name || ''}
        onConfirm={async (newName) => {
          if (!renameFile) return;
          try {
            const result = await window.electronAPI.fs.rename(renameFile.path, newName);
            if (result.success) {
              showToast({ type: 'success', message: `Renamed to ${newName}` });
              await readDirectory(currentPath);
            } else {
              showToast({ type: 'error', message: 'Failed to rename file' });
            }
          } catch (error: any) {
            showToast({ type: 'error', message: error.message || 'Failed to rename file' });
          }
          setRenameFile(null);
        }}
        onCancel={() => setRenameFile(null)}
      />
    </div>
  );
};

// Wrapper component that checks for Electron context
const App: React.FC = () => {
  // Check if running in Electron (electronAPI injected by preload)
  if (!window.electronAPI) {
    return <BrowserWarning />;
  }

  return <FileManagerApp />;
};

export default App;
