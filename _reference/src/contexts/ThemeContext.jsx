import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getThemeConfig, saveThemeConfig } from '@/lib/config';

/** @typedef {'system' | 'light' | 'dark'} ThemeMode */
/** @typedef {{ theme: ThemeMode, resolvedTheme: 'light' | 'dark', setTheme: (t: ThemeMode) => void }} ThemeContextValue */

const ThemeContext = createContext(/** @type {ThemeContextValue} */ (null));

/**
 * Resolves the user's preferred theme mode to an actual 'light' | 'dark' value.
 * @param {ThemeMode} mode
 * @returns {'light' | 'dark'}
 */
function resolveTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, _setTheme] = useState(() => getThemeConfig().theme);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getThemeConfig().theme));

  // Apply theme class to <html>
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);

    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Listen for OS-level changes when theme = 'system'
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = resolveTheme('system');
      setResolvedTheme(resolved);
      const root = document.documentElement;
      if (resolved === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    saveThemeConfig(newTheme);
    _setTheme(newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** @returns {ThemeContextValue} */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
