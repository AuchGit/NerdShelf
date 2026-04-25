// lib/levelUpEngine.js
import { getTotalLevel } from './characterModel'
import { getSpellcastingInfo } from './spellcastingRules'

// ── Snapshot / Undo ─────────────────────────────────────────────────────────

export function createSnapshot(character) {
  const snap = structuredClone(character)
  // Strip portrait (large blob)
  if (snap.appearance) snap.appearance.portrait = null
  // Strip nested snapshots from levelHistory to prevent exponential growth.
  // At level 10 without this fix, each snapshot contains all previous snapshots
  // which each contain all their previous snapshots → O(2^n) data size.
  // Undo still works because the CURRENT character's levelHistory has the full chain.
  if (snap.levelHistory) {
    snap.levelHistory = snap.levelHistory.map(entry => {
      const { snapshot, ...rest } = entry
      return rest // keep metadata (totalLevel, classId, timestamp) but drop the nested snapshot blob
    })
  }
  return snap
}

export function undoLevelUp(character, stepsBack = 0) {
  const history = character.levelHistory || []
  const idx = history.length - 1 - stepsBack
  if (idx < 0 || !history[idx]?.snapshot) return null
  const snap = structuredClone(history[idx].snapshot)
  if (character.appearance?.portrait)
    snap.appearance = { ...(snap.appearance || {}), portrait: character.appearance.portrait }
  // Graft the LIVE character's levelHistory (with full snapshots) up to the
  // undo point back into the restored snapshot. This preserves the undo chain
  // for further Level Downs, even though createSnapshot strips nested snapshots.
  snap.levelHistory = history.slice(0, idx)
  return snap
}
export function undoLastLevelUp(c) { return undoLevelUp(c, 0) }
export function canUndo(c) { const h=c.levelHistory||[];return h.length>0&&!!h[h.length-1].snapshot }
export function getLevelHistory(c) { return c.levelHistory || [] }
export function getLastLevelUpInfo(c) { const h=c.levelHistory||[];return h.length>0?h[h.length-1]:null }

// ── Feature Detection ───────────────────────────────────────────────────────

export function getLevelFeatures(cd, level) {
  if (!cd?.featuresPerLevel?.[level]) return []
  return cd.featuresPerLevel[level].map(f => typeof f === 'string' ? f : (f?.name || '')).filter(Boolean)
}
export function getLevelFeatureObjects(cd, level) {
  if (!cd?.featuresPerLevel?.[level]) return []
  return cd.featuresPerLevel[level].map(f => typeof f === 'string' ? { name: f, entries: [] } : f).filter(f => f.name)
}
export function isASILevel(cd, level) {
  return getLevelFeatures(cd, level).some(n => /ability score/i.test(n))
}
export function needsSubclassAtLevel(cd, ce, level) {
  return cd?.subclassLevel === level && !ce?.subclassId
}

// ── Max Spell Level ─────────────────────────────────────────────────────────

const MAX_SPELL_LEVEL_TABLE = {
  full: [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,9,9],
  half: [0,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5],
  '1/3':[0,0,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,3,4,4],
  pact: [1,1,2,2,3,3,4,4,5,5,5,5,5,5,5,5,5,5,5,5],
}
export function getMaxSpellLevel(prog, lvl) {
  // Normalize '1/2' → 'half' for backward compat with already-saved characters
  if (prog === '1/2') prog = 'half'
  const t = MAX_SPELL_LEVEL_TABLE[prog]
  return t ? (t[Math.min(lvl, 20) - 1] || 0) : 0
}

// ── Optional Feature Progression ────────────────────────────────────────────
// 5etools uses TWO formats:
//   Array:  progression: [0, 2, 2, 2, 3, 3, 4, ...]  (index 0 = level 1)
//   Object: progression: {"3": 2, "10": 3, "17": 4}   (key = class level)

function getProgTotal(progression, level) {
  if (!progression) return 0
  if (Array.isArray(progression)) {
    // Array: 0-indexed, index 0 = class level 1
    return (level >= 1 && level <= progression.length) ? (progression[level - 1] || 0) : 0
  }
  // Object: find highest key <= level
  let total = 0
  for (const [lv, count] of Object.entries(progression)) {
    if (parseInt(lv) <= level) total = count
  }
  return total
}

/**
 * Compute optional feature gains at a specific level.
 * Checks both class-level and subclass-level progressions.
 */
