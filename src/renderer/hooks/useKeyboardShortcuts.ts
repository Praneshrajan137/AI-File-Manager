import { useEffect, useLayoutEffect, useRef } from 'react';
import { useOverlayStack } from '@renderer/hooks/useOverlayStack';

type ShortcutHandler = () => void;
type ShortcutMap = Record<string, ShortcutHandler>;

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') {
    return false;
  }
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  return typeof el.closest === 'function' && el.closest('[contenteditable="true"]') !== null;
}

const INTERACTIVE_WIDGET_SELECTOR =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="treeitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"]';

function isInteractiveWidgetElement(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') {
    return false;
  }
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY' || (tag === 'A' && el.hasAttribute('href'))) {
    return true;
  }
  return typeof el.closest === 'function' && el.closest(INTERACTIVE_WIDGET_SELECTOR) !== null;
}

/**
 * Hook to register global keyboard shortcuts while respecting active overlays,
 * editable fields, and native interactive widget activation (Space on buttons/tabs).
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  const { hasOpenOverlay } = useOverlayStack();
  const shortcutsRef = useRef<ShortcutMap>(shortcuts);
  const hasOpenOverlayRef = useRef<boolean>(hasOpenOverlay);

  // Sync synchronously on DOM commit so immediate keypresses after click selection never read stale handlers.
  useLayoutEffect(() => {
    shortcutsRef.current = shortcuts;
    hasOpenOverlayRef.current = hasOpenOverlay;
  }, [hasOpenOverlay, shortcuts]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isEditableElement(e.target)) {
        return;
      }
      if (
        hasOpenOverlayRef.current ||
        (typeof document !== 'undefined' &&
          document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null)
      ) {
        return;
      }
      // Allow Spacebar to activate focused buttons, tabs, menus, treeitems, and checkboxes.
      if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && isInteractiveWidgetElement(e.target)) {
        return;
      }

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
      const handler = shortcutsRef.current[combination];
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
  }, []);
}
