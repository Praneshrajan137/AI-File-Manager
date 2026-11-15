import React from 'react';
import { ArrowUpDown } from 'lucide-react';

interface SortDropdownProps {
  value: 'name' | 'size' | 'modified' | 'type';
  onChange: (value: 'name' | 'size' | 'modified' | 'type') => void;
}

export const SortDropdown: React.FC<SortDropdownProps> = ({ value, onChange }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as 'name' | 'size' | 'modified' | 'type')}
      aria-label="Sort files by"
      data-testid="sort-dropdown"
      className="appearance-none pl-3 pr-8 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500"
    >
      <option value="name">Name</option>
      <option value="size">Size</option>
      <option value="modified">Modified</option>
      <option value="type">Type</option>
    </select>
    <ArrowUpDown
      className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 dark:text-slate-300 pointer-events-none"
      aria-hidden="true"
    />
  </div>
);
