import React, { useMemo, useState } from 'react';
import { Search, Database, X } from 'lucide-react';
import { ModalShell } from '@renderer/components/common/ModalShell';
import { OmnibarCommandItem, OmnibarResultRow, OmnibarRow } from './OmnibarResultRow';
import { OmnibarTab, useOmnibarSearch } from './useOmnibarSearch';

export type { OmnibarTab } from './useOmnibarSearch';

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

const OMNIBAR_TABS: OmnibarTab[] = ['all', 'files', 'content', 'commands'];

/**
 * Accessible command palette and workspace search modal supporting FTS5 content search,
 * symbol lookup (`@sym:`), backlinks (`link:`), duplicates (`dup:`), and instant commands.
 */
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
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

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

  React.useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
  }, [isOpen]);

  const { rows, graphInsights, loadingResults } = useOmnibarSearch({
    isOpen,
    query,
    activeTab,
    commands,
    onResetSelection: (): void => setActiveIndex(0),
  });

  React.useEffect(() => {
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
    } else if (row.kind === 'symbol') {
      void onOpenCitation(row.match.filePath, row.match.lineNumber, row.match.lineNumber);
    } else if (row.kind === 'backlink') {
      void onOpenCitation(row.match.sourcePath, row.match.lineNumber, row.match.lineNumber);
    } else if (row.kind === 'duplicate') {
      const target = row.cluster.files[0];
      if (target) void onNavigateFile(target);
    } else {
      row.command.run();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
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

  const activeDescendantId = rows[activeIndex] ? `omnibar-option-${activeIndex}` : undefined;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Command and Workspace Omnibar"
      dataTestId="command-omnibar"
      initialFocusRef={inputRef}
      backdropClassName="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      panelClassName="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
    >
      {/* Search Input Row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <Search className="w-5 h-5 text-accent-600 dark:text-accent-400 flex-shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls="omnibar-results-listbox"
          aria-activedescendant={activeDescendantId}
          aria-autocomplete="list"
          aria-label="Search files, indexed content, symbols, or commands"
          value={query}
          onChange={(e): void => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="omnibar-input"
          placeholder="Search files, indexed content (FTS5), @sym:, link:, dup:, or commands..."
          className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none"
        />
        {loadingResults && (
          <span className="text-[11px] text-accent-700 dark:text-accent-300 font-medium">
            Searching...
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close omnibar"
          data-testid="omnibar-close"
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Mode Tabs + Knowledge Graph Insights Bar */}
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1" role="tablist" aria-label="Omnibar categories">
          {OMNIBAR_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              data-testid={`omnibar-tab-${tab}`}
              onClick={(): void => setActiveTab(tab)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-accent-600 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {graphInsights && (
          <div
            className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300"
            data-testid="omnibar-graph-stats"
          >
            <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
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
      <div
        id="omnibar-results-listbox"
        role="listbox"
        aria-label="Omnibar results"
        className="overflow-y-auto flex-1 p-2 space-y-1 scrollbar-thin"
        data-testid="omnibar-results"
      >
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            {query.trim().length < 2
              ? 'Type at least 2 characters to search files & full-text content, or pick a command below.'
              : 'No matching files, indexed snippets, or commands.'}
          </div>
        ) : (
          rows.map((row, idx) => (
            <OmnibarResultRow
              key={row.key}
              row={row}
              index={idx}
              selected={idx === activeIndex}
              isDarkMode={isDarkMode}
              onHover={setActiveIndex}
              onExecute={executeRow}
            />
          ))
        )}
      </div>

      {/* Footer Hints */}
      <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
        <span>↑↓ Navigate · Enter Open · Esc Close</span>
        <span className="font-mono">Filters: @sym: · link: · dup:</span>
      </div>
    </ModalShell>
  );
};
