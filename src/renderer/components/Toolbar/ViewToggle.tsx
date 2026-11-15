import React from 'react';
import { List, Grid } from 'lucide-react';
import { Button } from '@renderer/components/common/Button';

interface ViewToggleProps {
  mode: 'list' | 'grid';
  onChange: (mode: 'list' | 'grid') => void;
}

export const ViewToggle: React.FC<ViewToggleProps> = ({ mode, onChange }) => (
  <div
    className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1"
    role="group"
    aria-label="View mode"
  >
    <Button
      variant={mode === 'list' ? 'primary' : 'ghost'}
      size="sm"
      onClick={() => onChange('list')}
      icon={<List className="w-4 h-4" aria-hidden="true" />}
      aria-label="List view"
      aria-pressed={mode === 'list'}
      data-testid="view-list-button"
    />
    <Button
      variant={mode === 'grid' ? 'primary' : 'ghost'}
      size="sm"
      onClick={() => onChange('grid')}
      icon={<Grid className="w-4 h-4" aria-hidden="true" />}
      aria-label="Grid view"
      aria-pressed={mode === 'grid'}
      data-testid="view-grid-button"
    />
  </div>
);
