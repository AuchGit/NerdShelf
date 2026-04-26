// lib/choiceParser.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure functions: convert 5etools data → unified ChoiceDescriptor[]
// No UI, no React imports, no side effects.
//
// ChoiceDescriptor shape:
// {
//   id:           string,            — unique key → character.choices[id]
//   source:       string,            — 'feat'|'race'|'subrace'|'background'|'class'
//   sourceId:     string,            — normalized entity id (e.g. 'war_caster')
//   type:         string,            — 'skill'|'tool'|'language'|'weapon'|'armor'
//                                       'spell'|'optfeature'|'ability'|'color'|'feat'|'variant'
//   label:        string,            — human-readable prompt
//   count:        number,            — how many options to pick
//   options:      ChoiceOption[]|null,   null = dynamic (needs spell list / feat list)
//   filter:       object|null,           for dynamic choices
//   required:     boolean,
//   // ── VARIANT GATING (NEW) ──────────────────────────────────────────────
//   variantId?:   string,            — id of the parent 'variant' descriptor
//   variantValue?: string,           — the option value that must be chosen to activate
//                                       this descriptor. undefined = always active.
// }
//
// ChoiceOption shape:
// { value: string, label: string, description?: string, icon?: string, meta?: object }
//
// character.choices shape:
// { [id: string]: string | string[] }
//   — single pick → string, multi pick → string[]
// ─────────────────────────────────────────────────────────────────────────────

// ── Static lookup tables ───────────────────────────────────────────────────────

const SKILLS_ALL = [
  'acrobatics','animalHandling','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine',
  'nature','perception','performance','persuasion','religion',
  'sleightOfHand','stealth','survival',
]

const SKILL_LABEL = {
  acrobatics:'Acrobatics', animalHandling:'Animal Handling', arcana:'Arcana',
  athletics:'Athletics',   deception:'Deception',            history:'History',
  insight:'Insight',       intimidation:'Intimidation',       investigation:'Investigation',
  medicine:'Medicine',     nature:'Nature',                  perception:'Perception',
  performance:'Performance', persuasion:'Persuasion',         religion:'Religion',
  sleightOfHand:'Sleight of Hand', stealth:'Stealth',        survival:'Survival',
}

const LANGUAGES_STANDARD = [
  'Common','Dwarvish','Elvish','Giant','Gnomish','Goblin',
  'Halfling','Orc','Abyssal','Celestial','Deep Speech',
  'Draconic','Infernal','Primordial','Sylvan','Undercommon',
]

const ARTISAN_TOOLS = [
  "alchemist's supplies","brewer's supplies","calligrapher's supplies",
  "carpenter's tools","cartographer's tools","cobbler's tools",
  "cook's utensils","glassblower's tools","jeweler's tools",
  "leatherworker's tools","mason's tools","painter's supplies",
  "potter's tools","smith's tools","tinker's tools","weaver's tools",
  "woodcarver's tools",
]

const MUSICAL_INSTRUMENTS = [
  "bagpipes","drum","dulcimer","flute","lute","lyre",
  "horn","pan flute","shawm","viol",
]

const GAMING_SETS = [
  "dice set","dragonchess set","playing card set","three-dragon ante set",
]

const SIMPLE_WEAPONS = [
  "club","dagger","greatclub","handaxe","javelin","light hammer",
  "mace","quarterstaff","sickle","spear",
  "light crossbow","dart","shortbow","sling",
]

const MARTIAL_WEAPONS = [
  "battleaxe","flail","glaive","greataxe","greatsword","halberd",
  "lance","longsword","maul","morningstar","pike","rapier",
  "scimitar","shortsword","trident","war pick","warhammer","whip",
  "blowgun","hand crossbow","heavy crossbow","longbow","net",
]

const ALL_WEAPONS = [...SIMPLE_WEAPONS, ...MARTIAL_WEAPONS]

const LANGUAGES_EXOTIC = [
  'Abyssal','Celestial','Deep Speech','Draconic',
  'Infernal','Primordial','Sylvan','Undercommon',
]

const LANGUAGES_ALL = [
  'Common','Dwarvish','Elvish','Giant','Gnomish','Goblin',
  'Halfling','Orc',...LANGUAGES_EXOTIC,
  'Aarakocra','Druidic','Gith','Gnoll','Kraul','Leonin',
  'Loxodon','Marquesian','Minotaur','Naush','Quori',
  'Thieves\' Cant','Vedalken','Zemnian',
]

// Per-dragon colours — used by the dynamic extractor below.
const DRAGON_COLOR_MAP = {
  black:'#555555',  blue:'#4466ff',   brass:'#cc8833',  bronze:'#aa8833',
  copper:'#aa6655', gold:'#ffaa00',   green:'#448844',  red:'#cc3333',
  silver:'#aaaaaa', white:'#dddddd',
  amethyst:'#9b59b6', crystal:'#85c1e9', emerald:'#2ecc71',
  sapphire:'#2980b9', topaz:'#f39c12',
}

/**
 * Dynamically extract Draconic Ancestry options from the race's entries table.
 */
function extractDraconicAncestryOptions(race) {
  for (const entry of (race.entries || [])) {
    if (typeof entry !== 'object' || !entry.name) continue
    if (!entry.name.toLowerCase().includes('ancestry')) continue
    for (const sub of (entry.entries || [])) {
      if (!sub || sub.type !== 'table' || !Array.isArray(sub.rows)) continue
      const opts = []
      for (const row of sub.rows) {
        const dragonName  = typeof row[0] === 'string' ? row[0].trim() : ''
        const damageType  = typeof row[1] === 'string' ? row[1].trim() : ''
        if (!dragonName) continue
        const key = dragonName.toLowerCase()
        opts.push({
          value: key,
          label: `${dragonName} (${damageType})`,
          meta:  { damage: damageType.toLowerCase(), color: DRAGON_COLOR_MAP[key] || '#888888' },
        })
      }
      if (opts.length > 0) return opts
    }
  }
  return []
}

