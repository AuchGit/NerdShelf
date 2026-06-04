// CrossEditionPill.jsx
//
// Kleiner Marker-Pill für Einträge die der User aus der ANDEREN D&D-
// Edition importiert hat (5e-Item im 5.5e-Char oder umgekehrt). Die
// Erkennung läuft datadriven: jedes Import-Item wird in
// character.custom.{spells,items,feats} mit `_crossEdition: true`
// abgelegt — wir machen einen Name-Lookup gegen den richtigen Bucket.
//
// Settings-Toggle: User kann den Marker in den DnD-Settings
// ausblenden (`nerdshelf:hideCrossEditionMarker`); useHide…-Hook
// liefert das live, ohne Storage-Polling.

import { useHideCrossEditionMarker } from '../../lib/crossEditionMarker'

export function isCrossEditionImport(character, kind, name) {
  if (!character || !name) return false
  const bucket = kind === 'spell' ? character.custom?.spells
              : kind === 'item'  ? character.custom?.items
              : kind === 'feat'  ? character.custom?.feats
              : null
  if (!Array.isArray(bucket)) return false
  const lower = String(name).toLowerCase()
  return bucket.some(x =>
    String(x?.name || '').toLowerCase() === lower && x?._crossEdition === true,
  )
}

export default function CrossEditionPill({ character, kind, name }) {
  const hide = useHideCrossEditionMarker()
  if (hide) return null
  if (!isCrossEditionImport(character, kind, name)) return null
  return (
    <span title="Importiert aus der anderen D&D-Edition" style={{
      fontSize: 9, fontWeight: 800, padding: '1px 5px',
      borderRadius: 4, letterSpacing: 0.3, textTransform: 'uppercase',
      border: '1px solid var(--accent-orange, #ff9533)',
      color: 'var(--accent-orange, #ff9533)',
      background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 12%, transparent)',
      whiteSpace: 'nowrap',
    }}>X-Ed</span>
  )
}
