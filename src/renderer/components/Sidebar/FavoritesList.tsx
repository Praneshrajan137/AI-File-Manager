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
      <div className="px-4 py-3 text-xs text-gray-400 text-center" data-testid="favorites-empty">
        No pinned favorites yet
      </div>
    );
  }

  return (
    <div className="mt-4 px-3" data-testid="favorites-list">
      <h3 className="text-[10px] font-semibold text-primary-400 uppercase tracking-wider px-2 mb-2">
        Favorites
      </h3>
      <ul className="space-y-1">
        {favorites.map((fav) => {
          const name = fav.split(/[\\/]/).filter(Boolean).pop() || fav;
          return (
            <li key={fav} className="group flex items-center gap-1 rounded-lg hover:bg-primary-100 dark:hover:bg-slate-800 px-2 py-1">
              <button
                type="button"
                onClick={() => onNavigate(fav)}
                title={fav}
                className="flex-1 min-w-0 flex items-center gap-2 text-left text-xs text-primary-700 dark:text-slate-200 font-medium truncate"
              >
                <Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="truncate">{name}</span>
              </button>
              {onUnpin && (
                <button
                  type="button"
                  onClick={() => void onUnpin(fav)}
                  aria-label={`Unpin ${name}`}
                  title="Unpin Favorite"
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-primary-400 hover:text-primary-700 dark:hover:text-white rounded transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
