import React from 'react';
import { Home, ChevronRight } from 'lucide-react';
import { useSystemPaths } from '@renderer/contexts/SystemPathsContext';

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
  const { paths, retry } = useSystemPaths();

  const handleHomeClick = async (): Promise<void> => {
    if (paths?.home) {
      onNavigate(paths.home);
      return;
    }
    const resolved = await retry();
    if (resolved?.home) {
      onNavigate(resolved.home);
    }
  };

  return (
    <nav
      className="flex items-center gap-1 text-sm overflow-x-auto flex-1 min-w-[140px]"
      aria-label="Breadcrumb"
      data-testid="breadcrumb"
    >
      <button
        type="button"
        onClick={() => void handleHomeClick()}
        className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        aria-label="Home"
        title="Home folder"
      >
        <Home className="w-4 h-4" aria-hidden="true" />
      </button>

      {root.startsWith('\\\\') && (
        <React.Fragment key={root}>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onNavigate(root)}
            aria-current={segments.length === 0 ? 'page' : undefined}
            className={`px-2 py-1 rounded-md truncate max-w-[180px] flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
              segments.length === 0
                ? 'font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
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
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onNavigate(fullPath)}
              aria-current={isLast ? 'page' : undefined}
              className={`px-2 py-1 rounded-md truncate max-w-[150px] flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                isLast
                  ? 'font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {segment}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};
