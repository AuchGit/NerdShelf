// Spellcasting-Regeln pro Klasse
// Arrays sind 0-indexed (Index 0 = Level 1)
//
// `ritualCasting` mirrors the matching class feature in the 5e SRD:
//   'spellbook' → cast any ritual spell in the spellbook, prepared or not (Wizard)
//   'known'     → cast any known ritual spell without preparation (Bard)
//   'prepared'  → must have the ritual prepared to ritual-cast it (Cleric, Druid, Artificer)
//   omitted     → no class-level ritual casting
// (Warlock can gain it via the Book of Ancient Secrets invocation — handled
// per-character, not here.)

export const SPELLCASTING_RULES = {
  Wizard: {
    type: 'prepared',
    hasSpellbook: true,
    cantripsKnown:  [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
    spellbookStart: 6,
    preparedFormula: (level, mod) => Math.max(1, mod + level),
    spellListKey: 'Wizard',
    spellcastingAbility: 'int',
    ritualCasting: 'spellbook',
  },
  Cleric: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
    preparedFormula: (level, mod) => Math.max(1, mod + level),
    spellListKey: 'Cleric',
    spellcastingAbility: 'wis',
    ritualCasting: 'prepared',
  },
  Druid: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    preparedFormula: (level, mod) => Math.max(1, mod + level),
    spellListKey: 'Druid',
    spellcastingAbility: 'wis',
    ritualCasting: 'prepared',
  },
  Paladin: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [],
    preparedFormula: (level, mod) => Math.max(1, mod + Math.floor(level / 2)),
    spellListKey: 'Paladin',
    spellcastingAbility: 'cha',
  },
  Bard: {
    type: 'known',
    cantripsKnown:  [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    spellsKnown:    [4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,16,16,16,16],
    spellListKey: 'Bard',
    spellcastingAbility: 'cha',
    ritualCasting: 'known',
  },
  Sorcerer: {
    type: 'known',
    cantripsKnown:  [4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
    spellsKnown:    [2,3,4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,15,15],
    spellListKey: 'Sorcerer',
    spellcastingAbility: 'cha',
  },
  Warlock: {
    type: 'known',
    cantripsKnown:  [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    spellsKnown:    [2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,14,15],
    spellListKey: 'Warlock',
    spellcastingAbility: 'cha',
  },
  Ranger: {
    type: 'known',
    cantripsKnown:  [],
    spellsKnown:    [0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,10,11],
    spellListKey: 'Ranger',
    spellcastingAbility: 'wis',
  },
  Artificer: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
    preparedFormula: (level, mod) => Math.max(1, mod + Math.floor(level / 2)),
    spellListKey: 'Artificer',
    spellcastingAbility: 'int',
    ritualCasting: 'prepared',
  },

  // ── Subclass-based casters (1/3 progression, gain spellcasting at class level 3) ──
  // Keyed by subclass name — looked up when classId has no entry.
  'Eldritch Knight': {
    type: 'known',
    cantripsKnown:  [0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
    spellsKnown:    [0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13],
    spellListKey: 'Wizard',
    spellcastingAbility: 'int',
    // School restrictions: EK can only pick Abjuration/Evocation EXCEPT at levels 3,8,14,20
    schoolRestriction: { schools: ['A','V'], freeChoiceLevels: [3,8,14,20] },
  },
  'Arcane Trickster': {
    type: 'known',
    cantripsKnown:  [0,0,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    spellsKnown:    [0,0,3,4,4,4,5,6,6,7,8,8,9,10,10,11,11,11,12,13],
    spellListKey: 'Wizard',
    spellcastingAbility: 'int',
    // School restrictions: AT can only pick Enchantment/Illusion EXCEPT at levels 3,8,14,20
    schoolRestriction: { schools: ['E','I'], freeChoiceLevels: [3,8,14,20] },
  },
}

// ── 5.5e overlay ───────────────────────────────────────────────────
// In the 2024 PHB (5.5e / XPHB), several "known"-caster classes were
// converted to "prepared" casters with a flat formula. The numbers
// here come straight from the 2024 PHB class tables.
//
// Anything NOT in this object inherits the 5e rules above unchanged
// (so Wizard, Cleric, Druid, Paladin, Artificer, EK, AT, etc. behave
// identically across editions).
export const SPELLCASTING_RULES_5_5E = {
  Bard: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    // 2024 Bard prepared spells table (by class level).
    preparedTable:   [4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,19,20,21,22,22],
    spellListKey: 'Bard',
    spellcastingAbility: 'cha',
    ritualCasting: 'prepared',
  },
  Sorcerer: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
    preparedTable:   [4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,19,20,21,22,22],
    spellListKey: 'Sorcerer',
    spellcastingAbility: 'cha',
  },
  Warlock: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    // 2024 Warlock prepared spells table.
    preparedTable:   [2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15],
    spellListKey: 'Warlock',
    spellcastingAbility: 'cha',
  },
  Ranger: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
    // 2024 Ranger prepared spells table — Ranger learned to cast spells
    // already at level 1 in the 2024 edition.
    preparedTable:   [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],
    spellListKey: 'Ranger',
    spellcastingAbility: 'wis',
  },
}

