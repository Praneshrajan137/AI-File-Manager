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
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  name?: string;
  id?: string;
  'data-testid'?: string;
  'aria-label'?: string;
  role?: React.AriaRole;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
  'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both';
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
  onKeyDown,
  onFocus,
  onBlur,
  className = '',
  name,
  id,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
  role,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  'aria-activedescendant': ariaActivedescendant,
  'aria-autocomplete': ariaAutocomplete,
}) => {
  const baseClasses = 'w-full px-3 py-2 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2';

  const stateClasses = error
    ? 'border-error-600 text-error-700 dark:text-red-200 placeholder-slate-500 focus:border-error-600 focus:ring-error-500'
    : 'border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 focus:border-accent-500 focus:ring-accent-500';

  const disabledClasses = disabled
    ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800'
    : 'bg-white dark:bg-slate-800';

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
            absolute top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400
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
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid={dataTestId}
        aria-label={ariaLabel}
        role={role}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        aria-activedescendant={ariaActivedescendant}
        aria-autocomplete={ariaAutocomplete}
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
          className="mt-1 text-xs text-error-700 dark:text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};
