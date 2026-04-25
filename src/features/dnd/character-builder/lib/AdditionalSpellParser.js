// Parses the 5etools additionalSpells format into structured data
// Used for racial spells, feat spells, etc.

export const SCHOOL_NAMES = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
  V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation',
}

/**
 * 5etools additionalSpells format:
 * [{
 *   innate:   { "1": { daily: { "1": [spellEntry] }, will: [spellEntry] } },
 *   prepared: { "1": [spellEntry] },
 *   known:    { "1": [spellEntry] },
 *   ritual:   { "1": [spellEntry] },
 *   ability:  "cha" | "choose"
 * }]
 *
 * spellEntry can be:
 *   - "fireball"               → fixed spell
 *   - "fireball|phb"           → fixed spell with source
 *   - "choose|school=D,E;level=1,2"   → string-format choice
 *   - { choose: "school=D;level=1" }  → object-format choice
 *   - { choose: { from: ["..."], count: 1 } }
 *
 * Returns: {
 *   fixed:   [{ name, level, grantType, uses }]
 *   choices: [{ count, grantType, uses, levels, schools, fromClass, fromList }]
 *   ability: string|null
 * }
 */
export function parseAdditionalSpells(additionalSpells) {
  if (!additionalSpells || additionalSpells.length === 0) return null

  const result = { fixed: [], choices: [], ability: null }

  for (const entry of additionalSpells) {
    if (entry.ability && entry.ability !== 'choose') result.ability = entry.ability

    for (const grantType of ['innate', 'prepared', 'known', 'ritual']) {
      const typeData = entry[grantType]
      if (!typeData) continue

      for (const [levelStr, levelData] of Object.entries(typeData)) {
        const spellLevel = parseInt(levelStr) || 0
        const flatEntries = flattenLevelData(levelData)

        for (const { raw, uses } of flatEntries) {
          if (!raw) continue

          if (typeof raw === 'string') {
            const trimmed = raw.trim()
            if (trimmed.startsWith('choose')) {
              result.choices.push(parseChooseString(trimmed, spellLevel, grantType, uses))
            } else {
              const name = toTitleCase(trimmed.split('|')[0].trim())
              if (name) result.fixed.push({ name, level: spellLevel, grantType, uses })
            }
          } else if (raw && typeof raw === 'object') {
            if (raw.choose !== undefined) {
              result.choices.push(parseChooseValue(raw.choose, spellLevel, grantType, uses))
            }
          }
        }
      }
    }
  }

  return result
}

// Flatten innate/prepared/known levelData (array or {daily,will,rest} object)
function flattenLevelData(levelData) {
  if (Array.isArray(levelData)) {
    return levelData.map(raw => ({ raw, uses: null }))
  }
  if (typeof levelData !== 'object' || levelData === null) return []

  const out = []
  if (levelData.will) {
    for (const raw of levelData.will) out.push({ raw, uses: 'at will' })
  }
  if (levelData.daily) {
    for (const [n, spells] of Object.entries(levelData.daily)) {
      for (const raw of spells) out.push({ raw, uses: `${n}/day` })
    }
  }
  if (levelData.rest) {
    for (const [n, spells] of Object.entries(levelData.rest)) {
      for (const raw of spells) out.push({ raw, uses: `${n}/rest` })
    }
  }
  return out
}

// Parse "choose|school=D,E;level=1,2" or "choose" style strings
function parseChooseString(str, level, grantType, uses) {
  const filter = { level, grantType, uses, count: 1, levels: null, schools: null, fromClass: null, fromList: null }
  const params = str.replace(/^choose\|?/, '').split(';')
  for (const part of params) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const k = part.slice(0, eqIdx).trim()
    const v = part.slice(eqIdx + 1).trim()
    if (!k || !v) continue
    if (k === 'level') filter.levels = v.split(',').map(Number).filter(n => !isNaN(n))
    else if (k === 'school') filter.schools = v.split(',').map(s => s.trim())
    else if (k === 'class') filter.fromClass = v.split('|')[0].trim()
    else if (k === 'count') filter.count = parseInt(v) || 1
  }
  if (!filter.levels && filter.level != null) filter.levels = [filter.level]
  return filter
}

// Parse choose as object: { from, count, school, level } or string
function parseChooseValue(choose, level, grantType, uses) {
  if (typeof choose === 'string') return parseChooseString(choose, level, grantType, uses)
  const filter = { level, grantType, uses, count: 1, levels: null, schools: null, fromClass: null, fromList: null }
  if (!choose || typeof choose !== 'object') return filter
  if (choose.count) filter.count = choose.count
  if (choose.from && Array.isArray(choose.from)) {
    filter.fromList = choose.from.map(f =>
      typeof f === 'string' ? toTitleCase(f.split('|')[0]) : f?.name || ''
    ).filter(Boolean)
  }
  if (choose.school) filter.schools = Array.isArray(choose.school) ? choose.school : [choose.school]
  if (choose.level !== undefined) {
    filter.levels = Array.isArray(choose.level) ? choose.level : [choose.level]
  }
  if (choose.class) filter.fromClass = typeof choose.class === 'string' ? choose.class : choose.class?.name
  if (!filter.levels && filter.level != null) filter.levels = [filter.level]
  return filter
}

/**
 * Filter a spell list according to a choice filter object.
 * classSpellMap: Map<className, Set<lowercaseSpellName>> for class-filtered choices
 */
export function filterSpellsForChoice(allSpells, choiceFilter, classSpellMap) {
  let candidates = allSpells

  // Level filter
  if (choiceFilter.levels && choiceFilter.levels.length > 0) {
    candidates = candidates.filter(s => choiceFilter.levels.includes(s.level))
  } else if (choiceFilter.level != null) {
    candidates = candidates.filter(s => s.level === choiceFilter.level)
  }

  // School filter
  if (choiceFilter.schools && choiceFilter.schools.length > 0) {
    candidates = candidates.filter(s => choiceFilter.schools.includes(s.school))
  }

  // Class filter (optional, use classSpellMap if provided)
  if (choiceFilter.fromClass && classSpellMap) {
    const classNames = classSpellMap.get(choiceFilter.fromClass.toLowerCase())
    if (classNames) {
      candidates = candidates.filter(s => classNames.has(s.name.toLowerCase()))
    }
  }

  // Specific list filter
  if (choiceFilter.fromList && choiceFilter.fromList.length > 0) {
    const set = new Set(choiceFilter.fromList.map(n => n.toLowerCase()))
    candidates = candidates.filter(s => set.has(s.name.toLowerCase()))
  }

  return candidates
}

function toTitleCase(str) {
  if (!str) return ''
  return str.replace(/\b\w/g, c => c.toUpperCase())
}
