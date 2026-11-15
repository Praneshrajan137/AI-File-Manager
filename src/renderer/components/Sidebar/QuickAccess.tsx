import React from 'react';
import { Home, Download, FileText, Image, RefreshCw } from 'lucide-react';
import { useSystemPaths } from '@renderer/contexts/SystemPathsContext';

interface QuickAccessProps {
  onNavigate: (path: string) => void;
}

export const QuickAccess: React.FC<QuickAccessProps> = ({ onNavigate }) => {
  const { paths, loading, error, retry } = useSystemPaths();

  if (loading && !paths) {
    return (
      <div className="mb-6 px-3">
        <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 mb-3">
          Quick Access
        </h3>
        <div className="px-2 text-sm text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  if (error || !paths) {
    return (
      <div className="mb-6 px-3">
        <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 mb-3">
          Quick Access
        </h3>
        <div
          role="alert"
          className="px-2 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-error-700 dark:text-red-200 space-y-2"
        >
          <p>{error || 'Unable to load system folders.'}</p>
          <button
            type="button"
            onClick={() => void retry()}
            data-testid="quick-access-retry"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 font-medium text-error-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
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
      <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 mb-3">
        Quick Access
      </h3>
      <ul className="space-y-0.5">
        {quickLinks.map((link) => (
          <li key={link.path}>
            <button
              type="button"
              onClick={() => onNavigate(link.path)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <link.icon
                className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:text-accent-600 dark:group-hover:text-indigo-400 transition-colors"
                aria-hidden="true"
              />
              <span className="font-medium">{link.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
