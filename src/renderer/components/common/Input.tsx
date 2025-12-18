import React from 'react';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'search' | 'number' | 'password' | 'email';
  disabled?: boolean;
  error?: string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  autoFocus?: boolean;
  onKeyPress?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  name?: string;
  id?: string;
}

export const Input: React.FC<InputProps> = ({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  error,
  icon,
  iconPosition = 'left',
  autoFocus = false,
  onKeyPress,
  onFocus,
  onBlur,
  className = '',
  name,
  id,
}) => {
  const baseClasses = 'w-full px-3 py-2 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2';

  const stateClasses = error
    ? 'border-error-500 text-error-900 placeholder-error-300 focus:border-error-500 focus:ring-error-500'
    : 'border-gray-300 text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:ring-primary-500';

  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'bg-white';

  const paddingClasses = icon
    ? iconPosition === 'left'
      ? 'pl-10'
      : 'pr-10'
    : '';

  return (
    <div className={`relative ${className}`}>
      {icon && (
        <div
          className={`
            absolute top-1/2 -translate-y-1/2 text-gray-400
            ${iconPosition === 'left' ? 'left-3' : 'right-3'}
          `}
        >
          {icon}
        </div>
      )}

      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyPress={onKeyPress}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`
          ${baseClasses}
          ${stateClasses}
          ${disabledClasses}
          ${paddingClasses}
        `}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />

      {error && (
        <p
          id={`${id}-error`}
          className="mt-1 text-xs text-error-600"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};
