// cardColors.js
//
// Generisches Color-Marker-System für alles Ausklappbare auf dem
// Sheet — Spells, Features, Traits, Backgrounds. Funktioniert
// parallel zu den item-tagColors die der Inventory-Tab schon hat.
//
// Speicherung: `character.colorMarkers[key] = '#rrggbb'`
// Key-Schema entspricht dem favoriteKey-Schema (composite strings
// wie 'feature:Rogue:Sneak Attack:1' / 'spell:Fireball' / 'trait:Darkvision').
//
// Read:  getColorMarker(character, key)            → string|null
// Write: setColorMarker(applyCharacter, key, color)→ persistiert

export const TAG_COLORS = [
  { label: 'Rot',    value: '#ef4444' },
  { label: 'Orange', value: '#f59e0b' },
  { label: 'Gelb',   value: '#eab308' },
  { label: 'Grün',   value: '#22c55e' },
  { label: 'Blau',   value: '#3b82f6' },
  { label: 'Lila',   value: '#a855f7' },
  { label: 'Pink',   value: '#ec4899' },
]

export function getColorMarker(character, key) {
  if (!key) return null
  return character?.colorMarkers?.[key] || null
}

export function setColorMarker(applyCharacter, key, color) {
  if (!applyCharacter || !key) return
  applyCharacter(d => {
    if (!d.colorMarkers) d.colorMarkers = {}
    if (color) d.colorMarkers[key] = color
    else delete d.colorMarkers[key]
  }, { changedPaths: ['colorMarkers'] })
}

// Stripe-Style fürs Card-Layout: linker, vertikaler Border in der
// gespeicherten Farbe. Verhält sich identisch zum InventoryTab-Stripe.
export function colorStripeStyle(color) {
  if (!color) return null
  return { borderLeft: `4px solid ${color}`, paddingLeft: 6 }
}