export function computeOptionalFeatureGains(classData, subclassData, level) {
  const results = []
  const allProgs = [
    ...(classData?.optionalfeatureProgression || []),
    ...(subclassData?.optionalfeatureProgression || []),
  ]
  for (const prog of allProgs) {
    if (!prog.progression) continue
    const totalAtLevel = getProgTotal(prog.progression, level)
    const totalAtPrev  = getProgTotal(prog.progression, level - 1)
    const newCount = totalAtLevel - totalAtPrev
    if (totalAtLevel > 0) {
      results.push({
        name: prog.name || 'Optional Feature',
        featureTypes: prog.featureType || [],
        newCount,
        totalCount: totalAtLevel,
        canReplace: newCount > 0, // Can swap old ones when gaining new picks
      })
    }
  }
  return results
}

/** Get all optional feature choices already made by this class entry */
export function getExistingOptionalFeatures(classEntry) {
  const result = []
  for (const [lv, choices] of Object.entries(classEntry?.levelChoices || {})) {
    for (const feat of (choices.optionalFeatures || [])) {
      result.push({ ...feat, level: parseInt(lv) })
    }
  }
  return result
}

// ── Prerequisite Checking ───────────────────────────────────────────────────

/**
 * Parse a 5etools prerequisite array into readable strings.
 * Returns: string[]
 */
