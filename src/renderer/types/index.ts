// Re-export types from shared contracts
export type {
  FileNode,
  FileStats,
  ValidationResult,
  FileSystemError,
  FileEvent,
  EventPriority,
  HistoryNode,
} from '@shared/contracts';

// Re-export from utils/constants
export type { SortBy, SortDirection, ViewMode } from '@renderer/utils/constants';

// Re-export from hooks
export type { ToastMessage } from '@renderer/hooks/useToast';
export type { Message, IndexingStatus } from '@renderer/hooks/useLLM';

// Renderer-specific types
export interface FileSelection {
  paths: string[];
  lastSelected: string | null;
}
