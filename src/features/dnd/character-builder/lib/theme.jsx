// src/features/dnd/character-builder/lib/theme.jsx
// Compat shim: DnD used to have its own theme provider with its own CSS variable
// names. The NerdShelf central ThemeProvider now owns theming. This file keeps
// the DnD component imports working by mapping old variable names to the
// canonical ones via an injected <style> tag.

import { createContext, useContext, useEffect } from 'react'

const DndThemeContext = createContext({ resolvedId: 'dark', isDark: true })

const STYLE_ID = 'dnd-compat-vars'
const COMPAT_CSS = `
:root {
  --bg-page: var(--color-bg);
  --bg-surface: var(--color-bg-elevated);
  --bg-inset: var(--color-bg-sunken);
  --bg-highlight: var(--color-surface-hover);
  --bg-deep: var(--color-bg-sunken);
  --border: var(--color-border);
  --border-subtle: var(--color-border);
  --border-strong: var(--color-border-strong);
  --text-primary: var(--color-text);
  --text-muted: var(--color-text-muted);
  --text-dim: var(--color-text-dim);
  --accent: var(--color-accent);
  --accent-hover: var(--color-accent-hover);
  --accent-red: var(--color-danger);
  --accent-green: var(--color-success);
  --accent-yellow: var(--color-warning);
  --shadow: rgba(0,0,0,0.25);
}
`

export function ThemeProvider({ children }) {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = COMPAT_CSS
    document.head.appendChild(style)
  }, [])

  return <DndThemeContext.Provider value={{ resolvedId: 'dark', isDark: true }}>{children}</DndThemeContext.Provider>
}

export function useTheme() {
  return useContext(DndThemeContext)
}