export function formatPrerequisites(prerequisite) {
  if (!Array.isArray(prerequisite) || prerequisite.length === 0) return []
  const parts = []
  for (const prereq of prerequisite) {
    if (prereq.level) {
      const lvl = prereq.level.level || prereq.level
      const cls = prereq.level.class?.name || ''
      parts.push(cls ? `${cls} Level ${lvl}` : `Level ${lvl}`)
    }
    if (prereq.spell) {
      for (const sp of prereq.spell) {
        const name = sp.replace(/#c$/, '').split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
        parts.push(`Cantrip: ${name}`)
      }
    }
    if (prereq.pact) {
      parts.push(`Pact of the ${prereq.pact}`)
    }
    if (prereq.item) {
      for (const item of prereq.item) {
        parts.push(typeof item === 'string' ? item : item.name || '')
      }
    }
    if (prereq.feature) {
      for (const feat of prereq.feature) {
        parts.push(`Feature: ${typeof feat === 'string' ? feat : feat.name || ''}`)
      }
    }
  }
  return parts.filter(Boolean)
}

/**
 * Check if a character meets the prerequisites for an optional feature.
 * classLevel = the class level AFTER this level-up.
 */
export function meetsPrerequisites(prereqs, character, classId, classLevel) {
  if (!Array.isArray(prereqs) || prereqs.length === 0) return true
  // Each top-level entry in the array is ANDed
  for (const prereq of prereqs) {
    if (prereq.level) {
      const reqLevel = prereq.level.level || prereq.level
      const reqClass = prereq.level.class?.name
      if (reqClass && reqClass !== classId) return false
      if (classLevel < reqLevel) return false
    }
    if (prereq.spell) {
      const known = getAllKnownSpellNames(character)
      for (const sp of prereq.spell) {
        const name = sp.replace(/#c$/, '').split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
        if (!known.has(name)) return false
      }
    }
    if (prereq.pact) {
      // Check if character has chosen this pact boon
      const ce = character.classes.find(c => c.classId === classId)
      const existing = getExistingOptionalFeatures(ce || {})
      const hasPact = existing.some(f => f.name === `Pact of the ${prereq.pact}`)
      // Also check current picks (in case choosing pact boon at same level)
      if (!hasPact) return false
    }
  }
  return true
}

// ── Level-Up Info ───────────────────────────────────────────────────────────

export function computeLevelUpInfo(classData, classEntry, character, isMulticlass = false) {
  const currentLevel = classEntry?.level || 0
  const nextLevel    = isMulticlass ? 1 : currentLevel + 1
  const totalLevel   = getTotalLevel(character)
  const hpAverage    = Math.floor(classData.hitDie / 2) + 1
  const effCasterProg = classEntry?.casterProgression || classData.casterProgression
  const prevMaxSpell = currentLevel > 0 && effCasterProg ? getMaxSpellLevel(effCasterProg, currentLevel) : 0
  const nextMaxSpell = effCasterProg ? getMaxSpellLevel(effCasterProg, nextLevel) : 0
  const unlocksNewSpellLevel = nextMaxSpell > prevMaxSpell
  const subclassData = classEntry?.subclassId
    ? (classData.subclasses || []).find(s => s.name === classEntry.subclassId) : null
  const optionalFeatureGains = computeOptionalFeatureGains(classData, subclassData, nextLevel)

  const info = {
    classId: classData.id, className: classData.name || classData.id,
    currentLevel, nextLevel, totalLevelAfter: totalLevel + 1,
    hitDie: classData.hitDie, source: classData.source, isMulticlass,
    features: getLevelFeatures(classData, nextLevel),
    featureObjects: getLevelFeatureObjects(classData, nextLevel),
    hasASI: isASILevel(classData, nextLevel),
    needsSubclass: isMulticlass ? classData.subclassLevel === 1
      : needsSubclassAtLevel(classData, classEntry, nextLevel),
    subclasses: classData.subclasses || [],
    subclassTitle: classData.subclassTitle || 'Subclass',
    hpAverage, hpIsMax: totalLevel === 0,
    newCantrips: 0, newSpellsKnown: 0, newSpellbookSpells: 0,
    maxSpellLevel: nextMaxSpell, prevMaxSpellLevel: prevMaxSpell,
    unlocksNewSpellLevel,
    casterProgression: classEntry?.casterProgression || classData.casterProgression,
    spellcastingAbility: classEntry?.spellcastingAbility || classData.spellcastingAbility,
    canSwapSpell: false, schoolRestriction: null,
    optionalFeatureGains,
  }

  const castAbility = classEntry?.spellcastingAbility || classData.spellcastingAbility
  const subName = classEntry?.subclassId || classEntry?.subclassName || null
  if (castAbility) {
    const prevInfo = currentLevel > 0 ? getSpellcastingInfo(classData.id, currentLevel, 0, subName) : null
    const currInfo = getSpellcastingInfo(classData.id, nextLevel, 0, subName)
    if (currInfo) {
      info.newCantrips = Math.max(0, (currInfo.cantripsKnown || 0) - (prevInfo?.cantripsKnown || 0))
      if (currInfo.type === 'known')
        info.newSpellsKnown = Math.max(0, (currInfo.spellsKnown || 0) - (prevInfo?.spellsKnown || 0))
      if (currInfo.hasSpellbook)
        info.newSpellbookSpells = nextLevel === 1 ? (currInfo.spellbookStart || 6) : 2
      if (currInfo.canSwapSpell && prevInfo) info.canSwapSpell = true
      if (currInfo.schoolRestriction) info.schoolRestriction = currInfo.schoolRestriction
    }
  }
  return info
}

// ── Multiclass ──────────────────────────────────────────────────────────────

export function parseMulticlassRequirements(raw) {
  const r = raw?.multiclassing?.requirements
  return (Array.isArray(r) && r.length > 0) ? r[0] : null
}
export function checkMulticlassEligibility(character, targetRaw, currentRawMap, scores) {
  if (getTotalLevel(character) >= 20) return { eligible: false, reason: 'Max Level (20)' }
  if (character.classes.some(c => c.classId === targetRaw?.name)) return { eligible: false, reason: 'Klasse vorhanden' }
  const check = (reqs, label) => {
    if (!reqs) return null
    for (const [ab, min] of Object.entries(reqs))
      if ((scores[ab] || 0) < min) return { eligible: false, reason: `${ab.toUpperCase()} ${scores[ab]||0} < ${min} ${label}` }
    return null
  }
  const tFail = check(parseMulticlassRequirements(targetRaw), '')
  if (tFail) return tFail
  for (const cls of character.classes) {
    const f = check(parseMulticlassRequirements(currentRawMap[cls.classId]), `(${cls.classId})`)
    if (f) return f
  }
  return { eligible: true, reason: '' }
}

// ── Apply Level-Up ──────────────────────────────────────────────────────────

export function applyLevelUp(character, {
  classIndex, classData, hpValue,
  subclassId = null, asiChoice = null,
  newCantrips = [], newSpells = [], swappedSpell = null,
  optionalFeatures = [], optFeatureSpells = {},
  classFeatureChoices = {},
  preparedSpellPool = null, newChoices = {},
}) {
  const snapshot = createSnapshot(character)
  const next = structuredClone(character)
  let cls, level
  if (classIndex >= 0) {
    cls = next.classes[classIndex]; cls.level += 1; level = cls.level
    cls.hpRolls[level] = hpValue
    if (!cls.levelChoices) cls.levelChoices = {}
    cls.levelChoices[level] = {}
    if (subclassId) { cls.subclassId = subclassId; cls.subclassName = subclassId }
  } else {
    level = 1
    cls = {
      classId: classData.id, subclassId: subclassId || null, subclassName: subclassId || null,
      source: classData.source, level: 1, hitDie: classData.hitDie,
      isSpellcaster: !!classData.spellcastingAbility, spellcastingAbility: classData.spellcastingAbility,
      casterProgression: classData.casterProgression, subclassTitle: classData.subclassTitle,
      subclassLevel: classData.subclassLevel, proficiency: classData.proficiency || [],
      startingProficiencies: classData.startingProficiencies || {},
      isMulticlass: true, levelChoices: { 1: {} }, hpRolls: { 1: hpValue },
      preparedSpells: [], knownSpells: [],
    }
    next.classes.push(cls)
  }
  if (asiChoice?.type === 'asi') {
    cls.levelChoices[level] = { ...cls.levelChoices[level], type: 'asi', improvements: asiChoice.improvements || {} }
  } else if (asiChoice?.type === 'feat' && asiChoice.featEntry) {
    cls.levelChoices[level] = { ...cls.levelChoices[level], type: 'feat', featId: asiChoice.featEntry.featId || asiChoice.featEntry.name }
    next.feats = [...(next.feats || []), {
      featId: asiChoice.featEntry.featId || asiChoice.featEntry.name,
      source: asiChoice.featEntry.source || '', chosenAt: { classId: cls.classId, level },
      _isOriginFeat: false, abilityBonus: asiChoice.featEntry.abilityBonus || {},
      choices: asiChoice.featEntry.choices || {}, additionalSpells: asiChoice.featEntry.additionalSpells || [],
    }]
  }
  if (newCantrips.length > 0) cls.levelChoices[level].cantrips = [...(cls.levelChoices[level].cantrips || []), ...newCantrips]
  if (newSpells.length > 0) {
    cls.levelChoices[level].knownSpells = [...(cls.levelChoices[level].knownSpells || []), ...newSpells]
    cls.knownSpells = [...(cls.knownSpells || []), ...newSpells]
  }
  if (swappedSpell?.oldSpell && swappedSpell?.newSpell) {
    cls.levelChoices[level].swappedSpell = swappedSpell
    cls.knownSpells = (cls.knownSpells || []).filter(n => n !== swappedSpell.oldSpell)
    cls.knownSpells.push(swappedSpell.newSpell)
    for (const lc of Object.values(cls.levelChoices)) {
      if (lc.knownSpells?.includes(swappedSpell.oldSpell))
        lc.knownSpells = lc.knownSpells.map(n => n === swappedSpell.oldSpell ? swappedSpell.newSpell : n)
      if (lc.startingSpells?.includes(swappedSpell.oldSpell))
        lc.startingSpells = lc.startingSpells.map(n => n === swappedSpell.oldSpell ? swappedSpell.newSpell : n)
    }
  }
  if (optionalFeatures.length > 0) cls.levelChoices[level].optionalFeatures = optionalFeatures
  // Optional feature spell choices (Blessed Warrior cantrips, Pact of the Tome cantrips, etc.)
  if (Object.keys(optFeatureSpells).length > 0) cls.levelChoices[level].optFeatureSpells = optFeatureSpells
  // Class feature choices (Ranger Favored Enemy/Terrain, etc.)
  // Stored both in levelChoices for history/undo AND flat on cls for active gameplay
  if (classFeatureChoices && Object.keys(classFeatureChoices).length > 0) {
    const cleaned = {}
    for (const [k, v] of Object.entries(classFeatureChoices)) if (v) cleaned[k] = v
    if (Object.keys(cleaned).length > 0) {
      cls.levelChoices[level].classFeatureChoices = cleaned
      // Also flatten to cls root for easy access (favoredEnemies[], favoredTerrains[])
      if (cleaned.favoredEnemy) {
        cls.favoredEnemies = [...(cls.favoredEnemies || []), cleaned.favoredEnemy]
      }
      if (cleaned.favoredTerrain) {
        cls.favoredTerrains = [...(cls.favoredTerrains || []), cleaned.favoredTerrain]
      }
    }
  }
  // Prepared caster: store full preparable spell pool for Foundry export
  if (preparedSpellPool && preparedSpellPool.length > 0) cls.preparedSpells = preparedSpellPool
  if (Object.keys(newChoices).length > 0) next.choices = { ...(next.choices || {}), ...newChoices }
  if (!next.levelHistory) next.levelHistory = []
  next.levelHistory.push({
    totalLevel: getTotalLevel(next), classId: cls.classId,
    classLevel: cls.level, timestamp: new Date().toISOString(), snapshot,
  })
  return next
}

// ── Known Spell Names ───────────────────────────────────────────────────────

export function getAllKnownSpellNames(character) {
  const names = new Set()
  for (const cls of (character.classes || [])) {
    for (const lc of Object.values(cls.levelChoices || {})) {
      for (const s of (lc.cantrips || []))       names.add(s)
      for (const s of (lc.startingSpells || []))  names.add(s)
      for (const s of (lc.knownSpells || []))     names.add(s)
      // Optional feature spells (Blessed Warrior, Pact of the Tome, etc.)
      for (const spArr of Object.values(lc.optFeatureSpells || {})) {
        for (const s of (spArr || [])) names.add(s)
      }
    }
    for (const s of (cls.knownSpells || []))    names.add(s)
    for (const s of (cls.preparedSpells || [])) names.add(s)
  }
  for (const s of (character.species?.raceSpells || []))    names.add(typeof s === 'string' ? s : s?.name)
  for (const s of (character.species?.subraceSpells || [])) names.add(typeof s === 'string' ? s : s?.name)
  return names
}
