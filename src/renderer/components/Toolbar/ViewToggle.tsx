import React from 'react';
import { List, Grid } from 'lucide-react';
import { Button } from '@renderer/components/common/Button';

interface ViewToggleProps {
  mode: 'list' | 'grid';
  onChange: (mode: 'list' | 'grid') => void;
}

export const ViewToggle: React.FC<ViewToggleProps> = ({ mode, onChange }) => (
  <div className="flex gap-1 bg-gray-100 rounded p-1">
    <Button
      variant={mode === 'list' ? 'primary' : 'ghost'}
      size="sm"
      onClick={() => onChange('list')}
      icon={<List className="w-4 h-4" />}
      aria-label="List view"
    />
    <Button
      variant={mode === 'grid' ? 'primary' : 'ghost'}
      size="sm"
      onClick={() => onChange('grid')}
      icon={<Grid className="w-4 h-4" />}
      aria-label="Grid view"
    />
  </div>
);
