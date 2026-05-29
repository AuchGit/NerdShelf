import { getModifier, getProficiencyBonus, getTotalLevel } from './characterModel'
import { asArray } from './choiceParser'
import { combinedMarkEffects, gatherCharacterFeatures } from './weaponMarkingRules'
import { FEATURE_PROFICIENCY_GRANTS } from './featureGrants'
import { activeConcentrationEffects } from './concentrationEffects'
import { getMechanicalEffects } from './featureEffects'

// ============================================================
// HAUPT-FUNKTION
// Gibt ein komplettes "computed" Objekt zurück mit allem
// was sich aus den Rohdaten ergibt
// ============================================================

export function computeCharacter(character, classDataMap = {}) {
  const totalLevel = getTotalLevel(character)
  if (totalLevel === 0) return null

  const profBonus = getProficiencyBonus(character)
  const abilityScores = computeAbilityScores(character)
  const modifiers = computeModifiers(abilityScores)
  const proficiencies = computeProficiencies(character, classDataMap)
  const savingThrows = computeSavingThrows(character, modifiers, profBonus, proficiencies)
  const skills = computeSkills(character, modifiers, profBonus, proficiencies)
  const hp = computeHP(character, modifiers, classDataMap)
  const ac = computeAC(character, modifiers, abilityScores)
  const spellcasting = computeSpellcasting(character, modifiers, profBonus)
  const weaponMastery = computeWeaponMastery(character, classDataMap)
  const attacks = computeAttacks(character, modifiers, profBonus, proficiencies, weaponMastery)
  const resources = computeResources(character, modifiers, profBonus, totalLevel, classDataMap)

  return {
    totalLevel,
    proficiencyBonus: profBonus,
    abilityScores,
    modifiers,
    proficiencies,
    savingThrows,
    skills,
    hp,
    ac,
    spellcasting,
    attacks,
    resources,
    weaponMastery,
    // Abgeleitetes
    initiative: modifiers.dex + getInitiativeBonus(character),
    speed: computeSpeed(character, abilityScores, classDataMap),
    passivePerception: 10 + skills.perception.total,
    passiveInvestigation: 10 + skills.investigation.total,
    passiveInsight: 10 + skills.insight.total,
    carryingCapacity: abilityScores.str * 15,
    pushDragLift: abilityScores.str * 30,
  }
}

// ============================================================
// ABILITY SCORES
// Base + Rasse + Hintergrund (5.5e) + Feats + sonstige Boni
// ============================================================

export function computeAbilityScores(character) {
  const base = { ...character.abilityScores.base }
  const totals = { ...base }

  // Rassische Boni (5e)
  const racialBonuses = extractRacialASI(character)
  for (const [ability, bonus] of Object.entries(racialBonuses)) {
    totals[ability] = (totals[ability] || 0) + bonus
  }

  // Background ASI (5.5e)
  const bgBonuses = character.background?.abilityScoreImprovements || {}
  for (const [ability, bonus] of Object.entries(bgBonuses)) {
    totals[ability] = (totals[ability] || 0) + bonus
  }

  // ASI aus Klassen-Levels (Feats die +1 geben oder direkte ASI)
  for (const cls of character.classes) {
    for (const [level, choice] of Object.entries(cls.levelChoices || {})) {
      if (choice.type === 'asi') {
        for (const [ability, bonus] of Object.entries(choice.improvements || {})) {
          totals[ability] = (totals[ability] || 0) + bonus
        }
      }
    }
  }

  // Half-Feats (+1 ASI)
  for (const feat of character.feats) {
    if (feat.abilityBonus) {
      for (const [ability, bonus] of Object.entries(feat.abilityBonus)) {
        totals[ability] = (totals[ability] || 0) + bonus
      }
    }
  }

  // Custom feats (+1 ASI)
  for (const feat of (character.custom?.feats || [])) {
    if (feat.abilityBonus) {
      for (const [ability, bonus] of Object.entries(feat.abilityBonus)) {
        totals[ability] = (totals[ability] || 0) + bonus
      }
    }
  }

  // Custom ASI adjustments (Manuals, Tomes, DM Boons)
  for (const [ability, bonus] of Object.entries(character.custom?.asi || {})) {
    if (totals[ability] !== undefined) totals[ability] += bonus
  }

  // Ability score choices from character.choices (Variant Human, Half-Elf, Lineage feats, etc.)
  // Fixed racial ASI is already in character.species.abilityScoreImprovements.
  // Only choice-based ASI (keys containing ':ability:') is handled here.
  // Amount defaults to +1 because rulesEngine doesn't load JSON descriptors;
  // races that grant +2 to a chosen ability write two separate picks instead.
  //
  // SKIP background: keys — 5.5e background ASI is stored with correct amounts
  // in background.abilityScoreImprovements (already applied above).
  // Including them here would double-count AND apply wrong amounts (+1 instead of +2).
  for (const [key, val] of Object.entries(character.choices || {})) {
    if (!key.includes(':ability:')) continue
    if (key.startsWith('background:')) continue  // handled via background.abilityScoreImprovements
    for (const ability of asArray(val)) {
      if (totals[ability] !== undefined) totals[ability] += 1
    }
  }

  // Ability Scores sind auf 20 gedeckelt (außer durch magische Items etc.)
  // Items können den Cap überschreiten — das lassen wir für später offen
  for (const key of Object.keys(totals)) {
    totals[key] = Math.min(totals[key], 30) // Hard cap 30
  }

  return totals
}

function extractRacialASI(character) {
  // Wird später befüllt wenn wir Race-Daten laden
  // character.species.abilityScoreImprovements enthält bereits aufgelöste Werte
  return character.species?.abilityScoreImprovements || {}
}

export function computeModifiers(abilityScores) {
  const mods = {}
  for (const [key, value] of Object.entries(abilityScores)) {
    mods[key] = getModifier(value)
  }
  return mods
}

// ============================================================
// PROFICIENCIES
// Sammelt alle Proficiencies aus Klasse, Rasse, Background, Feats
// ============================================================