function pickRules(classId, edition, subclassId) {
  const is55e = edition === '5.5e'
  // 5.5e overlay first, then fall back to the shared base table.
  if (is55e && SPELLCASTING_RULES_5_5E[classId]) return SPELLCASTING_RULES_5_5E[classId]
  if (SPELLCASTING_RULES[classId]) return SPELLCASTING_RULES[classId]
  if (subclassId) {
    if (is55e && SPELLCASTING_RULES_5_5E[subclassId]) return SPELLCASTING_RULES_5_5E[subclassId]
    return SPELLCASTING_RULES[subclassId] || null
  }
  return null
}

export function getSpellcastingInfo(classId, level, abilityMod = 0, subclassId = null, edition = '5e') {
  const rules = pickRules(classId, edition, subclassId)
  if (!rules) return null
  const idx = Math.min(level - 1, 19)
  const cantripsKnown = rules.cantripsKnown[idx] ?? 0

  if (rules.type === 'known') {
    return {
      type: 'known',
      hasSpellbook: false,
      cantripsKnown,
      spellsKnown: rules.spellsKnown[idx] ?? 0,
      spellListKey: rules.spellListKey,
      spellcastingAbility: rules.spellcastingAbility,
      schoolRestriction: rules.schoolRestriction || null,
      canSwapSpell: true, // Known casters can swap 1 spell per level-up (RAW)
      ritualCasting: rules.ritualCasting || null,
    }
  }
  // 5.5e prepared casters use a flat per-level TABLE; legacy 5e prepared
  // casters use a formula (level + ability mod). Support both.
  const maxPrepared = rules.preparedTable
    ? (rules.preparedTable[idx] ?? 0)
    : (rules.preparedFormula ? rules.preparedFormula(level, abilityMod) : 0)

  return {
    type: 'prepared',
    hasSpellbook: rules.hasSpellbook ?? false,
    cantripsKnown,
    spellbookStart: rules.spellbookStart ?? null,
    maxPrepared,
    spellListKey: rules.spellListKey,
    spellcastingAbility: rules.spellcastingAbility,
    schoolRestriction: null,
    // 5.5e prepared casters can also swap one prepared spell on a long
    // rest (RAW). Keep canSwapSpell tied to the rules' explicit flag if
    // they set one — defaults to false (5e prepared behaviour).
    canSwapSpell: rules.canSwapSpell ?? false,
    ritualCasting: rules.ritualCasting || null,
  }
}

export function isSpellcaster(classId, subclassId = null, edition = '5e') {
  return !!pickRules(classId, edition, subclassId)
}

/** Return the class name whose spell list should be used (e.g. EK → 'Wizard') */
export function getSpellListClass(classId, subclassId = null, edition = '5e') {
  const rules = pickRules(classId, edition, subclassId)
  return rules?.spellListKey || classId
}