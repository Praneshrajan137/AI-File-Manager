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
      <div className="mb-6 px-3">
        <h3 className="text-[10px] font-semibold text-primary-400 uppercase tracking-wider px-2 mb-3">
          Quick Access
        </h3>
        <div className="px-2 text-sm text-primary-300">Loading...</div>
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
    <div className="mb-6 px-3">
      <h3 className="text-[10px] font-semibold text-primary-400 uppercase tracking-wider px-2 mb-3">
        Quick Access
      </h3>
      <ul className="space-y-0.5">
        {quickLinks.map(link => (
          <li key={link.path}>
            <button
              onClick={() => onNavigate(link.path)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-primary-700 hover:bg-primary-50 hover:text-primary-900 rounded-lg transition-all duration-150 group"
            >
              <link.icon className="w-4 h-4 text-primary-400 group-hover:text-primary-600 transition-colors" />
              <span className="font-medium">{link.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