export function computeProficiencies(character, classDataMap = {}) {
  const result = {
    skills: {},
    savingThrows: {},
    weapons: [],
    armor: [],
    tools: {},
    languages: [],
  }

  // ── Aus Klassen ───────────────────────────────────────────
  for (const cls of character.classes) {
    // Saving Throws — only the FIRST class grants saving throw proficiencies
    // Multiclass classes do NOT grant saving throw proficiencies (PHB p.164)
    if (!cls.isMulticlass) {
      const savingThrowSources = cls.proficiency || cls.startingProficiencies?.savingThrows || []
      for (const save of savingThrowSources) {
        if (typeof save === 'string') {
          result.savingThrows[save.toLowerCase()] = true
        }
      }
    }

    // Proficiencies from class (weapons, armor, tools)
    // For multiclass classes, these should be from multiclassing table
    // but we read startingProficiencies as stored on the class entry
    const startingProfs = cls.startingProficiencies
      || classDataMap[cls.classId]?.startingProficiencies
      || {}

    // Waffen — unterstützt strings und Objekte
    // 5.5e classes often ship BOTH a structured `weaponProficiencies`
    // array (machine-readable) and a human-readable string in `weapons`
    // like "Martial weapons that have the {@filter Finesse or Light|…}
    // property". The string form is for the class description, not for
    // the proficiency engine — without filtering, the sheet renders
    // both "Martial weapons … property" (parsed tag) AND "martial"
    // (from weaponProficiencies). When the structured form exists for
    // this class, skip every string from `weapons` that isn't a plain
    // category token; the rules engine doesn't need them.
    const hasStructuredWeaponProfs = Array.isArray(startingProfs.weaponProficiencies)
      && startingProfs.weaponProficiencies.length > 0
    const BARE_CATEGORIES = new Set(['simple', 'martial', 'simple weapons', 'martial weapons'])
    for (const weapon of (startingProfs.weapons || [])) {
      const name = typeof weapon === 'string' ? weapon
        : (weapon?.proficiencyBonuses?.weapon || weapon?.value || null)
      if (!name) continue
      if (hasStructuredWeaponProfs) {
        // Only keep bare category tokens — drop descriptive prose / tags.
        if (!BARE_CATEGORIES.has(String(name).toLowerCase().trim())) continue
      }
      if (!result.weapons.includes(name)) result.weapons.push(name)
    }
    // Structured weapon proficiencies (5.5e format): { simple: true, all: { fromFilter: "..." } }
    for (const entry of (startingProfs.weaponProficiencies || [])) {
      if (!entry || typeof entry !== 'object') continue
      for (const [key, val] of Object.entries(entry)) {
        if (val === true && !result.weapons.includes(key)) {
          result.weapons.push(key)
        } else if (key === 'all' && val && typeof val === 'object') {
          // Filter expression → human-readable summary for display only.
          // The expression is "type=martial weapon|property=light;finesse";
          // squash to "martial (light/finesse)".
          const filt = String(val.fromFilter || '')
          const cat = (filt.match(/type=(\w+)/) || [])[1]
          const props = (filt.match(/property=([^|]+)/) || [])[1]
          if (cat) {
            const label = props ? `${cat} (${props.split(';').join('/')})` : cat
            if (!result.weapons.includes(label)) result.weapons.push(label)
          }
        }
      }
    }

    // Rüstungen
    for (const armor of (startingProfs.armor || [])) {
      const name = typeof armor === 'string' ? armor
        : (armor?.value || null)
      if (name && !result.armor.includes(name)) result.armor.push(name)
    }

    // Fixed tool proficiencies from class (e.g. Rogue: thieves' tools)
    // These are automatic grants, not choices — analogous to weapons/armor above.
    for (const tool of (startingProfs.tools || [])) {
      if (!tool) continue
      const name = typeof tool === 'string' ? tool
        : (tool?.value || tool?.name || Object.keys(tool).find(k => tool[k] === true) || null)
      if (name && name !== 'choose') {
        const key = normalizeTool(name)
        if (!result.tools[key]) result.tools[key] = 'proficient'
      }
    }

    // Selectable skills, tools, and expertise are read from
    // character.choices (unified choice system scan below).
    // levelChoices no longer stores these — character.choices is the
    // single source of truth for all selectable proficiencies.
  }

  // ── Aus Background ────────────────────────────────────────
  for (const skill of (character.background?.skillProficiencies || [])) {
    const key = normalizeSkill(skill)
    if (!result.skills[key]) result.skills[key] = 'proficient'
  }
  for (const tool of (character.background?.toolProficiencies || [])) {
    const key = normalizeTool(tool)
    if (!result.tools[key]) result.tools[key] = 'proficient'
  }
  for (const lang of (character.background?.languages || [])) {
    if (!result.languages.includes(lang)) result.languages.push(lang)
  }

  // ── Aus Rasse ─────────────────────────────────────────────
  for (const lang of (character.species?.extraLanguages || [])) {
    if (!result.languages.includes(lang)) result.languages.push(lang)
  }
  // Fixed race skill proficiencies (5e Elf Keen Senses = Perception,
  // Half-Orc Menacing = Intimidation, etc.). Hydrated onto
  // `species.__fixedSkills` by CharacterSheetPage.loadRaceTraits so the
  // rules engine doesn't need to re-fetch race data.
  for (const skill of (character.species?.__fixedSkills || [])) {
    const key = normalizeSkill(skill)
    if (!result.skills[key]) result.skills[key] = 'proficient'
  }
  // Choice-style race skill proficiencies (5.5e Elf "Insight, Perception,
  // or Survival" — Step3Race writes the pick to `traitChoices.skills`).
  for (const skill of (character.species?.traitChoices?.skills || [])) {
    const key = normalizeSkill(skill)
    if (!result.skills[key]) result.skills[key] = 'proficient'
  }
  // Sprachen aus languageProficiencies (werden aus Background-Daten befüllt)
  for (const lang of (character.background?.languageProficiencies || [])) {
    if (typeof lang === 'string' && !result.languages.includes(lang)) {
      result.languages.push(lang)
    }
  }

  // ── Aus Feats ─────────────────────────────────────────────
  for (const feat of (character.feats || [])) {
    // (Resilient and similar save-prof grants are handled below via
    //  the data-driven featureEffects catalog — no hardcoded names.)
    for (const skill of (feat.skillProficiencies || [])) {
      const key = normalizeSkill(skill)
      if (!result.skills[key]) result.skills[key] = 'proficient'
    }
    // User-chosen skill proficiencies (from FeatProfChoiceSection)
    for (const skill of (feat.choices?.proficiencies?.skills || [])) {
      const key = normalizeSkill(skill)
      if (!result.skills[key]) result.skills[key] = 'proficient'
    }
    for (const tool of (feat.toolProficiencies || [])) {
      const key = normalizeTool(tool)
      if (!result.tools[key]) result.tools[key] = 'proficient'
    }
    // User-chosen tool proficiencies
    for (const tool of (feat.choices?.proficiencies?.tools || [])) {
      const key = normalizeTool(tool)
      if (!result.tools[key]) result.tools[key] = 'proficient'
    }
    for (const armor of (feat.armorProficiencies || [])) {
      if (!result.armor.includes(armor)) result.armor.push(armor)
    }
    for (const weapon of (feat.weaponProficiencies || [])) {
      if (!result.weapons.includes(weapon)) result.weapons.push(weapon)
    }
   // User-chosen weapon proficiencies
    for (const weapon of (feat.choices?.proficiencies?.weapons || [])) {
      if (!result.weapons.includes(weapon)) result.weapons.push(weapon)
    }
  }

  // ── Custom feats proficiencies ──
  for (const feat of (character.custom?.feats || [])) {
    const p = feat.proficiencies || {}
    for (const s of (p.skills || [])) { if (s) result.skills[normalizeSkill(s)] = 'proficient' }
    for (const t of (p.tools || [])) { if (t) { const k = normalizeTool(t); result.tools[k] = 'proficient' } }
    for (const a of (p.armor || [])) { if (a && !result.armor.includes(a)) result.armor.push(a) }
    for (const w of (p.weapons || [])) { if (w && !result.weapons.includes(w)) result.weapons.push(w) }
  }

  // ── Extra Proficiencies (manual overrides only — NOT for racial/class skills) ──
  // Racial and class skill choices are now exclusively in character.choices.
  // extraProficiencies.skills is no longer used as a duplicate store.

  // ── From character.choices (SINGLE SOURCE OF TRUTH) ────────
  // All selectable proficiencies (skills, tools, languages, weapons, expertise)
  // are stored exclusively in character.choices. Type is determined from the
  // second-to-last segment of the colon-delimited key.
  for (const [key, val] of Object.entries(character.choices || {})) {
    const parts = key.split(':')
    const type  = parts[parts.length - 2]   // e.g. 'skill', 'tool', 'language', …
    const values = asArray(val)

    if (type === 'skill') {
      for (const s of values) {
        const norm = normalizeSkill(s)
        if (!result.skills[norm]) result.skills[norm] = 'proficient'
      }
    } else if (type === 'tool') {
      for (const t of values) {
        const norm = normalizeTool(t)
        if (!result.tools[norm]) result.tools[norm] = 'proficient'
      }
    } else if (type === 'language') {
      for (const l of values) {
        if (!result.languages.includes(l)) result.languages.push(l)
      }
    } else if (type === 'weapon') {
      for (const w of values) {
        if (!result.weapons.includes(w)) result.weapons.push(w)
      }
    } else if (type === 'expertise') {
      for (const s of values) {
        // Expertise always wins over proficient
        result.skills[normalizeSkill(s)] = 'expertise'
      }
    }
  }

  // ── Feature-implied grants (data-driven via featureGrants.js) ──
  // Subclass features whose proficiencies live in `entries` (free text)
  // — e.g. Hexblade's "Hex Warrior" granting medium armor / shields /
  // martial weapons — don't show up in `startingProficiencies`. The
  // FEATURE_PROFICIENCY_GRANTS catalog patches them in based on the
  // features gatherCharacterFeatures() detects.
  const featureSet = gatherCharacterFeatures(character)
  for (const rule of FEATURE_PROFICIENCY_GRANTS) {
    if (!featureSet.has(rule.feature.toLowerCase())) continue
    for (const w of (rule.weapons || [])) {
      if (!result.weapons.includes(w)) result.weapons.push(w)
    }
    for (const a of (rule.armor || [])) {
      if (!result.armor.includes(a)) result.armor.push(a)
    }
  }

  // ── Subclass-feature choices (player-picked skill / save) ──
  // For features like Fey Wanderer's Otherworldly Glamour, Gloom
  // Stalker's Iron Mind, Bard/Rogue Expertise, Cleric/Fighter/
  // Paladin Persuasion-or-X grants, etc. The chosen skill (or list
  // of skills) is stored as `cls.featureChoices[featureKey]` by the
  // picker on the sheet. Applied here so the standard prof badges
  // + skill totals reflect the player's pick.
  for (const cls of (character.classes || [])) {
    const choices = cls.featureChoices || {}
    for (const [, picked] of Object.entries(choices)) {
      if (!picked || typeof picked !== 'object') continue
      if (picked.type === 'skillProficiency' && picked.value) {
        const k = normalizeSkill(picked.value)
        if (!result.skills[k]) result.skills[k] = 'proficient'
      } else if (picked.type === 'savingThrowProficiency' && picked.value) {
        const k = String(picked.value).toLowerCase()
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(k)) {
          result.savingThrows[k] = true
        }
      } else if (picked.type === 'expertise' && Array.isArray(picked.value)) {
        // Expertise can only be granted on skills the character is
        // already proficient in — guard so a stale pick doesn't
        // accidentally upgrade an unrelated skill.
        for (const skill of picked.value) {
          const k = normalizeSkill(skill)
          if (result.skills[k] === 'proficient') result.skills[k] = 'expertise'
        }
      }
    }
  }

  // ── Save-proficiency grants from featureEffects catalog ────
  // Replaces the old hardcoded Resilient handling and adds support
  // for Diamond Soul (Monk 14, all saves), Slippery Mind (Rogue 15,
  // WIS+CHA), and anything else the catalog declares via
  // mechanic.{allSavesProficient,saveProficient,
  // saveProficiencyFromAbilityBonus}.
  const mech = getMechanicalEffects(character)
  if (mech.allSavesProficient) {
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      result.savingThrows[ab] = true
    }
  }
  for (const ab of mech.saveProficient) {
    result.savingThrows[ab] = true
  }

  return result
}