export function getVersionCoveredKeys(versions) {
  const COVERABLE = [
    'skillProficiencies', 'toolProficiencies', 'languageProficiencies',
    'additionalSpells', 'ability', 'weaponProficiencies',
  ]
  const covered = new Set()
  for (const v of (versions || [])) {
    for (const key of COVERABLE) {
      if (Object.prototype.hasOwnProperty.call(v, key)) covered.add(key)
    }
  }
  return covered
}

// Feat feature-type codes → human labels
export const FEATURE_TYPE_LABEL = {
  'MM':   { label:'Metamagic',             emoji:'✦' },
  'FS:F': { label:'Fighting Style',        emoji:'⚔' },
  'FS:R': { label:'Fighting Style',        emoji:'⚔' },
  'FS:P': { label:'Fighting Style',        emoji:'⚔' },
  'EI':   { label:'Eldritch Invocation',   emoji:'✦' },
  'MV:B': { label:'Maneuver',              emoji:'★' },
  'AS:V3': { label:'Arcane Shot',          emoji:'➳' },
  'SG':   { label:"Sorcerer's Gift",       emoji:'★' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * FIX (NEW): Strip 5etools inline tag syntax before using strings as option values/labels.
 *
 * 5etools uses tags like {@item thieves' tools|phb} or {@skill Perception|phb}
 * in proficiency arrays. These must be stripped so options display as clean strings
 * and not as "@item thieves' tools|phb".
 *
 * Examples:
 *   '{@item thieves\' tools|phb}'  → "thieves' tools"
 *   '{@skill Perception}'          → "Perception"
 *   'plain string'                 → 'plain string'
 */
function stripTags(str) {
  if (!str) return ''
  return String(str)
    // {@tag inner text|optional source} → inner text
    .replace(/\{@[a-z]+\s+([^|}]+)(?:\|[^}]*)?\}/gi, (_, inner) => inner.trim())
    // Bare @tag reference without braces (edge case) → empty
    .replace(/@[a-z]+\s+\S+/gi, '')
    .trim()
}

/**
 * Safe string extractor for any 5etools value.
 */
function toStr(s) {
  if (s === null || s === undefined) return ''
  if (typeof s === 'object') return s.name || s.source || ''
  return String(s)
}

/**
 * Normalize to lowercase snake_case key.
 */
function norm(s) {
  return toStr(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function makeId(...parts) {
  return parts.map(norm).join(':')
}

function skillOptions(keys) {
  return (keys.length > 0 ? keys : SKILLS_ALL).map(v => ({
    value: v,
    label: SKILL_LABEL[v] || v,
  }))
}

/**
 * FIX: toOptions now strips 5etools inline tags AND uses toStr for object safety.
 *
 * Before: String(v) on an object → "[object Object]"
 *         No tag stripping → "{@item thieves' tools|phb}" shown raw
 * After:  stripTags(toStr(v)) → "thieves' tools"
 */
function toOptions(list) {
  return (list || []).flatMap(v => {
    const raw = stripTags(toStr(v))
    if (!raw) return []
    return [{ value: raw, label: raw }]
  })
}

function normalizeSkillKey(raw) {
  if (!raw) return ''
  const str = stripTags(toStr(raw))
  if (SKILL_LABEL[str]) return str
  const camel = str.trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase())
  return SKILL_LABEL[camel] ? camel : camel
}

function flattenLevelDataEntries(levelData) {
  if (Array.isArray(levelData)) return levelData.filter(x => x !== null && x !== undefined)
  if (!levelData || typeof levelData !== 'object') return []
  const out = []
  for (const key of ['will', 'daily', 'rest']) {
    const sub = levelData[key]
    if (!sub) continue
    if (Array.isArray(sub)) {
      out.push(...sub.filter(x => x !== null && x !== undefined))
    } else if (typeof sub === 'object') {
      for (const arr of Object.values(sub)) {
        if (Array.isArray(arr)) out.push(...arr.filter(x => x !== null && x !== undefined))
      }
    }
  }
  return out
}

// ── Shared sub-parsers ─────────────────────────────────────────────────────────

function parseSkillChoices(entries, source, sourceId, idxRef) {
  const out = []
  for (const entry of (entries || [])) {
    if (!entry) continue

    if (typeof entry.any === 'number' && entry.any > 0) {
      out.push({
        id:       makeId(source, sourceId, 'skill', idxRef.i++),
        source, sourceId,
        type:     'skill',
        label:    `Choose ${entry.any} skill${entry.any > 1 ? 's' : ''}`,
        count:    entry.any,
        options:  skillOptions(SKILLS_ALL),
        filter:   null,
        required: true,
      })
      continue
    }

    if (!entry.choose) continue
    const { count = 1, from = [] } = typeof entry.choose === 'object' ? entry.choose : {}
    out.push({
      id:       makeId(source, sourceId, 'skill', idxRef.i++),
      source, sourceId,
      type:     'skill',
      label:    `Choose ${count} skill${count > 1 ? 's' : ''}`,
      count,
      options:  skillOptions(from.map(normalizeSkillKey)),
      filter:   null,
      required: true,
    })
  }
  return out
}

function parseToolChoices(entries, source, sourceId, idxRef) {
  const out = []
  for (const entry of (entries || [])) {
    if (!entry) continue

    if (typeof entry.anyArtisansTool === 'number') {
      out.push({
        id:       makeId(source, sourceId, 'tool', idxRef.i++),
        source, sourceId,
        type:     'tool',
        label:    `Choose ${entry.anyArtisansTool} artisan tool${entry.anyArtisansTool > 1 ? 's' : ''}`,
        count:    entry.anyArtisansTool,
        options:  toOptions(ARTISAN_TOOLS),
        filter:   null, required: true,
      })
      continue
    }
    if (typeof entry.anyMusicalInstrument === 'number') {
      out.push({
        id:       makeId(source, sourceId, 'tool', idxRef.i++),
        source, sourceId,
        type:     'tool',
        label:    `Choose ${entry.anyMusicalInstrument} musical instrument${entry.anyMusicalInstrument > 1 ? 's' : ''}`,
        count:    entry.anyMusicalInstrument,
        options:  toOptions(MUSICAL_INSTRUMENTS),
        filter:   null, required: true,
      })
      continue
    }
    if (typeof entry.any === 'number') {
      out.push({
        id:       makeId(source, sourceId, 'tool', idxRef.i++),
        source, sourceId,
        type:     'tool',
        label:    `Choose ${entry.any} tool${entry.any > 1 ? 's' : ''}`,
        count:    entry.any,
        options:  toOptions([...ARTISAN_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS]),
        filter:   null, required: true,
      })
      continue
    }
    if (entry.choose) {
      const { count = 1, from = [] } = typeof entry.choose === 'object' ? entry.choose : { count: 1, from: [] }
      out.push({
        id:       makeId(source, sourceId, 'tool', idxRef.i++),
        source, sourceId,
        type:     'tool',
        label:    `Choose ${count} tool${count > 1 ? 's' : ''}`,
        count,
        // FIX: stripTags is applied inside toOptions, so @item refs in `from` are cleaned
        options:  from.length > 0 ? toOptions(from) : toOptions([...ARTISAN_TOOLS, ...MUSICAL_INSTRUMENTS]),
        filter:   null, required: true,
      })
    }
  }
  return out
}

function parseLanguageChoices(entries, source, sourceId, idxRef) {
  const out = []
  for (const entry of (entries || [])) {
    if (!entry) continue

    if (typeof entry.anyStandard === 'number' && entry.anyStandard > 0) {
      out.push({
        id:       makeId(source, sourceId, 'language', idxRef.i++),
        source, sourceId,
        type:     'language',
        label:    `Choose ${entry.anyStandard} language${entry.anyStandard > 1 ? 's' : ''}`,
        count:    entry.anyStandard,
        options:  toOptions(LANGUAGES_STANDARD),
        filter:   null, required: true,
      })
      continue
    }

    // FIX: handle {any: N} — e.g. Linguist feat has languageProficiencies: [{any: 3}]
    if (typeof entry.any === 'number' && entry.any > 0) {
      out.push({
        id:       makeId(source, sourceId, 'language', idxRef.i++),
        source, sourceId,
        type:     'language',
        label:    `Choose ${entry.any} language${entry.any > 1 ? 's' : ''}`,
        count:    entry.any,
        options:  toOptions(LANGUAGES_STANDARD),
        filter:   null, required: true,
      })
      continue
    }

    if (!entry.choose) continue
    const { count = 1, from = [], anyStandard, any } = entry.choose
    const list = (anyStandard || any) ? LANGUAGES_STANDARD : (from.length > 0 ? from : LANGUAGES_STANDARD)
    out.push({
      id:       makeId(source, sourceId, 'language', idxRef.i++),
      source, sourceId,
      type:     'language',
      label:    `Choose ${count} language${count > 1 ? 's' : ''}`,
      count,
      options:  toOptions(list),
      filter:   null, required: true,
    })
  }
  return out
}

function parseAbilityChoices(entries, source, sourceId, idxRef) {
  const out = []
  for (const entry of (entries || [])) {
    if (!entry?.choose) continue
    // 5.5e weighted format ({choose: {weighted: {from, weights}}}) is handled
    // directly in Step6AbilityScores as a dedicated picker — skip here.
    if (entry.choose.weighted) continue
    const { count = 1, from = [], amount = 1 } = entry.choose
    const keys = from.length > 0 ? from : ['str','dex','con','int','wis','cha']
    out.push({
      id:       makeId(source, sourceId, 'ability', idxRef.i++),
      source, sourceId,
      type:     'ability',
      label:    `Choose ${count} ability score${count > 1 ? 's' : ''} to increase by ${amount}`,
      count,
      options:  keys.map(a => {
        const s = toStr(a)
        return { value: s, label: s.toUpperCase(), meta: { amount } }
      }),
      filter:   null, required: true,
    })
  }
  return out
}

function parseSpellChoicesFromBlock(additionalSpells, source, sourceId, idxRef) {
  const out = []
  for (const spellBlock of (additionalSpells || [])) {
    if (!spellBlock || typeof spellBlock !== 'object') continue

    for (const grantType of ['innate','prepared','known','ritual']) {
      const typeData = spellBlock[grantType]
      if (!typeData) continue
      if (typeof typeData !== 'object' || Array.isArray(typeData)) continue

      for (const [lvlStr, lvlData] of Object.entries(typeData)) {
        const level = parseInt(lvlStr) || 0
        const entries = flattenLevelDataEntries(lvlData)
        for (const raw of entries) {
          if (typeof raw === 'string' && raw.trim().startsWith('choose')) {
            out.push({
              id:       makeId(source, sourceId, 'spell', idxRef.i++),
              source, sourceId,
              type:     'spell',
              label:    'Choose a spell',
              count:    1,
              options:  null,
              filter:   { chooseStr: raw.trim(), level, grantType },
              required: true,
            })
          } else if (raw && typeof raw === 'object' && raw.choose !== undefined) {
            const cnt = typeof raw.choose === 'object' ? (raw.choose.count || 1) : 1
            out.push({
              id:       makeId(source, sourceId, 'spell', idxRef.i++),
              source, sourceId,
              type:     'spell',
              label:    `Choose ${cnt} spell${cnt > 1 ? 's' : ''}`,
              count:    cnt,
              options:  null,
              filter:   { chooseObj: raw.choose, level, grantType },
              required: true,
            })
          }
        }
      }
    }
  }
  return out
}

// ── NEW: Variant sub-choice parser ─────────────────────────────────────────────
//
// Parses proficiency/ability choices that live INSIDE a variant option entry.
// Each returned descriptor is annotated with variantId + variantValue so that
// filterActiveDescriptors can suppress them unless that option was chosen.
//
// optionEntry  — one entry from sub.entries (an option the player can pick)
// variantDescId — the id of the parent 'variant' descriptor
// source / sourceId / idxRef — passed through to sub-parsers

function parseVariantSubChoices(optionEntry, variantDescId, source, sourceId, idxRef) {
  if (!optionEntry || typeof optionEntry !== 'object') return []
  const optValue = optionEntry.name || ''
  if (!optValue) return []

  const sub = []
  sub.push(...parseSkillChoices(optionEntry.skillProficiencies,    source, sourceId, idxRef))
  sub.push(...parseToolChoices(optionEntry.toolProficiencies,      source, sourceId, idxRef))
  sub.push(...parseLanguageChoices(optionEntry.languageProficiencies, source, sourceId, idxRef))
  sub.push(...parseAbilityChoices(optionEntry.ability,             source, sourceId, idxRef))
  sub.push(...parseSpellChoicesFromBlock(optionEntry.additionalSpells, source, sourceId, idxRef))

  // Annotate every sub-descriptor so filterActiveDescriptors knows when to hide them
  return sub.map(d => ({ ...d, variantId: variantDescId, variantValue: optValue }))
}

// ── NEW: _versions-aware variant parser ────────────────────────────────────────
//
// 5etools uses a `_versions` array on some races/subraces to describe mutually
// exclusive feature branches (e.g. "Skill Versatility" vs "Drow Magic").
// Each version entry declares which top-level properties it provides or nullifies:
//
//   { name: "Variant; Drow Descent; Drow Magic",  skillProficiencies: null }
//   { name: "Variant; Drow Descent; Skill Versatility", additionalSpells: null }
//
// Semantics:
//   key present, null     → this option provides nothing for that key  (use [])
//   key present, non-null → this option explicitly defines that key    (use version value)
//   key absent            → this option inherits the base entity value  (use entity[key])
//
// Using `_versions` as the authoritative source is the ONLY reliable way to
// associate descriptors with their correct exclusive option — the entries tree
// only contains human-readable text, not structured proficiency data.

/**
 * Return the set of top-level property keys managed by _versions.
 * These keys MUST NOT be parsed from the entity root — they are handled
 * per-version to enforce strict variant separation.
 */

/**
 * Parse an entity's _versions array into:
 *   1. A single 'variant' descriptor (the choose-1 picker shown in UI)
 *   2. Per-option gated sub-descriptors (each tagged variantId + variantValue)
 *
 * Only descriptors whose variantValue matches the currently chosen option are
 * active — enforced by filterActiveDescriptors at call sites.
 *
 * @param {object}  entity    — race or subrace object with _versions
 * @param {string}  source    — 'race' | 'subrace'
 * @param {string}  sourceId  — normalized entity id
 * @param {{ i: number }} idx — shared counter (mutated)
 * @returns {ChoiceDescriptor[]}
 */
function parseVersionedChoices(entity, source, sourceId, idx) {
  const versions = entity._versions
  if (!Array.isArray(versions) || versions.length === 0) return []

  // ── Resolve option labels ──────────────────────────────────────────────────
  // Prefer the inset block in entries (richer display text).
  // Fall back to extracting option names from _version.name suffixes.
  let variantLabel = 'Variant Feature'
  let optionEntries = []

  for (const topEntry of (entity.entries || [])) {
    if (!topEntry || typeof topEntry !== 'object') continue
    if (topEntry.type === 'inset' && Array.isArray(topEntry.entries)) {
      const named = topEntry.entries.filter(
        e => e && typeof e === 'object' && e.name && e.type === 'entries'
      )
      if (named.length >= 2) {
        variantLabel  = topEntry.name || variantLabel
        optionEntries = named
        break
      }
    }
  }

  if (optionEntries.length === 0) {
    // Fallback: derive from _version.name suffixes (convention: "Parent; OptionName")
    for (const v of versions) {
      const parts   = (v.name || '').split('; ')
      const optName = parts[parts.length - 1]
      if (optName) optionEntries.push({ name: optName, entries: [] })
    }
  }

  if (optionEntries.length === 0) return []

  const opts = optionEntries.map(o => ({
    value:       o.name,
    label:       o.name,
    description: typeof o.entries?.[0] === 'string' ? o.entries[0] : '',
  }))

  // ── Variant descriptor (the choose-1 picker) ──────────────────────────────
  const variantDescId = makeId(source, sourceId, 'variant', idx.i++)
  const descriptors = [{
    id:       variantDescId,
    source, sourceId,
    type:     'variant',
    mode:     'exclusive',
    label:    `Choose 1 option: ${variantLabel}`,
    count:    1,
    options:  opts,
    filter:   null,
    required: true,
  }]

  // ── Per-version gated sub-descriptors ─────────────────────────────────────
  const VARIANT_KEYS = [
    'skillProficiencies', 'toolProficiencies', 'languageProficiencies',
    'additionalSpells', 'ability',
  ]

  for (const version of versions) {
    // Extract option name: last "; "-delimited segment of version.name
    const parts   = (version.name || '').split('; ')
    const optName = parts[parts.length - 1]
    if (!optName) continue

    // Compute effective properties for this version
    const effective = {}
    for (const key of VARIANT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(version, key)) {
        // Explicitly set in this version: null → [] (option provides nothing here)
        effective[key] = version[key] ?? []
      } else {
        // Absent from this version: inherit the base entity value
        effective[key] = entity[key] ?? []
      }
    }

    const sub = [
      ...parseSkillChoices(effective.skillProficiencies,        source, sourceId, idx),
      ...parseToolChoices(effective.toolProficiencies,          source, sourceId, idx),
      ...parseLanguageChoices(effective.languageProficiencies,  source, sourceId, idx),
      ...parseAbilityChoices(effective.ability,                 source, sourceId, idx),
      ...parseSpellChoicesFromBlock(effective.additionalSpells, source, sourceId, idx),
    ]

    // Gate every sub-descriptor: active only when optName is chosen
    descriptors.push(...sub.map(d => ({ ...d, variantId: variantDescId, variantValue: optName })))
  }

  return descriptors
}

// ── Main parsers ───────────────────────────────────────────────────────────────

/**
 * Parse all choices from a feat object.
 * Returns ChoiceDescriptor[]
 */
export function parseFeatChoices(feat) {
  if (!feat) return []
  const sourceId = norm(feat.name)
  const descriptors = []
  const idx = { i: 0 }

  descriptors.push(...parseSkillChoices(feat.skillProficiencies, 'feat', sourceId, idx))
  descriptors.push(...parseToolChoices(feat.toolProficiencies, 'feat', sourceId, idx))
  descriptors.push(...parseLanguageChoices(feat.languageProficiencies, 'feat', sourceId, idx))

  // ── Weapon proficiency choices ─────────────────────────────────────────────
  // FIX: Resolve fromFilter into actual weapon options when `from` is empty.
  // Weapon Master has fromFilter: "type=martial weapon;mundane weapon|..." with
  // count:4 but no `from` list → previously produced options:null → "Loading…"
  for (const entry of (feat.weaponProficiencies || [])) {
    if (!entry?.choose) continue
    const { count = 1, from = [], fromFilter } = typeof entry.choose === 'object' ? entry.choose : {}
    let opts = from.length > 0 ? toOptions(from) : null

    // Resolve fromFilter to static weapon list when from is empty
    if (!opts && fromFilter) {
      const filterLower = (fromFilter || '').toLowerCase()
      const weaponList = []
      if (filterLower.includes('martial weapon')) weaponList.push(...MARTIAL_WEAPONS)
      if (filterLower.includes('simple weapon')) weaponList.push(...SIMPLE_WEAPONS)
      // Fallback: if filter didn't match known types, provide all weapons
      if (weaponList.length === 0) weaponList.push(...ALL_WEAPONS)
      opts = toOptions([...new Set(weaponList)])
    }

    descriptors.push({
      id:       makeId('feat', sourceId, 'weapon', idx.i++),
      source:   'feat', sourceId,
      type:     'weapon',
      label:    `Choose ${count} weapon proficienc${count > 1 ? 'ies' : 'y'}`,
      count,
      options:  opts,
      filter:   fromFilter ? { fromFilter } : null,
      required: true,
    })
  }

  descriptors.push(...parseAbilityChoices(feat.ability, 'feat', sourceId, idx))

  // ── Expertise choices (Skill Expert, Prodigy) ──────────────────────────────
  // 5etools format: expertise: [{ anyProficientSkill: N }]
  // This means "choose N skills you're already proficient in to gain expertise".
  // Options are dynamic (depend on character's current proficiencies) so we set
  // options:null and filter:{anyProficientSkill:true} — the UI layer resolves
  // available options at render time from the character's proficient skills.
  for (const entry of (feat.expertise || [])) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.anyProficientSkill === 'number') {
      descriptors.push({
        id:       makeId('feat', sourceId, 'expertise', idx.i++),
        source:   'feat', sourceId,
        type:     'expertise',
        label:    `Choose ${entry.anyProficientSkill} skill${entry.anyProficientSkill > 1 ? 's' : ''} for Expertise`,
        count:    entry.anyProficientSkill,
        options:  null,  // resolved dynamically from character's proficient skills
        filter:   { anyProficientSkill: true },
        required: true,
      })
    }
  }

  for (const prog of (feat.optionalfeatureProgression || [])) {
    const types  = Array.isArray(prog.featureType) ? prog.featureType : [prog.featureType].filter(Boolean)
    const count  = prog.progression?.['*'] ?? prog.progression?.[1] ?? 1
    const info   = types.map(c => FEATURE_TYPE_LABEL[c]).find(Boolean) || { label: types.join('/'), emoji:'⭐' }
    descriptors.push({
      id:       makeId('feat', sourceId, 'optfeature', idx.i++),
      source:   'feat', sourceId,
      type:     'optfeature',
      label:    `Choose ${count} ${info.label}`,
      count,
      options:  null,
      filter:   { featureTypes: types, progressionName: prog.name },
      required: true,
    })
  }

  descriptors.push(...parseSpellChoicesFromBlock(feat.additionalSpells, 'feat', sourceId, idx))

  // ── Entry-text choice parsing (Elemental Adept etc.) ───────────────────────
  // Some feats define choices only in their entries text with no structured data.
  // Pattern: "choose one of the following damage types: acid, cold, fire, ..."
  // Parse these into proper choice descriptors so they appear in the UI.
  if (descriptors.length === 0 || !feat.skillProficiencies?.length) {
    for (const entry of (feat.entries || [])) {
      if (typeof entry !== 'string') continue
      const clean = stripTags(entry)
      // Match "choose one of the following <type>: item1, item2, ..., or itemN"
      const m = clean.match(/choose one of the following ([^:]+):\s*(.+)/i)
      if (!m) continue
      const categoryRaw = m[1].trim().toLowerCase()
      const itemsRaw = m[2]
        .replace(/\.$/, '')
        .split(/,\s*(?:or\s+)?/)
        .map(s => s.replace(/^or\s+/i, '').trim())
        .filter(Boolean)
      if (itemsRaw.length < 2) continue
      // Avoid duplicating if a structured field already covers this
      const category = categoryRaw.includes('damage') ? 'damageType' : categoryRaw.replace(/s$/, '')
      const alreadyCovered = descriptors.some(d =>
        d.type === category || (d.type === 'variant' && d.options?.length === itemsRaw.length)
      )
      if (alreadyCovered) continue
      descriptors.push({
        id:       makeId('feat', sourceId, category, idx.i++),
        source:   'feat', sourceId,
        type:     'variant',    // reuse variant type for single-pick from list
        mode:     'exclusive',
        label:    `Choose 1 ${m[1].trim()}`,
        count:    1,
        options:  itemsRaw.map(v => ({
          value: v.toLowerCase(),
          label: v.charAt(0).toUpperCase() + v.slice(1),
        })),
        filter:   null,
        required: true,
      })
      break  // only parse the first match per feat
    }
  }

  return descriptors
}

