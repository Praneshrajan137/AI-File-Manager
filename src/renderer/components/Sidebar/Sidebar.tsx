import React, { useState, useEffect } from 'react';
import { QuickAccess } from './QuickAccess';
import { DirectoryTree } from './DirectoryTree';
import { FavoritesList } from './FavoritesList';
import { UI_CONSTANTS } from '@renderer/utils/constants';
import { Shield } from 'lucide-react';

interface SidebarProps {
  width: number;
  onResize: (width: number) => void;
  onNavigate: (path: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ width, onResize, onNavigate }) => {
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = () => {
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(
        UI_CONSTANTS.SIDEBAR_MIN_WIDTH,
        Math.min(UI_CONSTANTS.SIDEBAR_MAX_WIDTH, e.clientX)
      );
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

  return (
    <div
      className="bg-white border-r border-primary-200 flex flex-col h-full relative shadow-elite"
      style={{ width: `${width}px` }}
    >
      {/* Header - Elite branding */}
      <div className="px-5 py-4 border-b border-primary-100 bg-gradient-to-b from-white to-primary-50/30">
        <h1 className="text-lg font-semibold text-primary-900 tracking-tight">
          File Manager
        </h1>
        <div className="flex items-center gap-1.5 mt-1">
          <Shield className="w-3 h-3 text-primary-500" />
          <span className="text-[11px] font-medium text-primary-500 tracking-wide uppercase">
            PrivateVault AI
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-3 scrollbar-thin">
        <QuickAccess onNavigate={onNavigate} />
        <DirectoryTree onNavigate={onNavigate} />
        <FavoritesList onNavigate={onNavigate} />
      </div>

      {/* Resize handle */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors ${isResizing ? 'bg-primary-400' : 'bg-transparent hover:bg-primary-300'
          }`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