// ============================================================
// SAVING THROWS
// ============================================================

export function computeSavingThrows(character, modifiers, profBonus, proficiencies) {
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha']
  const result = {}

  // Data-driven save bonuses from the featureEffects catalog:
  //   • saveBonusFromAbility — e.g. Paladin Aura of Protection adds
  //     the Paladin's CHA modifier to all saves. We use the CURRENT
  //     character's modifier — multiclass Paladins gain the aura too.
  const mech = getMechanicalEffects(character)
  const auraBonus = mech.saveBonusAbility ? (modifiers[mech.saveBonusAbility] || 0) : 0

  for (const ability of abilities) {
    const isProficient = proficiencies.savingThrows[ability] || false
    const mod = modifiers[ability] || 0
    const bonus = isProficient ? profBonus : 0

    // Feats wie Resilient können Saving Throw Proficiency geben
    const featBonus = getFeatSaveBonus(character, ability)

    const total = mod + bonus + featBonus + auraBonus

    result[ability] = {
      modifier: mod,
      proficient: isProficient,
      total,
      breakdown: `${mod >= 0 ? '+' : ''}${mod}`
        + (isProficient ? ` + ${profBonus} (prof)` : '')
        + (featBonus ? ` + ${featBonus}` : '')
        + (auraBonus ? ` + ${auraBonus} (aura/${mech.saveBonusAbility?.toUpperCase()})` : ''),
    }
  }

  return result
}

function getFeatSaveBonus(character, ability) {
  // Resilient feat gibt Proficiency für eine Save
  for (const feat of character.feats) {
    if (feat.featId === 'Resilient' && feat.choices?.ability === ability) {
      return 0 // Proficiency wird über proficiencies.savingThrows gehandelt
    }
  }
  return 0
}

// ============================================================
// SKILLS
// ============================================================

// Alle Skills und ihre zugehörigen Abilities
export const SKILL_MAP = {
  acrobatics:      'dex',
  animalHandling:  'wis',
  arcana:          'int',
  athletics:       'str',
  deception:       'cha',
  history:         'int',
  insight:         'wis',
  intimidation:    'cha',
  investigation:   'int',
  medicine:        'wis',
  nature:          'int',
  perception:      'wis',
  performance:     'cha',
  persuasion:      'cha',
  religion:        'int',
  sleightOfHand:   'dex',
  stealth:         'dex',
  survival:        'wis',
}

export function computeSkills(character, modifiers, profBonus, proficiencies) {
  const result = {}
  // Per-ability check bonuses contributed by features (Otherworldly
  // Glamour: +WIS on CHA checks, min +1, etc.). Computed once and
  // applied to every skill whose underlying ability matches.
  const mech = getMechanicalEffects(character)
  const checkBonusFor = (ability) => {
    const spec = mech.abilityCheckBonus?.[ability]
    if (!spec) return 0
    const fromMod = modifiers[spec.fromAbility] || 0
    return Math.max(spec.min || 0, fromMod)
  }

  for (const [skill, ability] of Object.entries(SKILL_MAP)) {
    const profStatus = proficiencies.skills[skill] || null
    const mod = modifiers[ability] || 0

    let bonus = 0
    if (profStatus === 'proficient') bonus = profBonus
    if (profStatus === 'expertise') bonus = profBonus * 2

    // Jack of All Trades (Bard): halber Proficiency auf nicht-profizierte Skills
    if (!profStatus && hasJackOfAllTrades(character)) {
      bonus = Math.floor(profBonus / 2)
    }

    const checkBonus = checkBonusFor(ability)

    result[skill] = {
      ability,
      modifier: mod,
      proficiency: profStatus,
      profBonus: bonus,
      checkBonus, // surfaced for tooltips; already included in total
      total: mod + bonus + checkBonus,
      display: `${mod + bonus + checkBonus >= 0 ? '+' : ''}${mod + bonus + checkBonus}`,
    }
  }

  return result
}

function hasJackOfAllTrades(character) {
  return character.classes.some(cls =>
    cls.classId === 'Bard' && cls.level >= 2
  )
}

// ============================================================
// HP
// ============================================================

