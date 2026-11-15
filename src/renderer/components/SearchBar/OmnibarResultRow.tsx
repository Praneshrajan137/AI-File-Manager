import React from 'react';
import {
  FileText,
  FileCode2,
  Terminal,
  Moon,
  Sun,
  Columns,
  Bot,
  FolderSearch,
  Database,
  CornerDownLeft,
} from 'lucide-react';
import type { ContentSearchMatch, GraphInsightsResponse } from '@shared/contracts';
import { extractBasename } from '@renderer/utils/pathHelpers';
import { formatFileSize } from '@renderer/utils/formatters';

export interface OmnibarCommandItem {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  run: () => void;
}

export type DuplicateClusterItem = GraphInsightsResponse['stats']['duplicateClusters'][number];
export type GraphSymbolMatch = NonNullable<GraphInsightsResponse['symbolMatches']>[number];
export type GraphBacklinkMatch = NonNullable<GraphInsightsResponse['backlinks']>[number];

export type OmnibarRow =
  | { kind: 'file'; key: string; path: string; name: string }
  | { kind: 'content'; key: string; match: ContentSearchMatch }
  | { kind: 'symbol'; key: string; match: GraphSymbolMatch }
  | { kind: 'backlink'; key: string; match: GraphBacklinkMatch }
  | { kind: 'duplicate'; key: string; cluster: DuplicateClusterItem }
  | { kind: 'command'; key: string; command: OmnibarCommandItem };

interface OmnibarResultRowProps {
  row: OmnibarRow;
  index: number;
  selected: boolean;
  isDarkMode: boolean;
  onHover: (index: number) => void;
  onExecute: (row: OmnibarRow) => void;
}

/**
 * Renders a single keyboard-selectable omnibar search or command entry with WCAG AA contrast.
 */
export const OmnibarResultRow: React.FC<OmnibarResultRowProps> = ({
  row,
  index,
  selected,
  isDarkMode,
  onHover,
  onExecute,
}) => {
  const rowId = `omnibar-option-${index}`;
  const baseClass = `w-full text-left px-3 py-2 rounded-xl flex gap-3 transition-colors ${
    selected
      ? 'bg-accent-50 dark:bg-accent-950/60 ring-1 ring-accent-400 dark:ring-accent-600'
      : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
  }`;

  if (row.kind === 'symbol') {
    return (
      <button
        id={rowId}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid="omnibar-symbol-result"
        onMouseEnter={(): void => onHover(index)}
        onClick={(): void => onExecute(row)}
        className={`${baseClass} items-center`}
      >
        <FileCode2 className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold font-mono text-slate-900 dark:text-slate-100 truncate">
            {row.match.symbolName} ({row.match.kind})
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
            {extractBasename(row.match.filePath)}#L{row.match.lineNumber}
          </div>
        </div>
      </button>
    );
  }

  if (row.kind === 'backlink') {
    return (
      <button
        id={rowId}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid="omnibar-backlink-result"
        onMouseEnter={(): void => onHover(index)}
        onClick={(): void => onExecute(row)}
        className={`${baseClass} items-center`}
      >
        <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {extractBasename(row.match.sourcePath)}#L{row.match.lineNumber}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
            {row.match.kind} → {row.match.targetRef}
          </div>
        </div>
      </button>
    );
  }

  if (row.kind === 'duplicate') {
    return (
      <button
        id={rowId}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid="omnibar-duplicate-result"
        onMouseEnter={(): void => onHover(index)}
        onClick={(): void => onExecute(row)}
        className={`${baseClass} items-center`}
      >
        <Database className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold font-mono text-slate-900 dark:text-slate-100 truncate">
            sha256:{row.cluster.sha256.slice(0, 10)} ({row.cluster.files.length} copies)
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate tabular-nums">
            {row.cluster.files.map((f) => extractBasename(f)).join(' · ')} ({formatFileSize(row.cluster.wastedBytes)} reclaimable)
          </div>
        </div>
      </button>
    );
  }

  if (row.kind === 'content') {
    return (
      <button
        id={rowId}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid="omnibar-content-result"
        onMouseEnter={(): void => onHover(index)}
        onClick={(): void => onExecute(row)}
        className={`${baseClass} items-start`}
      >
        <FileCode2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {row.match.fileName}
            </span>
            {row.match.startLine && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[10px] font-mono">
                #L{row.match.startLine}
                {row.match.endLine && row.match.endLine > row.match.startLine
                  ? `-L${row.match.endLine}`
                  : ''}
              </span>
            )}
            {row.match.heading && (
              <span className="text-[11px] text-accent-700 dark:text-accent-300 truncate">
                {row.match.heading}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mt-0.5">
            {row.match.snippet}
          </p>
        </div>
      </button>
    );
  }

  if (row.kind === 'file') {
    return (
      <button
        id={rowId}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid="omnibar-file-result"
        onMouseEnter={(): void => onHover(index)}
        onClick={(): void => onExecute(row)}
        className={`${baseClass} items-center`}
      >
        <FileText className="w-4 h-4 text-accent-600 dark:text-accent-400 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {row.name}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{row.path}</div>
        </div>
        <CornerDownLeft className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      </button>
    );
  }

  const cmdIcon =
    row.command.id === 'toggle-theme' ? (
      isDarkMode ? (
        <Sun className="w-4 h-4 text-amber-500 flex-shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4 text-accent-600 flex-shrink-0" aria-hidden="true" />
      )
    ) : row.command.id === 'toggle-split-pane' ? (
      <Columns className="w-4 h-4 text-sky-600 dark:text-sky-400 flex-shrink-0" aria-hidden="true" />
    ) : row.command.id === 'toggle-chat' ? (
      <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" aria-hidden="true" />
    ) : row.command.id === 'index-current' ? (
      <FolderSearch className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" aria-hidden="true" />
    ) : (
      <Terminal className="w-4 h-4 text-slate-600 dark:text-slate-300 flex-shrink-0" aria-hidden="true" />
    );

  return (
    <button
      id={rowId}
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={`omnibar-cmd-${row.command.id}`}
      onMouseEnter={(): void => onHover(index)}
      onClick={(): void => onExecute(row)}
      className={`${baseClass} items-center`}
    >
      {cmdIcon}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
          {row.command.label}
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
          {row.command.description}
        </div>
      </div>
      {row.command.shortcut && (
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          {row.command.shortcut}
        </kbd>
      )}
    </button>
  );
};
