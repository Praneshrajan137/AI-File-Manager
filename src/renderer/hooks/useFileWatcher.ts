import { useEffect, useRef } from 'react';
import { FileEvent } from '@shared/contracts';

/**
 * Hook to listen to real-time file system updates from Main Process.
 * 
 * Uses a ref to store the callback to prevent re-subscription cycles when
 * the callback changes. The subscription persists for the component's lifetime.
 * 
 * @param onFileEvent - Callback function to handle file events
 */
export function useFileWatcher(
  onFileEvent: (event: FileEvent) => void
): void {
  // Store the latest callback in a ref to avoid re-subscription
  const callbackRef = useRef(onFileEvent);
  
  // Update ref when callback changes (doesn't trigger re-subscription)
  useEffect(() => {
    callbackRef.current = onFileEvent;
  }, [onFileEvent]);
  
  useEffect(() => {
    // Subscribe to file watcher events via exposed API
    const cleanup = window.electronAPI.fileWatcher.subscribe((event) => {
      // Convert to FileEvent format with priority and timestamp
      const fileEvent: FileEvent = {
        type: event.type as 'create' | 'change' | 'unlink' | 'rename',
        path: event.path,
        priority: 5,
        timestamp: Date.now(),
      };

      // Always use the latest callback from ref
      callbackRef.current(fileEvent);
    });

    // Cleanup subscription on unmount only
    return cleanup;
  }, []); // Empty dependency array - subscription persists for component lifetime
}