export function computeHP(character, modifiers, classDataMap) {
  const conMod = modifiers.con || 0
  let maxHp = 0
  const breakdown = []

  for (const cls of character.classes) {
    const hitDie = cls.hitDie || classDataMap[cls.classId]?.hitDie || 8

    for (let level = 1; level <= cls.level; level++) {
      const roll = cls.hpRolls?.[level]

      if (level === 1 && character.classes[0].classId === cls.classId) {
        // Erster Level der ersten Klasse = immer Maximum
        const hp = hitDie + conMod
        maxHp += hp
        breakdown.push({ class: cls.classId, level, roll: hitDie, conMod, total: hp, isMax: true })
      } else {
        // Gewürfelt oder Average
        const rollValue = roll ?? Math.floor(hitDie / 2) + 1 // Average falls nicht gewürfelt
        const hp = rollValue + conMod
        maxHp += hp
        breakdown.push({ class: cls.classId, level, roll: rollValue, conMod, total: hp, isMax: false })
      }
    }
  }

  // Data-driven HP-per-level feats (Tough = +2). Stacking is supported
  // so future features can pile on without code changes.
  const hpPerLevel = getMechanicalEffects(character).hpPerLevel
  const toughBonus = hpPerLevel ? getTotalLevel(character) * hpPerLevel : 0
  maxHp += toughBonus

  return {
    max: maxHp,
    current: character.status.currentHp ?? maxHp,
    temporary: character.status.temporaryHp || 0,
    breakdown,
    toughBonus,
  }
}

function hasTough(character) {
  return character.feats.some(f => f.featId === 'Tough')
}

// ============================================================
// RÜSTUNGSKLASSE (AC)
// ============================================================

export function computeAC(character, modifiers, abilityScores) {
  const options = []

  const dexMod = modifiers.dex || 0
  const conMod = modifiers.con || 0
  const wisMod = modifiers.wis || 0
  const chaMod = modifiers.cha || 0
  const strMod = modifiers.str || 0

  // Unarmored Defense verschiedener Klassen
  const hasBarbarianUD = character.classes.some(c => c.classId === 'Barbarian')
  const hasMonkUD = character.classes.some(c => c.classId === 'Monk' && c.level >= 1)

  // Standard: keine Rüstung
  options.push({ label: 'Unarmored', value: 10 + dexMod, note: '10 + DEX' })

  // Barbarian Unarmored Defense
  if (hasBarbarianUD) {
    options.push({
      label: 'Unarmored Defense (Barbarian)',
      value: 10 + dexMod + conMod,
      note: '10 + DEX + CON',
    })
  }

  // Monk Unarmored Defense
  if (hasMonkUD) {
    options.push({
      label: 'Unarmored Defense (Monk)',
      value: 10 + dexMod + wisMod,
      note: '10 + DEX + WIS',
    })
  }

  // Draconic Resilience (Sorcerer Subclass)
  const hasDraconicResilience = character.classes.some(c =>
    c.classId === 'Sorcerer' && c.subclassId === 'Draconic Bloodline' && c.level >= 1
  )
  if (hasDraconicResilience) {
    options.push({
      label: 'Draconic Resilience',
      value: 13 + dexMod,
      note: '13 + DEX',
    })
  }

  // Natural Armor (manche Rassen)
  const naturalArmor = character.species?.naturalArmor
  if (naturalArmor) {
    options.push({
      label: 'Natural Armor',
      value: naturalArmor + dexMod,
      note: `${naturalArmor} + DEX`,
    })
  }

  // ── Equipped armor from inventory ──────────────────────────────────────────
  // Armor type determines DEX bonus:
  //   LA (Light Armor):  AC + full DEX mod
  //   MA (Medium Armor): AC + DEX mod (max +2)
  //   HA (Heavy Armor):  AC only (no DEX)
  //   S  (Shield):       +2 to AC (handled below)
  const allItems = [...(character.inventory?.items || []), ...(character.custom?.items || [])]
  const equippedArmor = allItems.filter(i => i.equipped && i.isArmor && i.type !== 'S')
  for (const armor of equippedArmor) {
    const baseAC = armor.ac || 10
    const armorType = (armor.type || '').split('|')[0]  // strip source suffix
    let ac = baseAC
    let note = `${baseAC}`

    if (armorType === 'LA') {
      // Light armor: add full DEX
      ac += dexMod
      note += ` + DEX(${dexMod})`
    } else if (armorType === 'MA') {
      // Medium armor: add DEX capped at +2
      const cappedDex = Math.min(dexMod, 2)
      ac += cappedDex
      note += ` + DEX(${cappedDex}, max 2)`
    }
    // HA: no DEX bonus

    options.push({ label: armor.name, value: ac, note })
  }

  // Shield: +2 if equipped
  const hasShield = allItems.some(i => i.equipped && (i.isShield || i.type === 'S'))
  const shieldBonus = hasShield ? 2 : 0

  // ── Concentration-spell AC effects ──────────────────────────
  // Pulled from the data-driven catalog so adding a new buff/debuff is
  // a one-line JSON entry.
  const concEff = activeConcentrationEffects(character)
  // acFormula override (e.g. Mage Armor → 13 + DEX) becomes another
  // option that competes with armor / unarmored defenses.
  if (concEff?.acFormula) {
    const abil = (modifiers[concEff.acFormula.ability] || 0)
    options.push({
      label: `${concEff.spell} (Konz.)`,
      value: (concEff.acFormula.base || 10) + abil,
      note: `${concEff.acFormula.base} + ${concEff.acFormula.ability.toUpperCase()}`,
      _concentration: true,
    })
  }

  // Bestes AC berechnen + Shield
  const best = options.reduce((a, b) => a.value > b.value ? a : b, options[0])
  let total = best.value + shieldBonus

  // acBonus (additive, e.g. Shield of Faith / Haste) stacks on the
  // chosen base AC.
  if (concEff?.acBonus) total += concEff.acBonus
  // acFloor (e.g. Barkskin) raises the result to a minimum.
  if (concEff?.acFloor) total = Math.max(total, concEff.acFloor)

  return {
    total,
    base: best.value,
    shield: shieldBonus,
    source: best.label,
    note: best.note,
    allOptions: options,
    concentrationEffect: concEff
      ? { spell: concEff.spell, label: concEff.label, acBonus: concEff.acBonus, acFloor: concEff.acFloor }
      : null,
  }
}

// ============================================================
// SPELLCASTING
// ============================================================

export function computeSpellcasting(character, modifiers, profBonus) {
  const result = {}

  for (const cls of character.classes) {
    if (!cls.spellcastingAbility) continue

    const ability = cls.spellcastingAbility.toLowerCase()
    const mod = modifiers[ability] || 0
    const spellAttack = mod + profBonus
    const saveDC = 8 + mod + profBonus

    result[cls.classId] = {
      ability,
      modifier: mod,
      spellAttackBonus: spellAttack,
      spellSaveDC: saveDC,
      spellAttackDisplay: `${spellAttack >= 0 ? '+' : ''}${spellAttack}`,
    }
  }

  return result
}

// ============================================================
// ANGRIFFE
// ============================================================

