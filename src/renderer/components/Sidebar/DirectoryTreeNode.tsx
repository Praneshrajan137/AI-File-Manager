import React, { useState } from 'react';
import { Folder, ChevronRight, Loader } from 'lucide-react';
import { FileNode } from '@shared/contracts';

interface DirectoryTreeNodeProps {
  node: FileNode;
  onNavigate: (path: string) => void;
  level?: number;
}

export const DirectoryTreeNode: React.FC<DirectoryTreeNodeProps> = ({
  node,
  onNavigate,
  level = 0
}) => {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChildrenIfNeeded = async (): Promise<void> => {
    if (!loaded) {
      setLoading(true);
      try {
        const subDirs = await window.electronAPI.fs.readDirectory(node.path);
        const dirs = subDirs.filter(f => f.isDirectory && f.isHidden !== true);
        setChildren(dirs);
        setLoaded(true);
      } catch (error) {
        console.error('Failed to load children:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleChevronClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (!expanded) {
      await loadChildrenIfNeeded();
    }
    setExpanded((prev) => !prev);
  };

  const handleClick = (): void => {
    if (!expanded) {
      void loadChildrenIfNeeded();
      setExpanded(true);
    }
    onNavigate(node.path);
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 p-2 hover:bg-gray-100 cursor-pointer rounded transition-colors"
        onClick={handleClick}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={handleChevronClick}
          className="p-0.5 rounded hover:bg-gray-200"
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
        >
          <ChevronRight
            className={`w-4 h-4 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        </button>
        <Folder className="w-4 h-4 text-blue-500" />
        <span className="text-sm truncate flex-1">{node.name}</span>
        {loading && <Loader className="w-3 h-3 animate-spin text-gray-400" />}
      </div>
      
      {expanded && children.length > 0 && (
        <div>
          {children.map(child => (
            <DirectoryTreeNode
              key={child.path}
              node={child}
              onNavigate={onNavigate}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
