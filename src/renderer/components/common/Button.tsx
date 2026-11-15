import React from 'react';
import { Spinner } from './Spinner';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'data-testid'?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  onClick,
  children,
  className = '',
  type = 'button',
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  'data-testid': dataTestId,
}) => {
  const baseClasses = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses = {
    primary: 'bg-accent-600 hover:bg-accent-700 active:bg-accent-800 text-white focus-visible:ring-accent-500',
    secondary: 'bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 active:bg-slate-400 text-slate-900 dark:text-slate-100 focus-visible:ring-slate-500',
    ghost: 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 text-slate-700 dark:text-slate-200 focus-visible:ring-slate-500',
    danger: 'bg-error-700 hover:bg-error-600 active:bg-red-800 text-white focus-visible:ring-error-500',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  const widthClass = fullWidth ? 'w-full' : '';

  const isDisabled = disabled || loading;

  const handleClick = (): void => {
    if (!isDisabled && onClick) {
      onClick();
    }
  };

  return (
    <button
      type={type}
      className={`
        ${baseClasses}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${widthClass}
        ${className}
      `}
      onClick={handleClick}
      disabled={isDisabled}
      title={title}
      aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
      aria-pressed={ariaPressed}
      aria-busy={loading}
      data-testid={dataTestId}
    >
      {loading ? (
        <>
          <Spinner size={size === 'sm' ? 'sm' : 'md'} color={variant === 'ghost' || variant === 'secondary' ? 'gray' : 'white'} />
          {children}
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' && icon}
          {children}
          {icon && iconPosition === 'right' && icon}
        </>
      )}
    </button>
  );
};
