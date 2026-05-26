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
  // dice rolls — not modelled here (couldn't be flat-applied anyway).
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
