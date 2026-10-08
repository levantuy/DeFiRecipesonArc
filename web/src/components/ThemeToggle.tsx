'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/ThemeProvider';

interface ThemeToggleProps {
  /** 'icon' = icon-only button (navbar); 'labeled' = icon + label (mobile menu) */
  variant?: 'icon' | 'labeled';
  className?: string;
}

export function ThemeToggle({ variant = 'icon', className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  if (variant === 'labeled') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors hover:bg-white/5 ${className}`}
        style={{ color: 'var(--muted)' }}
      >
        {isDark
          ? <Sun  className="h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }} />
          : <Moon className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
        }
        <span style={{ color: 'var(--ink)' }}>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
      }}
    >
      {isDark
        ? <Sun  className="h-4 w-4" />
        : <Moon className="h-4 w-4" />
      }
    </button>
  );
}