export function computeAttacks(character, modifiers, profBonus, proficiencies, weaponMastery = null) {
  const attacks = []

  // Unarmed Strike (immer verfügbar)
  const strMod = modifiers.str || 0
  attacks.push({
    id: 'unarmed',
    name: 'Unarmed Strike',
    attackBonus: strMod + profBonus,
    attackDisplay: `${strMod + profBonus >= 0 ? '+' : ''}${strMod + profBonus}`,
    damage: `1 + ${strMod}`,
    damageType: 'bludgeoning',
    range: '5 ft.',
    properties: [],
  })

  // Monk Martial Arts
  const monkClass = character.classes.find(c => c.classId === 'Monk')
  if (monkClass) {
    const martialArtsDie = getMonkMartialArtsDie(monkClass.level)
    const abilityMod = Math.max(strMod, modifiers.dex || 0)
    attacks.push({
      id: 'martial_arts',
      name: 'Martial Arts',
      attackBonus: abilityMod + profBonus,
      attackDisplay: `${abilityMod + profBonus >= 0 ? '+' : ''}${abilityMod + profBonus}`,
      damage: `${martialArtsDie} + ${abilityMod}`,
      damageType: 'bludgeoning',
      range: '5 ft.',
      properties: ['Finesse'],
    })
  }

  // Soulknife Rogue: Psychic Blades. The blade is a feature, not an
  // item — manifested on demand, doesn't take an inventory slot, the
  // player can't drop or be disarmed of it. Two attack rows:
  //
  //   • Main attack — scaling die (d6 → d8 → d10 → d12) on the Rogue
  //     Sneak Attack breakpoints (L3 / L5 / L11 / L17), DEX-based,
  //     finesse, melee + 60 ft. thrown.
  //   • Bonus-action blade — fixed 1d4, no ability mod to damage; the
  //     5e "TWF without the ability mod" pattern. Surfaced as its own
  //     row so the player can see it next to the main one.
  const soulknifeRogue = character.classes.find(c =>
    c.classId === 'Rogue' && String(c.subclassId || '').toLowerCase().includes('soulknife')
  )
  if (soulknifeRogue) {
    const dex = modifiers.dex || 0
    const lvl = soulknifeRogue.level
    const bladeDie = lvl >= 17 ? '1d12' : lvl >= 11 ? '1d10' : lvl >= 5 ? '1d8' : '1d6'
    // Thrown range follows the standard 5.5e thrown-weapon profile;
    // the "disadvantage past 60 ft." rule is universal so we don't
    // clutter the cell with it.
    const psychicBladeRange = '60/120 ft.'
    attacks.push({
      id: 'psychic_blades',
      name: 'Psychic Blades (Action)',
      attackBonus: dex + profBonus,
      attackDisplay: `${dex + profBonus >= 0 ? '+' : ''}${dex + profBonus}`,
      damage: `${bladeDie} + ${dex}`,
      damageType: 'psychic',
      range: psychicBladeRange,
      properties: ['Finesse'],
      isProficient: true,
      abilityUsed: 'dex',
      // Psychic Blades have the Vex mastery built in and the Soulknife
      // knows it automatically — no slot from cls.weaponMasteries used.
      mastery: ['Vex'],
    })
    // Bonus-action blade: 1d4 + DEX. Unlike regular TWF, the Soulknife
    // feature explicitly adds your ability modifier to this damage —
    // no Fighting Style: Two-Weapon Fighting required.
    attacks.push({
      id: 'psychic_blades_bonus',
      name: 'Psychic Blades (Bonus)',
      attackBonus: dex + profBonus,
      attackDisplay: `${dex + profBonus >= 0 ? '+' : ''}${dex + profBonus}`,
      damage: `1d4 + ${dex}`,
      damageType: 'psychic',
      range: psychicBladeRange,
      properties: ['Finesse', 'Bonus Action'],
      isProficient: true,
      abilityUsed: 'dex',
      mastery: [],
    })
  }

  // Bewaffnete Angriffe aus Inventar (wird später mit echten Item-Daten gefüllt)
  const allCombatItems = [...(character.inventory?.items || []), ...(character.custom?.items || [])]
  const weapons = allCombatItems.filter(i => i.equipped && i.isWeapon)
  for (const weapon of weapons) {
    // Legacy characters created before the wizard normalised weapon
    // properties may still carry raw 5etools codes like "F|XPHB". Map
    // common codes to their English label here so Finesse / Thrown /
    // Ammunition detection works without forcing the user to re-add
    // the weapon.
    const propsRaw = weapon.properties || []
    const props = propsRaw.map(p => {
      if (typeof p !== 'string') return ''
      const code = p.split('|')[0].toUpperCase()
      const MAP = { F: 'Finesse', V: 'Versatile', L: 'Light', H: 'Heavy', '2H': 'Two-Handed', T: 'Thrown', A: 'Ammunition', R: 'Reach', LD: 'Loading', S: 'Special' }
      return MAP[code] || p.split('|')[0]
    })
    const isFinesse = props.includes('Finesse')
    const isRanged = props.includes('Ammunition') || props.includes('Thrown')

    // Weapon-marking rules (Hex Warrior, Pact Weapon, Improved Pact
    // Weapon, …). Effects are data-driven via WEAPON_MARKING_RULES —
    // the engine never names a class or feature directly.
    const marks = combinedMarkEffects(character, weapon.id)

    let abilityMod
    let abilityUsed
    if (marks.abilityOverride) {
      abilityUsed = marks.abilityOverride
      abilityMod = modifiers[marks.abilityOverride] || 0
    } else if (isFinesse) {
      const useDex = (modifiers.dex || 0) >= strMod
      abilityUsed = useDex ? 'dex' : 'str'
      abilityMod = useDex ? (modifiers.dex || 0) : strMod
    } else if (isRanged) {
      abilityUsed = 'dex'
      abilityMod = modifiers.dex || 0
    } else {
      abilityUsed = 'str'
      abilityMod = strMod
    }

    const isProficient = checkWeaponProficiency(character, weapon, proficiencies)
    const baseAtk = abilityMod + (isProficient ? profBonus : 0) + (weapon.attackBonus || 0)
    const attackBonus = baseAtk + (marks.attackBonus || 0)
    const damageExtra = (weapon.attackBonus || 0) + (marks.damageBonus || 0)

    attacks.push({
      id: weapon.id,
      name: weapon.customName || weapon.name,
      attackBonus,
      attackDisplay: `${attackBonus >= 0 ? '+' : ''}${attackBonus}`,
      damage: `${weapon.dmg1} + ${abilityMod}${damageExtra ? ` + ${damageExtra}` : ''}`,
      damageType: weapon.dmgType || 'unknown',
      range: weapon.range || '5 ft.',
      properties: props,
      // 5.5e Weapon Mastery — empty on 5e weapons. Surfaced as a small
      // pill on the attack row of the player sheet. Hidden unless the
      // weapon's name is in the character's picked-mastery list so we
      // don't claim mastery on weapons the player didn't choose.
      mastery: (() => {
        const raw = weapon.mastery || []
        if (!raw.length) return []
        if (!weaponMastery) return raw
        const key = String(weapon.name || '').toLowerCase().trim()
        return weaponMastery.allPicked.has(key) ? raw : []
      })(),
      isProficient,
      abilityUsed,
      // First active mark — surfaced as a pill on the attack row. If
      // multiple are active (e.g. Hex Warrior + Pact Weapon), only the
      // first label shows but the tooltip aggregates them.
      markedAs: marks.labels.length > 0
        ? { label: marks.labels[0].label, note: marks.labels.map(l => l.note).join('\n') }
        : null,
    })
  }

  return attacks
}

