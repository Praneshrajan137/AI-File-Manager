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
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!expanded && children.length === 0) {
      // Lazy load children on first expand
      setLoading(true);
      try {
        const subDirs = await window.electronAPI.fs.readDirectory(node.path);
        const dirs = subDirs.filter(f => f.isDirectory && f.isHidden !== true);
        setChildren(dirs);
      } catch (error) {
        console.error('Failed to load children:', error);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const handleClick = () => {
    handleToggle();
    onNavigate(node.path); // Navigate to the folder when clicked
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 p-2 hover:bg-gray-100 cursor-pointer rounded transition-colors"
        onClick={handleClick}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <ChevronRight
          className={`w-4 h-4 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
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
