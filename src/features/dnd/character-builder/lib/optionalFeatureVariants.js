// optionalFeatureVariants.js
//
// 5etools markiert "Optional Class Feature Variants" (TCE-Erweiterungen
// die PHB-Features ersetzen oder ergänzen) mit `isClassFeatureVariant:
// true` direkt auf jedem classFeature-Eintrag. Beispiele:
//   • Bard L2 — Magical Inspiration (TCE)
//   • Druid L2 — Wild Companion (TCE)
//   • Rogue L3 — Steady Aim (TCE)
//   • Ranger L1 — Deft Explorer, Favored Foe (TCE)
//
// Diese sind opt-in: der Spieler entscheidet pro Charakter ob er die
// Variante benutzen will. Storage in `character.optionalClassFeatures`
// als { classId: { 'Feature Name': true } } — flach, data-driven, kein
// Hardcode.
//
// API:
//   listAvailableVariants(character, classDataMap)
//     → [{ classId, name, level, source, entries, enabled }]
//   isVariantEnabled(character, classId, featureName) → boolean
//   setVariantEnabled(character, classId, featureName, on) → patch fn
//     für updateCharacter('optionalClassFeatures', ...)
//   hasAnyVariantEnabled(character) → boolean  (für Charakter-Marker)

const PREFERRED_55E = ['XPHB', 'XDMG', 'XMM']

export function listAvailableVariants(character, classDataMap) {
  if (!character || !classDataMap) return []
  const edition = character?.meta?.edition || '5e'
  const is55e = edition === '5.5e'
  const out = []
  for (const cls of (character.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    for (const f of (cd.features || [])) {
      if (!f?.isClassFeatureVariant) continue
      if (!f?.name) continue
      if ((f.level || 1) > (cls.level || 1)) continue
      // Edition-Match: in 5e mode keine XPHB-Variants; in 5.5e mode
      // alle offiziellen Quellen zulassen (Bridge-Data).
      const src = String(f.source || '').toUpperCase()
      const isX = PREFERRED_55E.includes(src)
      if (!is55e && isX) continue
      out.push({
        classId: cls.classId,
        name: f.name,
        level: f.level || 1,
        source: f.source || null,
        entries: f.entries || [],
        enabled: isVariantEnabled(character, cls.classId, f.name),
      })
    }
  }
  // Sortiert nach class, dann level, dann name
  return out.sort((a, b) =>
    a.classId.localeCompare(b.classId)
    || a.level - b.level
    || a.name.localeCompare(b.name),
  )
}

export function isVariantEnabled(character, classId, featureName) {
  const map = character?.optionalClassFeatures || {}
  return !!map?.[classId]?.[featureName]
}

// Liefert das Patch-Object das `updateCharacter('optionalClassFeatures', …)`
// erwartet (komplette Map zurück). Pure function — keine Side-Effects.
export function setVariantEnabled(character, classId, featureName, on) {
  const cur = character?.optionalClassFeatures || {}
  const clsMap = { ...(cur[classId] || {}) }
  if (on) clsMap[featureName] = true
  else delete clsMap[featureName]
  const next = { ...cur }
  if (Object.keys(clsMap).length > 0) next[classId] = clsMap
  else delete next[classId]
  return next
}

export function hasAnyVariantEnabled(character) {
  const map = character?.optionalClassFeatures || {}
  for (const cls of Object.keys(map)) {
    if (map[cls] && Object.keys(map[cls]).length > 0) return true
  }
  return false
}

// Liefert die enabled-Variant-Features für eine konkrete Klasse — wird
// von collectActiveClassFeatures konsumiert um die Variants in
// __activeFeatures aufzunehmen.
export function getEnabledVariantsForClass(character, classId) {
  const map = character?.optionalClassFeatures?.[classId] || {}
  return Object.keys(map).filter(name => map[name])
}
