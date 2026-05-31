// pinnedActions.js
//
// "Pin to top"-System für die Action-Spalte. Markierte Einträge
// (per markerKey identifiziert — gleicher Key wie favoriteKey /
// colorMarker) erscheinen zusätzlich oben in einer "★ Pinned"-
// Kategorie. Originale Einträge bleiben dort wo sie strukturell
// hingehören; das Pin ist ein "auch hier anzeigen", keine
// Verschiebung.
//
// Storage: `character.status.pinnedActions: string[]` of markerKeys.

export function getPinnedActions(character) {
  const list = character?.status?.pinnedActions
  return Array.isArray(list) ? list : []
}

export function isPinnedAction(character, markerKey) {
  if (!markerKey) return false
  return getPinnedActions(character).includes(markerKey)
}

export function togglePinnedAction(applyCharacter, markerKey) {
  if (!applyCharacter || !markerKey) return
  applyCharacter(d => {
    if (!d.status) d.status = {}
    const cur = Array.isArray(d.status.pinnedActions) ? d.status.pinnedActions : []
    d.status.pinnedActions = cur.includes(markerKey)
      ? cur.filter(k => k !== markerKey)
      : [...cur, markerKey]
  }, { changedPaths: ['status.pinnedActions'] })
}
