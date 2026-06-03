// customNotes.js
//
// Pro ausklappbarem Eintrag (Feature, Spell, Item, Trait) kann der
// Spieler hinterlegen:
//   • pillText  — kurzer Hinweis (z.B. "Saving Throw vs Charm")
//   • pillColor — Farbe der Pille (settings-Default oder custom hex)
//   • body      — längerer Free-Form-Text für den "Notes"-Tab im
//                 expanded body
//
// Storage: `character.customNotes[key] = { pillText, pillColor, body }`.
// Same key-Schema wie favoriteKey / colorMarker — Eintrag teilt sich
// Identifier mit Favorite + Stripe-Color.

export function getCustomNote(character, key) {
  if (!key) return null
  return character?.customNotes?.[key] || null
}

export function setCustomNote(applyCharacter, key, patch) {
  if (!applyCharacter || !key) return
  applyCharacter(d => {
    if (!d.customNotes) d.customNotes = {}
    const cur = d.customNotes[key] || {}
    const next = { ...cur, ...patch }
    // Wenn das Ergebnis leer ist (alle Felder null/"" /undefined),
    // den Key komplett entfernen — kein Datenmüll.
    const isEmpty =
      !next.pillText && !next.pillColor && !next.body
    if (isEmpty) delete d.customNotes[key]
    else d.customNotes[key] = next
  }, { changedPaths: ['customNotes'] })
}

export function clearCustomNote(applyCharacter, key) {
  if (!applyCharacter || !key) return
  applyCharacter(d => {
    if (!d.customNotes) return
    delete d.customNotes[key]
  }, { changedPaths: ['customNotes'] })
}
