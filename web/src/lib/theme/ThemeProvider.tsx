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

/**
 * Read theme from the DOM — the inline <script> in <head> already applied
 * data-theme to <html> before React mounted, so we trust the DOM as source
 * of truth instead of re-reading localStorage (avoids double-apply).
 */
function getThemeFromDOM(): Theme {
  if (typeof window === 'undefined') return 'dark'; // SSR
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light') return 'light';
  if (attr === 'dark') return 'dark';
  // Fallback: read localStorage directly
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyThemeToDom(t: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  if (t === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  localStorage.setItem(STORAGE_KEY, t);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0d1b2f' : '#f0f5fc';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize from DOM (already set by inline script) — no SSR mismatch
  // because suppressHydrationWarning on <html> allows the DOM state to differ
  // from the server-rendered string.
  const [theme, setThemeState] = useState<Theme>('dark');

  // On first client mount, sync React state to whatever the DOM already shows.
  // This is the ONE place we read the DOM; we do NOT call applyThemeToDom here
  // (that would be redundant — the script already applied the correct theme).
  useEffect(() => {
    const current = getThemeFromDOM();
    setThemeState(current);

    // Listen for OS preference changes (only when no user override is saved)
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    function onMqChange(e: MediaQueryListEvent) {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const next: Theme = e.matches ? 'light' : 'dark';
        applyThemeToDom(next);
        setThemeState(next);
      }
    }
    mq.addEventListener('change', onMqChange);
    return () => mq.removeEventListener('change', onMqChange);
  }, []); // empty deps — run once on mount only

  const setTheme = useCallback((t: Theme) => {
    applyThemeToDom(t);
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyThemeToDom(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