function checkWeaponProficiency(character, weapon, proficiencies) {
  // Pull weapon proficiencies from EVERY source the character has —
  // classes (via computeProficiencies), feats, races, AND any legacy
  // extraProficiencies.weapons that older characters might still carry.
  //
  // Each proficiency entry can be:
  //   • a category — "simple" / "martial" / "simple weapons" / …
  //   • a category-shorthand — "simpleWeapons" / "martialWeapons" (5etools shape)
  //   • a specific weapon name — "Longsword" / "Shortsword|PHB" / …
  // Matching is case-insensitive and strips the |SOURCE suffix and
  // trailing " weapons" so "Longsword|XPHB" matches a weapon called
  // "Longsword" and "martialWeapons" matches weaponCategory "martial".
  const aggregated = [
    ...(proficiencies?.weapons || []),
    ...(character.extraProficiencies?.weapons || []),
  ]
  // Some feats / class-features add weapon prof via `weaponProficiencies`
  // on the character row directly — pick those up too.
  for (const feat of (character.feats || [])) {
    for (const w of (feat.weaponProficiencies || feat.choices?.weaponProficiencies || [])) {
      aggregated.push(w)
    }
  }

  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/\|.*$/, '')        // drop |SOURCE suffix
    .replace(/\s*weapons?$/, '')  // drop trailing " weapons"
    .replace(/weapons?$/, '')     // also handle the shorthand "simpleWeapons"
    .trim()

  const weaponName = norm(weapon.name)
  const weaponCustom = norm(weapon.customName)
  const weaponCat = norm(weapon.weaponCategory)
  // 5.5e classes (e.g. Rogue) grant proficiency with a filtered slice of
  // martial weapons — "martial weapons that have Finesse or Light". The
  // computeProficiencies pass surfaces these as a synthetic entry like
  // "martial (light/finesse)". Decode that into { cat, props[] } so the
  // check passes only when both the category AND at least one listed
  // property are present on the weapon.
  const weaponProps = (weapon.properties || []).map(p => {
    if (typeof p !== 'string') return ''
    return p.split('|')[0].toUpperCase()
  })
  const PROP_LABEL = { F: 'finesse', L: 'light', H: 'heavy', '2H': 'two-handed', T: 'thrown', A: 'ammunition', R: 'reach', LD: 'loading', S: 'special', V: 'versatile' }
  const weaponPropNames = weaponProps.map(c => (PROP_LABEL[c] || c).toLowerCase())

  for (const p of aggregated) {
    const n = norm(p)
    if (!n) continue
    if (n === weaponCat) return true                // category match (simple/martial)
    if (n === weaponName || n === weaponCustom) return true  // specific weapon
    // Filter-style "martial (light/finesse)" — match when the weapon's
    // category matches AND it carries at least one of the listed props.
    const filterMatch = n.match(/^(simple|martial)\s*\(([^)]+)\)$/)
    if (filterMatch && filterMatch[1] === weaponCat) {
      const wantProps = filterMatch[2].split('/').map(s => s.trim().toLowerCase())
      if (wantProps.some(wp => weaponPropNames.includes(wp))) return true
    }
  }
  return false
}

/**
 * Compute the per-class Weapon Mastery state for a 5.5e character.
 *
 * 5.5e Fighter (and other classes — once their tables ship the column)
 * gets a level-scaling "Weapon Mastery" column on classTableGroups.
 * The character picks N weapon NAMES whose mastery technique they can
 * use; the technique itself is determined by the weapon's `mastery`
 * field (Topple, Vex, Push, Graze, Nick, Sap, Slow, Cleave).
 *
 * Returns `{ knownCount, perClass: [{ classId, count, picked[] }] }`.
 * The picked list lives on `cls.weaponMasteries`. When no picks are
 * stored yet the array is empty so the UI can prompt the player to
 * choose. The attack table reads this to gate the per-row mastery
 * badge on whether the weapon's name is in any picked list.
 */
