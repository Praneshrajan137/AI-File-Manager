import { createContext, useContext } from 'react';

export interface DirectoryTreeFocusContextValue {
  focusedPath: string | null;
  setFocusedPath: (path: string) => void;
}

export const DirectoryTreeFocusContext = createContext<DirectoryTreeFocusContextValue | null>(null);

export function useDirectoryTreeFocus(): DirectoryTreeFocusContextValue | null {
  return useContext(DirectoryTreeFocusContext);
}
