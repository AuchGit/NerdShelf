// activeEffects.js
//
// Zentrales Effect-Record-Schema + Helpers. Phase-6-Scaffolding aus
// dem Daten-Audit: ein einheitlicher `character.status.activeEffects[]`-
// Bucket, an dem alle Subsysteme (Spell-Casts mit Buff-Effekt auf eine
// Waffe, temporäre Item-Effekte, künftige Per-Rest-Buffs) hängen.
//
// Effect-Record-Shape:
//   {
//     id:       string,          // crypto.randomUUID()-Style; vom Caller
//                                 //   gesetzt oder von addActiveEffect
//                                 //   generiert (timestamp-fallback).
//     kind:     string,          // 'shillelagh' | 'magic-weapon' |
//                                 //   'magic-stone' | … — semantischer
//                                 //   Typ; rulesEngine schaltet darauf.
//     source:   string,          // 'spell:Shillelagh' | 'feat:…' | …
//                                 //   menschenlesbar fürs UI/Tooltip.
//     target?:  {                // optional: an WEN/WAS hängt der Effekt
//       kind:   'weapon'|'spell'|'creature'|'self',
//       id:     string,          //   item.id für weapons, …
//       label?: string,          //   Display-Hilfe
//     },
//     value?:   any,             // strukturierte Override-Daten
//                                 //   (z.B. { abilityOverride: 'wis',
//                                 //          damageDie: '1d8' }).
//     until?:   'concentration-end' | 'short_rest' | 'long_rest' |
//               'minute' | 'turn-end' | null,
//     startedAt?: ISO-string,    // optional Display
//   }
//
// Bewusst additiv: bestehende Mini-Engines (weaponMarkingRules,
// concentrationEffects) bleiben unverändert; rulesEngine kombiniert
// deren Output mit den Active-Effects über einen einzigen Aggregator.

export function getActiveEffects(character) {
  const arr = character?.status?.activeEffects
  return Array.isArray(arr) ? arr : []
}

export function getEffectsForWeapon(character, weaponId) {
  if (!weaponId) return []
  return getActiveEffects(character).filter(e =>
    e?.target?.kind === 'weapon' && e?.target?.id === weaponId,
  )
}

export function getEffectsForKind(character, kind) {
  if (!kind) return []
  return getActiveEffects(character).filter(e => e?.kind === kind)
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID() } catch { /* fall through */ }
  }
  return `eff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export function addActiveEffect(applyCharacter, effect) {
  if (!applyCharacter || !effect || !effect.kind) return null
  const eff = {
    id: effect.id || makeId(),
    startedAt: effect.startedAt || new Date().toISOString(),
    ...effect,
  }
  applyCharacter(d => {
    if (!d.status) d.status = {}
    if (!Array.isArray(d.status.activeEffects)) d.status.activeEffects = []
    d.status.activeEffects.push(eff)
  }, { changedPaths: ['status.activeEffects'] })
  return eff.id
}

export function removeActiveEffect(applyCharacter, id) {
  if (!applyCharacter || !id) return
  applyCharacter(d => {
    const list = Array.isArray(d.status?.activeEffects) ? d.status.activeEffects : []
    d.status.activeEffects = list.filter(e => e?.id !== id)
  }, { changedPaths: ['status.activeEffects'] })
}

export function updateActiveEffect(applyCharacter, id, patch) {
  if (!applyCharacter || !id || !patch) return
  applyCharacter(d => {
    const list = Array.isArray(d.status?.activeEffects) ? d.status.activeEffects : []
    d.status.activeEffects = list.map(e =>
      e?.id === id ? { ...e, ...patch } : e,
    )
  }, { changedPaths: ['status.activeEffects'] })
}

// Räumt alle Effects auf deren `until` zum gegebenen Trigger passt.
// Wird vom Sheet beim Long/Short-Rest-Commit aufgerufen. `until ===
// 'minute' | 'turn-end'` ist informational — der Engine löscht das
// nicht automatisch (der Spieler entscheidet manuell via × Button).
export function clearEffectsForRest(applyCharacter, restKind) {
  if (!applyCharacter || !restKind) return
  // long_rest → entfernt alle long_rest + short_rest + concentration
  // -end (long rest bricht meist auch Konzentration). short_rest →
  // entfernt nur short_rest + concentration-end (RAW: short rest
  // bricht Konzentration nicht; concentration-end ist hier eine
  // gesetzte Erinnerung wenn Concentration der einzige Termin ist).
  // Wir bleiben pragmatisch:
  //   long_rest  → long_rest, short_rest, concentration-end, minute
  //   short_rest → short_rest, concentration-end
  applyCharacter(d => {
    const list = Array.isArray(d.status?.activeEffects) ? d.status.activeEffects : []
    const keep = list.filter(e => {
      const u = e?.until
      if (restKind === 'long_rest') {
        return !['long_rest', 'short_rest', 'concentration-end', 'minute', 'turn-end'].includes(u)
      }
      // short_rest
      return !['short_rest', 'concentration-end', 'turn-end'].includes(u)
    })
    d.status.activeEffects = keep
  }, { changedPaths: ['status.activeEffects'] })
}

// Beim Wechsel/Aufheben der Concentration cleanen wir die zugehörigen
// effects raus.
export function clearConcentrationEffects(applyCharacter) {
  if (!applyCharacter) return
  applyCharacter(d => {
    const list = Array.isArray(d.status?.activeEffects) ? d.status.activeEffects : []
    d.status.activeEffects = list.filter(e => e?.until !== 'concentration-end')
  }, { changedPaths: ['status.activeEffects'] })
}
