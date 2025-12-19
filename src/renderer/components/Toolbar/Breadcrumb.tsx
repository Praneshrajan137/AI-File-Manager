import React from 'react';
import { Home, ChevronRight } from 'lucide-react';
import * as pathLib from 'path';

interface BreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ path, onNavigate }) => {
  // Use platform-specific path separator (/ on Unix, \ on Windows)
  const separator = pathLib.sep;
  const parsedPath = pathLib.parse(path);
  const root = parsedPath.root;
  
  // Split and filter out empty segments and the root itself
  const segments = path.split(separator).filter(segment => {
    return segment && segment !== root && segment !== root.replace(separator, '');
  });

  return (
    <div className="flex items-center gap-2 text-sm overflow-x-auto" role="navigation" aria-label="Breadcrumb">
      <button
        onClick={() => onNavigate(root || separator)}
        className="hover:text-primary-600 transition-colors"
        aria-label="Home"
      >
        <Home className="w-4 h-4" />
      </button>

      {segments.map((segment, idx) => {
        // Build path incrementally from root
        // On Windows: root is "C:\", segments are ["Users", "Documents"]
        // On Unix: root is "/", segments are ["home", "user"]
        const pathSegments = segments.slice(0, idx + 1);
        const fullPath = root + pathSegments.join(separator);
        const isLast = idx === segments.length - 1;

        return (
          <React.Fragment key={fullPath}>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <button
              onClick={() => onNavigate(fullPath)}
              className={`hover:text-primary-600 transition-colors truncate max-w-[120px] ${
                isLast ? 'font-semibold text-gray-800' : 'text-gray-600'
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
