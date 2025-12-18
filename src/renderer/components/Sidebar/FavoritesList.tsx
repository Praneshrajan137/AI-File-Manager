import React, { useState } from 'react';
import { Star, Folder } from 'lucide-react';

interface FavoritesListProps {
  onNavigate: (path: string) => void;
}

export const FavoritesList: React.FC<FavoritesListProps> = ({ onNavigate }) => {
  const [favorites] = useState<string[]>([]);

  if (favorites.length === 0) {
    return (
      <div className="px-2 py-4 text-xs text-gray-400 text-center">
        No favorites yet
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-2">
        Favorites
      </h3>
      <ul className="space-y-1">
        {favorites.map(fav => (
          <li key={fav}>
            <button
              onClick={() => onNavigate(fav)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <Folder className="w-4 h-4 text-blue-500" />
              <span className="truncate flex-1">{fav}</span>
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