/**
 * Extract structured feature entries from a feat for UI rendering.
 * Recursively walks the entries tree and collects named feature blocks.
 *
 * Returns: Array<{ name: string, description: string }>
 *
 * Example: Gift of the Chromatic Dragon → [
 *   { name: "Chromatic Infusion", description: "As a bonus action…" },
 *   { name: "Reactive Resistance", description: "When you take damage…" },
 * ]
 *
 * Also handles Elemental Adept-style feats (no sub-features, just text entries).
 */
export function parseFeatEntries(feat) {
  if (!feat?.entries) return []
  const features = []

  function walk(entries) {
    for (const entry of (entries || [])) {
      if (typeof entry === 'string') continue
      if (!entry || typeof entry !== 'object') continue

      // Named item inside a list (e.g. Gift of the Chromatic Dragon)
      if (entry.type === 'item' && entry.name) {
        const desc = (entry.entries || [])
          .map(e => typeof e === 'string' ? stripTags(e) : '')
          .filter(Boolean)
          .join(' ')
        features.push({ name: entry.name, description: desc })
        continue
      }

      // Named entries block (e.g. Strike of the Giants variants)
      if (entry.type === 'entries' && entry.name) {
        const desc = (entry.entries || [])
          .map(e => typeof e === 'string' ? stripTags(e) : '')
          .filter(Boolean)
          .join(' ')
        features.push({ name: entry.name, description: desc })
        continue
      }

      // Recurse into lists and nested entries
      if (entry.type === 'list' && entry.items) {
        walk(entry.items)
      }
      if (entry.entries) {
        walk(entry.entries)
      }
    }
  }

  walk(feat.entries)
  return features
}

