import React, { useState, useEffect } from 'react';
import { DirectoryTreeNode } from './DirectoryTreeNode';
import { FileNode } from '@shared/contracts';

interface DirectoryTreeProps {
  rootPath?: string;
  onNavigate: (path: string) => void;
}

export const DirectoryTree: React.FC<DirectoryTreeProps> = ({
  rootPath,
  onNavigate
}) => {
  const [root, setRoot] = useState<FileNode | null>(null);
  const [effectiveRootPath, setEffectiveRootPath] = useState<string | null>(rootPath || null);

  // Fetch home directory from main process if no rootPath provided
  useEffect(() => {
    if (!rootPath) {
      window.electronAPI.fs.getSystemPaths()
        .then((paths) => setEffectiveRootPath(paths.home))
        .catch((err) => console.error('Failed to get system paths:', err));
    } else {
      setEffectiveRootPath(rootPath);
    }
  }, [rootPath]);

  // Load root directory stats once we have the path
  useEffect(() => {
    if (!effectiveRootPath) return;

    const loadRoot = async () => {
      try {
        const stats = await window.electronAPI.fs.getStats(effectiveRootPath);
        setRoot({
          path: effectiveRootPath,
          name: 'Home',
          isDirectory: true,
          size: 0,
          modified: Date.now(),
          extension: '',
          mimeType: '',
        });
      } catch (error) {
        console.error('Failed to load root:', error);
      }
    };

    loadRoot();
  }, [effectiveRootPath]);

  if (!root) return null;

  return (
    <div className="py-2 px-3" role="tree" aria-label="Directory tree">
      <h3 className="text-[10px] font-semibold text-primary-400 uppercase tracking-wider px-2 mb-3">
        Folders
      </h3>
      <DirectoryTreeNode node={root} onNavigate={onNavigate} />
    </div>
  );
};
