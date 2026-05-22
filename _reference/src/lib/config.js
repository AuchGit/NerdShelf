// ─── Config Keys ─────────────────────────────────────────────────────────────
const SUPABASE_CONFIG_KEY = 'nerd_tools_supabase';
const THEME_CONFIG_KEY    = 'nerd_tools_theme';

// ─── Supabase Config ─────────────────────────────────────────────────────────

/**
 * Read Supabase config.
 * Priority: localStorage → environment variables → empty strings
 */
export function getSupabaseConfig() {
  try {
    const stored = localStorage.getItem(SUPABASE_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.supabaseUrl && parsed.supabaseAnonKey) {
        return {
          supabaseUrl:     parsed.supabaseUrl,
          supabaseAnonKey: parsed.supabaseAnonKey,
        };
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Fall back to environment variables
  return {
    supabaseUrl:     import.meta.env.VITE_SUPABASE_URL     || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  };
}

/**
 * Persist Supabase config to localStorage.
 * Pass null to clear the stored config and fall back to env vars.
 */
export function saveSupabaseConfig(config) {
  if (!config) {
    localStorage.removeItem(SUPABASE_CONFIG_KEY);
    return;
  }
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));
}

/** Returns true if we have a valid-looking Supabase config. */
export function hasValidSupabaseConfig() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

// ─── Theme Config ─────────────────────────────────────────────────────────────

/** @typedef {'system' | 'light' | 'dark'} ThemeMode */

/**
 * Read persisted theme preference.
 * @returns {{ theme: ThemeMode }}
 */
export function getThemeConfig() {
  try {
    const stored = localStorage.getItem(THEME_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (['system', 'light', 'dark'].includes(parsed.theme)) {
        return { theme: parsed.theme };
      }
    }
  } catch {
    // Ignore
  }
  return { theme: 'system' };
}

/**
 * Persist theme preference.
 * @param {ThemeMode} theme
 */
export function saveThemeConfig(theme) {
  localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify({ theme }));
}
