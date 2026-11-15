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
  placeholder = 'Search files... (Ctrl+F)',
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
    className="w-36 sm:w-44 lg:w-56"
    data-testid="search-input"
  />
);
