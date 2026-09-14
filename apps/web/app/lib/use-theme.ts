'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'kulisa-theme';

function readCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Reads/writes the theme applied by the blocking script in `theme-script.tsx`
 * (`data-theme` on <html> + localStorage). Kept as a thin hook rather than a
 * store — there is exactly one reader (the profile menu toggle) today.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(readCurrentTheme());
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = readCurrentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled — theme still applies for this load.
    }
    setTheme(next);
  }, []);

  return { theme, toggleTheme };
}
