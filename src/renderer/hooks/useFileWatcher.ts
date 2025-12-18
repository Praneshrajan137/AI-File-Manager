import { useEffect } from 'react';
import { FileEvent } from '@shared/contracts';

/**
 * Hook to listen to real-time file system updates from Main Process
 * @param onFileEvent - Callback function to handle file events
 */
export function useFileWatcher(
  onFileEvent: (event: FileEvent) => void
): void {
  useEffect(() => {
    // Subscribe to file watcher events via exposed API
    const cleanup = window.electronAPI.fileWatcher.subscribe((event) => {
      // Convert to FileEvent format with priority and timestamp
      const fileEvent: FileEvent = {
        type: event.type as 'create' | 'change' | 'unlink',
        path: event.path,
        priority: 5,
        timestamp: Date.now(),
      };

      onFileEvent(fileEvent);
    });

    // Cleanup subscription on unmount
    return cleanup;
  }, [onFileEvent]);
}
