/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { FileGrid } from './components/FileExplorer/FileGrid';
import { ChatInterface } from './components/ChatPanel/ChatInterface';
import { FileContextMenu } from './components/ContextMenu/FileContextMenu';
import { DiagnosticsModal } from './components/Diagnostics/DiagnosticsModal';
import { FilePreviewDrawer } from './components/Preview/FilePreviewDrawer';
import { Toast } from './components/common/Toast';
import { RenameDialog } from './components/common/RenameDialog';
import { CreateEntryDialog } from './components/common/CreateEntryDialog';
import { useFileSystem } from './hooks/useFileSystem';
import { useNavigation } from './hooks/useNavigation';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useLLM } from './hooks/useLLM';
import { UI_CONSTANTS } from './utils/constants';
import {
  extractBasename,
  extractParentDirectory,
  isPathInsideDirectory,
  normalizeComparablePath,
} from './utils/pathHelpers';
import { FileEvent, FileNode, FilePreviewResult } from '@shared/contracts';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

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
    setSearchResults,
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

  // Persistent LLM state lifted above chat panel toggle
  const llmState = useLLM();

  // UI state
  const [chatOpen, setChatOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sidebarWidth, setSidebarWidth] = useState<number>(UI_CONSTANTS.SIDEBAR_DEFAULT_WIDTH);
  const [contextMenu, setContextMenu] = useState<{ file: FileNode; x: number; y: number } | null>(null);
  const [renameFile, setRenameFile] = useState<FileNode | null>(null);
  const [createEntryMode, setCreateEntryMode] = useState<'file' | 'directory' | null>(null);
  const [previewFileNode, setPreviewFileNode] = useState<FileNode | null>(null);
  const [previewResult, setPreviewResult] = useState<FilePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSeqRef = useRef(0);
  const previewOpenRef = useRef(false);

  const selectedSingleFile = useMemo((): FileNode | null => {
    if (selectedFiles.length !== 1) return null;
    const match = files.find((f) => f.path === selectedFiles[0]);
    return match && !match.isDirectory ? match : null;
  }, [selectedFiles, files]);

  const loadFilePreview = useCallback(async (file: FileNode): Promise<void> => {
    if (file.isDirectory) return;
    const seq = ++previewSeqRef.current;
    previewOpenRef.current = true;
    setPreviewFileNode(file);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await window.electronAPI.fs.previewFile(file.path, 100);
      if (!previewOpenRef.current || seq !== previewSeqRef.current) {
        return;
      }
      setPreviewResult(result);
    } catch (err: unknown) {
      if (!previewOpenRef.current || seq !== previewSeqRef.current) {
        return;
      }
      setPreviewResult(null);
      setPreviewError(getErrorMessage(err, 'Failed to preview file'));
    } finally {
      if (previewOpenRef.current && seq === previewSeqRef.current) {
        setPreviewLoading(false);
      }
    }
  }, []);

  // Event handlers - wrapped in useCallback to create stable references
  const handleDelete = useCallback(async (): Promise<void> => {
    if (selectedFiles.length === 0) return;
    const targets = [...selectedFiles];

    try {
      for (const filePath of targets) {
        await deleteFile(filePath, true, true);
      }
      showToast({
        type: 'success',
        message: `Deleted ${targets.length} file(s)`
      });
      setSelectedFiles([]);
      await readDirectory(currentPath);
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Delete failed')
      });
    }
  }, [selectedFiles, deleteFile, showToast, readDirectory, currentPath]);

  const handleBack = useCallback(async (): Promise<void> => {
    const prevPath = await goBack();
    if (prevPath) {
      setSelectedFiles([]);
      await readDirectory(prevPath);
    }
  }, [goBack, readDirectory]);

  const handleForward = useCallback(async (): Promise<void> => {
    const nextPath = await goForward();
    if (nextPath) {
      setSelectedFiles([]);
      await readDirectory(nextPath);
    }
  }, [goForward, readDirectory]);

  const handleToggleChat = useCallback((): void => {
    setChatOpen(prev => !prev);
  }, []);

  const handleSortDirectionToggle = useCallback((): void => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  const handleCloseContextMenu = useCallback((): void => {
    setContextMenu(null);
  }, []);

  const handleDeleteShortcut = useCallback((): void => {
    if (selectedFiles.length > 0) {
      void handleDelete();
    }
  }, [selectedFiles.length, handleDelete]);

  const handlePreviewShortcut = useCallback((): void => {
    if (selectedSingleFile) {
      void loadFilePreview(selectedSingleFile);
    }
  }, [selectedSingleFile, loadFilePreview]);

  // File watcher updates - memoized callback to prevent listener churn
  const handleFileWatcherEvent = useCallback((event: FileEvent): void => {
    if (currentPath && isPathInsideDirectory(event.path, currentPath)) {
      void readDirectory(currentPath); // Auto-refresh
      showToast({
        type: 'info',
        message: `File ${event.type}: ${extractBasename(event.path)}`,
        duration: 2000
      });
    }

    if (
      previewFileNode &&
      normalizeComparablePath(previewFileNode.path) === normalizeComparablePath(event.path)
    ) {
      if (event.type === 'unlink') {
        previewSeqRef.current += 1;
        setPreviewResult(null);
        setPreviewLoading(false);
        setPreviewError('File was removed on disk');
      } else {
        void loadFilePreview(previewFileNode);
      }
    }
  }, [currentPath, readDirectory, showToast, previewFileNode, loadFilePreview]);

  useFileWatcher(handleFileWatcherEvent);

  // Keyboard shortcuts - memoize shortcuts object to prevent effect churn
  const shortcuts = useMemo(() => ({
    'Ctrl+Shift+L': handleToggleChat,
    'Alt+Left': handleBack,
    'Alt+Right': handleForward,
    'Alt+P': handlePreviewShortcut,
    'Delete': handleDeleteShortcut,
  }), [handleToggleChat, handleBack, handleForward, handlePreviewShortcut, handleDeleteShortcut]);

  useKeyboardShortcuts(shortcuts);

  // Load home directory on mount (ONCE only)
  useEffect(() => {
    // Async IIFE to handle the initial navigation
    (async (): Promise<void> => {
      try {
        // Fetch home directory from main process via IPC (not os-browserify polyfill)
        const systemPaths = await window.electronAPI.fs.getSystemPaths();
        const homeDir = systemPaths.home;
        const ok = await readDirectory(homeDir);
        if (ok) {
          await navigateTo(homeDir);
        }
      } catch (err: unknown) {
        console.error('Failed to load home directory:', err);
      }
    })();
  }, []); // Empty deps - run only on mount

  // Additional event handlers (after keyboard shortcut handlers)
  const handleFileClick = (file: FileNode): void => {
    setSelectedFiles([file.path]);
  };

  const handleFileDoubleClick = async (file: FileNode): Promise<void> => {
    if (file.isDirectory) {
      setSelectedFiles([]);
      const ok = await readDirectory(file.path);
      if (ok) {
        await navigateTo(file.path);
      }
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
      } catch (err: unknown) {
        showToast({
          type: 'error',
          message: getErrorMessage(err, 'Failed to open file')
        });
      }
    }
  };

  const handleFileContextMenu = (file: FileNode, e: React.MouseEvent): void => {
    e.preventDefault();
    setContextMenu({ file, x: e.clientX, y: e.clientY });
  };

  const handleNavigate = async (path: string): Promise<void> => {
    setSelectedFiles([]);
    const ok = await readDirectory(path);
    if (ok) {
      await navigateTo(path);
    }
  };

  const handleSearchSelect = async (selectedPath: string): Promise<void> => {
    try {
      const stats = await window.electronAPI.fs.getStats(selectedPath);
      if (stats.isDirectory) {
        await handleNavigate(selectedPath);
        return;
      }

      const parentDir = extractParentDirectory(selectedPath);
      const ok = await readDirectory(parentDir);
      if (ok) {
        await navigateTo(parentDir);
      }
      setSelectedFiles([selectedPath]);

      const name = extractBasename(selectedPath);
      const dotIdx = name.lastIndexOf('.');
      const extension = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
      const previewNode: FileNode = {
        path: selectedPath,
        name,
        isDirectory: false,
        size: stats.size,
        modified: stats.modified,
        extension,
        mimeType: extension ? `application/${extension}` : 'application/octet-stream',
        isHidden: name.startsWith('.'),
      };
      await loadFilePreview(previewNode);
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Failed to open search suggestion'),
      });
    }
  };

  return (
    <div className="flex h-screen bg-gray-50" data-testid="app-container">
      {/* Sidebar */}
      <Sidebar
        width={sidebarWidth}
        onResize={setSidebarWidth}
        onNavigate={handleNavigate}
      />

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="main-content">
        {/* Toolbar */}
        <Toolbar
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={handleBack}
          onForward={handleForward}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          onSearchSelect={handleSearchSelect}
          onSearch={async (query): Promise<void> => {
            // Empty query = clear search and show current directory
            if (!query || query.trim() === '') {
              await readDirectory(currentPath);
              return;
            }

            // Search functionality using PathTrie-backed SEARCH:QUERY API
            try {
              const searchResults = await window.electronAPI.search.query(query, currentPath);
              if (searchResults.length > 0) {
                // Update file list to show search results
                setSearchResults(searchResults);
                showToast({ type: 'info', message: `Found ${searchResults.length} result(s) for "${query}"` });
              } else {
                // Clear results and show "no results" message
                setSearchResults([]);
                showToast({ type: 'info', message: `No results found for "${query}"` });
              }
            } catch (err: unknown) {
              console.error('Search error:', err);
              showToast({ type: 'error', message: getErrorMessage(err, 'Search failed') });
            }
          }}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortBy={sortBy}
          onSortChange={setSortBy}
          sortDirection={sortDirection}
          onSortDirectionToggle={handleSortDirectionToggle}
          onNewFile={(): void => setCreateEntryMode('file')}
          onNewFolder={(): void => setCreateEntryMode('directory')}
          canPreviewSelected={selectedSingleFile !== null}
          onPreviewSelected={(): void => {
            if (selectedSingleFile) {
              void loadFilePreview(selectedSingleFile);
            }
          }}
          onOpenDiagnostics={(): void => setDiagnosticsOpen(true)}
          chatOpen={chatOpen}
          onToggleChat={handleToggleChat}
        />

        {/* Explorer + Inspector Drawers Row */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* File Explorer */}
          <div className="flex-1 min-w-0 overflow-hidden p-4" data-testid="file-explorer">
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

          {/* Quick Preview Drawer (RingBuffer + LRUCache) */}
          <FilePreviewDrawer
            isOpen={previewFileNode !== null}
            file={previewFileNode}
            preview={previewResult}
            loading={previewLoading}
            error={previewError}
            onClose={(): void => {
              previewOpenRef.current = false;
              previewSeqRef.current += 1;
              setPreviewFileNode(null);
              setPreviewResult(null);
              setPreviewError(null);
              setPreviewLoading(false);
            }}
            onRefresh={(): void => {
              if (previewFileNode) {
                void loadFilePreview(previewFileNode);
              }
            }}
            onOpenExternal={(): void => {
              if (previewFileNode) {
                void handleFileDoubleClick(previewFileNode);
              }
            }}
            onCopyPath={async (): Promise<void> => {
              if (!previewFileNode) return;
              try {
                await window.electronAPI.clipboard.writeText(previewFileNode.path);
                showToast({ type: 'success', message: 'Path copied to clipboard' });
              } catch (err: unknown) {
                showToast({ type: 'error', message: getErrorMessage(err, 'Failed to copy path') });
              }
            }}
          />

          {/* Chat Panel */}
          {chatOpen && (
            <div
              className="w-96 h-full flex-shrink-0 bg-white border-l border-gray-200 shadow-lg"
              data-testid="chat-panel-container"
            >
              <ChatInterface currentPath={currentPath} llm={llmState} />
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={handleCloseContextMenu}
          onOpen={(): Promise<void> => handleFileDoubleClick(contextMenu.file)}
          onPreview={(): void => {
            void loadFilePreview(contextMenu.file);
          }}
          onRename={(): void => {
            setRenameFile(contextMenu.file);
            handleCloseContextMenu();
          }}
          onDelete={async (): Promise<void> => {
            try {
              await deleteFile(contextMenu.file.path, true, true);
              setSelectedFiles((prev) => prev.filter((p) => p !== contextMenu.file.path));
              if (currentPath) {
                await readDirectory(currentPath);
              }
            } catch (err: unknown) {
              showToast({
                type: 'error',
                message: getErrorMessage(err, 'Delete failed'),
              });
            } finally {
              handleCloseContextMenu();
            }
          }}
          onCopyPath={async (): Promise<void> => {
            try {
              await window.electronAPI.clipboard.writeText(contextMenu.file.path);
              showToast({ type: 'success', message: 'Path copied to clipboard' });
            } catch (err: unknown) {
              showToast({ type: 'error', message: getErrorMessage(err, 'Failed to copy path') });
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
            onClose={(): void => removeToast(toast.id)}
          />
        ))}
      </div>

      {/* Rename Dialog */}
      <RenameDialog
        isOpen={renameFile !== null}
        currentName={renameFile?.name || ''}
        onConfirm={async (newName): Promise<void> => {
          if (!renameFile) return;
          try {
            const result = await window.electronAPI.fs.rename(renameFile.path, newName);
            if (result.success) {
              showToast({ type: 'success', message: `Renamed to ${newName}` });
              await readDirectory(currentPath);
            } else {
              showToast({ type: 'error', message: 'Failed to rename file' });
            }
          } catch (err: unknown) {
            showToast({ type: 'error', message: getErrorMessage(err, 'Failed to rename file') });
          }
          setRenameFile(null);
        }}
        onCancel={(): void => setRenameFile(null)}
      />

      {/* New File / New Folder Dialog */}
      <CreateEntryDialog
        isOpen={createEntryMode !== null}
        mode={createEntryMode ?? 'file'}
        onConfirm={async (entryName): Promise<void> => {
          if (!createEntryMode || !currentPath) return;
          try {
            if (createEntryMode === 'file') {
              await window.electronAPI.fs.createFile(currentPath, entryName, '');
              showToast({ type: 'success', message: `Created file ${entryName}` });
            } else {
              await window.electronAPI.fs.createDirectory(currentPath, entryName);
              showToast({ type: 'success', message: `Created folder ${entryName}` });
            }
            await readDirectory(currentPath);
            setCreateEntryMode(null);
          } catch (err: unknown) {
            showToast({
              type: 'error',
              message: getErrorMessage(err, `Failed to create ${createEntryMode}`),
            });
          }
        }}
        onCancel={(): void => setCreateEntryMode(null)}
      />

      {/* Kernel Runtime Diagnostics Modal */}
      <DiagnosticsModal
        isOpen={diagnosticsOpen}
        onClose={(): void => setDiagnosticsOpen(false)}
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