function computeWeaponMastery(character, classDataMap = {}) {
  const perClass = []
  for (const cls of (character.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    // Source 1: scaling table column "Weapon Mastery" (Fighter, Barbarian).
    let count = getClassTableValue(cd, cls.level, 'Weapon Mastery')
    // Source 2: static "Weapon Mastery" class feature whose entry text
    // says "two/three/… kinds of weapons" (Ranger, Paladin, Rogue —
    // they don't scale, just a flat number from the feature). We parse
    // the count from the prose so a homebrew that grants "four" still
    // works without code changes.
    if (!count) {
      const feat = (cd.features || []).find(f =>
        String(f?.name || '').toLowerCase() === 'weapon mastery'
        && (f?.level == null || f.level <= cls.level)
      )
      if (feat) count = parseWeaponMasteryCount(feat) || 2
    }
    if (!count) continue
    perClass.push({
      classId: cls.classId,
      classIndex: character.classes.indexOf(cls),
      count,
      picked: Array.isArray(cls.weaponMasteries) ? cls.weaponMasteries.slice(0, count) : [],
    })
  }
  const allPicked = new Set()
  for (const c of perClass) for (const w of c.picked) allPicked.add(String(w).toLowerCase().trim())
  return {
    knownCount: perClass.reduce((s, c) => s + c.count, 0),
    perClass,
    allPicked,
  }
}

// Pull the count of "kinds of weapons" out of a Weapon Mastery feature
// entry. Matches "two kinds of …weapons", "three kinds of …weapons",
// "X different weapons", "X weapons of your choice" — all the phrasings
// 5etools uses across classes. Returns null when no number is found.
function parseWeaponMasteryCount(feature) {
  const flat = (arr) => arr.flatMap(e =>
    typeof e === 'string' ? [e] :
    Array.isArray(e?.entries) ? flat(e.entries) :
    Array.isArray(e?.items)   ? flat(e.items)   : []
  )
  const text = flat(feature.entries || []).join(' ').toLowerCase()
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
  // Match "two kinds of", "three different weapons", "two weapons of your choice", etc.
  const m = text.match(/\b(one|two|three|four|five|six|\d+)\b\s+(?:kinds?\s+of|different|weapons?\s+of\s+your\s+choice)/i)
  if (m) {
    const v = NUM[m[1].toLowerCase()] ?? parseInt(m[1], 10)
    return Number.isFinite(v) ? v : null
  }
  return null
}

function getMonkMartialArtsDie(level) {
  if (level >= 17) return 'd10'
  if (level >= 11) return 'd8'
  if (level >= 5) return 'd6'
  return 'd4'
}

// ============================================================
// KLASSEN-RESSOURCEN
// ============================================================

/**
 * Look up a numeric value in a class's `classTableGroups` by column
 * label. 5.5e classes embed level-scaling resource counts directly in
 * the data (e.g. Fighter "Second Wind" goes 2 → 3 → 4 at certain
 * levels). Reading the table here keeps the rules engine data-driven
 * instead of duplicating those breakpoints in code.
 *
 * Returns `null` if there's no matching column or no usable cell at
 * `level` — caller decides the fallback (5e classes typically have no
 * such table, so the fallback is the legacy hardcoded value).
 *
 * Matching is case-insensitive and tolerates `{@filter X|…}` markup so
 * spell-slot column lookups also work uniformly.
 */
function getClassTableValue(classData, level, columnLabel) {
  const cell = getClassTableCell(classData, level, columnLabel)
  if (cell == null) return null
  // Plain number / numeric string → integer.
  if (typeof cell === 'number') return cell
  if (typeof cell === 'string') {
    const n = parseInt(cell, 10)
    return Number.isNaN(n) ? null : n
  }
  // Object cells: { type: "bonus" | "bonusSpeed", value: N } → value.
  if (cell && typeof cell === 'object' && typeof cell.value === 'number') return cell.value
  return null
}

/**
 * Like getClassTableValue but returns a formatted die string ("1d6")
 * for cells of the 5etools dice shape:
 *   { type: "dice", toRoll: [{ number, faces }, ...] }
 * Used for Monk Martial Arts die, Rogue Sneak Attack dice, Bardic
 * Inspiration die — everywhere the table cell IS a die rather than a
 * count.
 */
function getClassTableDie(classData, level, columnLabel) {
  const cell = getClassTableCell(classData, level, columnLabel)
  if (!cell || typeof cell !== 'object') return null
  if (cell.type === 'dice' && Array.isArray(cell.toRoll) && cell.toRoll[0]) {
    const r = cell.toRoll[0]
    return `${r.number || 1}d${r.faces}`
  }
  return null
}

/** Internal: locate the raw cell. Tolerates `{@filter X|…}` markup on
 *  column labels and matches case-insensitively. */
function getClassTableCell(classData, level, columnLabel) {
  if (!classData?.classTableGroups || !level) return null
  const stripTag = (s) => String(s || '')
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .toLowerCase().trim()
  const target = stripTag(columnLabel)
  for (const group of classData.classTableGroups) {
    const labels = group.colLabels || []
    const idx = labels.findIndex(l => stripTag(l) === target)
    if (idx < 0) continue
    const row = (group.rows || [])[level - 1]
    if (!row) continue
    return row[idx]
  }
  return null
}

export function computeResources(character, modifiers, profBonus, totalLevel, classDataMap = {}) {
  const resources = []

  for (const cls of character.classes) {
    const level = cls.level

    const cd = classDataMap[cls.classId]
    // tv = table-value (numeric), td = table-die ("1d6")
    const tv = (col) => getClassTableValue(cd, level, col)
    const td = (col) => getClassTableDie(cd, level, col)

    switch (cls.classId) {
      case 'Barbarian': {
        // 5.5e XPHB Barbarian table: Rages, Rage Damage, Weapon Mastery.
        // 5e PHB uses hardcoded progression — keep the legacy helpers as
        // the fallback.
        const rages = tv('Rages') ?? getBarbarianRages(level)
        const rageDmg = tv('Rage Damage') ?? getBarbarianRageDamage(level)
        resources.push({ id: 'rage', name: 'Rages', max: rages, current: 0, recharge: 'long_rest' })
        resources.push({ id: 'rage_damage', name: 'Rage Damage Bonus', value: `+${rageDmg}`, type: 'passive' })
        break
      }

      case 'Bard': {
        // 5.5e XPHB calls the column "Bardic Die" (a die — d6 → d12).
        // 5e PHB used a static "1d6" and grew. getBardicInspirationDie
        // remains the 5e fallback.
        const die = td('Bardic Die') ?? td('Bardic Insp. Die') ?? getBardicInspirationDie(level)
        resources.push({ id: 'bardic_inspiration', name: 'Bardic Inspiration', max: Math.max(1, modifiers.cha || 1), current: 0, recharge: level >= 5 ? 'short_rest' : 'long_rest', die })
        break
      }

      case 'Cleric': {
        const cdMax = tv('Channel Divinity') ?? (level >= 18 ? 3 : level >= 6 ? 2 : 1)
        resources.push({ id: 'channel_divinity', name: 'Channel Divinity', max: cdMax, current: 0, recharge: 'short_rest' })
        break
      }

      case 'Druid': {
        const wsMax = tv('Wild Shape') ?? (level >= 20 ? 99 : 2)
        resources.push({ id: 'wild_shape', name: 'Wild Shape', max: wsMax, current: 0, recharge: 'short_rest' })
        break
      }

      case 'Fighter': {
        // 5.5e Fighter table has a "Second Wind" column (2/3/4 by level).
        // 5e Fighter has no such column → fallback to 1.
        const swMax = tv('Second Wind') ?? 1
        resources.push({ id: 'second_wind', name: 'Second Wind', max: swMax, current: 0, recharge: 'short_rest' })
        if (level >= 2) resources.push({ id: 'action_surge', name: 'Action Surge', max: level >= 17 ? 2 : 1, current: 0, recharge: 'short_rest' })
        if (level >= 9) resources.push({ id: 'indomitable', name: 'Indomitable', max: level >= 17 ? 3 : level >= 13 ? 2 : 1, current: 0, recharge: 'long_rest' })
        break
      }

      case 'Monk': {
        // 5.5e renamed Ki → Focus Points. The table's column is one or
        // the other depending on edition; we prefer Focus Points (newer)
        // then fall back. Martial Arts die also comes from the table.
        const points = tv('Focus Points') ?? tv('Ki Points') ?? level
        const maDie = td('Martial Arts') ?? `1${getMonkMartialArtsDie(level)}`
        resources.push({ id: 'ki', name: tv('Focus Points') != null ? 'Focus Points' : 'Ki Points', max: points, current: 0, recharge: 'short_rest' })
        resources.push({ id: 'martial_arts_die', name: 'Martial Arts Die', value: maDie, type: 'passive' })
        break
      }

      case 'Paladin': {
        const cdMax = tv('Channel Divinity') ?? (level >= 6 ? 2 : 1)
        resources.push({ id: 'lay_on_hands', name: 'Lay on Hands', max: level * 5, current: 0, recharge: 'long_rest', type: 'pool' })
        if (level >= 2) resources.push({ id: 'channel_divinity', name: 'Channel Divinity', max: cdMax, current: 0, recharge: 'short_rest' })
        break
      }

      case 'Ranger': {
        // 5.5e calls it "Favored Enemy" (Hunter's Mark casts), with
        // explicit counts in the table. 5e uses profBonus.
        const fe = tv('Favored Enemy') ?? profBonus
        if (level >= 1) resources.push({ id: 'favored_foe', name: 'Favored Enemy', max: fe, current: 0, recharge: 'long_rest' })
        break
      }

      case 'Rogue': {
        // 5.5e Sneak Attack die is in the table ("1d6" → "10d6"). 5e
        // uses ⌈level/2⌉d6 — same numbers, computed differently.
        const saDie = td('Sneak Attack') ?? `${Math.ceil(level / 2)}d6`
        if (level >= 1) resources.push({ id: 'sneak_attack', name: 'Sneak Attack', value: saDie, type: 'passive' })
        break
      }

      case 'Sorcerer': {
        const sp = tv('Sorcery Points') ?? level
        resources.push({ id: 'sorcery_points', name: 'Sorcery Points', max: sp, current: 0, recharge: 'long_rest' })
        break
      }

      case 'Warlock':
        // Pact Magic wird separat über Spell Slots gehandelt
        if (level >= 2) {
          const invocations = getWarlockInvocations(level)
          resources.push({ id: 'eldritch_invocations', name: 'Eldritch Invocations', value: invocations, type: 'passive' })
        }
        break

      case 'Wizard':
        resources.push({ id: 'arcane_recovery', name: 'Arcane Recovery', max: 1, value: Math.ceil(level / 2), current: 0, recharge: 'long_rest', note: `Recover up to ${Math.ceil(level / 2)} spell slot levels` })
        break

      case 'Artificer':
        resources.push({ id: 'infusions', name: 'Infusions Known', value: getArtificerInfusions(level), type: 'passive' })
        resources.push({ id: 'infused_items', name: 'Infused Items', max: getArtificerInfusedItems(level), type: 'passive' })
        break
    }
  }

  // Race-trait resources (Blessing of the Raven Queen, Stone's
  // Endurance, Relentless Endurance, Aasimar Healing Hands, …).
  // Parsed dynamically from `species.__traits` — same data the
  // featureEffects scanner uses — so any homebrew race with the
  // standard "you can use this … times per rest" phrasing gets a
  // tracked resource for free, without naming traits in code.
  for (const r of synthesizeRaceTraitResources(character, profBonus)) {
    resources.push(r)
  }

  return resources
}

// ── Race-trait resource synthesizer ─────────────────────────────
// Walks character.species.__traits and emits a class-resource entry
// for any trait whose text declares a usage limit. Matches the most
// common phrasings 5etools data uses:
//   • "<N> times" — fixed integer
//   • "a number of times equal to your proficiency bonus" — = profBonus
//   • "X per long rest" / "regain ... after a long rest"  → long_rest
//   • "short rest" / "short or long rest"                 → short_rest
// Returns [] when no trait matches — no traits, no resources.
function synthesizeRaceTraitResources(character, profBonus) {
  const traits = character?.species?.__traits
  if (!Array.isArray(traits) || traits.length === 0) return []
  const out = []
  for (const t of traits) {
    if (!t?.name || !Array.isArray(t.entries)) continue
    const flat = flattenTraitForResources(t.entries).toLowerCase()
    if (!flat) continue
    // Need both a usage limit AND a recharge cue to call it a resource.
    let max = null
    if (/a\s+number\s+of\s+times\s+equal\s+to\s+your\s+proficiency\s+bonus/.test(flat)) {
      max = Math.max(1, profBonus || 1)
    } else {
      const m = flat.match(/\b(one|two|three|four|five|six|\d+)\s+(?:time|times)\b/)
      if (m) {
        const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
        const v = NUM[m[1].toLowerCase()] ?? parseInt(m[1], 10)
        if (Number.isFinite(v)) max = v
      }
    }
    if (!max) continue
    let recharge = null
    if (/\bshort\s+(?:or\s+long\s+)?rest\b/.test(flat)) recharge = 'short_rest'
    else if (/\blong\s+rest\b/.test(flat)) recharge = 'long_rest'
    if (!recharge) continue
    out.push({
      id: `trait_${String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: t.name,
      max, current: 0, recharge,
    })
  }
  return out
}
// Local copy of the entry-flattener used by featureEffects, kept here
// so rulesEngine doesn't have to import the synthesizer module.
function flattenTraitForResources(entries) {
  const parts = []
  const walk = (e) => {
    if (typeof e === 'string') { parts.push(e); return }
    if (Array.isArray(e)) { for (const x of e) walk(x); return }
    if (e && typeof e === 'object') {
      if (Array.isArray(e.entries)) walk(e.entries)
      if (Array.isArray(e.items))   walk(e.items)
    }
  }
  walk(entries)
  return parts.join(' ').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1').replace(/\s+/g, ' ').trim()
}

// ============================================================
// GESCHWINDIGKEIT
// ============================================================

function computeSpeed(character, abilityScores, classDataMap = {}) {
  // species.speed may be:
  //   • a plain number (the walk speed)
  //   • an object { walk, fly, swim, climb, burrow } where each value
  //     is a number, OR `true` meaning "equal to walk speed"
  // — match 5etools' source shape.
  const raw = character.species?.speed
  const speed = { walk: 30, fly: null, swim: null, climb: null, burrow: null }
  if (typeof raw === 'number') {
    speed.walk = raw
  } else if (raw && typeof raw === 'object') {
    if (typeof raw.walk === 'number') speed.walk = raw.walk
    for (const mode of ['fly', 'swim', 'climb', 'burrow']) {
      const v = raw[mode]
      if (typeof v === 'number') speed[mode] = v
      else if (v === true)       speed[mode] = speed.walk
    }
  }

  // Monk: Unarmored Movement (walk + extra movement modes do NOT get
  // the bonus — only walk per RAW). 5.5e XPHB stores the per-level
  // bonus in the class table's "Unarmored Movement" column as a
  // { type: "bonusSpeed", value: N } object. getClassTableValue
  // unwraps it. Falls back to the 5e PHB hardcoded table.
  const monkClass = character.classes.find(c => c.classId === 'Monk')
  if (monkClass) {
    const fromTable = getClassTableValue(classDataMap[monkClass.classId], monkClass.level, 'Unarmored Movement')
    speed.walk += (fromTable != null ? fromTable : getMonkUnarmoredMovement(monkClass.level))
  }

  // Barbarian Fast Movement (Level 5+).
  const barbarianClass = character.classes.find(c => c.classId === 'Barbarian' && c.level >= 5)
  if (barbarianClass) speed.walk += 10

  // Heavy armor speed penalty: -10 ft if STR below armor's minimum.
  const equippedHA = [...(character.inventory?.items || []), ...(character.custom?.items || [])].find(i =>
    i.equipped && i.isArmor && (i.type || '').split('|')[0] === 'HA'
  )
  if (equippedHA && equippedHA.strength) {
    const str = abilityScores?.str || 10
    if (str < equippedHA.strength) speed.walk -= 10
  }

  // ── Permanent speed bonuses from feats (Mobile = +10) ─────────
  // Data-driven via featureEffects catalog; no class/feat names
  // hardcoded here.
  const mechSpeed = getMechanicalEffects(character).speedBonus
  if (mechSpeed) speed.walk += mechSpeed

  // ── Concentration-spell speed effects ──────────────────────
  // Longstrider (+10), Haste (×2 walk), Fly/Spider Climb (grant mode).
  const concEff = activeConcentrationEffects(character)
  if (concEff) {
    if (concEff.speedBonus) speed.walk += concEff.speedBonus
    if (concEff.speedMul && concEff.speedMul !== 1) speed.walk = Math.round(speed.walk * concEff.speedMul)
    if (concEff.addSpeedMode) {
      for (const [mode, source] of Object.entries(concEff.addSpeedMode)) {
        if (mode === 'walk') continue
        // 'walk' means "= walk speed"; numbers are used as-is.
        speed[mode] = source === 'walk' ? speed.walk : Number(source) || speed[mode]
      }
    }
  }

  return speed
}

function getInitiativeBonus(character) {
  // Data-driven: featureEffects catalog reports any initBonus mechanics
  // (Alert feat = +5; future entries can stack additively here).
  return getMechanicalEffects(character).initBonus || 0
}

// ============================================================
// HILFSTABELLEN
// ============================================================

function getBarbarianRages(level) {
  if (level >= 20) return 999 // Unlimited
  if (level >= 17) return 6
  if (level >= 15) return 5
  if (level >= 12) return 4
  if (level >= 6) return 3
  if (level >= 3) return 3
  return 2
}

function getBarbarianRageDamage(level) {
  if (level >= 16) return 4
  if (level >= 9) return 3
  return 2
}

function getBardicInspirationDie(level) {
  if (level >= 15) return 'd12'
  if (level >= 10) return 'd10'
  if (level >= 5) return 'd8'
  return 'd6'
}

function getMonkUnarmoredMovement(level) {
  if (level >= 18) return 30
  if (level >= 14) return 25
  if (level >= 10) return 20
  if (level >= 6) return 15
  if (level >= 2) return 10
  return 0
}

function getWarlockInvocations(level) {
  if (level >= 17) return 8
  if (level >= 15) return 7
  if (level >= 12) return 6
  if (level >= 9) return 5
  if (level >= 7) return 4
  if (level >= 5) return 3
  if (level >= 2) return 2
  return 0
}

function getArtificerInfusions(level) {
  if (level >= 18) return 12
  if (level >= 14) return 10
  if (level >= 10) return 8
  if (level >= 6) return 6
  if (level >= 2) return 4
  return 0
}

function getArtificerInfusedItems(level) {
  if (level >= 18) return 6
  if (level >= 14) return 5
  if (level >= 10) return 4
  if (level >= 6) return 3
  if (level >= 2) return 2
  return 0
}

// ============================================================
// NORMALISIERUNG
// ============================================================

export function normalizeSkill(skill) {
  // 'Animal Handling' → 'animalHandling'
  return skill
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .map((word, i) => i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
    .replace(/^./, c => c.toLowerCase())
}

export function normalizeTool(tool) {
  // Class data routinely uses 5etools refs like
  //   "{@item Thieves' Tools|XPHB}"
  // as a tool proficiency entry. Without stripping the wrapper the key
  // becomes "{@item_thieves'_tools|xphb}", colliding with the plain
  // "thieves'_tools" key written by backgrounds → both show on the
  // sheet's Proficiencies panel as duplicates ("{@Item Thieves'
  // Tools|Xphb}, Thieves' Tools"). The unwrap also drops a trailing
  // |SOURCE suffix on bare references like "longsword|phb".
  const stripped = String(tool || '')
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .replace(/\|[A-Za-z]+$/, '')
    .trim()
  return stripped.toLowerCase().replace(/\s+/g, '_')
}

// Hit Dice Zusammenfassung
export function computeHitDice(character) {
  const hitDice = {}
  for (const cls of character.classes) {
    const die = `d${cls.hitDie || 8}`
    hitDice[die] = (hitDice[die] || 0) + cls.level
  }
  return hitDice
}