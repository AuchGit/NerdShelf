// src/shared/hooks/useSidebarMode.js
//
// Quelle der Wahrheit für den Zustand der App-Sidebar (DnD/MTG/WH40K).
//
// Drei orthogonale Achsen:
//   1. autoMode    — vom Fenster diktiert ('full' | 'compact' | 'hidden')
//   2. userPref    — vom User explizit gewählt ('auto' | 'expanded' | 'collapsed')
//   3. effective   — was tatsächlich gerendert wird (full / compact)
//   4. overlay     — bei sehr schmalen Fenstern wird die Full-Variante
//                    als Overlay über den Content geblendet statt zu
//                    pushen. Vermeidet komische Squishing-Effekte und
//                    funktioniert wie die Sheet-Header-Toggle-Bar.
//
// Persistiert in localStorage damit der User-Toggle über Restarts
// hinweg bleibt. Default 'auto' = aktuelles Verhalten.

import { useEffect, useState, useCallback } from 'react'
import useWindowWidth, { SIDEBAR_WIDTH } from './useWindowWidth'

const STORAGE_KEY = 'nerdshelf-sidebar-pref'

function readPref() {
  if (typeof window === 'undefined') return 'auto'
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'expanded' || v === 'collapsed') return v
    return 'auto'
  } catch {
    return 'auto'
  }
}

export default function useSidebarMode() {
  const { mode: autoMode, width, contentWidth, mtgMode } = useWindowWidth()
  const [userPref, setUserPrefState] = useState(readPref)

  // Multi-Tab-Sync: ändert ein anderer Tab die Preference, übernehmen
  // wir das. Verhindert das übliche "ich hab's drüben umgestellt aber
  // hier ist immer noch alt"-Problem.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return
      setUserPrefState(readPref())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setUserPref = useCallback((next) => {
    setUserPrefState(next)
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }, [])

  // Effective: was rendert die Sidebar tatsächlich?
  //   userPref === 'expanded'  → immer full (240px)
  //   userPref === 'collapsed' → immer compact (60px) — auch bei breitem Fenster
  //   userPref === 'auto'      → 'full' wenn breit genug, sonst 'compact'
  //
  // Der frühere 'hidden'-Modus existiert nicht mehr — die Sidebar ist
  // bei jeder Fensterbreite mindestens als 60px-Rail sichtbar.
  let effective
  if (userPref === 'expanded') effective = 'full'
  else if (userPref === 'collapsed') effective = 'compact'
  else effective = autoMode === 'full' ? 'full' : 'compact'

  // Overlay-Modus: bei < 768 wird die expanded-Variante als Overlay
  // über den Content geblendet statt ihn zu verdrängen — sonst bliebe
  // weniger Content-Platz als die Sidebar selbst.
  const isNarrow = autoMode === 'hidden'
  const overlay = isNarrow && effective === 'full'

  // Sidebar-Width für die Content-Berechnung: bei Overlay-Modus zählt
  // die Rail-Breite (60), nicht die ausgefahrene Sidebar.
  const renderedWidth = overlay ? SIDEBAR_WIDTH.compact : SIDEBAR_WIDTH[effective]

  return {
    autoMode,
    userPref,
    setUserPref,
    effective,        // 'full' | 'compact'
    overlay,          // bool — true, wenn die full-Variante als Drawer rendert
    isNarrow,         // bool — autoMode war 'hidden'
    width,
    contentWidth: Math.max(0, width - renderedWidth),
    mtgMode,
    renderedWidth,
  }
}

// Convenience: toggle one step. Wird vom Chevron-Knopf in der Sidebar
// genutzt. 'auto' wird absichtlich weggelassen — der User toggled
// explizit zwischen den beiden Endzuständen.
export function nextSidebarPref(current, effective) {
  // Wenn aktuell expanded gerendert → user will collapsen.
  if (effective === 'full') return 'collapsed'
  return 'expanded'
}
