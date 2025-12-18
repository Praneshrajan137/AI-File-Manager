import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@renderer/components/common/Button';

interface NavigationButtonsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

export const NavigationButtons: React.FC<NavigationButtonsProps> = ({
  canGoBack,
  canGoForward,
  onBack,
  onForward
}) => (
  <div className="flex gap-2">
    <Button
      variant="ghost"
      size="sm"
      disabled={!canGoBack}
      onClick={onBack}
      icon={<ChevronLeft className="w-4 h-4" />}
      aria-label="Go back"
    />
    <Button
      variant="ghost"
      size="sm"
      disabled={!canGoForward}
      onClick={onForward}
      icon={<ChevronRight className="w-4 h-4" />}
      aria-label="Go forward"
    />
  </div>
);