/**
 * Extract fixed (non-choice) proficiencies granted by a feat.
 * Returns: { armor: string[], weapons: string[], tools: string[], skills: string[], languages: string[] }
 */
export function parseFeatFixedProficiencies(feat) {
  if (!feat) return { armor: [], weapons: [], tools: [], skills: [], languages: [] }

  const armor = []
  for (const entry of (feat.armorProficiencies || [])) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (val === true) armor.push(key)
    }
  }

  const weapons = []
  for (const entry of (feat.weaponProficiencies || [])) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (val === true) weapons.push(key)
    }
  }

  const tools = []
  for (const entry of (feat.toolProficiencies || [])) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (key !== 'choose' && key !== 'any' && key !== 'anyArtisansTool' && key !== 'anyMusicalInstrument' && val === true) {
        tools.push(stripTags(key))
      }
    }
  }

  const skills = []
  for (const entry of (feat.skillProficiencies || [])) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (key !== 'choose' && key !== 'any' && val === true) skills.push(key)
    }
  }

  const languages = []
  for (const entry of (feat.languageProficiencies || [])) {
    if (!entry || typeof entry !== 'object') continue
    for (const [key, val] of Object.entries(entry)) {
      if (key !== 'choose' && key !== 'any' && key !== 'anyStandard' && val === true) languages.push(key)
    }
  }

  return { armor, weapons, tools, skills, languages }
}

