import React, { useCallback, useId, useRef, useState } from 'react';
import { SearchInput } from './SearchInput';
import { SearchSuggestions } from './SearchSuggestions';
import { useDebouncedSearch } from '@renderer/hooks/useDebouncedSearch';
import { useRegisterOverlay } from '@renderer/hooks/useOverlayStack';

interface SearchBarProps {
  onSearch: (query: string) => void;
  onSelect: (path: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, onSelect }) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const requestSeqRef = useRef(0);
  const suppressSuggestionsRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const closeSuggestions = useCallback((): void => {
    suppressSuggestionsRef.current = true;
    setShowSuggestions(false);
    setActiveIndex(-1);
  }, []);

  const isPopupOpen = showSuggestions && suggestions.length > 0;
  useRegisterOverlay('search-bar-suggestions', isPopupOpen, closeSuggestions);

  const debouncedSearch = useDebouncedSearch(async (q: string) => {
    const trimmed = q.trim();
    const seq = ++requestSeqRef.current;

    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveIndex(-1);
      return;
    }

    try {
      const results = await window.electronAPI.search.autocomplete(trimmed, 10);
      if (seq !== requestSeqRef.current || suppressSuggestionsRef.current) {
        return;
      }
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setActiveIndex(-1);
    } catch {
      if (seq === requestSeqRef.current) {
        setSuggestions([]);
        setShowSuggestions(false);
        setActiveIndex(-1);
      }
    }
  }, 300);

  const handleInputChange = (value: string): void => {
    suppressSuggestionsRef.current = false;
    setQuery(value);
    setActiveIndex(-1);
    if (value.trim().length < 2) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      setShowSuggestions(false);
    }
    debouncedSearch(value);
  };

  const handleSelect = (path: string): void => {
    suppressSuggestionsRef.current = true;
    requestSeqRef.current += 1;
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);
    setQuery('');
    onSelect(path);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
        setActiveIndex(0);
      } else {
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
      }
      return;
    }

    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
        setActiveIndex(suggestions.length - 1);
      } else {
        setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && activeIndex >= 0 && suggestions[activeIndex]) {
        handleSelect(suggestions[activeIndex]);
        return;
      }
      suppressSuggestionsRef.current = true;
      requestSeqRef.current += 1;
      setShowSuggestions(false);
      setActiveIndex(-1);
      onSearch(query);
    } else if (e.key === 'Escape' && showSuggestions) {
      e.preventDefault();
      e.stopPropagation();
      closeSuggestions();
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
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
        expanded={isPopupOpen}
        listboxId={isPopupOpen ? listboxId : undefined}
        activeDescendantId={isPopupOpen && activeIndex >= 0 ? `search-suggestion-${activeIndex}` : undefined}
      />
      {isPopupOpen && (
        <SearchSuggestions
          suggestions={suggestions}
          activeIndex={activeIndex}
          listboxId={listboxId}
          onSelect={handleSelect}
          onHighlight={setActiveIndex}
        />
      )}
    </div>
  );
};
