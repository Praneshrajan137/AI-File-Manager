import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  FileText,
  FileCode2,
  Terminal,
  Moon,
  Sun,
  Columns,
  Bot,
  FolderSearch,
  Database,
  X,
  CornerDownLeft,
} from 'lucide-react';
import type { ContentSearchMatch, GraphInsightsResponse } from '@shared/contracts';
import { extractBasename } from '@renderer/utils/pathHelpers';

export type OmnibarTab = 'all' | 'files' | 'content' | 'commands';

interface OmnibarCommandItem {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  run: () => void;
}

interface CommandOmnibarProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  onNavigateFile: (filePath: string) => Promise<void> | void;
  onOpenCitation: (filePath: string, startLine?: number, endLine?: number) => Promise<void> | void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  splitPaneOpen: boolean;
  onToggleSplitPane: () => void;
  onToggleChat: () => void;
  onIndexCurrentDir: () => Promise<void> | void;
  onOrganizeCurrentDir?: () => void;
}

type OmnibarRow =
  | { kind: 'file'; key: string; path: string; name: string }
  | { kind: 'content'; key: string; match: ContentSearchMatch }
  | { kind: 'command'; key: string; command: OmnibarCommandItem };

export const CommandOmnibar: React.FC<CommandOmnibarProps> = ({
  isOpen,
  onClose,
  currentPath,
  onNavigateFile,
  onOpenCitation,
  isDarkMode,
  onToggleTheme,
  splitPaneOpen,
  onToggleSplitPane,
  onToggleChat,
  onIndexCurrentDir,
  onOrganizeCurrentDir,
}) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<OmnibarTab>('all');
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [contentResults, setContentResults] = useState<ContentSearchMatch[]>([]);
  const [graphInsights, setGraphInsights] = useState<GraphInsightsResponse | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchSeqRef = useRef(0);

  const commands = useMemo<OmnibarCommandItem[]>(
    () => [
      {
        id: 'toggle-theme',
        label: isDarkMode ? 'Switch to Crisp Light Theme' : 'Switch to Obsidian Dark Slate Theme',
        description: 'Toggle application appearance between Light and Dark Slate',
        run: onToggleTheme,
      },
      {
        id: 'toggle-split-pane',
        label: splitPaneOpen ? 'Close Split-Pane Explorer' : 'Open Split-Pane Dual Explorer',
        description: 'View two workspace directories side-by-side and drag-move files',
        shortcut: 'F6',
        run: onToggleSplitPane,
      },
      {
        id: 'toggle-chat',
        label: 'Toggle AI Copilot Sidebar',
        description: 'Open or close hybrid RAG chat assistant',
        shortcut: 'Ctrl+Shift+L',
        run: onToggleChat,
      },
      {
        id: 'index-current',
        label: 'Index Current Folder into Knowledge Graph',
        description: currentPath || 'No folder selected',
        run: (): void => {
          void onIndexCurrentDir();
        },
      },
      ...(onOrganizeCurrentDir
        ? [
            {
              id: 'organize-current',
              label: 'AI Organize Current Folder (Dry-Run)',
              description: currentPath || 'No folder selected',
              run: (): void => {
                onOrganizeCurrentDir();
              },
            },
          ]
        : []),
    ],
    [
      isDarkMode,
      splitPaneOpen,
      currentPath,
      onToggleTheme,
      onToggleSplitPane,
      onToggleChat,
      onIndexCurrentDir,
      onOrganizeCurrentDir,
    ]
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    setFileResults([]);
    setContentResults([]);
    const timer = setTimeout(() => inputRef.current?.focus(), 10);

    window.electronAPI?.graph
      ?.queryInsights?.()
      .then((insights) => setGraphInsights(insights))
      .catch(() => setGraphInsights(null));

    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    const seq = ++searchSeqRef.current;

    if (trimmed.length < 2 || activeTab === 'commands') {
      setFileResults([]);
      setContentResults([]);
      setLoadingResults(false);
      return;
    }

    setLoadingResults(true);
    const debounceTimer = setTimeout(async () => {
      try {
        const shouldSearchFiles = activeTab === 'all' || activeTab === 'files';
        const shouldSearchContent = activeTab === 'all' || activeTab === 'content';

        const [filesRes, contentRes] = await Promise.allSettled([
          shouldSearchFiles
            ? window.electronAPI.search.autocomplete(trimmed, 8)
            : Promise.resolve<string[]>([]),
          shouldSearchContent && window.electronAPI.search.content
            ? window.electronAPI.search.content(trimmed, 8)
            : Promise.resolve<ContentSearchMatch[]>([]),
        ]);

        if (seq !== searchSeqRef.current) return;
        setFileResults(filesRes.status === 'fulfilled' ? filesRes.value : []);
        setContentResults(contentRes.status === 'fulfilled' ? contentRes.value : []);
        setActiveIndex(0);
      } finally {
        if (seq === searchSeqRef.current) {
          setLoadingResults(false);
        }
      }
    }, 150);

    return () => clearTimeout(debounceTimer);
  }, [isOpen, query, activeTab]);

  const filteredCommands = useMemo(() => {
    if (activeTab !== 'all' && activeTab !== 'commands') return [];
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
    );
  }, [commands, query, activeTab]);

  const rows = useMemo<OmnibarRow[]>(() => {
    const out: OmnibarRow[] = [];
    if (activeTab === 'all' || activeTab === 'content') {
      for (const match of contentResults) {
        out.push({
          kind: 'content',
          key: `content:${match.chunkId}`,
          match,
        });
      }
    }
    if (activeTab === 'all' || activeTab === 'files') {
      for (const filePath of fileResults) {
        out.push({
          kind: 'file',
          key: `file:${filePath}`,
          path: filePath,
          name: extractBasename(filePath),
        });
      }
    }
    if (activeTab === 'all' || activeTab === 'commands') {
      for (const cmd of filteredCommands) {
        out.push({
          kind: 'command',
          key: `cmd:${cmd.id}`,
          command: cmd,
        });
      }
    }
    return out;
  }, [activeTab, contentResults, fileResults, filteredCommands]);

  useEffect(() => {
    if (activeIndex >= rows.length) {
      setActiveIndex(Math.max(0, rows.length - 1));
    }
  }, [rows.length, activeIndex]);

  const executeRow = (row: OmnibarRow): void => {
    onClose();
    if (row.kind === 'file') {
      void onNavigateFile(row.path);
    } else if (row.kind === 'content') {
      void onOpenCitation(row.match.filePath, row.match.startLine, row.match.endLine);
    } else {
      row.command.run();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (rows.length > 0 ? (prev + 1) % rows.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (rows.length > 0 ? (prev - 1 + rows.length) % rows.length : 0));
      return;
    }
    if (e.key === 'Enter' && rows[activeIndex]) {
      e.preventDefault();
      executeRow(rows[activeIndex]);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      data-testid="command-omnibar"
      role="dialog"
      aria-modal="true"
      aria-label="Command and Workspace Omnibar"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-primary-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        {/* Search Input Row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-primary-200 dark:border-slate-700">
          <Search className="w-5 h-5 text-indigo-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="omnibar-input"
            placeholder="Search files, indexed content (FTS5), symbols, or commands..."
            className="flex-1 bg-transparent text-sm text-primary-900 dark:text-slate-100 placeholder-primary-400 dark:placeholder-slate-500 focus:outline-none"
          />
          {loadingResults && (
            <span className="text-[11px] text-indigo-500 font-medium">Searching...</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close omnibar"
            data-testid="omnibar-close"
            className="p-1 rounded-lg text-primary-400 hover:bg-primary-100 dark:hover:bg-slate-800 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs + Knowledge Graph Insights Bar */}
        <div className="px-4 py-2 bg-primary-50/70 dark:bg-slate-950/60 border-b border-primary-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1" role="tablist">
            {(['all', 'files', 'content', 'commands'] as OmnibarTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                data-testid={`omnibar-tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white'
                    : 'text-primary-600 dark:text-slate-400 hover:bg-primary-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {graphInsights && (
            <div
              className="flex items-center gap-2 text-[11px] text-primary-500 dark:text-slate-400"
              data-testid="omnibar-graph-stats"
            >
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span>
                Graph: {graphInsights.stats.totalFiles} files / {graphInsights.stats.totalChunks} chunks
                {graphInsights.stats.duplicateClusters.length > 0
                  ? ` / ${graphInsights.stats.duplicateClusters.length} dup cluster(s)`
                  : ''}
              </span>
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="overflow-y-auto flex-1 p-2 space-y-1 scrollbar-thin" data-testid="omnibar-results">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-primary-400 dark:text-slate-500">
              {query.trim().length < 2
                ? 'Type at least 2 characters to search files & full-text content, or pick a command below.'
                : 'No matching files, indexed snippets, or commands.'}
            </div>
          ) : (
            rows.map((row, idx) => {
              const selected = idx === activeIndex;
              if (row.kind === 'content') {
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-testid="omnibar-content-result"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => executeRow(row)}
                    className={`w-full text-left px-3 py-2 rounded-xl flex items-start gap-3 transition-colors ${
                      selected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 ring-1 ring-indigo-300 dark:ring-indigo-700'
                        : 'hover:bg-primary-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <FileCode2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-primary-900 dark:text-slate-100 truncate">
                          {row.match.fileName}
                        </span>
                        {row.match.startLine && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono">
                            #L{row.match.startLine}
                            {row.match.endLine && row.match.endLine > row.match.startLine
                              ? `-L${row.match.endLine}`
                              : ''}
                          </span>
                        )}
                        {row.match.heading && (
                          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 truncate">
                            {row.match.heading}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-primary-600 dark:text-slate-400 line-clamp-2 mt-0.5">
                        {row.match.snippet}
                      </p>
                    </div>
                  </button>
                );
              }

              if (row.kind === 'file') {
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-testid="omnibar-file-result"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => executeRow(row)}
                    className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 transition-colors ${
                      selected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 ring-1 ring-indigo-300 dark:ring-indigo-700'
                        : 'hover:bg-primary-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-primary-900 dark:text-slate-100 truncate">
                        {row.name}
                      </div>
                      <div className="text-[11px] text-primary-400 dark:text-slate-500 truncate">
                        {row.path}
                      </div>
                    </div>
                    <CornerDownLeft className="w-3.5 h-3.5 text-primary-400" />
                  </button>
                );
              }

              const cmdIcon =
                row.command.id === 'toggle-theme' ? (
                  isDarkMode ? (
                    <Sun className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Moon className="w-4 h-4 text-indigo-500" />
                  )
                ) : row.command.id === 'toggle-split-pane' ? (
                  <Columns className="w-4 h-4 text-sky-500" />
                ) : row.command.id === 'toggle-chat' ? (
                  <Bot className="w-4 h-4 text-purple-500" />
                ) : row.command.id === 'index-current' ? (
                  <FolderSearch className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Terminal className="w-4 h-4 text-primary-500" />
                );

              return (
                <button
                  key={row.key}
                  type="button"
                  data-testid={`omnibar-cmd-${row.command.id}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => executeRow(row)}
                  className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 transition-colors ${
                    selected
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 ring-1 ring-indigo-300 dark:ring-indigo-700'
                      : 'hover:bg-primary-50 dark:hover:bg-slate-800/70'
                  }`}
                >
                  {cmdIcon}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-primary-900 dark:text-slate-100 truncate">
                      {row.command.label}
                    </div>
                    <div className="text-[11px] text-primary-500 dark:text-slate-400 truncate">
                      {row.command.description}
                    </div>
                  </div>
                  {row.command.shortcut && (
                    <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-primary-100 dark:bg-slate-800 text-primary-600 dark:text-slate-300 border border-primary-200 dark:border-slate-700">
                      {row.command.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-4 py-2 border-t border-primary-200 dark:border-slate-800 bg-primary-50/50 dark:bg-slate-950/60 flex items-center justify-between text-[11px] text-primary-500 dark:text-slate-400">
          <span>↑/↓ navigate • Enter open • Esc close</span>
          <span>Ctrl+K anywhere</span>
        </div>
      </div>
    </div>
  );
};
