'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'defi-recipes-theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getInitialTheme(): Theme {
  // On SSR, always return dark (matches the anti-flash script default)
  if (typeof window === 'undefined') return 'dark';
  // Read what the anti-flash script already applied to <html>
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t);
    // Also keep the Tailwind `dark` class in sync for any tw:dark: utilities
    if (t === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEY, t);
    // Update meta theme-color
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0d1b2f' : '#f0f5fc';
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, [applyTheme]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, [applyTheme]);

  // Sync on first mount (handles SSR mismatch gracefully)
  useEffect(() => {
    const t = getInitialTheme();
    setThemeState(t);
    applyTheme(t);
    // Also listen for OS preference changes when no user pref is saved
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    function onMqChange(e: MediaQueryListEvent) {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const next: Theme = e.matches ? 'light' : 'dark';
        setThemeState(next);
        applyTheme(next);
      }
    }
    mq.addEventListener('change', onMqChange);
    return () => mq.removeEventListener('change', onMqChange);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
