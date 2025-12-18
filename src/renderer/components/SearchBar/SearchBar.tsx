import React, { useState } from 'react';
import { SearchInput } from './SearchInput';
import { SearchSuggestions } from './SearchSuggestions';
import { useDebouncedSearch } from '@renderer/hooks/useDebouncedSearch';

interface SearchBarProps {
  onSearch: (query: string) => void;
  onSelect: (path: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, onSelect }) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const debouncedSearch = useDebouncedSearch(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const results = await window.electronAPI.search.autocomplete(q, 10);
      setSuggestions(results);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Search error:', error);
      setSuggestions([]);
    }
  }, 300);

  const handleInputChange = (value: string) => {
    setQuery(value);
    debouncedSearch(value);
  };

  const handleSelect = (path: string) => {
    onSelect(path);
    setShowSuggestions(false);
    setQuery('');
  };

  return (
    <div className="relative">
      <SearchInput
        value={query}
        onChange={handleInputChange}
        onFocus={() => query.length >= 2 && setShowSuggestions(true)}
      />
      {showSuggestions && suggestions.length > 0 && (
        <SearchSuggestions
          suggestions={suggestions}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
};
