import React from 'react';
import { Bot } from 'lucide-react';

interface ChatEmptySuggestionsProps {
  onSelectSuggestion: (text: string) => void;
}

const SUGGESTIONS = ['List my recent documents', 'Find large files', 'Search for images'];

/** Empty state and prompt starter pills for ChatInterface. */
export const ChatEmptySuggestions: React.FC<ChatEmptySuggestionsProps> = ({ onSelectSuggestion }) => (
  <div className="text-center py-8">
    <div className="w-16 h-16 bg-accent-100 dark:bg-accent-950 rounded-full flex items-center justify-center mx-auto mb-4">
      <Bot className="w-8 h-8 text-accent-600 dark:text-accent-300" aria-hidden="true" />
    </div>
    <p className="text-lg font-medium text-slate-800 dark:text-slate-100">
      Ask me anything about your files!
    </p>
    <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
      Try: &quot;What TypeScript files do I have?&quot;
    </p>
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={(): void => onSelectSuggestion(suggestion)}
          className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-xs text-slate-700 dark:text-slate-200 hover:bg-accent-50 dark:hover:bg-slate-700 hover:border-accent-200 hover:text-accent-700 dark:hover:text-accent-300 transition-colors"
        >
          {suggestion}
        </button>
      ))}
    </div>
  </div>
);
