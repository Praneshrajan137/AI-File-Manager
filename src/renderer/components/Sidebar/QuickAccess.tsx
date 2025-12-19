import React, { useEffect, useState } from 'react';
import { Home, Download, FileText, Image } from 'lucide-react';

interface QuickAccessProps {
  onNavigate: (path: string) => void;
}

interface SystemPaths {
  home: string;
  documents: string;
  downloads: string;
  pictures: string;
}

export const QuickAccess: React.FC<QuickAccessProps> = ({ onNavigate }) => {
  const [paths, setPaths] = useState<SystemPaths | null>(null);

  useEffect(() => {
    // Fetch system paths from main process via IPC
    window.electronAPI.fs.getSystemPaths()
      .then(setPaths)
      .catch(err => console.error('Failed to get system paths:', err));
  }, []);

  if (!paths) {
    return (
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-2">
          Quick Access
        </h3>
        <div className="px-2 text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  const quickLinks = [
    { name: 'Home', icon: Home, path: paths.home },
    { name: 'Documents', icon: FileText, path: paths.documents },
    { name: 'Downloads', icon: Download, path: paths.downloads },
    { name: 'Pictures', icon: Image, path: paths.pictures },
  ];

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-2">
        Quick Access
      </h3>
      <ul className="space-y-1">
        {quickLinks.map(link => (
          <li key={link.path}>
            <button
              onClick={() => onNavigate(link.path)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <link.icon className="w-4 h-4" />
              <span>{link.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
