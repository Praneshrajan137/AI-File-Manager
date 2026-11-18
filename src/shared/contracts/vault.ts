/**
 * contracts/vault.ts - Scoped workspace (Vault) and UI preferences contracts.
 */

export type ExplorerLens = 'files' | 'graph' | 'collections' | 'duplicates';

export interface UIPreferencesSnapshot {
  theme: 'light' | 'dark';
  explorerLens: ExplorerLens;
  viewMode: 'grid' | 'list';
  splitPaneOpen: boolean;
  onboardingCompleted?: boolean;
  developerBadges?: boolean;
}

export interface VaultConfigSnapshot {
  allowedRoots: string[];
  indexedRoots: string[];
  excludedDirs: string[];
  favorites: string[];
  defaultDeleteMode: 'vault' | 'trash';
  ui?: UIPreferencesSnapshot;
}