/**
 * Extract fixed (auto-granted) spells from a feat's additionalSpells.
 * Returns: Array<{ name: string, grantType: string, level: number }>
 */
export function parseFeatFixedSpells(feat) {
  if (!feat?.additionalSpells?.length) return []
  const spells = []

  for (const block of feat.additionalSpells) {
    if (!block || typeof block !== 'object') continue
    for (const grantType of ['innate', 'known', 'prepared', 'ritual']) {
      const typeData = block[grantType]
      if (!typeData || typeof typeData !== 'object' || Array.isArray(typeData)) continue
      for (const [lvlStr, lvlData] of Object.entries(typeData)) {
        const level = parseInt(lvlStr) || 0
        const entries = flattenLevelDataEntries(lvlData)
        for (const raw of entries) {
          if (typeof raw === 'string' && !raw.trim().startsWith('choose')) {
            const name = stripTags(raw).split('|')[0].replace(/\b\w/g, c => c.toUpperCase()).trim()
            if (name) spells.push({ name, grantType, level })
          }
        }
      }
    }
  }
  return spells
}

/**
 * Parse all choices from a race data object.
 * Returns ChoiceDescriptor[]
 *
 * FIX (_versions-aware variant gating):
 * When a race/subrace has a _versions array (e.g. Half-Elf variant features,
 * Aasimar, Shifter, Dragonborn variants), parseVersionedChoices is used to
 * associate each descriptor with its exclusive option using _versions as the
 * structural source of truth. Properties covered by _versions are NOT parsed
 * from the entity root — doing so was the root cause of both branches appearing.
 *
 * Legacy type:'options' scanning is preserved for races without _versions.
 * Use filterActiveDescriptors(descriptors, choices) at call sites.
 */
