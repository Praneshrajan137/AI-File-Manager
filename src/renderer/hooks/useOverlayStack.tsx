import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface OverlayEntry {
  id: string;
  onDismiss: () => void;
  blocking: boolean;
}

interface OverlayOptions {
  blocking?: boolean;
}

interface OverlayStackContextValue {
  hasOpenOverlay: boolean;
  pushOverlay: (id: string, onDismiss: () => void, blocking?: boolean) => void;
  removeOverlay: (id: string) => void;
  isTopOverlay: (id: string) => boolean;
}

const fallbackDismissStack: OverlayEntry[] = [];

const OverlayStackContext = createContext<OverlayStackContextValue | null>(null);

/**
 * Coordinates layered modals, drawers, and popovers in LIFO order so pressing Escape
 * dismisses only the topmost active layer instead of bubbling down to background UI.
 */
export const OverlayStackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const stackRef = useRef<OverlayEntry[]>([]);
  const [hasOpenOverlay, setHasOpenOverlay] = useState<boolean>(false);

  const syncTopState = useCallback((): void => {
    setHasOpenOverlay(stackRef.current.some((entry) => entry.blocking));
  }, []);

  const pushOverlay = useCallback(
    (id: string, onDismiss: () => void, blocking = true): void => {
      const next = stackRef.current.filter((entry) => entry.id !== id);
      next.push({ id, onDismiss, blocking });
      stackRef.current = next;
      syncTopState();
    },
    [syncTopState]
  );

  const removeOverlay = useCallback(
    (id: string): void => {
      const next = stackRef.current.filter((entry) => entry.id !== id);
      if (next.length !== stackRef.current.length) {
        stackRef.current = next;
        syncTopState();
      }
    },
    [syncTopState]
  );

  const isTopOverlay = useCallback((id: string): boolean => {
    const stack = stackRef.current;
    return stack.length > 0 && stack[stack.length - 1].id === id;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const stack = stackRef.current;
      if (stack.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const top = stack[stack.length - 1];
      top.onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return (): void => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const value = useMemo<OverlayStackContextValue>(
    () => ({
      hasOpenOverlay,
      pushOverlay,
      removeOverlay,
      isTopOverlay,
    }),
    [hasOpenOverlay, isTopOverlay, pushOverlay, removeOverlay]
  );

  return <OverlayStackContext.Provider value={value}>{children}</OverlayStackContext.Provider>;
};

export function useOverlayStack(): OverlayStackContextValue {
  const ctx = useContext(OverlayStackContext);
  if (ctx) return ctx;

  return {
    hasOpenOverlay:
      fallbackDismissStack.some((entry) => entry.blocking) ||
      (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]') !== null),
    pushOverlay: (id: string, onDismiss: () => void, blocking = true): void => {
      const idx = fallbackDismissStack.findIndex((entry) => entry.id === id);
      if (idx >= 0) fallbackDismissStack.splice(idx, 1);
      fallbackDismissStack.push({ id, onDismiss, blocking });
    },
    removeOverlay: (id: string): void => {
      const idx = fallbackDismissStack.findIndex((entry) => entry.id === id);
      if (idx >= 0) fallbackDismissStack.splice(idx, 1);
    },
    isTopOverlay: (id: string): boolean => {
      if (fallbackDismissStack.length === 0) return true;
      return fallbackDismissStack[fallbackDismissStack.length - 1].id === id;
    },
  };
}

/**
 * Registers an overlay entry while open so Escape closes layers strictly LIFO.
 * Falls back gracefully when rendered outside OverlayStackProvider in isolated tests.
 */
export function useRegisterOverlay(
  id: string,
  isOpen: boolean,
  onClose: () => void,
  options?: OverlayOptions
): void {
  const ctx = useContext(OverlayStackContext);
  const pushOverlay = ctx?.pushOverlay;
  const removeOverlay = ctx?.removeOverlay;
  const blocking = options?.blocking !== false;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    if (pushOverlay && removeOverlay) {
      pushOverlay(id, () => onCloseRef.current(), blocking);
      return (): void => removeOverlay(id);
    }

    const entry: OverlayEntry = { id, onDismiss: () => onCloseRef.current(), blocking };
    const idx = fallbackDismissStack.findIndex((item) => item.id === id);
    if (idx >= 0) fallbackDismissStack.splice(idx, 1);
    fallbackDismissStack.push(entry);

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const top = fallbackDismissStack[fallbackDismissStack.length - 1];
      if (!top || top.id === id) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return (): void => {
      window.removeEventListener('keydown', handleKeyDown, true);
      const removeIdx = fallbackDismissStack.findIndex((item) => item.id === id);
      if (removeIdx >= 0) fallbackDismissStack.splice(removeIdx, 1);
    };
  }, [blocking, id, isOpen, pushOverlay, removeOverlay]);
}
