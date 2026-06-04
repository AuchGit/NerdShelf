// crossEditionMarker.js
//
// LocalStorage-Toggle: User entscheidet in den DnD-Settings ob er die
// "Cross-Edition"-Pillen am importierten Eintrag sehen will. Default:
// AN (User sieht die Hinweise und kann selber entscheiden ob der
// Eintrag im Hintergrund seines Charakters Sinn macht).
//
// Vier konstante Read-Pfade exportiert damit Renderer keinen
// localStorage-Aufruf pro Pill machen müssen; Setter feuert ein
// custom-event so dass Renderer ohne explizites Storage-Hook re-
// rendern können wenn der Toggle umgelegt wird.

const KEY = 'nerdshelf:hideCrossEditionMarker'
const EVENT = 'nerdshelf:crossedition-changed'

export function getHideCrossEditionMarker() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setHideCrossEditionMarker(hide) {
  try {
    if (hide) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* ignore */ }
}

// React-Hook der den Toggle-State live mitliest.
import { useState, useEffect } from 'react'
export function useHideCrossEditionMarker() {
  const [v, setV] = useState(() => getHideCrossEditionMarker())
  useEffect(() => {
    const onChange = () => setV(getHideCrossEditionMarker())
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])
  return v
}
