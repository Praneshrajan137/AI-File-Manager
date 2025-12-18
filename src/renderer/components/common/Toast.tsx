import React from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { ToastMessage } from '@renderer/hooks/useToast';

interface ToastProps extends ToastMessage {
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  type,
  message,
  onClose,
}) => {
  // Note: Auto-dismiss is handled by useToast hook, not here
  // This component only handles manual dismissal via X button

  const typeConfig = {
    success: {
      bg: 'bg-success-500',
      text: 'text-white',
      icon: <CheckCircle className="w-5 h-5" />,
    },
    error: {
      bg: 'bg-error-500',
      text: 'text-white',
      icon: <AlertCircle className="w-5 h-5" />,
    },
    warning: {
      bg: 'bg-warning-500',
      text: 'text-white',
      icon: <AlertTriangle className="w-5 h-5" />,
    },
    info: {
      bg: 'bg-info-500',
      text: 'text-white',
      icon: <Info className="w-5 h-5" />,
    },
  };

  const config = typeConfig[type];

  return (
    <div
      className={`
        ${config.bg} ${config.text}
        flex items-start gap-3 p-4 rounded-lg shadow-lg min-w-[300px] max-w-[500px]
        animate-slideIn
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-shrink-0 mt-0.5">{config.icon}</div>

      <div className="flex-1 text-sm font-medium">{message}</div>

      <button
        onClick={onClose}
        className="flex-shrink-0 hover:opacity-75 transition-opacity focus:outline-none focus:ring-2 focus:ring-white rounded"
        aria-label="Close notification"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
};
