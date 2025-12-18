import { useEffect } from 'react';

type ShortcutHandler = () => void;
type ShortcutMap = Record<string, ShortcutHandler>;

/**
 * Hook to register global keyboard shortcuts
 * @param shortcuts - Map of keyboard shortcut strings to handler functions
 * @example
 * useKeyboardShortcuts({
 *   'Ctrl+F': handleSearch,
 *   'Ctrl+Shift+L': toggleChat,
 *   'Alt+Left': goBack,
 *   'Delete': handleDelete,
 * });
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Build key combination string
      const parts: string[] = [];

      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');

      // Add the actual key
      if (e.key.length === 1) {
        // Single character keys (uppercase)
        parts.push(e.key.toUpperCase());
      } else {
        // Special keys (ArrowLeft, Delete, F1, etc.)
        parts.push(e.key);
      }

      const combination = parts.join('+');

      // Check if we have a handler for this combination
      const handler = shortcuts[combination];
      if (handler) {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts]);
}
