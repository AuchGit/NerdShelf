// src/features/dnd/character-builder/lib/useSessionPrefs.js
//
// Reactive wrapper around the localStorage prefs in sessionPrefs.js.
// Both the in-session quick-edit panel and the global DnD settings tab
// mount this — they end up editing the same source and stay in sync via
// the 'dnd-session-prefs-changed' window event the setter dispatches.

import { useEffect, useState } from 'react'
import { getSessionPrefs, setSessionPrefs, toggleSessionPref, resetSessionPrefs } from './sessionPrefs'

export function useSessionPrefs() {
  const [prefs, setPrefs] = useState(() => getSessionPrefs())

  useEffect(() => {
    const refresh = () => setPrefs(getSessionPrefs())
    window.addEventListener('dnd-session-prefs-changed', refresh)
    // Also listen for cross-tab writes (Settings open in another window).
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('dnd-session-prefs-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return {
    prefs,
    toggle: (bucket, id) => toggleSessionPref(bucket, id),
    set:    (next)       => setSessionPrefs(next),
    reset:  ()           => resetSessionPrefs(),
  }
}
