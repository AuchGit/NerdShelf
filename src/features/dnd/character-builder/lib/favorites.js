// src/features/dnd/character-builder/lib/favorites.js
//
// "Favorite anything" pinning for the Overview tab. Players mark
// the feats / items / spells / class features / racial traits they
// want to keep at a glance on the sheet's landing page, and the
// Favorites section on Overview pulls each pinned thing's name and
// rules text from the same source-of-truth catalogues the rest of the
// sheet uses — no duplicate data lives in the favorite itself.
//
// Storage: `character.status.favorites: string[]` of opaque keys like
//   "feat:Alert"
//   "item:<inventoryItemId>"
//   "spell:Hunter's Mark"
//   "feature:Ranger:Favored Enemy:1"
//   "trait:Necrotic Resistance"
// The kind prefix is preserved verbatim so renderers can dispatch.

export const FAV_KINDS = ['feat', 'item', 'spell', 'feature', 'trait']

export function favoriteKey(kind, id) {
  return `${kind}:${id}`
}

export function parseFavoriteKey(key) {
  if (typeof key !== 'string') return null
  const idx = key.indexOf(':')
  if (idx < 0) return null
  return { kind: key.slice(0, idx), id: key.slice(idx + 1) }
}

export function getFavorites(character) {
  const list = character?.status?.favorites
  return Array.isArray(list) ? list : []
}

export function isFavorite(character, key) {
  return getFavorites(character).includes(key)
}

/**
 * Toggle a favorite. `applyCharacter` is the same mutator passed
 * through to the sheet tabs — we mutate the draft in place so the
 * change goes through the realtime sync + autosave like any other
 * status update.
 */
export function toggleFavorite(applyCharacter, key) {
  if (!applyCharacter || !key) return
  applyCharacter(d => {
    if (!d.status) d.status = {}
    const arr = Array.isArray(d.status.favorites) ? d.status.favorites : []
    const has = arr.includes(key)
    d.status.favorites = has ? arr.filter(k => k !== key) : [...arr, key]
  }, { changedPaths: ['status.favorites'] })
}
