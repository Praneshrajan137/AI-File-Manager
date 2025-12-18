import { useState, useCallback, useRef, useEffect } from 'react';
import { UI_CONSTANTS } from '@renderer/utils/constants';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface UseToastReturn {
  toasts: ToastMessage[];
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: number) => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timeoutRefs = useRef<Map<number, NodeJS.Timeout>>(new Map());
  const counterRef = useRef<number>(0);

  // Cleanup all pending timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, []);

  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    // Generate unique ID: timestamp + counter ensures no collisions
    // even if multiple toasts are created in the same millisecond
    const id = Date.now() * 1000 + (counterRef.current++ % 1000);
    const duration = toast.duration ?? UI_CONSTANTS.TOAST_DURATION;

    setToasts(prev => [...prev, { ...toast, id }]);

    // Auto-dismiss after duration
    const timeoutId = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timeoutRefs.current.delete(id);
    }, duration);

    // Store timeout ID for cleanup
    timeoutRefs.current.set(id, timeoutId);
  }, []);

  const removeToast = useCallback((id: number) => {
    // Clear pending timeout if exists
    const timeoutId = timeoutRefs.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutRefs.current.delete(id);
    }

    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return {
    toasts,
    showToast,
    removeToast,
  };
}
