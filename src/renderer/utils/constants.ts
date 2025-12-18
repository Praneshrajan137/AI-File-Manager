/**
 * Keyboard shortcuts configuration
 */
export const KEYBOARD_SHORTCUTS = {
  SEARCH: 'Ctrl+F',
  CHAT: 'Ctrl+Shift+L',
  BACK: 'Alt+Left',
  FORWARD: 'Alt+Right',
  DELETE: 'Delete',
  RENAME: 'F2',
  SELECT_ALL: 'Ctrl+A',
  COPY: 'Ctrl+C',
  PASTE: 'Ctrl+V',
  CUT: 'Ctrl+X',
  NEW_FILE: 'Ctrl+N',
  NEW_FOLDER: 'Ctrl+Shift+N',
  REFRESH: 'F5',
} as const;

/**
 * File size limits
 */
export const FILE_SIZE_LIMITS = {
  MAX_PREVIEW_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_INDEXABLE_SIZE: 10 * 1024 * 1024, // 10MB
} as const;

/**
 * UI constants
 */
export const UI_CONSTANTS = {
  SIDEBAR_MIN_WIDTH: 200,
  SIDEBAR_MAX_WIDTH: 400,
  SIDEBAR_DEFAULT_WIDTH: 260,
  CHAT_PANEL_WIDTH: 384, // 96 * 4 (Tailwind w-96)
  FILE_ITEM_HEIGHT: 50,
  DEBOUNCE_DELAY: 300,
  TOAST_DURATION: 3000,
  TOAST_Z_INDEX: 50,
  CONTEXT_MENU_Z_INDEX: 50,
} as const;

/**
 * File type categories
 */
export const FILE_TYPE_CATEGORIES = {
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'ico', 'webp'],
  VIDEO: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm'],
  AUDIO: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'odt', 'txt', 'rtf', 'md'],
  SPREADSHEET: ['xlsx', 'xls', 'csv', 'ods'],
  PRESENTATION: ['ppt', 'pptx', 'odp'],
  ARCHIVE: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  CODE: ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt'],
} as const;

/**
 * Sort criteria options
 */
export type SortBy = 'name' | 'size' | 'modified' | 'type';
export type SortDirection = 'asc' | 'desc';

/**
 * View modes
 */
export type ViewMode = 'list' | 'grid';
