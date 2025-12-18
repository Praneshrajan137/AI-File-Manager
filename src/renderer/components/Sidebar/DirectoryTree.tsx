import React, { useState, useEffect } from 'react';
import { DirectoryTreeNode } from './DirectoryTreeNode';
import { FileNode } from '@shared/contracts';
import * as os from 'os';

interface DirectoryTreeProps {
  rootPath?: string;
  onNavigate: (path: string) => void;
}

export const DirectoryTree: React.FC<DirectoryTreeProps> = ({
  rootPath = os.homedir(),
  onNavigate
}) => {
  const [root, setRoot] = useState<FileNode | null>(null);

  useEffect(() => {
    const loadRoot = async () => {
      try {
        const stats = await window.electronAPI.fs.getStats(rootPath);
        setRoot({
          path: rootPath,
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
  }, [rootPath]);

  if (!root) return null;

  return (
    <div className="py-2" role="tree" aria-label="Directory tree">
      <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-2">
        Folders
      </h3>
      <DirectoryTreeNode node={root} onNavigate={onNavigate} />
    </div>
  );
};
