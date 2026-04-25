// Die komplette Datenstruktur eines Characters.
// null-Werte = "noch nicht gewählt"
// Leere Arrays = "noch nichts eingetragen"

export function createEmptyCharacter() {
  return {
    // --- META ---
    meta: {
      edition: null,        // '5e' oder '5.5e'
      version: 1,
      completionStep: 0,
    },

    // --- GRUNDINFO ---
    info: {
      name: '',
      player: '',
      alignment: null,
      experience: 0,
      inspiration: false,
    },

    // --- SPEZIES/RASSE ---
    species: {
      raceId: null,
      subraceId: null,
      source: null,
      traitChoices: {},
      spellChoices: [],
      abilityScoreImprovements: {},
      // Ursprüngliche feste Rassen-ASI (gesetzt wenn Rasse gewählt, nie von freien Choices überschrieben)
      // Wird in Step3Race gesetzt und in Step6 für "zurück zu Standard" verwendet
      originalRacialASI: {},
      raceSpells: [],       // all spells granted by race (fixed + user-chosen from pool)
      subraceSpells: [],    // all spells granted by subrace
      extraLanguages: [],
      speed: null,           // wird aus Race-Daten gesetzt (für rulesEngine)
      size: null,
      darkvision: null,
      naturalArmor: null,
      asiMethod: 'fixed',    // 'fixed' | 'free21' | 'free111' | 'originFeat' — persists ASI mode selection
    },

    // --- BACKGROUND ---
    background: {
      backgroundId: null,
      source: null,
      skillProficiencies: [],
      toolProficiencies: [],
      languages: [],
      featureChoices: {},
      abilityScoreImprovements: {},
      asiWeightedMode: 0,    // 5.5e: index of chosen distribution (0=+2/+1, 1=+1/+1/+1)
      asiWeightedPicks: {},  // 5.5e: { slotIndex: abilityKey } for weighted ASI assignments
      feat: null,
    },

    // --- KLASSEN ---
    // Array für Multiclassing
    classes: [
      // {
      //   classId: 'Wizard',
      //   subclassId: null,
      //   source: 'PHB',
      //   level: 1,
      //   hitDie: 6,
      //   isSpellcaster: true,
      //   spellcastingAbility: 'int',
      //   casterProgression: 'full',
      //   subclassTitle: 'Arcane Tradition',
      //   subclassLevel: 2,
      //   startingProficiencies: {},
      //   levelChoices: {
      //     1: { skillProficiencies: [], cantrips: [], startingSpells: [] },
      //     4: { type: 'asi', improvements: { str: 0, dex: 2 } },
      //     // oder:
      //     4: { type: 'feat', featId: 'War Caster' },
      //   },
      //   hpRolls: { 1: 6, 2: 4, 3: 5 },
      //   preparedSpells: [],
      //   knownSpells: [],
      // }
    ],

    // --- HP PREFERENCE ---
    // Wie HP bei Level-Ups berechnet wird
    // Level 1 ist immer Maximum, unabhängig von dieser Einstellung
    hpPreference: {
      method: 'average',  // 'average' | 'roll'
      // 'average': fester Wert = floor(hitDie/2) + 1 + CON mod
      // 'roll': zufälliger Würfelwurf + CON mod beim Level-Up
    },

    // --- ABILITY SCORES ---
    abilityScores: {
      method: null,   // 'standard_array' | 'point_buy' | 'roll3d6' | 'roll4d6' | 'manual'
      base: {
        str: 8,
        dex: 8,
        con: 8,
        int: 8,
        wis: 8,
        cha: 8,
      },
      rolls: [],
    },

    // --- EXTRA PROFICIENCIES ---
    extraProficiencies: {
      skills: [],
      tools: [],
      weapons: [],
      armor: [],
      languages: [],
      savingThrows: [],
    },

    // --- CHOICES (unified choice storage) ---
    // Flat map: { [choiceId]: string | string[] }
    // choiceId format: "{source}:{sourceId}:{type}:{index}"
    // Examples:
    //   "feat:magic_initiate:optfeature:0"  → "Firebolt"
    //   "race:high_elf:language:0"          → "Elvish"
    //   "background:sage:tool:0"            → "thieves' tools"
    //   "race:dragonborn:color:0"           → "red"
    //   "class:rogue:level1:skill:0"        → ["athletics","deception"]
    choices: {},

    // --- FEATS ---
    feats: [],

    // --- CUSTOM ADDITIONS ---
    // Items/spells/feats added manually outside the leveling system.
    // All entries have _isCustom: true and integrate with sheet display + Foundry export.
    custom: {
      spells: [],
      // [{ name, level (0=cantrip), school, castingTime, range, duration,
      //    concentration, ritual, description, source, grantedBy (free text) }]
      feats: [],
      // [{ name, description, source, abilityBonus: {str:1}, 
      //    proficiencies: { skills:[], tools:[], weapons:[], armor:[] } }]
      items: [],
      // [{ name, type ('M'|'R'|'LA'|'MA'|'HA'|'S'|'G'), quantity, weight, value,
      //    ac, dmg1, dmgType, weaponCategory, properties:[], rarity, equipped, attuned,
      //    description, isWeapon, isArmor }]
      asi: {},
      // { str: 2, con: 1 } — manual adjustments from Manuals/Tomes/DM Boons
    },
    // [{
    //   featId: 'War Caster',
    //   source: 'PHB',
    //   chosenAt: { classId: 'Wizard', level: 4 },
    //   _isOriginFeat: false,
    //   abilityBonus: {},
    //   abilityChoices: [],
    //   choices: { spells: [], abilityChoiceByIndex: {}, abilityBonus: {} },
    //   additionalSpells: [],
    // }]

    // --- SPELL METADATA ---
    // Zentrale Metadaten aller ausgewählten Zauber (aus Klasse, Rasse, Feats)
    // Wird beim Auswählen von Zaubern befüllt, primär für den Foundry-Export benötigt
    // So hat Foundry alle nötigen Infos ohne die Spell-JSONs neu laden zu müssen
    //
    // Format: { 'Fireball': { level: 3, school: 'V', concentration: false, ritual: false,
    //                          source: 'PHB', grantedBy: 'Wizard', castingTime: '1 action',
    //                          range: '150 ft.', duration: 'Instantaneous' } }
    spellMetadata: {},

    // --- ZAUBER ---
    spells: {
      prepared: {},
      ritual: {},
      pactMagic: {
        level: null,
        slots: null,
      },
    },

    // --- INVENTAR ---
    inventory: {
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      // Starting equipment choice: 'A' | 'B' | 'C' | null
      // Starting equipment choice
      startingEquipmentChoice: null,    // legacy single choice
      startingEquipmentChoices: {},     // per-group: { groupIndex: 'A' }
      items: [],
      // Each item: {
      //   id:        string,    — unique instance id (crypto.randomUUID or counter)
      //   itemId:    string,    — reference to item-index ("Chain Mail")
      //   source:    string,    — item source book ("XPHB")
      //   name:      string,    — display name (may differ from itemId for magic variants)
      //   quantity:  number,
      //   equipped:  boolean,
      //   attuned:   boolean,
      //   grantedBy: string,    — "class" | "background" | "manual"
      //   // Cached item data for sheet display + export (avoids re-loading item-index):
      //   type:      string|null,  — 'M'|'R'|'LA'|'MA'|'HA'|'S'|'G' etc.
      //   weight:    number|null,
      //   value:     number|null,  — in cp
      //   ac:        number|null,
      //   dmg1:      string|null,
      //   dmgType:   string|null,
      //   weaponCategory: string|null,
      //   isWeapon:  boolean,
      //   isArmor:   boolean,
      //   rarity:    string,
      //   properties: string[],
      // }
      attunementSlots: 3,
    },

    // --- LEVEL HISTORY ---
    // Tracks each level-up for undo. Each entry stores a snapshot of the
    // character state BEFORE the level-up was applied.
    // [{ totalLevel, classId, classLevel, timestamp, snapshot }]
    levelHistory: [],

    // --- PERSÖNLICHKEIT ---
    personality: {
      traits: '',
      ideals: '',
      bonds: '',
      flaws: '',
      backstory: '',
      notes: '',
      organizations: '',
      allies: '',
      enemies: '',
      treasure: '',
    },

    // --- AUSSEHEN ---
    appearance: {
      age: '',
      height: '',
      weight: '',
      eyes: '',
      skin: '',
      hair: '',
      description: '',
      portrait: null,
    },

    // --- SESSION STATUS ---
    status: {
      currentHp: null,
      temporaryHp: 0,
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
      usedSpellSlots: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },
      usedPactSlots: 0,
      usedResources: {},
      usedHitDice: {},
      inspiration: false,
    },
  }
}

