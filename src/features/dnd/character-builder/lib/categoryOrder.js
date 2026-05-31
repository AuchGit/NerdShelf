// categoryOrder.js
//
// Persistente Sortierung für die Kategorien innerhalb jeder Sheet-
// Spalte (Actions, Spells, Items, Favorites). Speichert in
// `character.status.categoryOrder[columnId] = [key, key, ...]`.
// Unbekannte Keys werden ignoriert; neue Kategorien hängen automatisch
// hinten an. Reset löscht den Eintrag → fällt auf die default-
// Reihenfolge des Renderers zurück.

export function getSavedOrder(character, columnId) {
  return character?.status?.categoryOrder?.[columnId] || null
}

// Sortiert `categories` (Array von Objekten) gemäß gespeicherter
// Reihenfolge. `getKey` extrahiert den Stringkey aus jedem Element.
// Liefert ein neues Array — keine Mutation.
export function applySavedOrder(categories, savedOrder, getKey) {
  if (!Array.isArray(savedOrder) || savedOrder.length === 0) return categories
  const byKey = new Map(categories.map(c => [getKey(c), c]))
  const out = []
  const used = new Set()
  for (const k of savedOrder) {
    if (byKey.has(k) && !used.has(k)) {
      out.push(byKey.get(k))
      used.add(k)
    }
  }
  for (const c of categories) {
    if (!used.has(getKey(c))) out.push(c)
  }
  return out
}

// Bewegt einen Key innerhalb der gespeicherten Reihenfolge. Wenn noch
// keine Reihenfolge gespeichert war, wird die aktuelle Reihenfolge als
// Basis genommen — sonst springt die UI weil "unbekannte Kategorien"
// plötzlich ans Ende rutschen.
export function moveCategory(applyCharacter, columnId, currentKeys, key, dir) {
  if (!applyCharacter) return
  const idx = currentKeys.indexOf(key)
  if (idx < 0) return
  const swap = dir === 'up' ? idx - 1 : idx + 1
  if (swap < 0 || swap >= currentKeys.length) return
  const next = [...currentKeys]
  ;[next[idx], next[swap]] = [next[swap], next[idx]]
  applyCharacter(d => {
    if (!d.status) d.status = {}
    if (!d.status.categoryOrder) d.status.categoryOrder = {}
    d.status.categoryOrder[columnId] = next
  }, { changedPaths: [`status.categoryOrder.${columnId}`] })
}

export function resetCategoryOrder(applyCharacter, columnId) {
  if (!applyCharacter) return
  applyCharacter(d => {
    if (!d.status?.categoryOrder) return
    delete d.status.categoryOrder[columnId]
    if (Object.keys(d.status.categoryOrder).length === 0) {
      delete d.status.categoryOrder
    }
  }, { changedPaths: [`status.categoryOrder.${columnId}`] })
}
