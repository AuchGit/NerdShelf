import { getModifier, getProficiencyBonus, getTotalLevel } from './characterModel'
import { asArray } from './choiceParser'

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
  const attacks = computeAttacks(character, modifiers, profBonus)
  const resources = computeResources(character, modifiers, profBonus, totalLevel)

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
    // Abgeleitetes
    initiative: modifiers.dex + getInitiativeBonus(character),
    speed: computeSpeed(character, abilityScores),
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
    for (const weapon of (startingProfs.weapons || [])) {
      const name = typeof weapon === 'string' ? weapon
        : (weapon?.proficiencyBonuses?.weapon || weapon?.value || null)
      if (name && !result.weapons.includes(name)) result.weapons.push(name)
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
  // Sprachen aus languageProficiencies (werden aus Background-Daten befüllt)
  for (const lang of (character.background?.languageProficiencies || [])) {
    if (typeof lang === 'string' && !result.languages.includes(lang)) {
      result.languages.push(lang)
    }
  }

  // ── Aus Feats ─────────────────────────────────────────────
  for (const feat of (character.feats || [])) {
    // Resilient and similar feats: grant saving throw proficiency
    // Resilient stores chosen ability in abilityBonus (e.g. { con: 1 })
    if (feat.featId === 'Resilient') {
      const ability = Object.keys(feat.abilityBonus || {})[0] || feat.choices?.ability
      if (ability) result.savingThrows[ability.toLowerCase()] = true
    }
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

  return result
}

// ============================================================
// SAVING THROWS
// ============================================================

export function computeSavingThrows(character, modifiers, profBonus, proficiencies) {
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha']
  const result = {}

  for (const ability of abilities) {
    const isProficient = proficiencies.savingThrows[ability] || false
    const mod = modifiers[ability] || 0
    const bonus = isProficient ? profBonus : 0

    // Feats wie Resilient können Saving Throw Proficiency geben
    const featBonus = getFeatSaveBonus(character, ability)

    result[ability] = {
      modifier: mod,
      proficient: isProficient,
      total: mod + bonus + featBonus,
      breakdown: `${mod >= 0 ? '+' : ''}${mod}${isProficient ? ` + ${profBonus} (prof)` : ''}${featBonus ? ` + ${featBonus}` : ''}`,
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

    result[skill] = {
      ability,
      modifier: mod,
      proficiency: profStatus,
      profBonus: bonus,
      total: mod + bonus,
      display: `${mod + bonus >= 0 ? '+' : ''}${mod + bonus}`,
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

  // Feats wie Tough (+2 HP pro Level)
  const toughBonus = hasTough(character) ? getTotalLevel(character) * 2 : 0
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

  // Bestes AC berechnen + Shield
  const best = options.reduce((a, b) => a.value > b.value ? a : b, options[0])

  return {
    total: best.value + shieldBonus,
    base: best.value,
    shield: shieldBonus,
    source: best.label,
    note: best.note,
    allOptions: options,
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

export function computeAttacks(character, modifiers, profBonus) {
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

  // Bewaffnete Angriffe aus Inventar (wird später mit echten Item-Daten gefüllt)
  const allCombatItems = [...(character.inventory?.items || []), ...(character.custom?.items || [])]
  const weapons = allCombatItems.filter(i => i.equipped && i.isWeapon)
  for (const weapon of weapons) {
    const isFinesse = weapon.properties?.includes('Finesse')
    const isRanged = weapon.properties?.includes('Ammunition') || weapon.properties?.includes('Thrown')

    let abilityMod
    if (isFinesse) {
      abilityMod = Math.max(strMod, modifiers.dex || 0)
    } else if (isRanged) {
      abilityMod = modifiers.dex || 0
    } else {
      abilityMod = strMod
    }

    const isProficient = checkWeaponProficiency(character, weapon)
    const attackBonus = abilityMod + (isProficient ? profBonus : 0) + (weapon.attackBonus || 0)

    attacks.push({
      id: weapon.id,
      name: weapon.customName || weapon.name,
      attackBonus,
      attackDisplay: `${attackBonus >= 0 ? '+' : ''}${attackBonus}`,
      damage: `${weapon.dmg1} + ${abilityMod}${weapon.attackBonus ? ` + ${weapon.attackBonus}` : ''}`,
      damageType: weapon.dmgType || 'unknown',
      range: weapon.range || '5 ft.',
      properties: weapon.properties || [],
      isProficient,
    })
  }

  return attacks
}

function checkWeaponProficiency(character, weapon) {
  // Vereinfacht — wird später mit echten Weapon-Daten erweitert
  const profs = character.extraProficiencies?.weapons || []
  return profs.some(p =>
    p.toLowerCase() === weapon.name?.toLowerCase() ||
    p.toLowerCase() === weapon.weaponCategory?.toLowerCase()
  )
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

export function computeResources(character, modifiers, profBonus, totalLevel) {
  const resources = []

  for (const cls of character.classes) {
    const level = cls.level

    switch (cls.classId) {
      case 'Barbarian':
        resources.push({ id: 'rage', name: 'Rages', max: getBarbarianRages(level), current: 0, recharge: 'long_rest' })
        resources.push({ id: 'rage_damage', name: 'Rage Damage Bonus', value: getBarbarianRageDamage(level), type: 'passive' })
        break

      case 'Bard':
        resources.push({ id: 'bardic_inspiration', name: 'Bardic Inspiration', max: Math.max(1, modifiers.cha || 1), current: 0, recharge: level >= 5 ? 'short_rest' : 'long_rest', die: getBardicInspirationDie(level) })
        break

      case 'Cleric':
        resources.push({ id: 'channel_divinity', name: 'Channel Divinity', max: level >= 18 ? 3 : level >= 6 ? 2 : 1, current: 0, recharge: 'short_rest' })
        break

      case 'Druid':
        resources.push({ id: 'wild_shape', name: 'Wild Shape', max: level >= 20 ? 99 : 2, current: 0, recharge: 'short_rest' })
        break

      case 'Fighter':
        resources.push({ id: 'second_wind', name: 'Second Wind', max: 1, current: 0, recharge: 'short_rest' })
        if (level >= 2) resources.push({ id: 'action_surge', name: 'Action Surge', max: level >= 17 ? 2 : 1, current: 0, recharge: 'short_rest' })
        if (level >= 9) resources.push({ id: 'indomitable', name: 'Indomitable', max: level >= 17 ? 3 : level >= 13 ? 2 : 1, current: 0, recharge: 'long_rest' })
        break

      case 'Monk':
        const kiPoints = level
        resources.push({ id: 'ki', name: 'Ki Points', max: kiPoints, current: 0, recharge: 'short_rest' })
        break

      case 'Paladin':
        const divSmiteSlots = Math.floor(level / 2)
        resources.push({ id: 'lay_on_hands', name: 'Lay on Hands', max: level * 5, current: 0, recharge: 'long_rest', type: 'pool' })
        if (level >= 2) resources.push({ id: 'channel_divinity', name: 'Channel Divinity', max: level >= 6 ? 2 : 1, current: 0, recharge: 'short_rest' })
        break

      case 'Ranger':
        if (level >= 1) resources.push({ id: 'favored_foe', name: "Favored Foe", max: profBonus, current: 0, recharge: 'long_rest' })
        break

      case 'Rogue':
        if (level >= 1) resources.push({ id: 'sneak_attack', name: 'Sneak Attack', value: `${Math.ceil(level / 2)}d6`, type: 'passive' })
        break

      case 'Sorcerer':
        resources.push({ id: 'sorcery_points', name: 'Sorcery Points', max: level, current: 0, recharge: 'long_rest' })
        break

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

  return resources
}

// ============================================================
// GESCHWINDIGKEIT
// ============================================================

function computeSpeed(character, abilityScores) {
  // Basis aus Rasse
  let base = character.species?.speed || 30

  // Monk: Unarmored Movement
  const monkClass = character.classes.find(c => c.classId === 'Monk')
  if (monkClass) {
    base += getMonkUnarmoredMovement(monkClass.level)
  }

  // Barbarian Fast Movement (Level 5+)
  const barbarianClass = character.classes.find(c => c.classId === 'Barbarian' && c.level >= 5)
  if (barbarianClass) base += 10

  // Heavy armor speed penalty: -10 ft if STR below armor's minimum
  const equippedHA = [...(character.inventory?.items || []), ...(character.custom?.items || [])].find(i =>
    i.equipped && i.isArmor && (i.type || '').split('|')[0] === 'HA'
  )
  if (equippedHA && equippedHA.strength) {
    const str = abilityScores?.str || 10
    if (str < equippedHA.strength) base -= 10
  }

  return { walk: base, swim: null, fly: null, climb: null, burrow: null }
}

function getInitiativeBonus(character) {
  // Feats wie Alert geben +5
  const hasAlert = character.feats.some(f => f.featId === 'Alert')
  return hasAlert ? 5 : 0
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
  return tool.toLowerCase().replace(/\s+/g, '_')
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