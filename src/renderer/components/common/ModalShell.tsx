import React, { useEffect, useId, useRef } from 'react';
import { useRegisterOverlay } from '@renderer/hooks/useOverlayStack';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
  );
}

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  dataTestId?: string;
  overlayId?: string;
  panelClassName?: string;
  backdropClassName?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  closeOnBackdropClick?: boolean;
  children: React.ReactNode;
}

/**
 * Accessible modal dialog shell providing LIFO Escape dismissal, Tab/Shift+Tab focus
 * trapping, initial focus placement, and focus restoration to the triggering control.
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  role = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  dataTestId,
  overlayId,
  panelClassName = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-6 w-96 max-w-[92vw]',
  backdropClassName = 'fixed inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center z-50 p-4',
  initialFocusRef,
  closeOnBackdropClick = true,
  children,
}) => {
  const generatedId = useId();
  const effectiveId = overlayId ?? dataTestId ?? `modal-${generatedId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useRegisterOverlay(effectiveId, isOpen, onClose);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = setTimeout(() => {
      const target = initialFocusRef?.current;
      if (target && panelRef.current?.contains(target)) {
        target.focus();
        return;
      }
      if (panelRef.current) {
        const focusables = getFocusableElements(panelRef.current);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          panelRef.current.focus();
        }
      }
    }, 0);

    return (): void => {
      clearTimeout(focusTimer);
      const prev = previousFocusRef.current;
      if (prev && prev.isConnected) {
        prev.focus();
      }
      previousFocusRef.current = null;
    };
  }, [initialFocusRef, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab' || !panelRef.current) {
      return;
    }

    const focusables = getFocusableElements(panelRef.current);
    if (focusables.length === 0) {
      e.preventDefault();
      panelRef.current.focus();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !panelRef.current.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !panelRef.current.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={backdropClassName}
      onClick={closeOnBackdropClick ? onClose : undefined}
      data-testid={dataTestId}
      role={role}
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`${panelClassName} text-slate-900 dark:text-slate-100 focus:outline-none`}
        onClick={(e): void => e.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
      >
        {children}
      </div>
    </div>
  );
};
