import React, { useState, useEffect } from 'react';
import { QuickAccess } from './QuickAccess';
import { DirectoryTree } from './DirectoryTree';
import { FavoritesList } from './FavoritesList';
import { UI_CONSTANTS } from '@renderer/utils/constants';

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
      className="bg-white border-r border-gray-200 flex flex-col h-full relative"
      style={{ width: `${width}px` }}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-800">File Manager</h1>
        <p className="text-xs text-gray-500 mt-1">Project-2 with LLM</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        <QuickAccess onNavigate={onNavigate} />
        <DirectoryTree onNavigate={onNavigate} />
        <FavoritesList onNavigate={onNavigate} />
      </div>

      {/* Resize handle */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500 transition-colors ${
          isResizing ? 'bg-primary-500' : 'bg-transparent'
        }`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};