export function parseRaceChoices(race) {
  if (!race) return []
  const sourceId = norm(race.name)
  const descriptors = []
  const idx = { i: 0 }

  // ── Variant coverage guard ─────────────────────────────────────────────────
  // Keys present in _versions (even as null) are managed exclusively by
  // parseVersionedChoices. Parsing them here too would generate unconditional
  // descriptors for both branches — the root cause of the reported bug.
  const versionCoveredKeys = getVersionCoveredKeys(race._versions)

  if (!versionCoveredKeys.has('ability'))
    descriptors.push(...parseAbilityChoices(race.ability, 'race', sourceId, idx))
  if (!versionCoveredKeys.has('skillProficiencies'))
    descriptors.push(...parseSkillChoices(race.skillProficiencies, 'race', sourceId, idx))
  if (!versionCoveredKeys.has('languageProficiencies'))
    descriptors.push(...parseLanguageChoices(race.languageProficiencies, 'race', sourceId, idx))
  if (!versionCoveredKeys.has('toolProficiencies'))
    descriptors.push(...parseToolChoices(race.toolProficiencies, 'race', sourceId, idx))
  if (!versionCoveredKeys.has('additionalSpells'))
    descriptors.push(...parseSpellChoicesFromBlock(race.additionalSpells, 'race', sourceId, idx))

  // Dragonborn ancestry
  const ancestryOpts = extractDraconicAncestryOptions(race)
  if (ancestryOpts.length > 0) {
    descriptors.push({
      id:       makeId('race', sourceId, 'color', 0),
      source:   'race', sourceId,
      type:     'color',
      label:    'Choose Draconic Ancestry',
      count:    1,
      options:  ancestryOpts,
      filter:   null,
      required: true,
    })
  }

  // Feat choices (Variant Human, Lineage feats, etc.)
  for (const entry of (race.feats || [])) {
    if (!entry?.choose && !entry?.name) continue
    if (entry.choose) {
      descriptors.push({
        id:       makeId('race', sourceId, 'feat', idx.i++),
        source:   'race', sourceId,
        type:     'feat',
        label:    `Choose ${entry.choose.count || 1} feat`,
        count:    entry.choose.count || 1,
        options:  null,
        filter:   typeof entry.choose === 'object' ? entry.choose : null,
        required: true,
      })
    }
  }

  // ── Variant option blocks ───────────────────────────────────────────────────
  if (Array.isArray(race._versions) && race._versions.length > 0) {
    // _versions present → authoritative path.
    // Handles inset-style variant features that type:'options' never matches.
    // Each option's descriptors are strictly separated and gated by variantValue.
    descriptors.push(...parseVersionedChoices(race, 'race', sourceId, idx))
  } else {
    // Legacy path: scan entries for explicit type:'options' blocks.
    // Used by races that define variant choices inline without _versions.
    for (const entry of (race.entries || [])) {
      if (typeof entry !== 'object' || !entry.entries) continue
      for (const sub of (entry.entries || [])) {
        if (sub?.type !== 'options') continue
        if (!Array.isArray(sub.entries) || sub.entries.length === 0) continue

        const opts = sub.entries
          .filter(o => o && typeof o === 'object' && o.name)
          .map(o => ({
            value:       o.name,
            label:       o.name,
            description: typeof o.entries?.[0] === 'string' ? o.entries[0] : '',
          }))

        if (opts.length === 0) continue

        const variantDescId = makeId('race', sourceId, 'variant', idx.i++)
        descriptors.push({
          id:       variantDescId,
          source:   'race', sourceId,
          type:     'variant',
          mode:     'exclusive',
          label:    `Choose ${sub.count || 1} option: ${entry.name || ''}`,
          count:    sub.count || 1,
          options:  opts,
          filter:   null,
          required: true,
        })

        for (const optEntry of sub.entries) {
          descriptors.push(
            ...parseVariantSubChoices(optEntry, variantDescId, 'race', sourceId, idx)
          )
        }
      }
    }
  }

  return descriptors
}

