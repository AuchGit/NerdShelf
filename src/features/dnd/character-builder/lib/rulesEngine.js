import { getModifier, getProficiencyBonus, getTotalLevel } from './characterModel'
import { asArray } from './choiceParser'
import { combinedMarkEffects, gatherCharacterFeatures } from './weaponMarkingRules'
import { FEATURE_PROFICIENCY_GRANTS } from './featureGrants'
import { activeConcentrationEffects, activeVariableDamageEffect } from './concentrationEffects'
import { getMechanicalEffects } from './featureEffects'
import { sumEquippedBonuses, getWeaponBonus, collectPassiveGrants } from './itemBonuses'
import { aggregateFeatureBonuses } from './featureBonusExtractor'
import { getEffectsForWeapon } from './activeEffects'
import { getClassTableValue as _gcTableValue, getClassTableDie as _gcTableDie, getClassTableCell as _gcTableCell } from './classTableLookup'
import { RESOURCE_TEMPLATES } from './resourceTemplates'
import {
  getBarbarianRages, getBarbarianRageDamage, getBardicInspirationDie,
  getMonkMartialArtsDie, getMonkUnarmoredMovement,
  getWarlockInvocations, getArtificerInfusions, getArtificerInfusedItems,
} from './rulesEngineFallbacks'

// Boni aus aktiv-gewählten Class-/Subclass-/Optional-Features
// (Fighting Style Defense → +1 AC, Archery → +2 ranged attack,
// Dueling → +2 1H melee damage, Thrown Weapon Fighting → +2 thrown
// damage, etc.). __activeFeatures wird in CharacterSheetPage.
// hydrateClassDataAndRecompute befüllt — inkl. chosen sub-features
// aus dem option-block-resolver, sodass eine Magician/Warden-Wahl
// hier korrekt durchschlägt.
function _featureBonusesFor(character) {
  const list = Array.isArray(character?.__activeFeatures) ? character.__activeFeatures : []
  return aggregateFeatureBonuses(list)
}

