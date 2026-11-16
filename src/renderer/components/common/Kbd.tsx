import React from 'react';

interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

/** Crisp keyboard shortcut badge for toolbar, status footer, and contextual HUDs. */
export const Kbd: React.FC<KbdProps> = ({ children, className = '' }) => (
  <kbd
    className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-medium leading-none rounded border border-slate-300/90 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.08)] ${className}`.trim()}
  >
    {children}
  </kbd>
);