// ── Hilfsfunktionen ────────────────────────────────────────

export function getTotalLevel(character) {
  return character.classes.reduce((sum, cls) => sum + cls.level, 0)
}

export function getProficiencyBonus(character) {
  const totalLevel = getTotalLevel(character)
  return Math.ceil(totalLevel / 4) + 1
}

export function getModifier(score) {
  return Math.floor((score - 10) / 2)
}

// Berechnet Max-HP für Level 1 (immer Maximum)
export function getLevel1HP(character) {
  const cls = character.classes[0]
  if (!cls) return 0
  const hitDie = cls.hitDie || 8
  const abilityScores = getAllAbilityScores(character)
  const conMod = getModifier(abilityScores.con || 8)
  return hitDie + conMod
}

// Alle Ability Scores nach Boni
export function getAllAbilityScores(character) {
  const base = { ...character.abilityScores.base }
  const racial = character.species?.abilityScoreImprovements || {}
  const bg = character.background?.abilityScoreImprovements || {}
  const featBonus = {}
  for (const feat of (character.feats || [])) {
    for (const [k, v] of Object.entries(feat.abilityBonus || {})) {
      featBonus[k] = (featBonus[k] || 0) + v
    }
  }

  const result = {}
  for (const key of ['str','dex','con','int','wis','cha']) {
    result[key] = (base[key] || 8) + (racial[key] || 0) + (bg[key] || 0) + (featBonus[key] || 0)
  }
  return result
}