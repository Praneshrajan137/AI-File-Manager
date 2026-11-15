import React from 'react';

interface SearchSuggestionsProps {
  suggestions: string[];
  activeIndex: number;
  listboxId: string;
  onSelect: (path: string) => void;
  onHighlight?: (index: number) => void;
}

export const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({
  suggestions,
  activeIndex,
  listboxId,
  onSelect,
  onHighlight,
}) => (
  <div className="absolute top-full mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-64 overflow-y-auto z-50">
    {suggestions.length === 0 ? (
      <div className="p-3 text-sm text-slate-600 dark:text-slate-400 text-center">No results found</div>
    ) : (
      <ul id={listboxId} role="listbox" aria-label="Search suggestions" className="py-1">
        {suggestions.map((path, idx) => {
          const isActive = idx === activeIndex;
          return (
            <li
              key={path}
              id={`search-suggestion-${idx}`}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => onHighlight?.(idx)}
              onMouseDown={(e) => {
                // Keep focus until click selects item instead of triggering blur dismissal first
                e.preventDefault();
                onSelect(path);
              }}
              className={`px-3 py-2 text-sm truncate cursor-pointer transition-colors ${
                isActive
                  ? 'bg-accent-50 dark:bg-indigo-950/60 text-accent-700 dark:text-indigo-200 font-medium'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={path}
            >
              {path}
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
