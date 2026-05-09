// ============================================================
// SimpleBuild Pro — Dropdown Menu Component
// ============================================================

'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import clsx from 'clsx';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export function Dropdown({ trigger, children, align = 'right', className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          className={clsx(
            'absolute z-50 mt-1 min-w-[180px] bg-white rounded-xl shadow-xl border border-slate-200 py-1 animate-fade-in',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
}

export function DropdownItem({ children, onClick, danger, icon, disabled }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {icon && <span className="shrink-0 w-4 h-4">{icon}</span>}
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 border-t border-slate-100" />;
}