/**
 * Parse all choices from a subrace data object.
 * Returns ChoiceDescriptor[] (with source='subrace')
 *
 * FIX: Guard against receiving an empty object {} — return [] immediately
 * if the subrace has no name (means no subrace is actually selected).
 */
export function parseSubraceChoices(subrace) {
  // FIX: was `if (!subrace) return []` — now also guards against {}
  if (!subrace || !subrace.name) return []
  // Reuse race parser and re-stamp source as 'subrace'
  return parseRaceChoices(subrace).map(d => ({
    ...d,
    source:     'subrace',
    id:         d.id.replace(/^race:/, 'subrace:'),
    // FIX: update variantId prefix too so filtering still works
    variantId:  d.variantId ? d.variantId.replace(/^race:/, 'subrace:') : d.variantId,
  }))
}

/**
 * Parse all choices from a background data object.
 * Returns ChoiceDescriptor[]
 */
export function parseBackgroundChoices(background) {
  if (!background) return []
  const sourceId = norm(background.name)
  const descriptors = []
  const idx = { i: 0 }

  descriptors.push(...parseSkillChoices(background.skillProficiencies, 'background', sourceId, idx))
  descriptors.push(...parseToolChoices(background.toolProficiencies, 'background', sourceId, idx))
  descriptors.push(...parseLanguageChoices(background.languageProficiencies, 'background', sourceId, idx))
  // 5.5e backgrounds grant choosable ASI (+2/+1 or +1/+1/+1)
  descriptors.push(...parseAbilityChoices(background.ability, 'background', sourceId, idx))

  return descriptors
}

/**
 * Parse starting skill choices for a class (from startingProficiencies.skills).
 */
export function parseClassChoices(cls, level = 1) {
  if (!cls) return []
  const sourceId = norm(cls.classId || cls.name || '')
  const descriptors = []
  const idx = { i: 0 }
  const profs = cls.startingProficiencies || {}

  for (const entry of (profs.skills || [])) {
    if (!entry) continue
    let count = 2, from = SKILLS_ALL
    if (entry.choose) {
      count = entry.choose.count || 2
      from  = (entry.choose.from || []).map(normalizeSkillKey)
    } else if (typeof entry.any === 'number') {
      count = entry.any
      from  = SKILLS_ALL
    }
    if (!from.length) from = SKILLS_ALL
    descriptors.push({
      id:       makeId('class', sourceId, `level${level}`, 'skill', idx.i++),
      source:   'class', sourceId,
      type:     'skill',
      label:    `Choose ${count} skill${count > 1 ? 's' : ''}`,
      count,
      options:  skillOptions(from),
      filter:   null,
      required: true,
    })
  }

  if (cls.classId === 'Rogue') {
    descriptors.push({
      id:       makeId('class', sourceId, `level${level}`, 'expertise', 0),
      source:   'class', sourceId,
      type:     'expertise',
      label:    'Choose 2 skills for Expertise',
      count:    2,
      options:  null,
      filter:   { includesThievesTools: true },
      required: true,
    })
  }

  return descriptors
}

// ── NEW: filterActiveDescriptors ───────────────────────────────────────────────
//
/**
 * Filter out variant-gated descriptors whose variant option has not been chosen.
 *
 * A descriptor with no variantId is always active.
 * A descriptor with variantId is active ONLY when choices[variantId] includes
 * its variantValue (string or array).
 *
 * Usage (Step3Race, Step7Proficiencies, etc.):
 *
 *   const active = filterActiveDescriptors(
 *     [...parseRaceChoices(race), ...parseSubraceChoices(subrace)],
 *     character.choices || {}
 *   )
 *
 * The variant descriptor ITSELF (type:'variant') is always included so the
 * player can make or change their choice.
 */
export function filterActiveDescriptors(descriptors, choices) {
  return descriptors.filter(d => {
    // No variant gate → always active
    if (!d.variantId) return true
    // Variant gate → active only when the right option is chosen
    const chosen = asArray(choices?.[d.variantId])
    return chosen.includes(d.variantValue)
  })
}

