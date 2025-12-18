import React from 'react';
import { Home, Download, FileText, Image } from 'lucide-react';
import * as os from 'os';
import * as path from 'path';

interface QuickAccessProps {
  onNavigate: (path: string) => void;
}

export const QuickAccess: React.FC<QuickAccessProps> = ({ onNavigate }) => {
  const quickLinks = [
    { name: 'Home', icon: Home, path: os.homedir() },
    { name: 'Documents', icon: FileText, path: path.join(os.homedir(), 'Documents') },
    { name: 'Downloads', icon: Download, path: path.join(os.homedir(), 'Downloads') },
    { name: 'Pictures', icon: Image, path: path.join(os.homedir(), 'Pictures') },
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
