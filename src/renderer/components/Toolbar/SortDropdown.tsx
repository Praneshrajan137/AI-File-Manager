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
      className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      <option value="name">Name</option>
      <option value="size">Size</option>
      <option value="modified">Modified</option>
      <option value="type">Type</option>
    </select>
    <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
  </div>
);
