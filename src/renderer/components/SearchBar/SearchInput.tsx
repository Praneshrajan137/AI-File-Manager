import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@renderer/components/common/Input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  expanded?: boolean;
  listboxId?: string;
  activeDescendantId?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onFocus,
  onKeyDown,
  placeholder = 'Search files...',
  expanded = false,
  listboxId,
  activeDescendantId,
}) => (
  <Input
    value={value}
    onChange={onChange}
    onFocus={onFocus}
    onKeyDown={onKeyDown}
    placeholder={placeholder}
    icon={<Search className="w-4 h-4" />}
    iconPosition="left"
    type="search"
    role="combobox"
    aria-label="Search files"
    aria-expanded={expanded}
    aria-controls={listboxId}
    aria-activedescendant={activeDescendantId}
    aria-autocomplete="list"
    className="w-40 sm:w-52 lg:w-64"
    data-testid="search-input"
  />
);
