import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@renderer/components/common/Input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onFocus,
  onKeyDown,
  placeholder = 'Search files... (Ctrl+F)'
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
    className="w-64"
  />
);
