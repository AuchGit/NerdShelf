// Spellcasting-Regeln pro Klasse
// Arrays sind 0-indexed (Index 0 = Level 1)

export const SPELLCASTING_RULES = {
  Wizard: {
    type: 'prepared',
    hasSpellbook: true,
    cantripsKnown:  [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
    spellbookStart: 6,
    preparedFormula: (level, mod) => Math.max(1, mod + level),
    spellListKey: 'Wizard',
    spellcastingAbility: 'int',
  },
  Cleric: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
    preparedFormula: (level, mod) => Math.max(1, mod + level),
    spellListKey: 'Cleric',
    spellcastingAbility: 'wis',
  },
  Druid: {
    type: 'prepared',
    hasSpellbook: false,
    cantripsKnown:  [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
    preparedFormula: (level, mod) => Math.max(1, mod + level),
    spellListKey: 'Druid',
    spellcastingAbility: 'wis',
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

export function getSpellcastingInfo(classId, level, abilityMod = 0, subclassId = null) {
  // Try class first, then subclass name (for subclass-based casters like EK/AT)
  const rules = SPELLCASTING_RULES[classId] || (subclassId ? SPELLCASTING_RULES[subclassId] : null)
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
    }
  }
  return {
    type: 'prepared',
    hasSpellbook: rules.hasSpellbook ?? false,
    cantripsKnown,
    spellbookStart: rules.spellbookStart ?? null,
    maxPrepared: rules.preparedFormula(level, abilityMod),
    spellListKey: rules.spellListKey,
    spellcastingAbility: rules.spellcastingAbility,
    schoolRestriction: null,
    canSwapSpell: false,
  }
}

export function isSpellcaster(classId, subclassId = null) {
  return !!(SPELLCASTING_RULES[classId] || (subclassId ? SPELLCASTING_RULES[subclassId] : null))
}

/** Return the class name whose spell list should be used (e.g. EK → 'Wizard') */
export function getSpellListClass(classId, subclassId = null) {
  const rules = SPELLCASTING_RULES[classId] || (subclassId ? SPELLCASTING_RULES[subclassId] : null)
  return rules?.spellListKey || classId
}