// ── Attacks per Attack-Action ─────────────────────────────────
// 5e/5.5e: jeder Char hat 1 Attack pro Attack-Action. "Extra Attack"
// und seine Folge-Tier-Features pushen das hoch.
//
// 100% data-driven aus dem __activeFeatures-Entry-Text:
//   PHB Fighter L5  → "you can attack twice, instead of once …"
//   PHB Fighter L5  → "The number of attacks increases to three when you
//                      reach 11th level in this class and to four when
//                      you reach 20th level"   ← inline tier-table
//   XPHB Fighter L5 → "You can attack twice instead of once …"
//   XPHB Fighter L11 → "You can attack three times instead of once …"
//   XPHB Fighter L20 → "You can attack four times instead of once …"
//
// Patterns matchen sowohl "attack N times" als auch
// "increases to N when you reach Lth level" — letztere wird
// charLevel-gegen-Threshold gegated. Max aller Treffer wird
// zurückgegeben (Multiclass: höchste Stufe gewinnt, nicht Summe).
// Kein Feature-Name-Whitelist — Homebrew "Path of the Triple Strike"
// L11 mit "you can attack three times" funktioniert automatisch.
export function computeAttacksPerAction(character) {
  const features = character?.__activeFeatures || []
  const WORD = { two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6 }
  const totalLevel = (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
  let max = 1

  for (const f of features) {
    const txt = Array.isArray(f?.entries)
      ? f.entries.filter(e => typeof e === 'string').join(' ').toLowerCase()
      : ''
    if (!txt) continue

    // Pattern A: "attack twice|three times|N times instead of once"
    const baseRe = /\battack\s+(twice|two\s+times|three\s+times|four\s+times|five\s+times|six\s+times|\d+\s+times)\b/g
    let m
    while ((m = baseRe.exec(txt)) !== null) {
      const tok = m[1].toLowerCase()
      const firstWord = tok.split(/\s+/)[0]
      const n = WORD[firstWord] != null ? WORD[firstWord] : parseInt(firstWord, 10)
      if (Number.isFinite(n) && n > max) max = n
    }

    // Pattern B: Inline Tier-Progression — "increases to N when you
    // reach Lth level" UND chained "and to N when you reach Lth level"
    // (PHB Fighter packt L11+L20 in EINEN Satz: "increases to three
    // when you reach 11th level … and to four when you reach 20th
    // level"). Wir matchen jede Vorkommnis von "to N when you reach
    // Lth level" — Pattern A oben fängt die Base-Count ab, also kein
    // Risk auf "attack twice instead of once"-Doppelmatching.
    const tierRe = /\bto\s+(two|three|four|five|six|\d+)\s+when\s+you\s+reach\s+(\d+)(?:st|nd|rd|th)?\s+level/g
    while ((m = tierRe.exec(txt)) !== null) {
      const w = m[1].toLowerCase()
      const n = WORD[w] != null ? WORD[w] : parseInt(w, 10)
      const lvl = parseInt(m[2], 10)
      // "in this class" — feature ist class-gebunden, lookup
      // class-level. Sonst totalLevel.
      let referenceLevel = totalLevel
      if (f.classId) {
        const cls = (character?.classes || []).find(c => c.classId === f.classId)
        if (cls?.level) referenceLevel = cls.level
      }
      if (Number.isFinite(n) && Number.isFinite(lvl) && referenceLevel >= lvl && n > max) {
        max = n
      }
    }
  }
  return max
}

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

  // ── Homebrew Item _hbPassiveGrants ────────────────────────
  // Items mit attuned + equipped können beliebige passive Grants
  // beitragen — Skills, Tools, Languages, Saves, Senses, Resists.
  const itemGrants = collectPassiveGrants(character)
  for (const skill of itemGrants.skillProficiencies) {
    const key = normalizeSkill(skill)
    if (!result.skills[key] || result.skills[key] === 'none') {
      result.skills[key] = 'proficient'
    }
  }
  for (const skill of itemGrants.skillExpertise) {
    const key = normalizeSkill(skill)
    result.skills[key] = 'expertise'
  }
  for (const tool of itemGrants.toolProficiencies) {
    if (!result.tools) result.tools = []
    if (!result.tools.some(t => t.toLowerCase() === tool)) result.tools.push(tool)
  }
  for (const lang of itemGrants.languages) {
    if (!result.languages.some(l => l.toLowerCase() === lang.toLowerCase())) {
      result.languages.push(lang)
    }
  }
  for (const ab of itemGrants.savingThrows) {
    if (!result.savingThrows) result.savingThrows = {}
    if (!result.savingThrows[ab]) result.savingThrows[ab] = 'proficient'
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
    // Sprachen aus feat.languageProficiencies (5etools: array of
    // {<langName>: true} or {anyStandard: N}). Wir extrahieren fixed
    // language-names; "anyStandard/anyExotic" sind Choice-Picks die
    // im character.choices liegen und über den unten getriggerten
    // generischen choices-loop laufen.
    for (const block of (feat.languageProficiencies || [])) {
      if (!block || typeof block !== 'object') continue
      for (const [key, val] of Object.entries(block)) {
        if (val === true && !/^any/i.test(key)
          && !result.languages.includes(key)) {
          result.languages.push(key)
        }
      }
    }
    // User-chosen languages (vom Choice-Picker via feat.choices).
    for (const lang of (feat.choices?.proficiencies?.languages || [])) {
      if (typeof lang === 'string' && !result.languages.includes(lang)) {
        result.languages.push(lang)
      }
    }
    // Saving-Throw-Proficiency-Grants (Resilient: structured Form
    // mit {<ability>: true} array). Resilient gibt prof in EINER
    // gewählten Ability — `feat.choices.ability` enthält den Pick.
    for (const block of (feat.savingThrowProficiencies || [])) {
      if (!block || typeof block !== 'object') continue
      for (const [ability, val] of Object.entries(block)) {
        const abLow = ability.toLowerCase()
        if (val === true && ['str','dex','con','int','wis','cha'].includes(abLow)) {
          result.savingThrows[abLow] = true
        }
      }
    }
    // Resilient + andere "choose one ability"-Feats speichern den
    // Pick in feat.choices.ability (string). Wende ihn auf saves an.
    if (feat.choices?.ability) {
      const a = String(feat.choices.ability).toLowerCase()
      if (['str','dex','con','int','wis','cha'].includes(a)) {
        result.savingThrows[a] = true
      }
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

  // ── Datadriven Feature-Text-Proficiency-Grants ─────────────
  // Jedes aktive Feature dessen Entry-Text "you gain proficiency
  // with X (weapons|armor)" trägt, fügt seine Tokens hier hinzu.
  // Catches Druid Warden, Kensei-Subclass Variants, homebrew
  // features etc. — ohne hand-edited Catalog-Eintrag.
  const featBonuses = aggregateFeatureBonuses(character?.__activeFeatures || [])
  for (const w of (featBonuses.weaponProficiencies || [])) {
    if (!result.weapons.includes(w)) result.weapons.push(w)
  }
  for (const a of (featBonuses.armorProficiencies || [])) {
    if (!result.armor.includes(a)) result.armor.push(a)
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
      } else if (picked.type === 'languageProficiency' && Array.isArray(picked.value)) {
        // Language picks vom Feature-Picker (Ranger Deft Explorer L2,
        // Sorcerer Origin Spell language, …) landen direkt in der
        // languages-Liste. Dedup gegen bereits vorhandene Sprachen.
        for (const lang of picked.value) {
          if (typeof lang !== 'string' || !lang) continue
          if (!result.languages.some(l => String(l).toLowerCase() === lang.toLowerCase())) {
            result.languages.push(lang)
          }
        }
      } else if (picked.type === 'toolProficiency' && Array.isArray(picked.value)) {
        // Tool-Profs landen im tools-Object (existing structure).
        for (const tool of picked.value) {
          if (typeof tool !== 'string' || !tool) continue
          const key = tool.toLowerCase()
          if (!result.tools[key]) result.tools[key] = true
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

  // Magic-Item-Boni auf ALLE Saves (Cloak of Protection +1,
  // Ring of Protection +1, Robe of the Archmagi +2, etc.).
  const itemSaves = sumEquippedBonuses(character, 'bonusSavingThrow')
  // Feature-Boni (data-extracted aus optionalfeature/Feature-Text —
  // catches future Saving-Throw-Boni ohne Hardcode).
  const featBonusesSv = _featureBonusesFor(character)
  const featSaveBonus = featBonusesSv.savingThrowBonus || 0

  for (const ability of abilities) {
    const isProficient = proficiencies.savingThrows[ability] || false
    const mod = modifiers[ability] || 0
    const bonus = isProficient ? profBonus : 0

    // Feats wie Resilient können Saving Throw Proficiency geben
    const featBonus = getFeatSaveBonus(character, ability)

    const total = mod + bonus + featBonus + auraBonus + itemSaves.total + featSaveBonus

    result[ability] = {
      modifier: mod,
      proficient: isProficient,
      total,
      breakdown: `${mod >= 0 ? '+' : ''}${mod}`
        + (isProficient ? ` + ${profBonus} (prof)` : '')
        + (featBonus ? ` + ${featBonus}` : '')
        + (auraBonus ? ` + ${auraBonus} (aura/${mech.saveBonusAbility?.toUpperCase()})` : '')
        + (itemSaves.total ? ` + ${itemSaves.total} (item)` : '')
        + (featSaveBonus ? ` + ${featSaveBonus} (feature)` : ''),
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

  // Homebrew item _hbPassiveGrants.hpBonus — flat HP add wenn attuned + equipped.
  const itemHp = collectPassiveGrants(character).hpBonus || 0
  maxHp += itemHp

  return {
    max: maxHp,
    current: character.status.currentHp ?? maxHp,
    temporary: character.status.temporaryHp || 0,
    breakdown,
    toughBonus,
    itemHpBonus: itemHp,
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
  // type kann 5etools-Source-Suffix tragen (`S|XPHB`, `LA|XPHB`, …)
  // → vor jedem literal-Vergleich auf den Code vor dem `|` runterstutzen.
  const typeCode = (it) => String(it?.type || '').split('|')[0]
  const equippedArmor = allItems.filter(i => i.equipped && i.isArmor && typeCode(i) !== 'S')
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
  const hasShield = allItems.some(i => i.equipped && (i.isShield || typeCode(i) === 'S'))
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

  // Magic-Item-Boni: +N Armor/Shield, Cloak of Protection, Ring of
  // Protection, Robe of the Archmagi etc. tragen `bonusAc` als String
  // wie "+1". Wir summieren über ALLE equipped Items — auch das
  // Shield-Item selbst (eine "Shield, +1" hat sowohl Type=S als auch
  // bonusAc: "+1"; dadurch ergibt sich +2 base + 1 magic = +3 korrekt).
  const itemAc = sumEquippedBonuses(character, 'bonusAc')
  total += itemAc.total

  // Feature-AC-Boni (Fighting Style "Defense" → +1 wenn Rüstung an).
  // acBonusRequiresArmor gilt für Defense; Features ohne Flag (z.B.
  // Cloak-of-Protection-ähnliche Items) addieren immer. Wir bestimmen
  // "trägt Rüstung" über die getroffene AC-Option: armor-basierte
  // Optionen haben `armor.isArmor`, unarmored-defense nicht.
  const featBonuses = _featureBonusesFor(character)
  const wearingArmor = equippedArmor.length > 0
  let featAcContribution = 0
  if (typeof featBonuses.acBonus === 'number' && featBonuses.acBonus !== 0) {
    if (featBonuses.acBonusRequiresArmor && !wearingArmor) {
      // skip — z.B. Defense ohne Rüstung greift nicht
    } else {
      featAcContribution = featBonuses.acBonus
      total += featAcContribution
    }
  }

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
    itemBonusAc: itemAc.total,
    itemBonusAcSources: itemAc.sources,
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

  // Magic-Item-Boni werden auf jede Caster-Klasse identisch addiert
  // (Robe of the Archmagi, +N Spellcasting Focus, Staff of Power, …).
  // 5etools unterscheidet bonusSpellAttack (Attack-Roll) und
  // bonusSpellSaveDc (DC) — beide werden aus equipped Items summiert.
  const itemAtk = sumEquippedBonuses(character, 'bonusSpellAttack').total
  const itemDC  = sumEquippedBonuses(character, 'bonusSpellSaveDc').total

  for (const cls of character.classes) {
    if (!cls.spellcastingAbility) continue

    const ability = cls.spellcastingAbility.toLowerCase()
    const mod = modifiers[ability] || 0
    const spellAttack = mod + profBonus + itemAtk
    const saveDC = 8 + mod + profBonus + itemDC

    result[cls.classId] = {
      ability,
      modifier: mod,
      spellAttackBonus: spellAttack,
      spellSaveDC: saveDC,
      spellAttackDisplay: `${spellAttack >= 0 ? '+' : ''}${spellAttack}`,
      itemBonusAttack: itemAtk,
      itemBonusDC: itemDC,
    }
  }

  return result
}

// ============================================================
// ANGRIFFE
// ============================================================

export function computeAttacks(character, modifiers, profBonus, proficiencies, weaponMastery = null) {
  const attacks = []
  // Extra Attack pre-compute — applies to alle Action-Attack-Rows
  // (Unarmed, Monk Martial Arts, Psychic Blades, Weapons). Bonus-
  // Action-Attacks (Psychic Blades Bonus, Off-Hand TWF) bekommen das
  // Feld NICHT (sie sind eine separate Action-Economy-Phase).
  const _attacksPerActionTop = computeAttacksPerAction(character)

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
    attacksPerAction: _attacksPerActionTop,
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
      attacksPerAction: _attacksPerActionTop,
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
      attacksPerAction: _attacksPerActionTop,
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
  // Aktive Variable-Damage-Konzentration (Hex, Hunter's Mark, Divine
  // Favor, Bless …) — wird als Advisory-Effekt an jede Waffen-Row
  // gehängt. KEIN Stat-Math (die Würfe sind per-Roll) — nur
  // Display-Pille damit der Spieler beim Würfeln nicht vergisst.
  const variableBuff = activeVariableDamageEffect(character)
  // Feature-Boni: Fighting-Style-Effekte etc. werden hier pro Waffe
  // konditional addiert (ranged vs. melee, einhändig vs. thrown).
  const fb = _featureBonusesFor(character)
  // Aliased für die weapon-loop unten (war oben schon einmal als
  // _attacksPerActionTop berechnet).
  const attacksPerAction = _attacksPerActionTop
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
    // Aktive Effects die auf diese Waffe gebunden sind (Shillelagh,
    // Magic Weapon, Magic Stone, Elemental Weapon — generisch via
    // character.status.activeEffects). Mehrere Effects stacken
    // additiv für Boni; abilityOverride/damageDie nimmt der LETZTE
    // Effect (Spieler-Order).
    const effects = getEffectsForWeapon(character, weapon.id)
    const effectAcc = {
      abilityOverride: null, damageDie: null, damageType: null,
      attackBonus: 0, damageBonus: 0, magical: false,
      labels: [],
    }
    for (const e of effects) {
      const v = e?.value || {}
      if (v.abilityOverride) effectAcc.abilityOverride = v.abilityOverride
      if (v.damageDie)       effectAcc.damageDie       = v.damageDie
      if (v.damageType)      effectAcc.damageType      = v.damageType
      if (typeof v.attackBonus === 'number') effectAcc.attackBonus += v.attackBonus
      if (typeof v.damageBonus === 'number') effectAcc.damageBonus += v.damageBonus
      if (v.magical) effectAcc.magical = true
      if (e?.source) effectAcc.labels.push({
        id: e.id,                                  // für Dismiss-Knopf am Attack-Row
        label: e.source.replace(/^spell:/, ''),
        kind: e.kind,
        damageType: v.damageType || null,
        until: e.until || null,
      })
    }

    let abilityMod
    let abilityUsed
    // Effect-Override hat höchste Priorität (Shillelagh überschreibt
    // selbst Hex Warrior). Wenn beide aktiv sind, nimmt der spätere
    // Effect den AbilityOverride.
    if (effectAcc.abilityOverride) {
      abilityUsed = effectAcc.abilityOverride
      abilityMod = modifiers[effectAcc.abilityOverride] || 0
    } else if (marks.abilityOverride) {
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
    // Magic-Weapon-Bonus: 5etools-Items tragen entweder `bonusWeapon`
    // (zählt für attack UND damage — klassisch "+1 Weapon") oder
    // separat `bonusWeaponAttack` / `bonusWeaponDamage`. Legacy:
    // `weapon.attackBonus` (numerisch, von CustomEditModal gesetzt).
    const wBonus = getWeaponBonus(weapon)
    // Fighting-Style-Boni (data-extracted aus den Feature-Texten):
    //   • Archery → +rangedAttackBonus auf Fernkampf-Attack-Rolls
    //   • Dueling → +oneHandedMeleeDamageBonus wenn Nahkampf+1H+keine andere Waffe
    //   • Thrown Weapon Fighting → +thrownDamageBonus auf Thrown-Waffen
    // isRanged ist oben bereits berechnet; "1H+nothing else" leiten wir
    // aus Properties + Equipped-Set ab.
    let featAtk = 0
    let featDmg = 0
    if (isRanged && fb.rangedAttackBonus) featAtk += fb.rangedAttackBonus
    if (!isRanged && fb.meleeAttackBonus) featAtk += fb.meleeAttackBonus
    if (fb.thrownDamageBonus && props.includes('Thrown')) featDmg += fb.thrownDamageBonus
    if (fb.oneHandedMeleeDamageBonus
        && !isRanged
        && !props.includes('Two-Handed')
        && !props.includes('Heavy')
    ) {
      // "no other weapons" — wir gucken ob noch eine ANDERE Waffe
      // equipped ist (Off-Hand-Two-Weapon-Fighting würde Dueling
      // ausschließen). Versatile-Waffen einhändig getragen → erlaubt.
      const otherWeaponEquipped = weapons.some(w =>
        w.id !== weapon.id && w.equipped && w.isWeapon,
      )
      if (!otherWeaponEquipped) featDmg += fb.oneHandedMeleeDamageBonus
    }
    const baseAtk = abilityMod + (isProficient ? profBonus : 0) + wBonus.attack + featAtk
    const attackBonus = baseAtk + (marks.attackBonus || 0) + effectAcc.attackBonus
    const damageExtra = wBonus.damage + (marks.damageBonus || 0) + featDmg + effectAcc.damageBonus
    // Damage-Die-Override (Shillelagh: 1d8 statt Quarterstaff-1d6;
    // Magic Stone: 1d6). Wir bauen den Damage-String aus dem über-
    // schriebenen Würfel und tag'n den Damage-Type wenn der Effect
    // einen vorgibt.
    const effectiveDmg1     = effectAcc.damageDie  || weapon.dmg1
    const effectiveDmgType  = effectAcc.damageType || weapon.dmgType || 'unknown'

    // Reach-Property erweitert die Nahkampf-Reichweite per RAW von
    // 5 auf 10 ft. 5etools füllt `range` nur bei Ranged/Thrown-Waffen
    // (Longbow "150/600", Dagger "20/60"), Nahkampf-Reach-Waffen wie
    // Whip / Glaive / Halberd / Lance / Pike haben kein `range`-Feld
    // — der alte Fallback `|| '5 ft.'` hat das verschluckt. Daher:
    //   1. explizite range aus den Daten → wie sie ist
    //   2. Reach-Property gesetzt          → 10 ft
    //   3. sonst                            → 5 ft
    // Damit funktioniert das automatisch für jede Reach-Waffe in den
    // 5e- und 5.5e-Datendateien, ohne Whitelist.
    const computedRange = weapon.range
      ? weapon.range
      : (props.includes('Reach') ? '10 ft.' : '5 ft.')
    attacks.push({
      id: weapon.id,
      name: weapon.customName || weapon.name,
      attackBonus,
      attackDisplay: `${attackBonus >= 0 ? '+' : ''}${attackBonus}`,
      damage: `${effectiveDmg1} + ${abilityMod}${damageExtra ? ` + ${damageExtra}` : ''}`,
      damageType: effectiveDmgType,
      // Effect-Labels werden als Pill auf der Attack-Row angezeigt
      // ("Shillelagh", "Magic Weapon", …) damit der Spieler sofort
      // sieht dass die Waffe gerade gebuffed ist.
      activeEffects: effectAcc.labels,
      magical: effectAcc.magical || undefined,
      // Wie viele Treffer pro Attack-Action (Extra Attack feature
      // pushed das auf 2/3/4 hoch). Renderer zeigt "×N" pill wenn > 1.
      attacksPerAction,
      range: computedRange,
      properties: props,
      // Per-Roll-Advisory aus aktiver Konzentration. Renderer kann
      // daraus eine "Hex +1d6 necrotic"-Pille auf der Attack-Row
      // bauen. Kein Effekt auf attackBonus / damage — der Player
      // entscheidet pro Hit ob die Bedingung greift.
      variableBuff: variableBuff ? {
        label:      variableBuff.label,
        formula:    variableBuff.formula,
        damageType: variableBuff.damageType,
        note:       variableBuff.note || null,
      } : null,
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
  // Strip 5etools rule-link tags ({@variantrule Weapons|XPHB} etc.) so
  // wording like "kinds of {@variantrule Weapons|XPHB} of your choice"
  // still matches the "two weapons of your choice" pattern.
  const text = flat(feature.entries || []).join(' ')
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .toLowerCase()
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
  // Match "two kinds of", "three different weapons", "two weapons of your choice", etc.
  const m = text.match(/\b(one|two|three|four|five|six|\d+)\b\s+(?:kinds?\s+of|different|weapons?\s+of\s+your\s+choice)/i)
  if (m) {
    const v = NUM[m[1].toLowerCase()] ?? parseInt(m[1], 10)
    return Number.isFinite(v) ? v : null
  }
  return null
}

// getMonkMartialArtsDie + andere Fallbacks leben jetzt in
// rulesEngineFallbacks.js und werden oben importiert.

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
// Re-export aliases so der vorhandene Code im File die lokalen Namen
// weiterbenutzen kann. Die Implementierung lebt jetzt in
// ./classTableLookup damit auch featureEffectParser drauf zugreifen
// kann (Sneak-Attack-Pille-Scaling Phase 3).
const getClassTableValue = _gcTableValue
const getClassTableDie   = _gcTableDie
const getClassTableCell  = _gcTableCell

export function computeResources(character, modifiers, profBonus, totalLevel, classDataMap = {}) {
  const resources = []

  // Per-Klasse-Resource-Templates aus lib/resourceTemplates.js. Eine
  // neue Klasse hinzufügen = ein Eintrag im Catalog; kein switch hier
  // mehr.
  for (const cls of character.classes) {
    const level = cls.level
    const cd = classDataMap[cls.classId]
    const ctx = {
      level,
      modifiers,
      profBonus,
      // tv = table-value (numeric), td = table-die ("1d6")
      tv: (col) => getClassTableValue(cd, level, col),
      td: (col) => getClassTableDie(cd, level, col),
    }
    const template = RESOURCE_TEMPLATES[cls.classId]
    if (!template) continue
    const out = template(ctx)
    if (Array.isArray(out)) {
      for (const r of out) resources.push(r)
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

  // Class/subclass features mit eingebetteter Resource-Tabelle —
  // Soulknife Energy Dice, Battle Master Superiority Dice, alles
  // wo 5etools eine `{type: 'table'}` mit Level-Spalte + Count-Spalte
  // im feature.entries hat. Erkennung läuft rein über die Tabellen-
  // Form, nicht über Klassen- oder Featurenamen.
  const existingIds = new Set(resources.map(r => r.id))
  for (const r of synthesizeFeatureTableResources(character)) {
    if (existingIds.has(r.id)) continue
    existingIds.add(r.id)
    resources.push(r)
  }

  return resources
}

// ── Class/Subclass-Feature-Tabellen-Synthesizer ─────────────────
// Viele 5etools-Subklassen-Features ("Psionic Power" mit Soulknife
// Energy Dice, "Combat Superiority" mit Superiority Dice, …) tragen
// ihre Mechanik als Inline-Tabelle innerhalb der feature.entries.
// Spalten sind typischerweise:
//   • [Klassen-]Level — z.B. "Rogue Level", "Fighter Level"
//   • Count           — "Number", "Dice", "Uses", "Points", "Charges"
//   • Optional Die    — "Die Size", "Die"
//
// Wir suchen Tables in jedem aktiven Feature, identifizieren diese
// drei Spalten datengetrieben (Regex auf die colLabels), picken die
// Zeile mit dem höchsten Level ≤ Character-Class-Level, und emiten
// eine Resource. Recharge kommt aus dem umgebenden Prosatext
// ("short rest"/"long rest"). Keine Hardcoded-Featurenamen, keine
// Whitelist — alles was die Form hat wird erfasst.
// 5etools-Tag-Stripper für inline-Werte aus Tabellenzellen
// (z.B. "{@dice D6}" → "D6"). Lokal definiert damit der Synthesizer
// keine externe Abhängigkeit braucht.
function stripTraitTags(s) {
  return String(s || '').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
}

function synthesizeFeatureTableResources(character) {
  const features = character?.__activeFeatures || []
  if (features.length === 0) return []

  // Class-Level pro classId — brauchen wir um die richtige Zeile in
  // der Tabelle zu finden. Multiclass-sauber: ein Soulknife-Rogue 5 +
  // Fighter 3 picked die Zeile für Level 5 aus der Rogue-Tabelle, nicht
  // den Gesamtlevel.
  const levelByClass = {}
  for (const cls of (character.classes || [])) levelByClass[cls.classId] = cls.level

  const out = []
  for (const f of features) {
    if (!Array.isArray(f.entries)) continue
    const classLevel = levelByClass[f.classId] || 0
    if (classLevel < 1) continue
    const tables = []
    collectTables(f.entries, tables)
    if (tables.length === 0) continue
    const flat = flattenTraitForResources(f.entries).toLowerCase()
    // Recharge-Erkennung: short rest gewinnt wenn beide erwähnt, weil
    // Features die teilweise auf Short Rest recovern (Soulknife: "regain
    // one … finish a Short Rest") für den Spieler so geführt werden
    // wie Short-Rest-Resources — er sieht zumindest, dass der Pool
    // bewegt werden kann ohne Long Rest.
    const recharge = /short(?:\s+or\s+long)?\s+rest|finish\s+a\s+short\s+rest/.test(flat)
      ? 'short_rest'
      : 'long_rest'
    for (const table of tables) {
      const row = pickTableRowForLevel(table, classLevel)
      if (!row) continue
      const { count, dieSize, captionUsed } = row
      if (!Number.isFinite(count) || count <= 0) continue
      // Name bevorzugt Tabellen-Caption (z.B. "Soulknife Energy Dice"),
      // sonst Featurename. Caption ist meist die saubere Spielregel-
      // Bezeichnung, die der Spieler kennt.
      const name = (table.caption ? stripTraitTags(String(table.caption)) : f.name).trim()
      const id = `tbl-${slugForResource(f.classId)}-${slugForResource(name)}`
      out.push({
        id, name, max: count, current: 0, recharge,
        die: dieSize || undefined,
        source: `${f.classId}${captionUsed ? '' : ''}`,
      })
    }
  }
  return out
}

function collectTables(entries, acc) {
  if (!entries) return
  if (Array.isArray(entries)) {
    for (const e of entries) collectTables(e, acc)
    return
  }
  if (typeof entries !== 'object') return
  if (entries.type === 'table' && Array.isArray(entries.colLabels) && Array.isArray(entries.rows)) {
    acc.push(entries)
  }
  if (Array.isArray(entries.entries)) collectTables(entries.entries, acc)
  if (Array.isArray(entries.items))   collectTables(entries.items, acc)
}

// Versucht aus einer Tabelle die richtige Zeile für `classLevel` zu
// extrahieren. Liefert { count, dieSize } oder null wenn die Tabelle
// nicht die Resource-Pattern-Form hat.
//
// Pattern:
//   • Eine Spalte deren Label "level" enthält → Level-Spalte
//   • Eine numerische Spalte ("number", "dice", "uses", "points",
//     "charges") → Count-Spalte
//   • Optional: "die size" / "die" → Die-Spalte
function pickTableRowForLevel(table, classLevel) {
  const labels = (table.colLabels || []).map(l => stripTraitTags(String(l)).toLowerCase().trim())
  // Level-Spalte: enthält das Wort "level" (egal in welcher Sprache
  // das Klassen-Präfix steht — "Rogue Level", "Class Level", oder
  // einfach "Level").
  const levelIdx = labels.findIndex(l => /\blevel\b/.test(l))
  if (levelIdx < 0) return null
  // Count-Spalte: Standard-Namen für nutzbare Ressourcen.
  const countIdx = labels.findIndex(l =>
    /\b(number|dice|uses|points|charges|invocations|maneuvers known|maneuvers)\b/.test(l),
  )
  if (countIdx < 0) return null
  const dieIdx = labels.findIndex(l => /\b(die\s*size|die)\b/.test(l) && labels.indexOf(l) !== countIdx)

  // Beste passende Zeile: höchstes Level ≤ classLevel.
  let best = null
  for (const row of (table.rows || [])) {
    if (!Array.isArray(row)) continue
    const lvlRaw = stripTraitTags(String(row[levelIdx] ?? '')).trim()
    // Eine Zeile kann "3" oder "3-4" oder "3–4" stehen haben (Range).
    // Wir picken die untere Grenze als Breakpoint.
    const lvlMatch = lvlRaw.match(/(\d+)/)
    if (!lvlMatch) continue
    const lvl = parseInt(lvlMatch[1], 10)
    if (!Number.isFinite(lvl) || lvl > classLevel) continue
    if (!best || lvl > best.level) best = { level: lvl, row }
  }
  if (!best) return null
  const countCell = stripTraitTags(String(best.row[countIdx] ?? '')).trim()
  const countMatch = countCell.match(/(\d+)/)
  const count = countMatch ? parseInt(countMatch[1], 10) : NaN
  let dieSize = null
  if (dieIdx >= 0) {
    const dieCell = stripTraitTags(String(best.row[dieIdx] ?? '')).trim()
    const dieMatch = dieCell.match(/d\s*(\d+)/i)
    if (dieMatch) dieSize = `d${dieMatch[1]}`
  }
  return { count, dieSize, captionUsed: !!table.caption }
}

function slugForResource(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
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
  // Homebrew item _hbPassiveGrants.speedBonus — pro mode additiv.
  const localGrants = collectPassiveGrants(character)
  if (localGrants?.speedBonus) {
    for (const [mode, bonus] of Object.entries(localGrants.speedBonus)) {
      speed[mode] = (speed[mode] || 0) + bonus
    }
  }

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
  // Plus Homebrew _hbPassiveGrants.initBonus on attuned + equipped items.
  return (getMechanicalEffects(character).initBonus || 0)
    + (collectPassiveGrants(character).initBonus || 0)
}

// ============================================================
// HILFSTABELLEN
// ============================================================

// 5e-Hardcoded-Progression-Fallbacks leben jetzt zentral in
// rulesEngineFallbacks.js und werden oben importiert.

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