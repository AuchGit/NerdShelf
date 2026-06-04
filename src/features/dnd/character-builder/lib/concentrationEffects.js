// src/features/dnd/character-builder/lib/concentrationEffects.js
//
// Catalog of concentration-spells whose effects mechanically alter
// stats on the sheet (AC, speed, movement modes). The rules engine
// reads this when a character has an active concentration AND the
// spell name (case-insensitively) matches one of the entries.
//
// Effects supported:
//   acBonus       — flat bonus added to final AC.
//   acFloor       — minimum AC (max with current value, e.g. Bark Skin).
//   acFormula     — overrides the base AC formula. Currently used for
//                   Mage Armor: { base: 13, ability: 'dex' } means
//                   "AC = 13 + DEX, no armor needed".
//   speedBonus    — flat ft. added to all movement modes.
//   speedMul      — multiplier applied to walk speed (Haste = 2).
//   addSpeedMode  — { fly: 'walk' } grants a fly speed equal to walk;
//                   number values would set a fixed mode.
//
// Spell names are matched against the user's stored concentration
// (character.status.concentration.spell), case-insensitive. The user
// types the name freely on cast, so this works with both official
// data and free-text input.
//
// Adding a new spell = new entry. No JS path changes required.

export const CONCENTRATION_EFFECTS = {
  'shield of faith': {
    label: '+2 AC',
    acBonus: 2,
  },
  'haste': {
    label: '+2 AC · Speed ×2',
    acBonus: 2,
    speedMul: 2,
  },
  'longstrider': {
    label: 'Speed +10 ft',
    speedBonus: 10,
  },
  'mage armor': {
    // RAW: "no armor + AC becomes 13 + DEX". computeAC currently uses
    // 10 + DEX unarmored. acFormula override handles this cleanly.
    label: 'AC 13 + DEX',
    acFormula: { base: 13, ability: 'dex' },
  },
  'barkskin': {
    label: 'AC mind. 16',
    acFloor: 16,
  },
  'fly': {
    label: 'Fly = Walk',
    addSpeedMode: { fly: 'walk' },
  },
  'spider climb': {
    label: 'Climb = Walk',
    addSpeedMode: { climb: 'walk' },
  },
  'water breathing': {
    // No mechanical stat changes — included for completeness so the GM
    // sees the marker. Empty effects → just label.
    label: 'Atmen unter Wasser',
  },
  // Add more as needed. Bless / Bane / Guidance etc. apply variable
  // dice rolls — die werden NICHT als acBonus/speedBonus modelliert
  // (würden eh nicht stacken), aber als advisory-Pill auf Attack-Rows
  // via VARIABLE_CONCENTRATION_DAMAGE (siehe unten).
}

// Variable-Dice-Buffs für Per-Attack-Pills. Kein flat-Stat-Bonus —
// das Datum ist eine reine Anzeige-Hilfe damit der Spieler vergisst
// nicht "+1d6 necrotic von Hex" beim Würfeln. Erkennung läuft wieder
// rein über den Concentration-Spell-Namen, kein Hardcode pro Klasse.
//
// Form: 'spell name (lowercase)' → {
//   label:       string             // angezeigter Source-Name
//   formula:     string             // die Dice-Notation ('+1d6 necrotic')
//   damageType:  string             // für Pillen-Farbgebung
//   targets:     'weapon-attack'    // wo greift's
//   note:        string?            // optionaler Hover-Hinweis
// }
export const VARIABLE_CONCENTRATION_DAMAGE = {
  'hex': {
    label: 'Hex', formula: '+1d6', damageType: 'necrotic',
    targets: 'weapon-attack',
    note: 'Auf jeden Treffer gegen das verhexte Ziel +1d6 necrotic.',
  },
  "hunter's mark": {
    label: "Hunter's Mark", formula: '+1d6', damageType: 'piercing',
    targets: 'weapon-attack',
    note: 'Auf jeden Treffer gegen das markierte Ziel +1d6 (1d8 ab L17).',
  },
  'divine favor': {
    label: 'Divine Favor', formula: '+1d4', damageType: 'radiant',
    targets: 'weapon-attack',
    note: 'Solange aktiv, +1d4 radiant auf jeden Waffen-Treffer.',
  },
  'bless': {
    label: 'Bless', formula: '+1d4', damageType: 'attack-roll',
    targets: 'weapon-attack',
    note: 'Während Bless: +1d4 auf Attack-Rolls und Saving Throws.',
  },
}

export function activeVariableDamageEffect(character) {
  const c = character?.status?.concentration
  if (!c) return null
  const name = String(c.spell || c.name || '').trim().toLowerCase()
  if (!name) return null
  const e = VARIABLE_CONCENTRATION_DAMAGE[name]
  if (!e) return null
  return { spell: c.spell || c.name, ...e }
}

/**
 * Look up the effects of a concentration spell by name. Returns null
 * if there's nothing to apply for that spell (variable-dice spells,
 * unknown names, etc.).
 */
export function getConcentrationEffects(spellName) {
  if (!spellName) return null
  const key = String(spellName).trim().toLowerCase()
  return CONCENTRATION_EFFECTS[key] || null
}

/**
 * Convenience: the active effects (if any) for a character.
 */
export function activeConcentrationEffects(character) {
  const c = character?.status?.concentration
  if (!c) return null
  const name = c.spell || c.name
  if (!name) return null
  const eff = getConcentrationEffects(name)
  if (!eff) return null
  return { spell: name, ...eff }
}
