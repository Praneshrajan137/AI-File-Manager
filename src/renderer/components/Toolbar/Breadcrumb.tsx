import React from 'react';
import { Home, ChevronRight } from 'lucide-react';

interface BreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ path, onNavigate }) => {
  const segments = path.split('/').filter(Boolean);

  return (
    <div className="flex items-center gap-2 text-sm overflow-x-auto" role="navigation" aria-label="Breadcrumb">
      <button
        onClick={() => onNavigate('/')}
        className="hover:text-primary-600 transition-colors"
        aria-label="Home"
      >
        <Home className="w-4 h-4" />
      </button>

      {segments.map((segment, idx) => {
        const segmentPath = '/' + segments.slice(0, idx + 1).join('/');
        const isLast = idx === segments.length - 1;

        return (
          <React.Fragment key={segmentPath}>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <button
              onClick={() => onNavigate(segmentPath)}
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
