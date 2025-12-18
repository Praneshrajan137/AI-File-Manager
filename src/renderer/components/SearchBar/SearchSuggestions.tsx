import React from 'react';

interface SearchSuggestionsProps {
  suggestions: string[];
  onSelect: (path: string) => void;
}

export const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({
  suggestions,
  onSelect
}) => (
  <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto z-50">
    {suggestions.length === 0 ? (
      <div className="p-3 text-sm text-gray-400 text-center">No results found</div>
    ) : (
      <ul role="listbox" aria-label="Search suggestions">
        {suggestions.map((path, idx) => (
          <li
            key={idx}
            role="option"
            className="px-4 py-2 text-sm text-gray-700 hover:bg-primary-100 cursor-pointer transition-colors"
            onClick={() => onSelect(path)}
          >
            {path}
          </li>
        ))}
      </ul>
    )}
  </div>
);
