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
  'aria-label'?: string;
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
  'aria-label': ariaLabel,
}) => {
  const baseClasses = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses = {
    primary: 'bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white focus:ring-primary-500',
    secondary: 'bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 focus:ring-gray-300',
    ghost: 'bg-transparent hover:bg-gray-100 active:bg-gray-200 text-gray-700 focus:ring-gray-300',
    danger: 'bg-error-500 hover:bg-error-600 active:bg-error-700 text-white focus:ring-error-500',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  const widthClass = fullWidth ? 'w-full' : '';

  const isDisabled = disabled || loading;

  const handleClick = () => {
    if (!isDisabled && onClick) {
      onClick();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && !isDisabled && onClick) {
      e.preventDefault();
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
      onKeyPress={handleKeyPress}
      disabled={isDisabled}
      aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
      aria-busy={loading}
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
