import React from 'react';
import {
  ArrowRightLeft,
  Copy,
  Eye,
  Files,
  Pencil,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { formatFileSize } from '@renderer/utils/formatters';
import { Kbd } from '@renderer/components/common/Kbd';

interface SelectionActionBarProps {
  selectedCount: number;
  totalBytes: number;
  canPreviewSingle: boolean;
  canRenameSingle: boolean;
  canCopyToSplitPane: boolean;
  onPreview: () => void;
  onRename: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  onCopyToSplitPane?: () => void;
  onAskAi: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

/**
 * Floating contextual batch action capsule rendered over the bottom edge of the active
 * explorer pane whenever one or more items are selected (Linear / Raycast pattern).
 */
export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectedCount,
  totalBytes,
  canPreviewSingle,
  canRenameSingle,
  canCopyToSplitPane,
  onPreview,
  onRename,
  onCopy,
  onCut,
  onDuplicate,
  onCopyToSplitPane,
  onAskAi,
  onDelete,
  onClearSelection,
}) => {
  if (selectedCount <= 0) return null;

  return (
    <div
      role="region"
      aria-label="Selected item actions"
      data-testid="selection-action-bar"
      className="pointer-events-auto max-w-[calc(100%-1.5rem)] rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-2xl px-2.5 py-1.5 flex items-center gap-1 flex-wrap justify-center text-xs"
    >
      <span
        data-testid="selection-summary-badge"
        className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 text-accent-700 dark:text-indigo-200 font-semibold tabular-nums whitespace-nowrap"
      >
        {selectedCount} selected{totalBytes > 0 ? ` · ${formatFileSize(totalBytes)}` : ''}
      </span>

      {canPreviewSingle && (
        <button
          type="button"
          onClick={onPreview}
          data-testid="selection-preview-button"
          title="Quick Preview (Space / Alt+P)"
          className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Preview</span>
        </button>
      )}

      {canRenameSingle && (
        <button
          type="button"
          onClick={onRename}
          data-testid="selection-rename-button"
          title="Rename (F2)"
          className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Rename</span>
        </button>
      )}

      <button
        type="button"
        onClick={onCopy}
        data-testid="selection-copy-button"
        title="Copy (Ctrl+C)"
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Copy</span>
      </button>

      <button
        type="button"
        onClick={onCut}
        data-testid="selection-cut-button"
        title="Cut / Move (Ctrl+X)"
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Cut</span>
      </button>

      <button
        type="button"
        onClick={onDuplicate}
        data-testid="selection-duplicate-button"
        title="Duplicate in place (Ctrl+D)"
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Files className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Duplicate</span>
      </button>

      {canCopyToSplitPane && onCopyToSplitPane && (
        <button
          type="button"
          onClick={onCopyToSplitPane}
          data-testid="selection-split-copy-button"
          title="Copy selected items to secondary Split Pane"
          className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-accent-700 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>To Pane</span>
        </button>
      )}

      <button
        type="button"
        onClick={onAskAi}
        data-testid="selection-ask-ai-button"
        title="Inspect selection with AI Copilot"
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-accent-700 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Ask AI</span>
      </button>

      <button
        type="button"
        onClick={onDelete}
        data-testid="selection-delete-button"
        title="Delete selected (Del)"
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded-md text-error-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/60 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Delete</span>
      </button>

      <button
        type="button"
        onClick={onClearSelection}
        data-testid="selection-clear-button"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        className="inline-flex items-center gap-1 px-1.5 py-1 min-h-[28px] rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
