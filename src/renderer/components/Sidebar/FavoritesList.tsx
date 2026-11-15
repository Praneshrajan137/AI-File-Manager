import React from 'react';
import { Star, X } from 'lucide-react';

interface FavoritesListProps {
  favorites?: string[];
  onNavigate: (path: string) => void;
  onUnpin?: (path: string) => Promise<void> | void;
}

export const FavoritesList: React.FC<FavoritesListProps> = ({
  favorites = [],
  onNavigate,
  onUnpin,
}) => {
  if (favorites.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 text-center" data-testid="favorites-empty">
        No pinned favorites yet
      </div>
    );
  }

  return (
    <div className="mt-4 px-3" data-testid="favorites-list">
      <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 mb-2">
        Favorites
      </h3>
      <ul className="space-y-1">
        {favorites.map((fav) => {
          const name = fav.split(/[\\/]/).filter(Boolean).pop() || fav;
          return (
            <li
              key={fav}
              className="group flex items-center gap-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1"
            >
              <button
                type="button"
                onClick={() => onNavigate(fav)}
                title={fav}
                className="flex-1 min-w-0 flex items-center gap-2 text-left text-xs text-slate-700 dark:text-slate-200 font-medium truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <Star className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{name}</span>
              </button>
              {onUnpin && (
                <button
                  type="button"
                  onClick={() => void onUnpin(fav)}
                  aria-label={`Unpin ${name}`}
                  title="Unpin Favorite"
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 p-1 min-w-[24px] min-h-[24px] inline-flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
