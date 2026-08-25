// useExtraSpellNames.js
//
// React-Anbindung für die Homebrew-Spell-Listen: lädt alle Homebrew-Kinds,
// die eine Liste tragen können, und liefert die zusätzlichen Zaubernamen
// (lowercase) für einen Charakter — optional auf eine Klasse eingegrenzt.
//
// Konsumiert an den zwei Stellen, an denen ein Spieler Zauber wählt:
//   • SpellPrepareModal → vorbereitende Zauberwirker
//   • Level-Up / Charaktererstellung → lernende Zauberwirker
//
// Die Auswertung selbst liegt in characterSpellLists.js (rein + getestet).
import { useEffect, useMemo, useState } from 'react'
import { listHomebrew } from '../../homebrew/lib/homebrewStore'
import { extraSpellNamesFor } from './characterSpellLists'

// Kinds, an denen eine Spell-Liste hängen kann (plus die Listen selbst).
const CARRIER_KINDS = ['spelllists', 'races', 'backgrounds', 'features', 'items']

const EMPTY = new Set()

export function useExtraSpellNames(character, classId = null) {
  const [byKind, setByKind] = useState(null)
  useEffect(() => {
    let cancelled = false
    Promise.all(CARRIER_KINDS.map(k => listHomebrew(k).catch(() => [])))
      .then((lists) => {
        if (cancelled) return
        const next = {}
        CARRIER_KINDS.forEach((k, i) => { next[k] = lists[i] || [] })
        // Nichts angelegt → gar nicht erst rechnen.
        setByKind(next.spelllists.length ? next : null)
      })
    return () => { cancelled = true }
  }, [])
  return useMemo(
    () => (byKind && character ? extraSpellNamesFor(character, byKind, classId) : EMPTY),
    [byKind, character, classId],
  )
}
