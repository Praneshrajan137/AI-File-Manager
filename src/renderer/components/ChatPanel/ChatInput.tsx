import React from 'react';
import { Bot, Folder, MousePointerClick, Send, Square } from 'lucide-react';
import { CopilotQueryMode } from '@shared/contracts';
import { extractBasename } from '@renderer/utils/pathHelpers';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  currentPath?: string;
  selectedCount?: number;
  useFolder?: boolean;
  useSelection?: boolean;
  mode?: CopilotQueryMode;
  onToggleFolder?: () => void;
  onToggleSelection?: () => void;
  onToggleMode?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  onCancel,
  disabled,
  currentPath = '',
  selectedCount = 0,
  useFolder = false,
  useSelection = false,
  mode = 'rag',
  onToggleFolder,
  onToggleSelection,
  onToggleMode,
}) => {
  const handleKeyPress = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const folderLabel = currentPath ? extractBasename(currentPath) || currentPath : 'workspace';

  return (
    <div
      className="p-3 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
      data-testid="chat-input-container"
    >
      {/* Context Scope & Agent Mode Chips */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {onToggleFolder && (
          <button
            type="button"
            disabled={!currentPath || disabled}
            onClick={onToggleFolder}
            data-testid="chip-folder"
            aria-pressed={useFolder}
            title={currentPath ? `Scope answers to ${currentPath}` : 'Open a folder first'}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition-colors disabled:opacity-45 ${
              useFolder
                ? 'bg-indigo-100 dark:bg-indigo-950 border-indigo-400 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200 font-medium'
                : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}
          >
            <Folder className="w-3 h-3" />
            <span className="truncate max-w-[110px]">@folder:{folderLabel}</span>
          </button>
        )}

        {onToggleSelection && (
          <button
            type="button"
            disabled={selectedCount === 0 || disabled}
            onClick={onToggleSelection}
            data-testid="chip-selection"
            aria-pressed={useSelection}
            title="Include currently selected files in prompt context"
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition-colors disabled:opacity-45 ${
              useSelection && selectedCount > 0
                ? 'bg-emerald-100 dark:bg-emerald-950 border-emerald-400 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 font-medium'
                : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}
          >
            <MousePointerClick className="w-3 h-3" />
            <span>@selection ({selectedCount})</span>
          </button>
        )}

        {onToggleMode && (
          <button
            type="button"
            disabled={disabled}
            onClick={onToggleMode}
            data-testid="chip-agent-mode"
            aria-pressed={mode === 'agent'}
            title="Toggle bounded ReAct tool-calling agent (up to 4 read-only steps)"
            className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition-colors ${
              mode === 'agent'
                ? 'bg-purple-100 dark:bg-purple-950 border-purple-400 dark:border-purple-700 text-purple-800 dark:text-purple-200 font-medium'
                : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}
          >
            <Bot className="w-3 h-3" />
            <span>{mode === 'agent' ? 'Agent (ReAct)' : 'RAG Fast'}</span>
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e): void => onChange(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={
            mode === 'agent'
              ? 'Ask Agent to inspect workspace files (@folder / @selection)...'
              : 'Ask about your files (@folder / @selection)...'
          }
          disabled={disabled}
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm disabled:opacity-50"
          data-testid="chat-input"
        />
        <button
          onClick={onSend}
          disabled={!value.trim() || disabled}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Send message"
          data-testid="send-button"
        >
          <Send className="w-4 h-4" />
        </button>
        {disabled && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-1 text-xs font-medium"
            aria-label="Stop generation"
            data-testid="cancel-query-button"
            title="Cancel running AI response"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        )}
      </div>
    </div>
  );
};
