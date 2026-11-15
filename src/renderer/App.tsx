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
import { CommandOmnibar } from './components/SearchBar/CommandOmnibar';
import { DryRunPlanModal } from './components/Organizer/DryRunPlanModal';
import { Toast } from './components/common/Toast';
import { RenameDialog } from './components/common/RenameDialog';
import { CreateEntryDialog } from './components/common/CreateEntryDialog';
import { DeleteConfirmDialog } from './components/common/DeleteConfirmDialog';
import { ArrowUp, RefreshCw, X } from 'lucide-react';
import { useFileSystem } from './hooks/useFileSystem';
import { useNavigation } from './hooks/useNavigation';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useLLM } from './hooks/useLLM';
import { UI_CONSTANTS } from './utils/constants';
import { getErrorMessage } from './utils/formatters';
import { sortFileNodes, toggleMultiSelection } from './utils/explorerHelpers';
import {
  extractBasename,
  extractParentDirectory,
  isPathInsideDirectory,
  joinChildPath,
  normalizeComparablePath,
} from './utils/pathHelpers';
import {
  FileDeleteMode,
  FileEvent,
  FileLineRangeResult,
  FileNode,
  FilePreviewResult,
  OperationJournalState,
  VaultConfigSnapshot,
} from '@shared/contracts';

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
  const [omnibarOpen, setOmnibarOpen] = useState(false);
  const [organizeTargetDir, setOrganizeTargetDir] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('fm_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const [splitPaneOpen, setSplitPaneOpen] = useState(false);
  const [secondaryPath, setSecondaryPath] = useState<string>('');
  const [secondaryFiles, setSecondaryFiles] = useState<FileNode[]>([]);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [secondarySelectedFiles, setSecondarySelectedFiles] = useState<string[]>([]);
  const secondaryAnchorRef = useRef<string | null>(null);
  const [lastWatcherEvent, setLastWatcherEvent] = useState<FileEvent | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sidebarWidth, setSidebarWidth] = useState<number>(UI_CONSTANTS.SIDEBAR_DEFAULT_WIDTH);
  const [contextMenu, setContextMenu] = useState<{ file: FileNode; x: number; y: number } | null>(null);
  const [renameFile, setRenameFile] = useState<FileNode | null>(null);
  const [createEntryMode, setCreateEntryMode] = useState<'file' | 'directory' | null>(null);
  const [previewFileNode, setPreviewFileNode] = useState<FileNode | null>(null);
  const [previewResult, setPreviewResult] = useState<FilePreviewResult | null>(null);
  const [previewLineRange, setPreviewLineRange] = useState<FileLineRangeResult | null>(null);
  const [previewHighlightRange, setPreviewHighlightRange] = useState<{
    startLine: number;
    endLine?: number;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSeqRef = useRef(0);
  const previewOpenRef = useRef(false);
  const [vaultConfig, setVaultConfig] = useState<VaultConfigSnapshot | null>(null);
  const [journalState, setJournalState] = useState<OperationJournalState | null>(null);
  const [pendingDeletePaths, setPendingDeletePaths] = useState<string[] | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    try {
      window.localStorage.setItem('fm_theme', isDarkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage failures in restricted contexts
    }
  }, [isDarkMode]);

  useEffect(() => {
    const handleGlobalOmnibarShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOmnibarOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalOmnibarShortcut);
    return () => window.removeEventListener('keydown', handleGlobalOmnibarShortcut);
  }, []);

  const orderedFilePaths = useMemo(
    () => sortFileNodes(files, sortBy, sortDirection).map((f) => f.path),
    [files, sortBy, sortDirection]
  );

  const orderedSecondaryPaths = useMemo(
    () => sortFileNodes(secondaryFiles, sortBy, sortDirection).map((f) => f.path),
    [secondaryFiles, sortBy, sortDirection]
  );

  const loadSecondaryDirectory = useCallback(async (dirPath: string): Promise<boolean> => {
    if (!dirPath) return false;
    setSecondaryLoading(true);
    try {
      const entries = await window.electronAPI.fs.readDirectory(dirPath);
      setSecondaryPath(dirPath);
      setSecondaryFiles(entries);
      return true;
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Failed to read secondary pane directory'),
      });
      return false;
    } finally {
      setSecondaryLoading(false);
    }
  }, [showToast]);

  const handleToggleTheme = useCallback((): void => {
    setIsDarkMode((prev) => !prev);
  }, []);

  const handleToggleSplitPane = useCallback((): void => {
    const next = !splitPaneOpen;
    setSplitPaneOpen(next);
    if (next && !secondaryPath && currentPath) {
      void loadSecondaryDirectory(currentPath);
    }
  }, [splitPaneOpen, secondaryPath, currentPath, loadSecondaryDirectory]);

  const refreshWorkspaceMetadata = useCallback(async (): Promise<void> => {
    try {
      const [vaultRes, journalRes] = await Promise.allSettled([
        window.electronAPI.vault?.getConfig(),
        window.electronAPI.fs?.getJournalState(),
      ]);
      if (vaultRes.status === 'fulfilled' && vaultRes.value) {
        setVaultConfig(vaultRes.value);
      }
      if (journalRes.status === 'fulfilled' && journalRes.value) {
        setJournalState(journalRes.value);
      }
    } catch {
      // Safe fallback in partial test bridges
    }
  }, []);

  const selectedSingleFile = useMemo((): FileNode | null => {
    if (selectedFiles.length !== 1) return null;
    const match = files.find((f) => f.path === selectedFiles[0]);
    return match && !match.isDirectory ? match : null;
  }, [selectedFiles, files]);

  const loadFilePreview = useCallback(async (
    file: FileNode,
    rangeFocus: { startLine: number; endLine?: number } | null = null
  ): Promise<void> => {
    if (file.isDirectory) return;
    const seq = ++previewSeqRef.current;
    previewOpenRef.current = true;
    setPreviewFileNode(file);
    setPreviewLoading(true);
    setPreviewError(null);
    if (!rangeFocus) {
      setPreviewLineRange(null);
      setPreviewHighlightRange(null);
    } else {
      setPreviewHighlightRange(rangeFocus);
    }

    try {
      const previewPromise = window.electronAPI.fs.previewFile(file.path, 100);
      const rangePromise =
        rangeFocus && typeof window.electronAPI.fs.readFileRange === 'function'
          ? window.electronAPI.fs.readFileRange(file.path, rangeFocus.startLine, rangeFocus.endLine, 8)
          : Promise.resolve<FileLineRangeResult | null>(null);

      const [result, rangeResult] = await Promise.all([previewPromise, rangePromise]);
      if (!previewOpenRef.current || seq !== previewSeqRef.current) {
        return;
      }
      setPreviewResult(result);
      setPreviewLineRange(rangeResult);
    } catch (err: unknown) {
      if (!previewOpenRef.current || seq !== previewSeqRef.current) {
        return;
      }
      setPreviewResult(null);
      setPreviewLineRange(null);
      setPreviewError(getErrorMessage(err, 'Failed to preview file'));
    } finally {
      if (previewOpenRef.current && seq === previewSeqRef.current) {
        setPreviewLoading(false);
      }
    }
  }, []);

  const handleOpenCitation = useCallback(async (
    filePathOrName: string,
    startLine?: number,
    endLine?: number
  ): Promise<void> => {
    try {
      let resolvedPath = filePathOrName.trim();
      const hasSeparator = resolvedPath.includes('/') || resolvedPath.includes('\\');
      if (!hasSeparator) {
        const localMatch = files.find(
          (f) => !f.isDirectory && f.name.toLowerCase() === resolvedPath.toLowerCase()
        );
        if (localMatch) {
          resolvedPath = localMatch.path;
        } else if (currentPath) {
          const matches = await window.electronAPI.search.query(resolvedPath, currentPath);
          const exactMatch = matches.find(
            (m) => m.name.toLowerCase() === resolvedPath.toLowerCase()
          );
          if (exactMatch) {
            resolvedPath = exactMatch.path;
          } else if (matches.length > 0) {
            resolvedPath = matches[0].path;
          }
        } else {
          const suggestions = await window.electronAPI.search.autocomplete(resolvedPath, 10);
          const exactSuggestion = suggestions.find(
            (s) => extractBasename(s).toLowerCase() === resolvedPath.toLowerCase()
          );
          if (exactSuggestion) {
            resolvedPath = exactSuggestion;
          } else if (suggestions.length > 0) {
            resolvedPath = suggestions[0];
          }
        }
      }

      const stats = await window.electronAPI.fs.getStats(resolvedPath);
      if (stats.isDirectory) {
        await readDirectory(resolvedPath);
        await navigateTo(resolvedPath);
        return;
      }

      const name = extractBasename(resolvedPath);
      const dotIdx = name.lastIndexOf('.');
      const extension = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
      const targetNode: FileNode = {
        path: resolvedPath,
        name,
        isDirectory: false,
        size: stats.size,
        modified: stats.modified,
        extension,
        mimeType: extension ? `application/${extension}` : 'application/octet-stream',
        isHidden: name.startsWith('.'),
      };

      const rangeFocus =
        typeof startLine === 'number' && Number.isFinite(startLine) && startLine >= 1
          ? { startLine, endLine }
          : null;
      await loadFilePreview(targetNode, rangeFocus);
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, `Failed to open citation "${filePathOrName}"`),
      });
    }
  }, [files, currentPath, readDirectory, navigateTo, loadFilePreview, showToast]);

  // Event handlers - wrapped in useCallback to create stable references
  const handleUndo = useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.fs.undo();
      if (result.state) {
        setJournalState(result.state);
      }
      if (result.success) {
        if (currentPath) {
          await readDirectory(currentPath);
        }
        showToast({
          type: 'success',
          message: `Undid: ${result.operation?.description || 'last operation'}`,
        });
      }
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Undo failed'),
      });
    }
  }, [currentPath, readDirectory, showToast]);

  const handleRedo = useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.fs.redo();
      if (result.state) {
        setJournalState(result.state);
      }
      if (result.success) {
        if (currentPath) {
          await readDirectory(currentPath);
        }
        showToast({
          type: 'success',
          message: `Redid: ${result.operation?.description || 'operation'}`,
        });
      }
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Redo failed'),
      });
    }
  }, [currentPath, readDirectory, showToast]);

  const executeDeletePaths = useCallback(async (
    targets: string[],
    mode: FileDeleteMode = 'vault'
  ): Promise<void> => {
    if (targets.length === 0) return;

    try {
      for (const filePath of targets) {
        await deleteFile(filePath, true, true, mode);
      }
      setSelectedFiles((prev) => prev.filter((p) => !targets.includes(p)));
      if (currentPath) {
        await readDirectory(currentPath);
      }
      await refreshWorkspaceMetadata();
      showToast({
        type: 'success',
        message:
          mode === 'vault'
            ? `Moved ${targets.length} item(s) to Trash Vault`
            : `Deleted ${targets.length} item(s)`,
        actionLabel: mode === 'vault' ? 'Undo' : undefined,
        onAction: mode === 'vault' ? (): void => { void handleUndo(); } : undefined,
      });
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Delete failed')
      });
    }
  }, [deleteFile, currentPath, readDirectory, refreshWorkspaceMetadata, showToast, handleUndo]);

  const handleDelete = useCallback((): void => {
    if (selectedFiles.length === 0) return;
    setPendingDeletePaths([...selectedFiles]);
  }, [selectedFiles]);

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
      handleDelete();
    }
  }, [selectedFiles.length, handleDelete]);

  const handlePreviewShortcut = useCallback((): void => {
    if (selectedSingleFile) {
      void loadFilePreview(selectedSingleFile);
    }
  }, [selectedSingleFile, loadFilePreview]);

  const handleSpaceQuickLook = useCallback((): void => {
    if (
      omnibarOpen ||
      organizeTargetDir !== null ||
      diagnosticsOpen ||
      renameFile !== null ||
      createEntryMode !== null ||
      pendingDeletePaths !== null
    ) {
      return;
    }

    if (
      previewFileNode !== null &&
      (!selectedSingleFile ||
        normalizeComparablePath(previewFileNode.path) ===
          normalizeComparablePath(selectedSingleFile.path))
    ) {
      previewOpenRef.current = false;
      previewSeqRef.current += 1;
      setPreviewFileNode(null);
      setPreviewResult(null);
      setPreviewLineRange(null);
      setPreviewHighlightRange(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    if (selectedSingleFile) {
      void loadFilePreview(selectedSingleFile);
    }
  }, [
    omnibarOpen,
    organizeTargetDir,
    diagnosticsOpen,
    renameFile,
    createEntryMode,
    pendingDeletePaths,
    previewFileNode,
    selectedSingleFile,
    loadFilePreview,
  ]);

  // File watcher updates - memoized callback to prevent listener churn
  const handleFileWatcherEvent = useCallback((event: FileEvent): void => {
    setLastWatcherEvent(event);

    if (currentPath && isPathInsideDirectory(event.path, currentPath)) {
      void readDirectory(currentPath); // Auto-refresh
      showToast({
        type: 'info',
        message: `File ${event.type}: ${extractBasename(event.path)}`,
        duration: 2000
      });
    }

    if (splitPaneOpen && secondaryPath && isPathInsideDirectory(event.path, secondaryPath)) {
      void loadSecondaryDirectory(secondaryPath);
    }

    if (
      previewFileNode &&
      normalizeComparablePath(previewFileNode.path) === normalizeComparablePath(event.path)
    ) {
      if (event.type === 'unlink') {
        previewSeqRef.current += 1;
        setPreviewResult(null);
        setPreviewLineRange(null);
        setPreviewHighlightRange(null);
        setPreviewLoading(false);
        setPreviewError('File was removed on disk');
      } else {
        void loadFilePreview(previewFileNode, previewHighlightRange);
      }
    }
  }, [
    currentPath,
    readDirectory,
    splitPaneOpen,
    secondaryPath,
    loadSecondaryDirectory,
    showToast,
    previewFileNode,
    loadFilePreview,
    previewHighlightRange,
  ]);

  useFileWatcher(handleFileWatcherEvent);

  // Keyboard shortcuts - memoize shortcuts object to prevent effect churn
  const shortcuts = useMemo(() => ({
    'Ctrl+Shift+L': handleToggleChat,
    'Alt+Left': handleBack,
    'Alt+Right': handleForward,
    'Alt+P': handlePreviewShortcut,
    ' ': handleSpaceQuickLook,
    'F6': handleToggleSplitPane,
    'Delete': handleDeleteShortcut,
    'Ctrl+Z': (): void => { void handleUndo(); },
    'Ctrl+Y': (): void => { void handleRedo(); },
    'Ctrl+Shift+Z': (): void => { void handleRedo(); },
  }), [
    handleToggleChat,
    handleBack,
    handleForward,
    handlePreviewShortcut,
    handleSpaceQuickLook,
    handleToggleSplitPane,
    handleDeleteShortcut,
    handleUndo,
    handleRedo,
  ]);

  useKeyboardShortcuts(shortcuts);

  // Load home directory on mount (ONCE only)
  useEffect(() => {
    // Async IIFE to handle the initial navigation
    (async (): Promise<void> => {
      try {
        await refreshWorkspaceMetadata();
        // Fetch home directory from main process via IPC (not os-browserify polyfill)
        const systemPaths = await window.electronAPI.fs.getSystemPaths();
        const homeDir = systemPaths.home;
        const ok = await readDirectory(homeDir);
        if (ok) {
          await navigateTo(homeDir);
        }
      } catch (err: unknown) {
        showToast({ type: 'error', message: getErrorMessage(err, 'Failed to load home directory') });
      }
    })();
  }, []); // Empty deps - run only on mount

  // Additional event handlers (after keyboard shortcut handlers)
  const handleFileClick = useCallback((file: FileNode, e?: React.MouseEvent): void => {
    const { selected, nextAnchor } = toggleMultiSelection(
      selectedFiles,
      orderedFilePaths,
      file.path,
      {
        ctrlKey: e?.ctrlKey,
        metaKey: e?.metaKey,
        shiftKey: e?.shiftKey,
      },
      selectionAnchorRef.current
    );
    selectionAnchorRef.current = nextAnchor;
    setSelectedFiles(selected);
  }, [selectedFiles, orderedFilePaths]);

  const handleSecondaryFileClick = useCallback((file: FileNode, e?: React.MouseEvent): void => {
    const { selected, nextAnchor } = toggleMultiSelection(
      secondarySelectedFiles,
      orderedSecondaryPaths,
      file.path,
      {
        ctrlKey: e?.ctrlKey,
        metaKey: e?.metaKey,
        shiftKey: e?.shiftKey,
      },
      secondaryAnchorRef.current
    );
    secondaryAnchorRef.current = nextAnchor;
    setSecondarySelectedFiles(selected);
  }, [secondarySelectedFiles, orderedSecondaryPaths]);

  const handleSecondaryFileDoubleClick = useCallback(async (file: FileNode): Promise<void> => {
    if (file.isDirectory) {
      setSecondarySelectedFiles([]);
      await loadSecondaryDirectory(file.path);
    } else {
      await loadFilePreview(file);
    }
  }, [loadSecondaryDirectory, loadFilePreview]);

  const handleDropMove = useCallback(async (sourcePaths: string[], destinationDir: string): Promise<void> => {
    if (!destinationDir || sourcePaths.length === 0) return;
    const normalizedDest = normalizeComparablePath(destinationDir);
    const eligibleSources = sourcePaths.filter((srcPath) => {
      const normalizedSrc = normalizeComparablePath(srcPath);
      if (!normalizedSrc || normalizedSrc === normalizedDest) return false;
      if (isPathInsideDirectory(destinationDir, srcPath)) return false;
      const parentNorm = normalizeComparablePath(extractParentDirectory(srcPath));
      return parentNorm !== normalizedDest;
    });

    if (eligibleSources.length === 0) return;

    let movedCount = 0;
    try {
      for (const srcPath of eligibleSources) {
        const destTarget = joinChildPath(destinationDir, extractBasename(srcPath));
        const res = await window.electronAPI.fs.move(srcPath, destTarget);
        if (res.success) {
          movedCount += 1;
        }
      }
      if (movedCount > 0) {
        if (currentPath) {
          await readDirectory(currentPath);
        }
        if (splitPaneOpen && secondaryPath) {
          await loadSecondaryDirectory(secondaryPath);
        }
        await refreshWorkspaceMetadata();
        showToast({
          type: 'success',
          message: `Moved ${movedCount} item(s) to ${extractBasename(destinationDir) || destinationDir}`,
          actionLabel: 'Undo',
          onAction: (): void => { void handleUndo(); },
        });
      }
    } catch (err: unknown) {
      showToast({
        type: 'error',
        message: getErrorMessage(err, 'Failed to move item(s)'),
      });
    }
  }, [
    currentPath,
    readDirectory,
    splitPaneOpen,
    secondaryPath,
    loadSecondaryDirectory,
    refreshWorkspaceMetadata,
    showToast,
    handleUndo,
  ]);

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

  const handleAddVaultRoot = useCallback(async (): Promise<void> => {
    try {
      const res = await window.electronAPI.vault.addRoot({ pickDialog: true });
      setVaultConfig(res.config);
      if (!res.cancelled && res.addedPath) {
        showToast({ type: 'success', message: `Added workspace: ${extractBasename(res.addedPath)}` });
        await handleNavigate(res.addedPath);
      }
    } catch (err: unknown) {
      showToast({ type: 'error', message: getErrorMessage(err, 'Failed to add workspace root') });
    }
  }, [showToast, handleNavigate]);

  const handleRemoveVaultRoot = useCallback(async (rootPath: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.vault.removeRoot(rootPath);
      setVaultConfig(updated);
      showToast({ type: 'info', message: `Removed workspace: ${extractBasename(rootPath)}` });
    } catch (err: unknown) {
      showToast({ type: 'error', message: getErrorMessage(err, 'Failed to remove workspace root') });
    }
  }, [showToast]);

  const handleToggleIndexedRoot = useCallback(async (rootPath: string, enabled: boolean): Promise<void> => {
    try {
      const updated = await window.electronAPI.vault.setIndexed(rootPath, enabled);
      setVaultConfig(updated);
      showToast({
        type: 'info',
        message: enabled
          ? `Enabled AI indexing for ${extractBasename(rootPath)}`
          : `Disabled AI indexing for ${extractBasename(rootPath)}`,
      });
    } catch (err: unknown) {
      showToast({ type: 'error', message: getErrorMessage(err, 'Failed to update AI index setting') });
    }
  }, [showToast]);

  const handleToggleFavorite = useCallback(async (targetPath: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.vault.toggleFavorite(targetPath);
      setVaultConfig(updated);
    } catch (err: unknown) {
      showToast({ type: 'error', message: getErrorMessage(err, 'Failed to toggle favorite') });
    }
  }, [showToast]);

  const handleEmptyTrashVault = useCallback(async (): Promise<void> => {
    try {
      const updatedState = await window.electronAPI.fs.emptyTrashVault();
      setJournalState(updatedState);
      showToast({ type: 'info', message: 'Trash Vault emptied' });
    } catch (err: unknown) {
      showToast({ type: 'error', message: getErrorMessage(err, 'Failed to empty Trash Vault') });
    }
  }, [showToast]);

  return (
    <div
      className="flex h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100"
      data-testid="app-container"
    >
      {/* Sidebar */}
      <Sidebar
        width={sidebarWidth}
        onResize={setSidebarWidth}
        onNavigate={handleNavigate}
        vaultConfig={vaultConfig}
        journalState={journalState}
        lastWatcherEvent={lastWatcherEvent}
        onAddVaultRoot={handleAddVaultRoot}
        onRemoveVaultRoot={handleRemoveVaultRoot}
        onToggleIndexedRoot={handleToggleIndexedRoot}
        onToggleFavorite={handleToggleFavorite}
        onEmptyTrashVault={handleEmptyTrashVault}
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
          canUndo={Boolean(journalState?.canUndo)}
          canRedo={Boolean(journalState?.canRedo)}
          undoDescription={journalState?.lastUndoDescription}
          redoDescription={journalState?.lastRedoDescription}
          onUndo={(): void => { void handleUndo(); }}
          onRedo={(): void => { void handleRedo(); }}
          onOpenDiagnostics={(): void => setDiagnosticsOpen(true)}
          onOpenOmnibar={(): void => setOmnibarOpen(true)}
          onOpenOrganize={(): void => {
            if (currentPath) {
              setOrganizeTargetDir(currentPath);
            }
          }}
          splitPaneOpen={splitPaneOpen}
          onToggleSplitPane={handleToggleSplitPane}
          isDarkMode={isDarkMode}
          onToggleTheme={handleToggleTheme}
          chatOpen={chatOpen}
          onToggleChat={handleToggleChat}
        />

        {/* Explorer + Inspector Drawers Row */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Primary File Explorer */}
          <div className="flex-1 min-w-0 overflow-hidden p-4 dark:bg-slate-950" data-testid="file-explorer">
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
              currentDirectory={currentPath}
              onDropMove={(sources, dest): void => {
                void handleDropMove(sources, dest);
              }}
            />
          </div>

          {/* Secondary Split-Pane Explorer (F6) */}
          {splitPaneOpen && (
            <div
              className="flex-1 min-w-0 flex flex-col border-l border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden"
              data-testid="split-pane-right"
            >
              <div className="px-3 py-1.5 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={(): void => {
                      const parent = extractParentDirectory(secondaryPath);
                      if (parent && parent !== secondaryPath) {
                        void loadSecondaryDirectory(parent);
                      }
                    }}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
                    title="Up one folder"
                    data-testid="split-pane-up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <span
                    className="font-mono text-[11px] text-gray-700 dark:text-slate-300 truncate"
                    title={secondaryPath}
                    data-testid="split-pane-path"
                  >
                    {secondaryPath || currentPath}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(): void => {
                      if (secondaryPath) void loadSecondaryDirectory(secondaryPath);
                    }}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
                    title="Refresh secondary pane"
                    data-testid="split-pane-refresh"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleSplitPane}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-300"
                    title="Close split pane (F6)"
                    data-testid="split-pane-close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden p-4">
                <FileGrid
                  files={secondaryFiles}
                  selectedFiles={secondarySelectedFiles}
                  onFileClick={handleSecondaryFileClick}
                  onFileDoubleClick={handleSecondaryFileDoubleClick}
                  onFileContextMenu={handleFileContextMenu}
                  sortBy={sortBy}
                  sortDirection={sortDirection}
                  viewMode={viewMode}
                  loading={secondaryLoading}
                  currentDirectory={secondaryPath}
                  onDropMove={(sources, dest): void => {
                    void handleDropMove(sources, dest);
                  }}
                />
              </div>
            </div>
          )}

          {/* Quick Preview Drawer (RingBuffer + LRUCache + vault-asset:// + #Lx-Ly Citations) */}
          <FilePreviewDrawer
            isOpen={previewFileNode !== null}
            file={previewFileNode}
            preview={previewResult}
            lineRange={previewLineRange}
            highlightRange={previewHighlightRange}
            loading={previewLoading}
            error={previewError}
            onClose={(): void => {
              previewOpenRef.current = false;
              previewSeqRef.current += 1;
              setPreviewFileNode(null);
              setPreviewResult(null);
              setPreviewLineRange(null);
              setPreviewHighlightRange(null);
              setPreviewError(null);
              setPreviewLoading(false);
            }}
            onRefresh={(): void => {
              if (previewFileNode) {
                void loadFilePreview(previewFileNode, previewHighlightRange);
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
            onClearRangeFocus={(): void => {
              setPreviewLineRange(null);
              setPreviewHighlightRange(null);
            }}
          />

          {/* Chat Panel */}
          {chatOpen && (
            <div
              className="w-96 h-full flex-shrink-0 bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shadow-lg"
              data-testid="chat-panel-container"
            >
              <ChatInterface
                currentPath={currentPath}
                selectedPaths={selectedFiles}
                llm={llmState}
                onOpenCitation={(filePath, startLine, endLine): void => {
                  void handleOpenCitation(filePath, startLine, endLine);
                }}
                onOpenOrganize={(targetDir): void => {
                  if (targetDir) {
                    setOrganizeTargetDir(targetDir);
                  }
                }}
              />
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
          isFavorite={Boolean(
            vaultConfig?.favorites.some(
              (f) => normalizeComparablePath(f) === normalizeComparablePath(contextMenu.file.path)
            )
          )}
          onToggleFavorite={(): void => {
            void handleToggleFavorite(contextMenu.file.path);
            handleCloseContextMenu();
          }}
          onDelete={(): void => {
            setPendingDeletePaths([contextMenu.file.path]);
            handleCloseContextMenu();
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

      {/* Toast Container (bottom-right so top toolbar Undo/Redo/Chat controls are never occluded) */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
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
              await refreshWorkspaceMetadata();
              showToast({
                type: 'success',
                message: `Renamed to ${newName}`,
                actionLabel: 'Undo',
                onAction: (): void => { void handleUndo(); },
              });
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
              showToast({
                type: 'success',
                message: `Created file ${entryName}`,
                actionLabel: 'Undo',
                onAction: (): void => { void handleUndo(); },
              });
            } else {
              await window.electronAPI.fs.createDirectory(currentPath, entryName);
              showToast({
                type: 'success',
                message: `Created folder ${entryName}`,
                actionLabel: 'Undo',
                onAction: (): void => { void handleUndo(); },
              });
            }
            await refreshWorkspaceMetadata();
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

      {/* Delete Mode Confirmation Dialog (Trash Vault / OS Trash / Permanent) */}
      <DeleteConfirmDialog
        isOpen={pendingDeletePaths !== null}
        targetPaths={pendingDeletePaths ?? []}
        defaultMode={vaultConfig?.defaultDeleteMode ?? 'vault'}
        onConfirm={(mode): void => {
          const targets = pendingDeletePaths ?? [];
          setPendingDeletePaths(null);
          void executeDeletePaths(targets, mode);
        }}
        onCancel={(): void => setPendingDeletePaths(null)}
      />

      {/* Kernel Runtime Diagnostics Modal */}
      <DiagnosticsModal
        isOpen={diagnosticsOpen}
        onClose={(): void => setDiagnosticsOpen(false)}
      />

      {/* Unified Command & Search Omnibar (Ctrl+K) */}
      <CommandOmnibar
        isOpen={omnibarOpen}
        onClose={(): void => setOmnibarOpen(false)}
        currentPath={currentPath}
        onNavigateFile={handleSearchSelect}
        onOpenCitation={handleOpenCitation}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
        splitPaneOpen={splitPaneOpen}
        onToggleSplitPane={handleToggleSplitPane}
        onToggleChat={handleToggleChat}
        onIndexCurrentDir={(): void => {
          if (currentPath) {
            setChatOpen(true);
            void llmState.startIndexing(currentPath);
          }
        }}
        onOrganizeCurrentDir={(): void => {
          if (currentPath) {
            setOrganizeTargetDir(currentPath);
          }
        }}
      />

      {/* AI Folder Organization Dry-Run Plan Modal */}
      <DryRunPlanModal
        isOpen={organizeTargetDir !== null}
        targetDir={organizeTargetDir ?? currentPath}
        onClose={(): void => setOrganizeTargetDir(null)}
        onApplied={async (result): Promise<void> => {
          setOrganizeTargetDir(null);
          setSelectedFiles([]);
          if (currentPath) {
            await readDirectory(currentPath);
          }
          await refreshWorkspaceMetadata();
          showToast({
            type: 'success',
            message: `Organized ${result.appliedCount} file(s)`,
            actionLabel: 'Undo',
            onAction: (): void => {
              void handleUndo();
            },
          });
        }}
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
