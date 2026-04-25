// lib/featParser.js
// Parses 5etools feat proficiency grant formats into structured choice descriptors.
// Generic — works for any feat; used by dataLoader, Step6, and Step7Proficiencies.

export const ARTISAN_TOOLS = [
  "alchemist's supplies", "brewer's supplies", "calligrapher's supplies",
  "carpenter's tools", "cartographer's tools", "cobbler's tools",
  "cook's utensils", "glassblower's tools", "jeweler's tools",
  "leatherworker's tools", "mason's tools", "painter's supplies",
  "potter's tools", "smith's tools", "tinker's tools", "weaver's tools",
  "woodcarver's tools",
]

export const MUSICAL_INSTRUMENTS = [
  "bagpipes", "drum", "dulcimer", "flute", "lute", "lyre",
  "horn", "pan flute", "shawm", "viol",
]

/**
 * Parses skillProficiencies from 5etools format.
 * Returns { fixed: string[], choice: { count, from: string[] } | null }
 */
export function parseFeatSkillProfs(skillProficiencies = []) {
  const fixed = []
  let choice = null
  for (const entry of skillProficiencies) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (key === 'choose') {
        choice = {
          count: val.count || 1,
          from: (val.from || []).map(normalizeSkill).filter(Boolean),
        }
      } else if (val === true) {
        fixed.push(normalizeSkill(key))
      }
    }
  }
  return { fixed, choice }
}

/**
 * Parses toolProficiencies from 5etools format.
 * Returns { fixed: string[], choice: { count, from: string[] } | null }
 */
export function parseFeatToolProfs(toolProficiencies = []) {
  const fixed = []
  let choice = null
  for (const entry of toolProficiencies) {
    if (!entry || typeof entry !== 'object') continue
    // anyArtisansTool: N
    if (typeof entry.anyArtisansTool === 'number') {
      choice = { count: entry.anyArtisansTool, from: ARTISAN_TOOLS }
      continue
    }
    // anyMusicalInstrument: N
    if (typeof entry.anyMusicalInstrument === 'number') {
      choice = { count: entry.anyMusicalInstrument, from: MUSICAL_INSTRUMENTS }
      continue
    }
    // any: N  (any tool)
    if (typeof entry.any === 'number') {
      choice = { count: entry.any, from: [] } // empty = any tool
      continue
    }
    for (const [key, val] of Object.entries(entry)) {
      if (key === 'choose' && typeof val === 'object') {
        choice = {
          count: val.count || 1,
          from: val.from || [],
        }
      } else if (val === true) {
        fixed.push(key)
      }
    }
  }
  return { fixed, choice }
}

/**
 * Parses weaponProficiencies from 5etools format.
 * Returns { fixed: string[], choice: { count, from: string[], fromFilter?: string } | null }
 */
export function parseFeatWeaponProfs(weaponProficiencies = []) {
  const fixed = []
  let choice = null
  for (const entry of weaponProficiencies) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (key === 'choose' && typeof val === 'object') {
        choice = {
          count: val.count || 1,
          from: val.from || [],
          fromFilter: val.fromFilter || null,
        }
      } else if (val === true) {
        fixed.push(key)
      }
    }
  }
  return { fixed, choice }
}

/**
 * Parses armorProficiencies from 5etools format.
 * Returns { fixed: string[], choice: null } — armor profs are currently always fixed.
 */
export function parseFeatArmorProfs(armorProficiencies = []) {
  const fixed = []
  for (const entry of armorProficiencies) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (val === true) fixed.push(key)
    }
  }
  return { fixed, choice: null }
}

/**
 * Master parser — returns all proficiency grants for a feat as a structured object.
 * Input: the feat object as returned by loadFeatList.
 *
 * Returns:
 * {
 *   skills:  { fixed: string[], choice: {count, from}|null },
 *   tools:   { fixed: string[], choice: {count, from}|null },
 *   weapons: { fixed: string[], choice: {count, from, fromFilter?}|null },
 *   armor:   { fixed: string[], choice: null },
 *   hasAnyChoice: boolean,   // true if the user needs to pick anything
 * }
 */
export function parseFeatProficiencies(feat) {
  const skills  = parseFeatSkillProfs(feat.skillProficiencies)
  const tools   = parseFeatToolProfs(feat.toolProficiencies)
  const weapons = parseFeatWeaponProfs(feat.weaponProficiencies)
  const armor   = parseFeatArmorProfs(feat.armorProficiencies)

  return {
    skills,
    tools,
    weapons,
    armor,
    hasAnyChoice: !!(skills.choice || tools.choice || weapons.choice),
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function normalizeSkill(raw) {
  if (!raw) return ''
  // Convert "sleight of hand" → "sleightOfHand"
  return raw.trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase())
}