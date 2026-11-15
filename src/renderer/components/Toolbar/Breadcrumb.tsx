import React from 'react';
import { Home, ChevronRight } from 'lucide-react';

interface BreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

function parseBreadcrumbPath(targetPath: string): { root: string; separator: string; segments: string[] } {
  const uncMatch = /^(\\\\[^\\/]+[\\/][^\\/]+)(?:[\\/](.*))?$/.exec(targetPath);
  if (uncMatch) {
    const shareRoot = uncMatch[1].replace(/\//g, '\\');
    const remainder = uncMatch[2] || '';
    const segments = remainder.split(/[\\/]+/).filter((segment) => segment.length > 0);
    return { root: shareRoot, separator: '\\', segments };
  }

  const isWindowsStyle = /^[A-Za-z]:/.test(targetPath) || (targetPath.includes('\\') && !targetPath.includes('/'));
  const separator = isWindowsStyle ? '\\' : '/';
  const driveMatch = /^([A-Za-z]:)(?:[\\/]|$)/.exec(targetPath);

  if (driveMatch) {
    const drivePrefix = `${driveMatch[1]}\\`;
    const remainder = targetPath.slice(driveMatch[0].length);
    const segments = remainder.split(/[\\/]+/).filter((segment) => segment.length > 0);
    return { root: drivePrefix, separator: '\\', segments };
  }

  const root = targetPath.startsWith('/') ? '/' : '';
  const segments = targetPath.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return { root, separator, segments };
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ path, onNavigate }) => {
  const { root, separator, segments } = parseBreadcrumbPath(path);

  // Handle home button click - navigate to user's home directory
  const handleHomeClick = async () => {
    try {
      const systemPaths = await window.electronAPI.fs.getSystemPaths();
      onNavigate(systemPaths.home);
    } catch (error) {
      console.error('Failed to navigate to home:', error);
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 text-sm overflow-x-auto flex-1 min-w-[140px]"
      role="navigation"
      aria-label="Breadcrumb"
      data-testid="breadcrumb"
    >
      <button
        onClick={handleHomeClick}
        className="p-1.5 rounded-md text-primary-500 dark:text-slate-400 hover:text-primary-700 dark:hover:text-slate-100 hover:bg-primary-50 dark:hover:bg-slate-800 transition-all flex-shrink-0"
        aria-label="Home"
      >
        <Home className="w-4 h-4" />
      </button>

      {root.startsWith('\\\\') && (
        <React.Fragment key={root}>
          <ChevronRight className="w-3.5 h-3.5 text-primary-300 dark:text-slate-600 flex-shrink-0" />
          <button
            onClick={() => onNavigate(root)}
            className={`px-2 py-1 rounded-md truncate max-w-[180px] flex-shrink-0 transition-all ${
              segments.length === 0
                ? 'font-medium text-primary-900 dark:text-slate-100 bg-primary-50 dark:bg-slate-800'
                : 'text-primary-600 dark:text-slate-300 hover:text-primary-800 dark:hover:text-white hover:bg-primary-50 dark:hover:bg-slate-800'
            }`}
          >
            {root}
          </button>
        </React.Fragment>
      )}

      {segments.map((segment, idx) => {
        const pathSegments = segments.slice(0, idx + 1);
        const needsSeparator = root.length > 0 && !root.endsWith(separator);
        const fullPath = root + (needsSeparator ? separator : '') + pathSegments.join(separator);
        const isLast = idx === segments.length - 1;

        return (
          <React.Fragment key={fullPath}>
            <ChevronRight className="w-3.5 h-3.5 text-primary-300 dark:text-slate-600 flex-shrink-0" />
            <button
              onClick={() => onNavigate(fullPath)}
              className={`px-2 py-1 rounded-md truncate max-w-[150px] flex-shrink-0 transition-all ${isLast
                  ? 'font-medium text-primary-900 dark:text-slate-100 bg-primary-50 dark:bg-slate-800'
                  : 'text-primary-600 dark:text-slate-300 hover:text-primary-800 dark:hover:text-white hover:bg-primary-50 dark:hover:bg-slate-800'
                }`}
            >
              {segment}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

