// src/core/theme/ThemeProvider.jsx
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext(null);
const MODE_KEY = 'nerdshelf-theme-mode';
const CUSTOM_KEY = 'nerdshelf-theme-custom';

const DEFAULT_CUSTOM = {
  '--color-bg': '#0f1115',
  '--color-bg-elevated': '#171a21',
  '--color-bg-sunken': '#0a0c10',
  '--color-surface': '#1d212a',
  '--color-surface-hover': '#252a35',
  '--color-border': '#2a3040',
  '--color-border-strong': '#3a4256',
  '--color-text': '#e6e8ee',
  '--color-text-muted': '#9aa3b4',
  '--color-text-dim': '#6b7386',
  '--color-accent': '#7aa2f7',
  '--color-accent-hover': '#94b5ff',
  '--color-accent-contrast': '#0f1115',
  '--color-danger': '#f7768e',
  '--color-success': '#9ece6a',
  '--color-warning': '#e0af68',
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'system'; } catch { return 'system'; }
  });
  const [customColors, setCustomColorsState] = useState(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      return raw ? { ...DEFAULT_CUSTOM, ...JSON.parse(raw) } : DEFAULT_CUSTOM;
    } catch { return DEFAULT_CUSTOM; }
  });
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light')
                 : mode === 'custom' ? 'custom' : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved === 'light' ? 'light' : 'dark';

    if (resolved === 'custom') {
      for (const [k, v] of Object.entries(customColors)) {
        root.style.setProperty(k, v);
      }
    } else {
      for (const k of Object.keys(DEFAULT_CUSTOM)) {
        root.style.removeProperty(k);
      }
    }
  }, [resolved, customColors]);

  const setThemeMode = useCallback((m) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
  }, []);

  const setCustomColors = useCallback((next) => {
    setCustomColorsState(next);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const resetCustomColors = useCallback(() => {
    setCustomColorsState(DEFAULT_CUSTOM);
    try { localStorage.removeItem(CUSTOM_KEY); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setThemeMode, customColors, setCustomColors, resetCustomColors, DEFAULT_CUSTOM }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}