// ── filterDescriptorsByActiveVariants ──────────────────────────────────────────
//
/**
 * Alias of filterActiveDescriptors with a name that makes intent explicit.
 * Returns only descriptors that are either:
 *   (a) not gated behind any variant (variantId is absent), or
 *   (b) gated behind a variant whose option is currently chosen in `choices`.
 *
 * Use this in UI layers (Step3Race, Step7) to decide what to render.
 * The underlying character.choices object is already kept clean at the state
 * level — Step3Race deletes sub-choice keys for unchosen variant options the
 * moment a variant selection changes.
 */
export const filterDescriptorsByActiveVariants = filterActiveDescriptors

// ── Aggregate accessor ─────────────────────────────────────────────────────────

/**
 * Get all active ChoiceDescriptors for a character, given loaded data.
 * Pass null for any not-yet-selected sources.
 *
 * FIX: Now also calls filterActiveDescriptors so variant-gated descriptors are
 * automatically excluded when the matching variant option hasn't been chosen yet.
 */
const DESC_TYPE_TO_PROF_KEY = {
  skill:    'skillProficiencies',
  tool:     'toolProficiencies',
  language: 'languageProficiencies',
  weapon:   'weaponProficiencies',
  spell:    'additionalSpells',
  ability:  'ability',
}

export function getAllChoiceDescriptors({ race = null, subrace = null, background = null, feats = [], cls = null, choices = {} } = {}) {
  const raceDescs    = parseRaceChoices(race)
  const subraceDescs = parseSubraceChoices(subrace)

  // ── Suppression: subrace _versions cover ───────────────────────────────────
  const subraceVersionCoveredKeys = getVersionCoveredKeys(subrace?._versions)

  // ── Suppression: subrace direct override (no _versions needed) ─────────────
  // When a subrace directly provides a functional key (e.g. additionalSpells),
  // it replaces the race's version of that key. This handles Tiefling subraces
  // (Baalzebul, Devil's Tongue, etc.) which each override Infernal Legacy spells
  // without using _versions.
  const OVERRIDE_KEYS = {
    additionalSpells:     'spell',
    skillProficiencies:   'skill',
    toolProficiencies:    'tool',
    languageProficiencies:'language',
    weaponProficiencies:  'weapon',
  }
  const subraceDirectOverrideTypes = new Set()
  if (subrace && subrace.name) {
    for (const [dataKey, descType] of Object.entries(OVERRIDE_KEYS)) {
      const val = subrace[dataKey]
      if (Array.isArray(val) && val.length > 0) {
        subraceDirectOverrideTypes.add(descType)
      }
    }
  }

  const filteredRaceDescs = (subraceVersionCoveredKeys.size === 0 && subraceDirectOverrideTypes.size === 0)
    ? raceDescs
    : raceDescs.filter(d => {
        // _versions coverage: suppress unconditional race descriptors for covered keys
        const profKey = DESC_TYPE_TO_PROF_KEY[d.type]
        if (profKey && subraceVersionCoveredKeys.has(profKey) && !d.variantId) return false
        // Direct override: suppress race descriptors whose type the subrace directly provides
        if (subraceDirectOverrideTypes.has(d.type) && !d.variantId) return false
        return true
      })

  const all = [
    ...filteredRaceDescs,
    ...subraceDescs,
    ...parseBackgroundChoices(background),
    ...feats.flatMap(f => parseFeatChoices(f)),
    ...(cls ? parseClassChoices(cls) : []),
  ]
  return filterActiveDescriptors(all, choices)
}

// ── Value accessors ────────────────────────────────────────────────────────────

export function getChoiceValue(choices, id) {
  return choices?.[id] ?? null
}

export function setChoiceValue(choices, id, value) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    const next = { ...choices }
    delete next[id]
    return next
  }
  return { ...choices, [id]: value }
}

export function toggleChoiceItem(choices, id, item, max) {
  const cur = asArray(choices?.[id])
  const has = cur.includes(item)
  if (has) return setChoiceValue(choices, id, cur.filter(v => v !== item))
  if (cur.length >= max) return choices
  return setChoiceValue(choices, id, [...cur, item])
}

export function asArray(val) {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// ── Derived accessors — used by rulesEngine ────────────────────────────────────

export function getChosenSkills(choices, descriptors) {
  return _collect(choices, descriptors, 'skill')
}
export function getChosenTools(choices, descriptors) {
  return _collect(choices, descriptors, 'tool')
}
export function getChosenLanguages(choices, descriptors) {
  return _collect(choices, descriptors, 'language')
}
export function getChosenWeapons(choices, descriptors) {
  return _collect(choices, descriptors, 'weapon')
}
export function getChosenOptFeatures(choices, descriptors) {
  return _collect(choices, descriptors, 'optfeature')
}
export function getChosenSpells(choices, descriptors) {
  return _collect(choices, descriptors, 'spell')
}
export function getChosenExpertise(choices, descriptors) {
  return _collect(choices, descriptors, 'expertise')
}

export function getChosenAbilityDeltas(choices, descriptors) {
  const result = { str:0, dex:0, con:0, int:0, wis:0, cha:0 }
  for (const d of descriptors) {
    if (d.type !== 'ability') continue
    for (const v of asArray(choices?.[d.id])) {
      const opt = d.options?.find(o => o.value === v)
      const amount = opt?.meta?.amount ?? 1
      if (result[v] !== undefined) result[v] += amount
    }
  }
  return result
}

export function getChosenAncestry(choices, descriptors) {
  const d = descriptors.find(x => x.type === 'color')
  if (!d) return null
  const v = choices?.[d.id]
  if (!v) return null
  return d.options?.find(o => o.value === v) || null
}

export function isChoiceComplete(choices, descriptor) {
  const vals = asArray(choices?.[descriptor.id])
  return vals.length >= descriptor.count
}

export function areAllChoicesComplete(choices, descriptors) {
  return descriptors.filter(d => d.required).every(d => isChoiceComplete(choices, d))
}

// ── Internal ───────────────────────────────────────────────────────────────────

function _collect(choices, descriptors, type) {
  const seen = new Set()
  for (const d of descriptors) {
    if (d.type !== type) continue
    for (const v of asArray(choices?.[d.id])) seen.add(v)
  }
  return [...seen]
}