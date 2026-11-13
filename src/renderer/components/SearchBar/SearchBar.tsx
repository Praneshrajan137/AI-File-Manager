import React, { useRef, useState } from 'react';
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
  const requestSeqRef = useRef(0);
  const suppressSuggestionsRef = useRef(false);

  const debouncedSearch = useDebouncedSearch(async (q: string) => {
    const trimmed = q.trim();
    const seq = ++requestSeqRef.current;

    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const results = await window.electronAPI.search.autocomplete(trimmed, 10);
      if (seq !== requestSeqRef.current || suppressSuggestionsRef.current) {
        return;
      }
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (error) {
      if (seq === requestSeqRef.current) {
        console.error('Search error:', error);
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }
  }, 300);

  const handleInputChange = (value: string) => {
    suppressSuggestionsRef.current = false;
    setQuery(value);
    if (value.trim().length < 2) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      setShowSuggestions(false);
    }
    debouncedSearch(value);
  };

  const handleSelect = (path: string) => {
    suppressSuggestionsRef.current = true;
    requestSeqRef.current += 1;
    setShowSuggestions(false);
    setSuggestions([]);
    setQuery('');
    onSelect(path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // User pressed Enter - execute search (or reload current dir when empty)
      e.preventDefault();
      suppressSuggestionsRef.current = true;
      requestSeqRef.current += 1;
      setShowSuggestions(false);
      onSearch(query);
    } else if (e.key === 'Escape') {
      // User pressed Escape - close suggestions
      suppressSuggestionsRef.current = true;
      setShowSuggestions(false);
    }
  };

  return (
    <div className="relative">
      <SearchInput
        value={query}
        onChange={handleInputChange}
        onFocus={() => {
          suppressSuggestionsRef.current = false;
          if (query.trim().length >= 2 && suggestions.length > 0) {
            setShowSuggestions(true);
          }
        }}
        onKeyDown={handleKeyDown}
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
