// ═══════════════════════════════════════════════════════════════════════
// foundryExport.js — FoundryVTT dnd5e v5.0.4 / Core 13 Actor Export
// Generiert ein vollständiges Actor-JSON das direkt in Foundry importiert
// werden kann (File → Import Data).
//
// Abhängigkeiten (alle im selben Verzeichnis):
//   ./rulesEngine              → computeCharacter, computeAbilityScores,
//                                computeModifiers, SKILL_MAP
//   ./characterModel           → getProficiencyBonus, getTotalLevel
//   ./foundry-class-index.json → ClassFeature ActiveEffects & ScaleValues
//   ./foundry-spell-index.json → Spell Activity & Effect Patches
// ═══════════════════════════════════════════════════════════════════════

import {
  computeCharacter,
  computeAbilityScores,
  computeModifiers,
  SKILL_MAP,          // { acrobatics: 'dex', animalHandling: 'wis', … }
} from './rulesEngine'
import { getProficiencyBonus, getTotalLevel } from './characterModel'
import { parseTags } from './tagParser'
// JSON-Daten aus dem public/-Ordner werden zur Laufzeit per fetch() geladen.
// Vite erlaubt keine statischen imports aus public/ — fetch() ist der korrekte Weg.
let CLASS_INDEX = null
let SPELL_INDEX = null
let FEAT_INDEX  = null
let ITEM_FNDRY  = null
let SPELL_DESC  = null
let RACE_FNDRY  = null   // foundry-races.json — race + raceFeature patches
let OPTFEAT_FNDRY = null // foundry-optionalfeatures.json — Eldritch Invocations etc.
let RACE_DATA   = null   // races.json — 5etools race entries (für Beschreibungen)
let BG_DATA     = null   // backgrounds.json — 5etools background entries
let CF_DESC     = null   // class-feature-desc-index.json — "Name||Class" → HTML
let FEATS_DATA  = null   // feats.json — 5etools feat entries (für Beschreibungen)
let OPTFEAT_DATA = null  // optionalfeatures.json — Eldritch Invocations entries

// Live spell data map: spellName(lowercase) → { level, school, entries, ... }
let LIVE_SPELL_MAP = null

// DDB-Importer Icon Lookup Maps (name → Foundry icon path)
let ICON_CLASS_FEATURES = null
let ICON_CLASSES        = null
let ICON_FEATS          = null
let ICON_GENERAL        = null
let ICON_ITEMS          = null
let ICON_RACES          = null
let ICON_SPELLS         = null

/** Build a name→path Map from a DDB icon array [{name,path}] */
function buildIconMap(arr) {
  const m = new Map()
  for (const e of (arr || [])) {
    if (e?.name && e?.path) m.set(e.name, e.path)
  }
  return m
}

/** Look up a Foundry icon by name across multiple icon maps */
function lookupIcon(name, ...maps) {
  if (!name) return null
  for (const m of maps) {
    if (m?.has(name)) return m.get(name)
  }
  return null
}

async function ensureIndexes() {
  if (CLASS_INDEX) return   // bereits geladen → nichts tun

  // DDB-Importer Icon-Dateien laden (aus public/data/Foundry/)
  const iconFiles = await Promise.all([
    fetch('/data/Foundry/class-features.json').then(r => r.json()).catch(() => []),
    fetch('/data/Foundry/classes.json').then(r => r.json()).catch(() => []),
    fetch('/data/Foundry/feats.json').then(r => r.json()).catch(() => []),
    fetch('/data/Foundry/general.json').then(r => r.json()).catch(() => []),
    fetch('/data/Foundry/items.json').then(r => r.json()).catch(() => []),
    fetch('/data/Foundry/races.json').then(r => r.json()).catch(() => []),
    fetch('/data/Foundry/spells.json').then(r => r.json()).catch(() => []),
  ])
  ICON_CLASS_FEATURES = buildIconMap(iconFiles[0])
  ICON_CLASSES        = buildIconMap(iconFiles[1])
  ICON_FEATS          = buildIconMap(iconFiles[2])
  ICON_GENERAL        = buildIconMap(iconFiles[3])
  ICON_ITEMS          = buildIconMap(iconFiles[4])
  ICON_RACES          = buildIconMap(iconFiles[5])
  ICON_SPELLS         = buildIconMap(iconFiles[6])

  ;[CLASS_INDEX, SPELL_INDEX, FEAT_INDEX, ITEM_FNDRY, SPELL_DESC, RACE_FNDRY, OPTFEAT_FNDRY, RACE_DATA, BG_DATA, CF_DESC, FEATS_DATA, OPTFEAT_DATA] =
    await Promise.all([
      fetch('/data/5e/foundry-class-index.json').then(r => r.json()),
      fetch('/data/5e/foundry-spell-index.json').then(r => r.json()),
      fetch('/data/5e/foundry-feat-index.json').then(r => r.json()),
      fetch('/data/5e/foundry-item-foundry-index.json').then(r => r.json()),
      fetch('/data/5e/spells/spell-desc-index.json').then(r => r.json()),
      fetch('/data/5e/foundry-races.json').then(r => r.json()),
      fetch('/data/5e/foundry-optionalfeatures.json').then(r => r.json()),
      fetch('/data/5e/races.json').then(r => r.json()),
      fetch('/data/5e/backgrounds.json').then(r => r.json()),
      fetch('/data/5e/class-feature-desc-index.json').then(r => r.json()).catch(() => ({})),
      fetch('/data/5e/feats.json').then(r => r.json()).catch(() => ({ feat: [] })),
      fetch('/data/5e/optionalfeatures.json').then(r => r.json()).catch(() => ({ optionalfeature: [] })),
    ])
}

// ───────────────────────────────────────────────────────────────────────
// KONSTANTEN
// ───────────────────────────────────────────────────────────────────────

const SYSTEM_VERSION = {
  coreVersion:   '13.344',
  systemId:      'dnd5e',
  systemVersion: '5.0.4',
}

// camelCase skill name → Foundry 3-letter ID
const FOUNDRY_SKILL_ID = {
  acrobatics:    'acr', animalHandling: 'ani', arcana:        'arc',
  athletics:     'ath', deception:      'dec', history:       'his',
  insight:       'ins', intimidation:   'itm', investigation: 'inv',
  medicine:      'med', nature:         'nat', perception:    'prc',
  performance:   'prf', persuasion:     'per', religion:      'rel',
  sleightOfHand: 'slt', stealth:        'ste', survival:      'sur',
}

// 5etools magic school code → Foundry school ID
const SCHOOL_MAP = {
  A: 'abj', C: 'con', D: 'div', E: 'enc',
  V: 'evo', I: 'ill', N: 'nec', T: 'trs', U: 'abj',
}

// 5etools damage type code → Foundry damage type string
const DMG_TYPE_MAP = {
  B: 'bludgeoning', P: 'piercing',  S: 'slashing',
  A: 'acid',        C: 'cold',      F: 'fire',
  L: 'lightning',   N: 'necrotic',  R: 'radiant',
  T: 'thunder',     Ps: 'psychic',  Y: 'psychic',
  Fo: 'force',      Po: 'poison',
}

// 5etools creature size → Foundry size token
const SIZE_MAP = { T: 'tiny', S: 'sm', M: 'med', L: 'lg', H: 'huge', G: 'grg' }

// ActiveEffect change mode string → Foundry numeric mode
const EFFECT_MODE_NUM = {
  CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5,
}

// Full-caster spell slot table indexed by effective caster level
const FULL_CASTER_SLOTS = {
  1:[2,0,0,0,0,0,0,0,0],  2:[3,0,0,0,0,0,0,0,0],  3:[4,2,0,0,0,0,0,0,0],
  4:[4,3,0,0,0,0,0,0,0],  5:[4,3,2,0,0,0,0,0,0],  6:[4,3,3,0,0,0,0,0,0],
  7:[4,3,3,1,0,0,0,0,0],  8:[4,3,3,2,0,0,0,0,0],  9:[4,3,3,3,1,0,0,0,0],
  10:[4,3,3,3,2,0,0,0,0], 11:[4,3,3,3,2,1,0,0,0], 12:[4,3,3,3,2,1,0,0,0],
  13:[4,3,3,3,2,1,1,0,0], 14:[4,3,3,3,2,1,1,0,0], 15:[4,3,3,3,2,1,1,1,0],
  16:[4,3,3,3,2,1,1,1,0], 17:[4,3,3,3,2,1,1,1,1], 18:[4,3,3,3,3,1,1,1,1],
  19:[4,3,3,3,3,2,1,1,1], 20:[4,3,3,3,3,2,2,1,1],
}

const WARLOCK_SLOTS = {
  1:{slots:1,level:1},  2:{slots:2,level:1},  3:{slots:2,level:2},
  4:{slots:2,level:2},  5:{slots:2,level:3},  6:{slots:2,level:3},
  7:{slots:2,level:4},  8:{slots:2,level:4},  9:{slots:2,level:5},
  10:{slots:2,level:5}, 11:{slots:3,level:5}, 12:{slots:3,level:5},
  13:{slots:3,level:5}, 14:{slots:3,level:5}, 15:{slots:3,level:5},
  16:{slots:3,level:5}, 17:{slots:4,level:5}, 18:{slots:4,level:5},
  19:{slots:4,level:5}, 20:{slots:4,level:5},
}

// Standard saving throw proficiencies per class (2014 rules)
const CLASS_SAVES = {
  Barbarian: ['str','con'], Bard:      ['dex','cha'],
  Cleric:    ['wis','cha'], Druid:     ['int','wis'],
  Fighter:   ['str','con'], Monk:      ['str','dex'],
  Paladin:   ['wis','cha'], Ranger:    ['str','dex'],
  Rogue:     ['dex','int'], Sorcerer:  ['con','cha'],
  Warlock:   ['wis','cha'], Wizard:    ['int','wis'],
  Artificer: ['con','int'],
}

// Known weapon type strings → Foundry weapon proficiency IDs
const WEAPON_PROF_MAP = {
  'simple':         'sim',  'simple weapons':   'sim',
  'martial':        'mar',  'martial weapons':  'mar',
  'dagger':         'dagger',  'dart':          'dart',
  'sling':          'sling',   'quarterstaff':  'quarterstaff',
  'light crossbow': 'lightcrossbow',
  'hand crossbow':  'handCrossbow',
  'longsword':      'longsword', 'rapier':     'rapier',
  'shortsword':     'shortsword',
}

// Known armor type strings → Foundry armor proficiency IDs
const ARMOR_PROF_MAP = {
  'light': 'lgt',    'light armor':  'lgt',
  'medium': 'med',   'medium armor': 'med',
  'heavy': 'hvy',    'heavy armor':  'hvy',
  'shield': 'shield','shields':      'shield',
}

// 5etools weapon property → Foundry property tag
const WEAPON_PROP_MAP = {
  Ammunition: 'ammunition', Finesse: 'fin',     Heavy: 'hvy',
  Light: 'lgt',             Loading: 'lod',     Reach: 'rch',
  Thrown: 'thr',           'Two-Handed': 'two', Versatile: 'ver',
  Special: 'spc',
}

// Foundry magic school icons (core Foundry icon paths, always present)
const SCHOOL_ICONS = {
  abj: 'icons/magic/defensive/shield-barrier-flaming-diamond-teal.webp',
  con: 'icons/magic/nature/wolf-paw-glow-small-teal.webp',
  div: 'icons/magic/perception/eye-ringed-glow-angry-small-teal.webp',
  enc: 'icons/magic/control/hypnosis-spiral-purple.webp',
  evo: 'icons/magic/fire/flame-burning-hand-orange.webp',
  ill: 'icons/magic/movement/trail-streak-zigzag-yellow.webp',
  nec: 'icons/magic/death/undead-skeleton-rags-brown.webp',
  trs: 'icons/magic/air/wind-tornado-gray.webp',
}

// Item type → Foundry core icon fallback
const ITEM_TYPE_ICONS = {
  // Weapons
  M:   'icons/weapons/swords/sword-broad-silver.webp',
  R:   'icons/weapons/bows/shortbow-recurve-orange.webp',
  // Armor
  LA:  'icons/equipment/chest/breastplate-banded-steel.webp',
  MA:  'icons/equipment/chest/breastplate-banded-steel.webp',
  HA:  'icons/equipment/chest/breastplate-metal.webp',
  S:   'icons/equipment/shield/heater-crystal-steel-blue.webp',
  // Consumables
  P:   'icons/consumables/potions/potion-round-blue.webp',
  SC:  'icons/sundries/scrolls/scroll-runed-brown-yellow.webp',
  // Gear
  G:   'icons/sundries/misc/backpack-brown.webp',
  AT:  'icons/tools/hand/chisel-steel-grey.webp',
}

// Which casters get mode="prepared" (can swap spells on long rest) vs "always"
const PREPARED_CASTERS = new Set(['Cleric', 'Druid', 'Wizard', 'Paladin', 'Artificer'])

// Pseudo-spell names that MUST NOT be exported as real Spell items.
// These are list headers (expanded-spell-list choices) that accidentally
// end up in levelChoices due to UI quirks. Foundry rejects the whole
// actor import if these hit the spell pipeline.
const FAKE_SPELL_NAMES = new Set([
  'bard spells', 'cleric spells', 'druid spells', 'paladin spells',
  'ranger spells', 'sorcerer spells', 'warlock spells', 'wizard spells',
  'artificer spells',
  'bard cantrips', 'cleric cantrips', 'druid cantrips',
  'sorcerer cantrips', 'warlock cantrips', 'wizard cantrips',
])

/** True if this looks like a spell-list header rather than a real spell. */
function isFakeSpellName(name) {
  if (!name || typeof name !== 'string') return true
  const n = name.toLowerCase().trim()
  if (!n) return true
  if (FAKE_SPELL_NAMES.has(n)) return true
  // Catch generic "<X> Spells" / "<X> Cantrips" patterns regardless of data source
  if (/\s(spells|cantrips)$/i.test(n) && n.split(/\s+/).length <= 3) return true
  return false
}

/** Build a spell description HTML from 5etools entries + entriesHigherLevel */
function buildDescriptionFromEntries(entries, entriesHL) {
  let html = entriesToHtml(entries || [])
  if (entriesHL?.length > 0) {
    html += '<hr/>' + entriesToHtml(entriesHL)
  }
  return html
}

/**
 * Converts 5etools entries array to an HTML string using existing parseTags.
 * Used as a runtime fallback when foundry data doesn't have a pre-built description.
 */
function entriesToHtml(entries) {
  if (!Array.isArray(entries)) return ''
  return entries.map(entry => {
    if (typeof entry === 'string') return `<p>${parseTags(entry)}</p>`
    if (!entry || typeof entry !== 'object') return ''
    switch (entry.type) {
      case 'entries':
      case 'section':
        return (entry.name ? `<p><strong>${parseTags(entry.name)}</strong></p>` : '')
          + entriesToHtml(entry.entries || [])
      case 'inset':
      case 'quote':
        return `<blockquote>${entry.name ? `<p><strong>${parseTags(entry.name)}</strong></p>` : ''}${entriesToHtml(entry.entries || [])}</blockquote>`
      case 'list':
        return `<ul>${(entry.items || []).map(i => {
          const text = typeof i === 'string' ? i : (i.entry || i.name || '')
          return `<li><p>${parseTags(text)}</p></li>`
        }).join('')}</ul>`
      case 'table': {
        const headers = (entry.colLabels || []).map(h => `<th>${parseTags(h)}</th>`).join('')
        const rows = (entry.rows || []).map(r => {
          const cells = Array.isArray(r) ? r : [r]
          return `<tr>${cells.map(c => {
            const val = typeof c === 'object' ? (c.exact ?? c.min ?? '') : c
            return `<td>${parseTags(String(val ?? ''))}</td>`
          }).join('')}</tr>`
        }).join('')
        return `<table>${entry.caption ? `<caption>${parseTags(entry.caption)}</caption>` : ''}<thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`
      }
      default:
        if (entry.entries) {
          return (entry.name ? `<p><strong>${parseTags(entry.name)}</strong></p>` : '')
            + entriesToHtml(entry.entries)
        }
        return entry.name ? `<p>${parseTags(entry.name)}</p>` : ''
    }
  }).join('\n')
}

/**
 * Looks up the Foundry img for a feat by name+source.
 * Tries exact key, then name-only fallback.
 */
function lookupFeatImg(name, source, featIndex) {
  if (!name) return null
  const exact = featIndex[`${name}||${source || ''}`]
  if (exact?.img) return exact.img
  const fallback = featIndex[name]
  return fallback?.img || null
}

/**
 * Looks up the Foundry description for a feat by name+source.
 */
function lookupFeatDesc(name, source, featIndex) {
  if (!name) return ''
  const exact = featIndex[`${name}||${source || ''}`]
  if (exact?.description) return exact.description
  const fallback = featIndex[name]
  return fallback?.description || ''
}

/**
 * Looks up Foundry img/description for an item.
 */
function lookupItemFoundry(name, source, itemFndry) {
  if (!name) return {}
  const exact = itemFndry[`${name}||${source || ''}`]
  if (exact) return exact
  return itemFndry[name] || {}
}

/**
 * Looks up class feature description from CF_DESC index (built by download-data).
 * Falls back to a name-only lookup if className-keyed lookup fails.
 */
function lookupClassFeatureDesc(name, className) {
  if (!name || !CF_DESC) return ''
  return CF_DESC[`${name}||${className}`] || CF_DESC[name] || ''
}

/**
 * Looks up feat description: first from FEAT_INDEX (enriched by download-data),
 * then falls back to feats.json entries at runtime.
 */
function lookupFullFeatDesc(name, source) {
  // 1. Already-indexed description (enriched feat-index)
  const indexed = lookupFeatDesc(name, source, FEAT_INDEX)
  if (indexed) return indexed

  // 2. Runtime fallback: feats.json
  if (FEATS_DATA?.feat) {
    const entry = FEATS_DATA.feat.find(f =>
      f.name === name && (!source || f.source === source)
    )
    if (entry?.entries) return entriesToHtml(entry.entries)
  }
  return ''
}

/**
 * Looks up optional feature description (Eldritch Invocations, Maneuvers, etc.)
 * First from CF_DESC index, then runtime fallback to optionalfeatures.json.
 */
function lookupOptionalFeatureDesc(name, source) {
  // 1. CF_DESC (built by download-data from optionalfeatures.json)
  const key = source ? `${name}||${source}` : name
  if (CF_DESC?.[key]) return CF_DESC[key]

  // 2. Runtime fallback
  if (OPTFEAT_DATA?.optionalfeature) {
    const entry = OPTFEAT_DATA.optionalfeature.find(f =>
      f.name === name && (!source || f.source === source)
    )
    if (entry?.entries) return entriesToHtml(entry.entries)
  }
  return ''
}

// ───────────────────────────────────────────────────────────────────────
// ID-GENERATOR
// Deterministischer 16-Zeichen Foundry-Style ID aus einem Seed-String.
// Gleicher Seed → gleiche ID → stabile Cross-References innerhalb des Dokuments.
// ───────────────────────────────────────────────────────────────────────

function makeId(seed) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  // DJB2 + FNV-1a hybrid für gute Verteilung
  let h1 = 5381
  let h2 = 0x811c9dc5 >>> 0
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    h1 = (Math.imul(h1, 33) ^ c) >>> 0
    h2 = (Math.imul(h2 ^ c, 0x01000193)) >>> 0
  }
  let out = ''
  let v = h1
  for (let i = 0; i < 8; i++) {
    out += chars[v % 62]
    v   = (Math.floor(v / 62) ^ Math.imul(h2, i + 1)) >>> 0
    if (!v) v = 0xdeadbeef
  }
  v = h2
  for (let i = 0; i < 8; i++) {
    out += chars[v % 62]
    v   = (Math.floor(v / 62) ^ Math.imul(h1, i + 1)) >>> 0
    if (!v) v = 0xcafebabe
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────
// HILFSFUNKTIONEN
// ───────────────────────────────────────────────────────────────────────

/** Foundry _stats Block für ein Item oder den Actor */
function makeStats() {
  return { ...SYSTEM_VERSION, createdTime: null, modifiedTime: null, lastModifiedBy: null }
}

/** Source-Block */
function makeSource(book, edition) {
  return {
    book:     book || '',
    page:     '',
    license:  '',
    custom:   '',
    rules:    edition === '5.5e' ? '2024' : '2014',
    revision: 1,
  }
}

/** "1 action", "1 bonus action", "1 reaction, …" → Foundry activation type */
function parseActivationType(ct) {
  if (!ct) return 'action'
  const s = ct.toLowerCase()
  if (s.includes('bonus'))     return 'bonus'
  if (s.includes('reaction'))  return 'reaction'
  if (/\d+\s*minute/.test(s)) return 'minute'
  if (/\d+\s*hour/.test(s))   return 'hour'
  return 'action'
}

/** "1 minute", "Instantaneous", "Until dispelled" → { value, units } */
function parseDuration(dur) {
  if (!dur || dur === 'Instantaneous') return { value: null, units: 'inst' }
  if (dur === 'Until dispelled')       return { value: null, units: 'perm' }
  const s = dur.toLowerCase()
  const n = dur.match(/(\d+)/)?.[1] ?? null
  if (s.includes('round'))  return { value: n, units: 'round'  }
  if (s.includes('minute')) return { value: n, units: 'minute' }
  if (s.includes('hour'))   return { value: n, units: 'hour'   }
  if (s.includes('day'))    return { value: n, units: 'day'    }
  return { value: null, units: 'inst' }
}

/** "150 ft.", "Touch", "Self" → { value, units } */
function parseRange(rangeStr) {
  if (!rangeStr)                                   return { value: null, units: '' }
  if (rangeStr === 'Touch')                        return { value: null, units: 'touch' }
  if (rangeStr === 'Self')                         return { value: null, units: 'self' }
  if (rangeStr === 'Unlimited' || rangeStr === 'Sight') return { value: null, units: 'spec' }
  const m = rangeStr.match(/(\d+)\s*(ft|feet|foot|mile)/i)
  if (m) return { value: m[1], units: m[2].toLowerCase().startsWith('mile') ? 'mile' : 'ft' }
  return { value: null, units: 'spec' }
}

/**
 * Derives basic Foundry target.affects from spellMetadata range string.
 * Heuristic fallback when no explicit target data is available from spell-index.
 */
function deriveSpellTarget(meta) {
  const base = { count: '', type: '', choice: false, special: '' }
  const r = meta?.range || ''
  if (!r) return base
  if (r === 'Self' || r.startsWith('Self (')) {
    return { ...base, type: 'self' }
  }
  if (r === 'Touch') {
    return { ...base, count: '1', type: 'creature' }
  }
  // Distance range → likely single target creature
  if (/\d+\s*(ft|feet|mile)/i.test(r)) {
    return { ...base, count: '1', type: 'creature' }
  }
  return base
}

/**
 * Spell components { v, s, m } + flags → Foundry properties array
 * Foundry v5: 'vocal' | 'somatic' | 'material' | 'concentration' | 'ritual'
 */
function buildSpellProperties(components, concentration, ritual) {
  const p = []
  if (components?.v)   p.push('vocal')
  if (components?.s)   p.push('somatic')
  if (components?.m)   p.push('material')
  if (concentration)   p.push('concentration')
  if (ritual)          p.push('ritual')
  return p
}

/**
 * Schreibt dot-notation Pfade (z.B. "target.affects.type") in ein Objekt.
 * Wird für spell-index und class-index System-Patches verwendet.
 */
function applyDotOverrides(obj, overrides) {
  for (const [path, value] of Object.entries(overrides || {})) {
    const parts = path.split('.')
    let cursor = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (cursor[parts[i]] == null || typeof cursor[parts[i]] !== 'object') {
        cursor[parts[i]] = {}
      }
      cursor = cursor[parts[i]]
    }
    cursor[parts[parts.length - 1]] = value
  }
}

/** String-Modus ("ADD", "OVERRIDE", …) oder Zahl → Foundry numerischer Modus */
function effectMode(mode) {
  if (typeof mode === 'number') return mode
  return EFFECT_MODE_NUM[mode?.toUpperCase()] ?? 2
}

/** Baut einen Foundry ActiveEffect aus einem Patch-Deskriptor */
function buildEffect(patch, effectId, fallbackName) {
  return {
    _id:      effectId,
    name:     patch.name || fallbackName,
    type:     'base',
    system:   {},
    img:      'icons/svg/aura.svg',
    origin:   null,
    tint:     '#ffffff',
    transfer: patch.transfer ?? false,
    disabled: patch.disabled ?? false,
    statuses: [],
    changes:  (patch.changes || []).map(ch => ({
      key:      ch.key,
      value:    String(ch.value),
      mode:     effectMode(ch.mode),
      priority: ch.priority ?? 20,
    })),
    duration: {
      seconds:    null,
      startTime:  null,
      rounds:     patch.duration?.rounds ?? null,
      turns:      patch.duration?.turns  ?? null,
      startRound: null,
      startTurn:  null,
      combat:     null,
    },
    flags: {
      dae:        { transfer: patch.transfer ?? false, stackable: 'noneNameOnly' },
      'midi-qol': { forceCEOff: true },
      core:       {},
    },
    description: patch.description || '',
    sort:        0,
    _stats:      makeStats(),
  }
}

/**
 * Baut Damage-Parts Array für Attack/Save/Damage Activities
 */
function buildDamageParts(parts = []) {
  return {
    critical:    { bonus: '' },
    includeBase: true,
    parts: parts.map(p => ({
      number:       p.number       ?? null,
      denomination: p.denomination ?? null,
      bonus:        p.bonus        || '',
      types:        p.types        || [],
      custom:       p.custom       || { enabled: false, formula: '' },
      scaling:      p.scaling      || { mode: 'whole', number: 1, formula: '' },
    })),
  }
}

/**
 * Baut eine vollständige Spell-Activity aus einem Index-Patch.
 * actId        = deterministischer 16-Zeichen ID
 * patch        = activity-Deskriptor aus dem Spell-Index
 * meta         = spellMetadata-Eintrag (castingTime, range, duration, …)
 * effectIdMap  = { foundryId → tatsächliche _id } Auflösungstabelle
 */
function buildSpellActivity(actId, patch, meta, effectIdMap) {
  const actType   = patch.type || 'utility'
  const actRange  = parseRange(meta?.range)
  const actDur    = parseDuration(meta?.duration)
  const actActType = parseActivationType(meta?.castingTime)

  const base = {
    _id:  actId,
    type: actType,
    sort: 0,
    activation: {
      type:      patch.activation?.type      ?? actActType,
      value:     1,
      condition: patch.activation?.condition ?? '',
      override:  !!patch.activation?.type,
    },
    consumption: {
      spellSlot: true,
      targets:   [],
      scaling:   { allowed: false, max: '' },
    },
    description: { chatFlavor: '' },
    duration: {
      value:         actDur.value,
      units:         actDur.units,
      concentration: meta?.concentration ?? false,
      override:      false,
    },
    // Effekt-Referenzen: foundryId → tatsächliche _id auflösen
    effects: (patch.effects || []).map(e => {
      const rid = effectIdMap[e.foundryId]
      if (!rid) return null
      const entry = { _id: rid }
      if (e.onSave !== undefined) entry.onSave = e.onSave
      return entry
    }).filter(Boolean),
    range: {
      value:    actRange.value ?? '',
      units:    actRange.units,
      special:  '',
      override: false,
    },
    target: {
      template: { contiguous: false, units: 'ft' },
      affects:  { choice: false },
      override: false,
      prompt:   true,
    },
    uses: { spent: 0, recovery: [] },
  }

  // Target-Overrides aus Patch
  if (patch.target?.affects) {
    base.target.affects  = { ...base.target.affects,  ...patch.target.affects }
    base.target.override = true
  }
  if (patch.target?.template) {
    base.target.template = { ...base.target.template, ...patch.target.template }
    base.target.override = true
  }

  // Range-Overrides aus patch.system
  if (patch.system?.['range.value'] !== undefined) {
    base.range.value    = String(patch.system['range.value'])
    base.range.override = true
  }
  if (patch.system?.['range.units']) {
    base.range.units    = patch.system['range.units']
    base.range.override = true
  }

  // Typ-spezifische Felder
  switch (actType) {
    case 'attack':
      base.attack = {
        ability: 'spellcasting',
        bonus:   '',
        critical: { threshold: null },
        flat:    false,
        type:    { value: patch.attack?.type?.value || 'ranged', classification: 'spell' },
      }
      base.damage = buildDamageParts(patch.damage?.parts)
      break

    case 'save':
      base.save = {
        ability: patch.save?.ability || 'con',
        dc:      { formula: '', calculation: 'spellcasting' },
      }
      if (patch.damage?.parts?.length) {
        base.damage = buildDamageParts(patch.damage.parts)
      }
      break

    case 'damage':
      base.damage = buildDamageParts(patch.damage?.parts)
      break

    case 'heal':
      base.healing = {
        number:       patch.healing?.number       ?? null,
        denomination: patch.healing?.denomination ?? null,
        bonus:        patch.healing?.bonus        || '',
        types:        patch.healing?.types        || [],
        custom:       patch.healing?.custom       || { enabled: false, formula: '' },
        scaling:      patch.healing?.scaling      || { mode: '', number: null, formula: '' },
      }
      break

    default: // utility
      base.roll = { prompt: false, visible: false }
  }

  return base
}

// ───────────────────────────────────────────────────────────────────────
// SPELL ITEM BUILDER
// ───────────────────────────────────────────────────────────────────────

function makeCustomSpellItem(spell, character) {
  const edition = character.meta?.edition || '5e'
  const levelNum = spell.level || 0
  const schoolKey = SCHOOL_MAP[spell.school] || 'abj'
  const actId = makeId(`act_custom_${spell.name}`)
  const isCantrip = levelNum === 0

  return {
    _id:    makeId(`cspell_${spell.name}`),
    name:   spell.name,
    type:   'spell',
    img:    SCHOOL_ICONS[schoolKey] || 'icons/svg/aura.svg',
    system: {
      description:  { value: spell.description || '', chat: '' },
      identifier:   spell.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      source:       { book: spell.source || 'Custom', custom: spell.source || 'Custom' },
      activation:   { type: 'action', value: 1, condition: '' },
      duration:     { value: spell.duration || 'Instantaneous' },
      level:        levelNum,
      materials:    { value: '', consumed: false, cost: 0, supply: 0 },
      preparation:  { mode: isCantrip ? 'prepared' : 'always', prepared: true },
      properties:   buildSpellProperties(
        {}, spell.concentration || false, spell.ritual || false
      ),
      range:        parseRange(spell.range),
      school:       schoolKey,
      // Custom spells are not bound to a class — leave sourceClass empty so
      // Foundry doesn't try to link them to a non-existent class identifier.
      sourceClass:  '',
      target:       { affects: {}, template: { count: '', contiguous: false, type: '', size: '', width: '', height: '', units: 'ft' } },
      activities:   {
        [actId]: {
          _id: actId, type: 'utility', sort: 0,
          activation: { type: 'action', value: 1, condition: '', override: false },
          consumption: { spellSlot: !isCantrip, targets: [], scaling: { allowed: false, max: '' } },
          description: {},
          duration: { value: spell.duration || '', units: '', concentration: spell.concentration || false, override: false },
          effects: [],
          range: { ...parseRange(spell.range), special: '', override: false },
          target: { template: { contiguous: false, units: 'ft' }, affects: { choice: false }, override: false, prompt: true },
          uses: { spent: 0, recovery: [] },
          roll: { prompt: false, visible: false },
        },
      },
      uses: { spent: null, max: '', recovery: [] },
    },
    sort: 0,
    effects: [],
  }
}

/**
 * Only allow sourceClass values that correspond to an actually present class
 * on this character. Otherwise Foundry tries to bind the spell to a class
 * identifier that doesn't exist in the actor, causing import warnings.
 */
function resolveSourceClass(sourceClass, character) {
  if (!sourceClass) return ''
  const known = new Set((character.classes || []).map(c => (c.classId || '').toLowerCase()))
  const slug = sourceClass.toString().toLowerCase().replace(/\s+/g, '-')
  return known.has(sourceClass.toLowerCase()) ? slug : ''
}

function makeSpellItem(name, rawLevel, prepMode, sourceClass, character) {
  const edition    = character.meta?.edition || '5e'
  const charMeta   = (character.spellMetadata || {})[name] || {}

  // Merge with live spell data for accurate level/school/description.
  // IMPORTANT: The live DB (LIVE_SPELL_MAP, built from the real spell JSONs)
  // takes PRIORITY over charMeta. spellMetadata is often stale / defaulted to 0
  // which would mis-mark every spell as a cantrip. charMeta is only used as a
  // fallback when the live DB doesn't have the spell (e.g. homebrew).
  const live = LIVE_SPELL_MAP?.get(name.toLowerCase()) || {}
  const meta = {
    ...charMeta,
    level:         (typeof live.level === 'number') ? live.level : charMeta.level,
    school:        live.school || charMeta.school,
    source:        live.source || charMeta.source,
    castingTime:   live.castingTime || charMeta.castingTime,
    range:         live.range || charMeta.range,
    duration:      live.duration || charMeta.duration,
    concentration: typeof live.concentration === 'boolean' ? live.concentration : charMeta.concentration,
    ritual:        typeof live.ritual === 'boolean' ? live.ritual : charMeta.ritual,
    components:    live.components || charMeta.components,
    entries:       live.entries || charMeta.entries,
    entriesHigherLevel: live.entriesHigherLevel || charMeta.entriesHigherLevel,
  }

  // rawLevel is only used when the caller KNOWS it's a cantrip (0 passed explicitly).
  // Otherwise meta.level (from the live spell DB) is the authoritative value.
  const levelNum = rawLevel === 'cantrip' || rawLevel === 0
    ? 0
    : (typeof meta.level === 'number'
        ? meta.level
        : (typeof rawLevel === 'number' ? rawLevel : 0))
  const schoolKey  = SCHOOL_MAP[meta.school] || 'abj'
  const isInnate   = prepMode === 'innate'
  const isPact     = prepMode === 'pact'
  const isAlways   = prepMode === 'always'
  const sourceBook = meta.source || (edition === '5.5e' ? 'XPHB' : 'PHB')

  // ── Parsing ──────────────────────────────────────────
  const range   = parseRange(meta.range)
  const dur     = parseDuration(meta.duration)
  const actType = parseActivationType(meta.castingTime)

  // Spell component text
  const comps       = meta.components || {}
  const matRaw      = comps.m
  const matText     = typeof matRaw === 'string'  ? matRaw
                    : typeof matRaw === 'object'  ? (matRaw.text || '') : ''
  const matConsumed = typeof matRaw === 'object'  ? (matRaw.consumed || false) : false
  const matCost     = typeof matRaw === 'object'  ? (matRaw.cost    || 0)     : 0

  const properties = buildSpellProperties(comps, meta.concentration, meta.ritual)

  // ── Spell-Index Patch suchen ──────────────────────────
  const patchKey = `${name}||${sourceBook}`
  const patch    = SPELL_INDEX[patchKey] || null

  // Effects aus Patch bauen, foundryId → _id Map erstellen
  const effects    = []
  const effectIdMap = {}
  for (const effPatch of (patch?.effects || [])) {
    if (!effPatch.foundryId) continue
    const effId = makeId(`eff_${name}_${effPatch.foundryId}`)
    effectIdMap[effPatch.foundryId] = effId
    effects.push(buildEffect(effPatch, effId, name))
  }

  // Activities bauen
  let activities = {}
  if (patch?.activities?.length) {
    // Patched activities ersetzen das Default
    for (let i = 0; i < patch.activities.length; i++) {
      const actId = makeId(`act_${name}_${i}`)
      activities[actId] = buildSpellActivity(actId, patch.activities[i], meta, effectIdMap)
    }
  } else {
    // Default: eine utility-Activity (ermöglicht zumindest das Rollen)
    const actId = makeId(`act_${name}_default`)
    activities[actId] = {
      _id:  actId,
      type: 'utility',
      sort: 0,
      activation: {
        type:      actType,
        value:     1,
        condition: meta.castingTime?.toLowerCase().includes('reaction')
                   ? (meta.reactionCondition || '') : '',
        override:  false,
      },
      consumption: {
        spellSlot: !isInnate && levelNum > 0,
        targets:   [],
        scaling:   { allowed: false, max: '' },
      },
      description: {},
      duration: {
        value:         dur.value,
        units:         dur.units,
        concentration: meta.concentration ?? false,
        override:      false,
      },
      effects: [],
      range: {
        value:   range.value ?? '',
        units:   range.units,
        special: '',
        override: false,
      },
      target: {
        template: { contiguous: false, units: 'ft' },
        affects:  { choice: false },
        override: false,
        prompt:   true,
      },
      uses: { spent: 0, recovery: [] },
      roll: { prompt: false, visible: false },
    }
  }

  // ── Icon & Description vor system-Objekt deklarieren (TDZ-Fix) ──────────
  const spellImg  = patch?.img || lookupIcon(name, ICON_SPELLS) || SCHOOL_ICONS[schoolKey] || 'icons/svg/aura.svg'
  const spellDesc = SPELL_DESC[patchKey] || buildDescriptionFromEntries(meta.entries, meta.entriesHigherLevel)

  // Resolve sourceClass against actually present classes. Innate spells
  // (race/feat granted) must NEVER carry a class binding.
  const effectiveSourceClass = isInnate ? '' : resolveSourceClass(sourceClass, character)

  // ── System zusammenbauen ─────────────────────────────
  const system = {
    description:  { value: spellDesc, chat: '' },
    identifier:   name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    source:       makeSource(sourceBook, edition),
    activation:   { type: actType, value: 1, condition: '' },
    duration:     dur,
    level:        levelNum,
    materials:    { value: matText, consumed: matConsumed, cost: matCost, supply: 0 },
    preparation:  {
      mode:     isPact ? 'pact' : isInnate ? 'innate' : isAlways ? 'always' : 'prepared',
      prepared: !isInnate,
    },
    properties,
    range,
    school:      schoolKey,
    sourceClass: effectiveSourceClass,
    target: {
      affects:  deriveSpellTarget(meta),
      template: { count: '', contiguous: false, type: '', size: '', width: '', height: '', units: 'ft' },
    },
    activities,
    uses: isInnate
      ? { spent: 0, max: '1', recovery: [{ period: 'lr', type: 'recoverAll' }] }
      : { spent: null, max: '', recovery: [] },
  }

  // System dot-overrides aus dem Patch anwenden
  if (patch?.system) applyDotOverrides(system, patch.system)

  // Spell-class filter flags (für Tidy5e Sheet und andere Plugins)
  const classFlags = effectiveSourceClass
    ? {
        'spell-class-filter-for-5e': { parentClass: effectiveSourceClass },
        'tidy5e-sheet':              { parentClass: effectiveSourceClass },
      }
    : {}

  return {
    _id:     makeId(`spell_${name}_${effectiveSourceClass || 'g'}`),
    name,
    type:    'spell',
    img:     spellImg,
    system,
    effects,
    folder:  null,
    sort:    0,
    flags:   { dnd5e: { riders: { activity: [], effect: [] } }, ...classFlags },
    _stats:  makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// CLASS ITEM BUILDER
// ───────────────────────────────────────────────────────────────────────

function makeClassItem(cls, character) {
  const edition  = character.meta?.edition || '5e'
  const classKey = `class_${cls.classId}`

  // ── HP Advancement ────────────────────────────────────
  // Every level from 1..cls.level must have a value — Foundry uses this to
  // compute max HP. Missing entries mean "no HP gained at that level".
  const hpValue = {}
  for (let lv = 1; lv <= cls.level; lv++) {
    if (lv === 1) {
      hpValue['1'] = 'max'
    } else if (character.hpPreference?.method === 'roll' && cls.hpRolls?.[lv]) {
      hpValue[String(lv)] = cls.hpRolls[lv]
    } else {
      hpValue[String(lv)] = 'avg'
    }
  }

  // ── Saving Throw Advancement ──────────────────────────
  // IMPORTANT: In Foundry, only ONE class — the primary (first) — grants saves.
  // Multiclassed characters must not gain both sets of saves from both classes.
  // Classes beyond index 0 are considered multiclass and don't add save profs.
  const rawSaves = cls.startingProficiencies?.savingThrows
    || cls.proficiency
    || CLASS_SAVES[cls.classId]
    || []
  const saveGrants = rawSaves.map(s => `saves:${s.toLowerCase()}`).filter(Boolean)
  const isPrimaryClass = character.classes?.[0]?.classId === cls.classId

  // ── Skill Advancement (aus character.choices) ─────────
  // Unified choice keys: "class:{classId}:level1:skill:{n}" → Wert
  const chosenSkills = []
  for (const [key, val] of Object.entries(character.choices || {})) {
    const parts = key.split(':')
    if (parts[0] !== 'class' || parts[1] !== cls.classId) continue
    if (!key.includes(':skill:')) continue
    for (const sk of (Array.isArray(val) ? val : [val])) {
      // sk kann Foundry-ID ('arc') oder camelCase ('arcana') sein
      const fid = FOUNDRY_SKILL_ID[sk]
              ?? FOUNDRY_SKILL_ID[sk.toLowerCase().replace(/\s+/g, '')]
              ?? (Object.values(FOUNDRY_SKILL_ID).includes(sk) ? sk : null)
      if (fid && !chosenSkills.includes(`skills:${fid}`)) {
        chosenSkills.push(`skills:${fid}`)
      }
    }
  }
  // Fallback: levelChoices[1]
  if (!chosenSkills.length) {
    for (const sk of (cls.levelChoices?.[1]?.skillProficiencies || [])) {
      const fid = FOUNDRY_SKILL_ID[sk]
              ?? FOUNDRY_SKILL_ID[sk.toLowerCase().replace(/\s+/g, '')]
              ?? null
      if (fid && !chosenSkills.includes(`skills:${fid}`)) {
        chosenSkills.push(`skills:${fid}`)
      }
    }
  }

  // ── ScaleValue Advancement aus Class-Index ────────────
  const subclassName  = cls.subclassId?.split('__')[0] || ''
  const clsIndexEntry = (CLASS_INDEX._shared?.class || []).find(c => c.name === cls.classId)
  const subIndexEntry = (CLASS_INDEX._shared?.subclass || []).find(s =>
    s.name === subclassName && s.className === cls.classId
  )

  const advancement = [
    // HitPoints (immer)
    {
      _id:           makeId(`adv_hp_${classKey}`),
      type:          'HitPoints',
      configuration: {},
      value:         hpValue,
    },
    // Saving Throws — only the primary (first) class grants saves
    ...(saveGrants.length && isPrimaryClass ? [{
      _id:  makeId(`adv_saves_${classKey}`),
      type: 'Trait',
      configuration: {
        allowReplacements: false,
        choices:           [],
        grants:            saveGrants,
        mode:              'default',
      },
      value: { chosen: saveGrants },
      level: 1,
      classRestriction: 'primary',
    }] : []),
    // Skill Choices — only the primary class; multiclass skill grants come
    // from multiclass-proficiencies, not the class's level-1 choice list.
    ...(chosenSkills.length && isPrimaryClass ? [{
      _id:  makeId(`adv_skills_${classKey}`),
      type: 'Trait',
      configuration: {
        allowReplacements: true,
        choices:           [],
        grants:            chosenSkills,
        mode:              'default',
      },
      value: { chosen: chosenSkills },
    }] : []),
    // ScaleValues der Klasse (z.B. Sorcery Points, Rage Damage …)
    ...((clsIndexEntry?.advancement || []).map(adv => ({
      _id:           makeId(`adv_scl_cls_${cls.classId}_${adv.title}`),
      type:          'ScaleValue',
      configuration: adv.configuration,
      title:         adv.title,
      value:         {},
    }))),
    // ScaleValues der Subklasse (z.B. Psychic Blades, Divine Strike …)
    ...((subIndexEntry?.advancement || []).map(adv => ({
      _id:           makeId(`adv_scl_sub_${subclassName}_${adv.title}`),
      type:          'ScaleValue',
      configuration: adv.configuration,
      title:         adv.title,
      value:         {},
    }))),
  ]

  return {
    _id:  makeId(classKey),
    name: cls.classId,
    type: 'class',
    img:  CLASS_INDEX.classes[cls.classId]?.class?.[0]?.img || lookupIcon(cls.classId, ICON_CLASSES) || 'icons/svg/item-bag.svg',
    system: {
      description:       {
        value: CLASS_INDEX.classes[cls.classId]?.class?.[0]?.system?.description?.value
               || CF_DESC?.[`_class||${cls.classId}`] || '',
        chat: ''
      },
      identifier:        cls.classId.toLowerCase().replace(/\s+/g, '-'),
      source:            makeSource(cls.source || 'PHB', edition),
      startingEquipment: [],
      wealth:            '',
      levels:            cls.level,
      primaryAbility:    { value: [], all: false },
      hd: {
        denomination: `d${cls.hitDie || 8}`,
        spent:        0,
        additional:   '',
      },
      spellcasting: {
        progression: cls.casterProgression || 'none',
        ability:     cls.spellcastingAbility || '',
      },
      advancement,
    },
    effects: [],
    folder:  null,
    sort:    0,
    flags:   {},
    _stats:  makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// SUBCLASS ITEM BUILDER
// ───────────────────────────────────────────────────────────────────────

function makeSubclassItem(cls, character) {
  const edition      = character.meta?.edition || '5e'
  const subclassName = cls.subclassId.split('__')[0]
  const subEntry     = (CLASS_INDEX._shared?.subclass || []).find(s =>
    s.name === subclassName && s.className === cls.classId
  )

  const advancement = (subEntry?.advancement || []).map(adv => ({
    _id:           makeId(`adv_sub_${subclassName}_${adv.title}`),
    type:          'ScaleValue',
    configuration: adv.configuration,
    title:         adv.title,
    value:         {},
  }))

  return {
    _id:  makeId(`subclass_${cls.subclassId}`),
    name: subclassName,
    type: 'subclass',
    img:  subEntry?.img || CLASS_INDEX.classes[cls.classId]?.subclass?.find(s => s.name === subclassName)?.img || lookupIcon(subclassName, ICON_CLASSES) || 'icons/svg/item-bag.svg',
    system: {
      description: {
        value: subEntry?.system?.description?.value
          || CLASS_INDEX.classes[cls.classId]?.subclass?.find(s => s.name === subclassName)?.system?.description?.value
          || CF_DESC?.[`_subclass||${subclassName}||${cls.classId}`] || '',
        chat: ''
      },
      identifier:      subclassName.toLowerCase().replace(/\s+/g, '-'),
      source:          makeSource(cls.source || 'PHB', edition),
      classIdentifier: cls.classId.toLowerCase().replace(/\s+/g, '-'),
      spellcasting:    { progression: 'none' },
      advancement,
    },
    effects: [],
    folder:  null,
    sort:    0,
    flags:   {},
    _stats:  makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// RACE ITEM BUILDER
// Erzeugt das top-level Race-Item (type: 'race') mit movement, senses,
// type und advancement.
// ───────────────────────────────────────────────────────────────────────

function makeRaceItem(character) {
  const edition    = character.meta?.edition || '5e'
  const raceName   = character.species?.raceId?.split('__')[0] || ''
  const subrace    = character.species?.subraceId?.split('__')[0] || ''
  const raceSource = character.species?.source || 'PHB'
  const displayName = subrace
    ? `${raceName} (${subrace})`
    : raceName

  // Beschreibung aus races.json bauen
  const raceEntry = (RACE_DATA?.race || []).find(r =>
    r.name === raceName && (r.source === raceSource || !raceSource)
  )
  const descHtml = raceEntry ? entriesToHtml(raceEntry.entries || []) : ''

  const speed      = character.species?.speed || 30
  const speedObj   = typeof speed === 'object' ? speed : { walk: speed }
  const darkvision = character.species?.darkvision || 0
  const sizeCode   = SIZE_MAP[character.species?.size || 'M'] || 'med'

  // Advancement: Size + Language grants
  const advancement = [
    {
      _id:           makeId(`adv_race_size_${raceName}`),
      type:          'Size',
      configuration: { sizes: [sizeCode] },
      level:         0,
      value:         { size: sizeCode },
    },
  ]

  return {
    _id:  makeId(`race_${displayName}`),
    name: displayName,
    type: 'race',
    img:  lookupIcon(raceName, ICON_RACES) || lookupIcon(displayName, ICON_RACES) || 'icons/svg/mystery-man.svg',
    system: {
      description: { value: descHtml, chat: '' },
      identifier:  displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      source:      makeSource(raceSource, edition),
      advancement,
      movement: {
        burrow: speedObj.burrow || 0,
        climb:  speedObj.climb  || 0,
        fly:    speedObj.fly    || 0,
        swim:   speedObj.swim   || 0,
        walk:   speedObj.walk   || 30,
        units:  'ft',
        hover:  false,
      },
      senses: {
        darkvision,
        blindsight:  0,
        tremorsense: 0,
        truesight:   0,
        units:       'ft',
        special:     '',
      },
      type: { value: 'humanoid' },
    },
    effects: [],
    folder:  null,
    sort:    0,
    flags:   {},
    _stats:  makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// BACKGROUND ITEM BUILDER
// Erzeugt das Background-Item (type: 'background') mit Skill/Tool/Language
// advancement.
// ───────────────────────────────────────────────────────────────────────

function makeBackgroundItem(character) {
  const edition  = character.meta?.edition || '5e'
  const bgId     = character.background?.backgroundId?.split('__')[0] || ''
  const bgSource = character.background?.source || 'PHB'

  // Beschreibung aus backgrounds.json
  const bgEntry = (BG_DATA?.background || []).find(b =>
    b.name === bgId && (b.source === bgSource || !bgSource)
  )
  const descHtml = bgEntry ? entriesToHtml(bgEntry.entries || []) : ''

  // Skill grants aus character.background
  const skillGrants = (character.background?.skillProficiencies || []).map(sk => {
    const fid = FOUNDRY_SKILL_ID[sk]
      ?? FOUNDRY_SKILL_ID[sk.toLowerCase().replace(/\s+/g, '')]
      ?? null
    return fid ? `skills:${fid}` : null
  }).filter(Boolean)

  const advancement = []
  if (skillGrants.length) {
    advancement.push({
      _id:           makeId(`adv_bg_skills_${bgId}`),
      type:          'Trait',
      configuration: { allowReplacements: true, choices: [], grants: skillGrants, mode: 'default' },
      value:         { chosen: skillGrants },
      level:         0,
      title:         'Skill Proficiencies',
    })
  }

  return {
    _id:  makeId(`bg_${bgId}`),
    name: bgId,
    type: 'background',
    img:  lookupIcon(bgId, ICON_GENERAL) || 'icons/skills/trades/academics-book-study-purple.webp',
    system: {
      description:       { value: descHtml, chat: '' },
      identifier:        bgId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      source:            makeSource(bgSource, edition),
      startingEquipment: [],
      advancement,
    },
    effects: [],
    folder:  null,
    sort:    0,
    flags:   {},
    _stats:  makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// RACIAL TRAIT ITEM BUILDER
// Erzeugt feat-Items (type.value: 'race') für jeden Racial Trait,
// z.B. Darkvision, Fey Ancestry, Celestial Resistance.
// Nutzt foundry-races.json raceFeature Patches für ActiveEffects.
// ───────────────────────────────────────────────────────────────────────

function makeRacialTraitItems(character) {
  const edition     = character.meta?.edition || '5e'
  const raceName    = character.species?.raceId?.split('__')[0] || ''
  const subrace     = character.species?.subraceId?.split('__')[0] || ''
  const raceSource  = character.species?.source || 'PHB'
  const raceItemId  = makeId(`race_${subrace ? `${raceName} (${subrace})` : raceName}`)

  // 5etools race entry → entries für Beschreibungen
  const raceEntry = (RACE_DATA?.race || []).find(r =>
    r.name === raceName && (r.source === raceSource || !raceSource)
  )
  const raceEntries = (raceEntry?.entries || []).filter(e =>
    typeof e === 'object' && e.type === 'entries' && e.name
  )

  // Foundry raceFeature patches (für ActiveEffects)
  const raceFeatPatches = (RACE_FNDRY?.raceFeature || []).filter(rf =>
    rf.raceName === raceName || rf.raceName === subrace
  )

  const items = []
  for (const entry of raceEntries) {
    const traitName = entry.name
    // Überspringe rein informationale Einträge (Age, Size, Alignment, Languages)
    if (/^(Age|Size|Alignment|Languages?)$/i.test(traitName)) continue

    const descHtml = entriesToHtml(entry.entries || [])

    // Suche Foundry patch für ActiveEffects
    const patch = raceFeatPatches.find(rf => rf.name === traitName)
    const effects = (patch?.effects || []).map((eff, i) => ({
      _id:      makeId(`rfe_${raceName}_${traitName}_${i}`),
      name:     eff.name || traitName,
      type:     'base',
      system:   {},
      img:      'icons/svg/aura.svg',
      origin:   null,
      tint:     '#ffffff',
      transfer: eff.transfer ?? true,
      disabled: eff.disabled ?? false,
      statuses: [],
      changes:  (eff.changes || []).map(ch => ({
        key:      ch.key,
        value:    String(ch.value),
        mode:     effectMode(ch.mode),
        priority: ch.priority ?? 20,
      })),
      duration: {
        seconds: null, startTime: null, rounds: null, turns: null,
        startRound: null, startTurn: null, combat: null,
      },
      flags:       { dae: { transfer: true, stackable: 'noneNameOnly' }, core: {} },
      description: '',
      sort:        0,
      _stats:      makeStats(),
    }))

    items.push({
      _id:  makeId(`rtrait_${raceName}_${traitName}`),
      name: traitName,
      type: 'feat',
      img:  lookupIcon(traitName, ICON_RACES, ICON_GENERAL) || 'icons/svg/aura.svg',
      system: {
        description:   { value: descHtml, chat: '' },
        identifier:    traitName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        source:        makeSource(raceSource, edition),
        prerequisites: { repeatable: false },
        properties:    [],
        requirements:  '',
        type:          { value: 'race', subtype: '' },
        advancement:   [],
        activities:    {},
        uses:          { spent: 0, recovery: [] },
        crewed:        false,
        enchant:       {},
      },
      effects,
      folder: null,
      sort:   0,
      flags:  { dnd5e: { advancementOrigin: raceItemId } },
      _stats: makeStats(),
    })
  }

  return items
}

// ───────────────────────────────────────────────────────────────────────
// CLASS FEATURE ITEM BUILDER
// Erzeugt nur Items für Features die aus dem Class-Index tatsächlich
// Effects oder Activities haben (kein leerer Platzhalter-Müll).
// ───────────────────────────────────────────────────────────────────────

function makeClassFeatureItem(featData, cls, character) {
  const edition     = character.meta?.edition || '5e'
  const classItemId = makeId(`class_${cls.classId}`)

  // ── ActiveEffects ─────────────────────────────────────
  const effects = (featData.effects || []).map((eff, i) => ({
    _id:      makeId(`cfe_${cls.classId}_${featData.name}_${i}`),
    name:     eff.name || featData.name,
    type:     'base',
    system:   {},
    img:      'icons/svg/aura.svg',
    origin:   null,
    tint:     '#ffffff',
    transfer: eff.transfer ?? true,
    disabled: eff.disabled ?? false,
    statuses: [],
    changes:  (eff.changes || []).map(ch => ({
      key:      ch.key,
      value:    String(ch.value),
      mode:     effectMode(ch.mode),
      priority: ch.priority ?? 20,
    })),
    duration: {
      seconds:    null,
      startTime:  null,
      rounds:     eff.duration?.rounds ?? null,
      turns:      eff.duration?.turns  ?? null,
      startRound: null,
      startTurn:  null,
      combat:     null,
    },
    flags:       { dae: { transfer: true, stackable: 'noneNameOnly' } },
    description: '',
    sort:        0,
    _stats:      makeStats(),
  }))

  // ── Activities ────────────────────────────────────────
  const activities = {}
  for (let i = 0; i < (featData.activities || []).length; i++) {
    const actPatch = featData.activities[i]
    const actId    = makeId(`act_${cls.classId}_${featData.name}_${i}`)
    const actType  = actPatch.type || 'utility'

    const act = {
      _id:  actId,
      type: actType,
      sort: 0,
      activation: {
        type:      actPatch.activation?.type || 'action',
        value:     1,
        condition: actPatch.activation?.condition || '',
        override:  !!actPatch.activation?.type,
      },
      consumption: { spellSlot: false, targets: [], scaling: { allowed: false, max: '' } },
      description: {},
      duration:    { value: '', units: 'inst', concentration: false, override: false },
      effects:     [],
      range: {
        value:    featData.system?.['range.value'] != null
                  ? String(featData.system['range.value']) : '',
        units:    featData.system?.['range.units'] || '',
        special:  '',
        override: !!featData.system?.['range.value'],
      },
      target: {
        template: { contiguous: false, units: 'ft', ...(actPatch.target?.template || {}) },
        affects:  { choice: false,                  ...(actPatch.target?.affects  || {}) },
        override: !!actPatch.target,
        prompt:   true,
      },
      uses: { spent: 0, recovery: [] },
    }

    if (actType === 'damage' && actPatch.damage?.parts) {
      act.damage = buildDamageParts(actPatch.damage.parts)
    }
    if (['utility', 'heal'].includes(actType)) {
      act.roll = { prompt: false, visible: false }
    }

    activities[actId] = act
  }

  return {
    _id:  makeId(`cf_${cls.classId}_${featData.name}_${featData.level}`),
    name: featData.name,
    type: 'feat',
    img:  featData.img || lookupIcon(featData.name, ICON_CLASS_FEATURES, ICON_GENERAL) || 'icons/svg/aura.svg',
    system: {
      description:   {
        value: featData.system?.description?.value || lookupClassFeatureDesc(featData.name, cls.classId) || '',
        chat:  ''
      },
      identifier:    featData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      source:        makeSource(featData.source || cls.source || 'PHB', edition),
      prerequisites: { level: featData.level || 1, repeatable: false },
      properties:    [],
      requirements:  `${cls.classId} ${featData.level}`,
      type:          { value: featData.subclassShortName ? 'subclass' : 'class', subtype: '' },
      advancement:   [],
      activities,
      uses:          { spent: 0, recovery: [] },
      crewed:        false,
      enchant:       {},
    },
    effects,
    folder: null,
    sort:   0,
    flags:  { dnd5e: { advancementOrigin: classItemId } },
    _stats: makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// FEAT ITEM BUILDER
// ───────────────────────────────────────────────────────────────────────

function makeFeatItem(feat, character) {
  const edition  = character.meta?.edition || '5e'
  const featImg  = lookupFeatImg(feat.featId, feat.source, FEAT_INDEX)
  const featDesc = lookupFullFeatDesc(feat.featId, feat.source)
  return {
    _id:  makeId(`feat_${feat.featId}`),
    name: feat.featId,
    type: 'feat',
    img:  featImg || lookupIcon(feat.featId, ICON_FEATS) || 'icons/svg/item-bag.svg',
    system: {
      description:   { value: featDesc, chat: '' },
      identifier:    feat.featId.toLowerCase().replace(/\s+/g, '-'),
      source:        makeSource(feat.source || 'PHB', edition),
      prerequisites: { repeatable: false },
      properties:    [],
      requirements:  '',
      type:          { value: 'feat', subtype: '' },
      advancement:   [],
      activities:    {},
      uses:          { spent: 0, recovery: [] },
      crewed:        false,
      enchant:       {},
    },
    effects: [],
    folder:  null,
    sort:    0,
    flags:   {},
    _stats:  makeStats(),
  }
}

// ───────────────────────────────────────────────────────────────────────
// INVENTORY ITEM BUILDER
// Unterstützt Waffen, Rüstungen, Schilde und allgemeine Ausrüstung.
// ───────────────────────────────────────────────────────────────────────

function makeInventoryItem(item, edition) {
  const slug  = (item.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const src   = makeSource(item.source || 'PHB', edition)
  // item.value ist in CP gespeichert → in GP umrechnen (gerundet auf 4 Dezimalstellen)
  const priceGp = item.value != null ? +(item.value / 100).toFixed(4) : 0

  const { img: itemFoundryImg, description: itemFoundryDesc } =
    lookupItemFoundry(item.name || item.itemId, item.source, ITEM_FNDRY)
  const itemTypeIcon = ITEM_TYPE_ICONS[(item.type || '').split('|')[0]] || 'icons/svg/item-bag.svg'
  const itemImg = itemFoundryImg || lookupIcon(item.name || item.itemId, ICON_ITEMS) || itemTypeIcon
  const itemDesc = itemFoundryDesc || ''

  const baseSystem = {
    description:  { value: itemDesc, chat: '' },
    identifier:   slug,
    source:       src,
    quantity:     item.quantity || 1,
    weight:       { value: item.weight ?? 0, units: 'lb' },
    price:        { value: priceGp, denomination: 'gp' },
    rarity:       item.rarity || '',
    attunement:   item.attuned ? 'required' : '',
    attuned:      item.attuned  ?? false,
    equipped:     item.equipped ?? false,
    identified:   true,
    unidentified: { description: '' },
    container:    null,
    uses:         { spent: null, recovery: [] },
    activities:   {},
  }

  // ── Waffe ──────────────────────────────────────────
  if (item.isWeapon) {
    const isRanged  = item.type === 'R'
      || (item.properties || []).some(p => ['Ammunition', 'Thrown'].includes(p))
    const isMartial = (item.weaponCategory || '').toLowerCase() === 'martial'
    const wTypeVal  = isRanged
      ? (isMartial ? 'martialR' : 'simpleR')
      : (isMartial ? 'martialM' : 'simpleM')

    // Schaden-Würfel parsen: "2d6", "1d8", "d4" …
    const dmgMatch = (item.dmg1 || '').match(/^(\d+)?d(\d+)/)
    const dmgNum   = dmgMatch ? parseInt(dmgMatch[1] || '1', 10) : 1
    const dmgDie   = dmgMatch ? parseInt(dmgMatch[2], 10)        : 4
    const dmgType  = DMG_TYPE_MAP[item.dmgType] || item.dmgType?.toLowerCase() || 'bludgeoning'

    // Waffen-Eigenschaften → Foundry Tags
    const wProps = (item.properties || []).map(p => WEAPON_PROP_MAP[p]).filter(Boolean)

    // Standard weapon attack activity
    const actId   = 'dnd5eactivity000'
    const activity = {
      _id:  actId,
      type: 'attack',
      sort: 0,
      activation:  { type: 'action', value: 1, condition: '', override: false },
      consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: true },
      description: { chatFlavor: '' },
      duration:    { concentration: false, value: '', units: 'inst', special: '', override: false },
      effects:     [],
      range: {
        value:    isRanged ? String(item.range?.normal || '') : '5',
        units:    'ft',
        special:  '',
        override: false,
      },
      target: {
        template: { count: '', contiguous: false, type: '', size: '', width: '', height: '', units: '' },
        affects:  { count: '', type: '', choice: false, special: '' },
        prompt: true, override: false,
      },
      attack: {
        ability:  '',
        bonus:    '',
        critical: { threshold: null },
        flat:     false,
        type:     { value: isRanged ? 'ranged' : 'melee', classification: 'weapon' },
      },
      damage: { critical: { bonus: '' }, includeBase: true, parts: [] },
      uses:   { spent: 0, recovery: [] },
    }

    return {
      _id:  makeId(`inv_${item.id || item.name}`),
      name: item.name || item.itemId || 'Unknown Item',
      type: 'weapon',
      img:  itemImg,
      system: {
        ...baseSystem,
        activities:  { [actId]: activity },
        damage: {
          base: {
            number: dmgNum, denomination: dmgDie, bonus: '',
            types:  [dmgType],
            custom: { enabled: false, formula: '' },
            scaling: { mode: '', number: null, formula: '' },
          },
          versatile: { types: [], custom: { enabled: false }, scaling: { number: 1 } },
        },
        armor:        { value: 10 },
        hp:           { value: 0, max: 0, dt: null, conditions: '' },
        properties:   wProps,
        proficient:   null,
        type:         { value: wTypeVal, baseItem: slug },
        crewed:       false,
        magicalBonus: null,
        cover:        null,
        range: {
          value: isRanged ? (item.range?.normal ?? null) : null,
          long:  isRanged ? (item.range?.long   ?? 0)   : 5,
          units: 'ft',
        },
        ammunition: {},
      },
      effects: [],
      folder:  null,
      sort:    0,
      flags:   {},
      _stats:  makeStats(),
    }
  }

  // ── Rüstung / Schild ───────────────────────────────
  if (item.isArmor || item.isShield) {
    const rawType    = (item.type || '').split('|')[0]
    const armorType  = rawType === 'LA' ? 'light'
                     : rawType === 'MA' ? 'medium'
                     : rawType === 'HA' ? 'heavy'
                     : rawType === 'S'  ? 'shield' : 'clothing'
    const dexCap     = rawType === 'MA' ? 2 : rawType === 'HA' ? 0 : null

    return {
      _id:  makeId(`inv_${item.id || item.name}`),
      name: item.name || 'Unknown Item',
      type: 'equipment',
      img:  itemImg,
      system: {
        ...baseSystem,
        crewed:     false,
        armor:      { value: item.ac ?? null, dex: dexCap },
        proficient: null,
        properties: [],
        strength:   item.strength || 0,
        type:       { value: armorType, baseItem: '' },
      },
      effects: [],
      folder:  null,
      sort:    0,
      flags:   {},
      _stats:  makeStats(),
    }
  }

  // ── Container (Backpack, Pouch, Chest, etc.) ────────
  const itemFndryEntry = lookupItemFoundry(item.name || item.itemId, item.source, ITEM_FNDRY)
  const containerCap   = itemFndryEntry.containerCapacity || null
  if (containerCap) {
    const capWeight = Array.isArray(containerCap.weight) ? containerCap.weight.reduce((a,b) => a+b, 0) : 0
    return {
      _id:  makeId(`inv_${item.id || item.name}`),
      name: item.name || 'Unknown Item',
      type: 'container',
      img:  itemImg,
      system: {
        ...baseSystem,
        properties: [],
        capacity: {
          weight:  { value: capWeight, units: 'lb' },
          volume:  { units: 'cubicFoot' },
        },
        currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
      },
      effects: [],
      folder:  null,
      sort:    0,
      flags:   {},
      _stats:  makeStats(),
    }
  }

  // ── Allgemeine Ausrüstung / Loot ───────────────────
  const typeCode     = (item.type || '').split('|')[0]
  const isConsumable = ['P', 'SC', 'OTH'].includes(typeCode)
  const foundryType  = isConsumable ? 'consumable' : 'loot'
  const subTypeVal   = typeCode === 'P'  ? 'potion'
                     : typeCode === 'SC' ? 'scroll' : 'gear'

  return {
    _id:  makeId(`inv_${item.id || item.name}`),
    name: item.name || 'Unknown Item',
    type: foundryType,
    img:  itemImg,
    system: {
      ...baseSystem,
      properties: [],
      type:       { value: subTypeVal, subtype: '' },
    },
    effects: [],
    folder:  null,
    sort:    0,
    flags:   {},
    _stats:  makeStats(),
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HAUPTFUNKTION
// ═══════════════════════════════════════════════════════════════════════

export async function exportToFoundry(character) {
  await ensureIndexes()

  // Load live spell data for accurate levels/schools/descriptions
  if (!LIVE_SPELL_MAP) {
    try {
      const { loadSpellList } = await import('./dataLoader')
      const spells = await loadSpellList(character.meta?.edition || '5e')
      LIVE_SPELL_MAP = new Map()
      for (const sp of spells) {
        LIVE_SPELL_MAP.set(sp.name.toLowerCase(), sp)
      }
    } catch (e) {
      console.warn('[Export] Could not load spell data:', e)
      LIVE_SPELL_MAP = new Map()
    }
  }

  // ── Computed Character Stats ─────────────────────────
  const computed  = computeCharacter(character) || {}
  const scores    = computeAbilityScores(character)
  const modifiers = computeModifiers(scores)
  const profBonus = getProficiencyBonus(character)
  const edition   = character.meta?.edition || '5e'
  const profs     = computed.proficiencies || {}

  // ── Ability Scores mit vollständigem roll-Block ──────
  const rollBlock = { min: null, max: null, mode: 0 }
  const abilities = {}
  for (const [key, score] of Object.entries(scores)) {
    abilities[key] = {
      value:     score,
      proficient: profs.savingThrows?.[key] ? 1 : 0,
      max:       20,
      bonuses:   { check: '', save: '' },
      check:     { roll: { ...rollBlock } },
      save:      { roll: { ...rollBlock } },
    }
  }

  // ── Skills mit Jack of All Trades Support ────────────
  const isJoat = character.classes.some(c => c.classId === 'Bard' && c.level >= 2)
  const skills  = {}
  for (const [skillName, ability] of Object.entries(SKILL_MAP)) {
    const fid        = FOUNDRY_SKILL_ID[skillName]
    const profStatus = profs.skills?.[skillName] || null
    let profValue = 0
    if (profStatus === 'expertise')   profValue = 2
    else if (profStatus === 'proficient') profValue = 1
    else if (isJoat) profValue = 0.5   // Bard: Jack of All Trades

    skills[fid] = {
      value:   profValue,
      ability,
      roll:    { ...rollBlock },
      bonuses: { check: '', passive: '' },
    }
  }

  // ── HP ────────────────────────────────────────────────
  const maxHp     = computed.hp?.max || 1
  const currentHp = computed.hp?.current ?? maxHp
  const tempHp    = character.status?.temporaryHp || null

  // ── Spell Slots berechnen ─────────────────────────────
  let casterLevel = 0
  let warlockData  = null
  let spellcastingAbility = ''
  for (const cls of (character.classes || [])) {
    if (cls.spellcastingAbility && !spellcastingAbility) {
      spellcastingAbility = cls.spellcastingAbility
    }
    const prog = cls.casterProgression
    if      (prog === 'full') casterLevel += cls.level
    else if (prog === 'half') casterLevel += Math.floor(cls.level / 2)
    else if (prog === '1/3')  casterLevel += Math.floor(cls.level / 3)
    else if (prog === 'pact') warlockData  = WARLOCK_SLOTS[cls.level] || null
  }
  const effCL  = Math.min(20, Math.round(casterLevel))
  const slotArr = effCL > 0 ? FULL_CASTER_SLOTS[effCL] : null
  const spellSlots = {
    spell1: { value: slotArr?.[0] || 0 }, spell2: { value: slotArr?.[1] || 0 },
    spell3: { value: slotArr?.[2] || 0 }, spell4: { value: slotArr?.[3] || 0 },
    spell5: { value: slotArr?.[4] || 0 }, spell6: { value: slotArr?.[5] || 0 },
    spell7: { value: slotArr?.[6] || 0 }, spell8: { value: slotArr?.[7] || 0 },
    spell9: { value: slotArr?.[8] || 0 }, pact:   { value: warlockData?.slots || 0 },
  }

  // ── Proficiency Strings → Foundry Arrays ─────────────
  const weaponProfValues  = []
  const weaponProfCustom  = []
  for (const wp of (profs.weapons || [])) {
    const mapped = WEAPON_PROF_MAP[wp.toLowerCase()]
    if (mapped) weaponProfValues.push(mapped)
    else        weaponProfCustom.push(wp)
  }
  const armorProfValues = []
  const armorProfCustom = []
  for (const ap of (profs.armor || [])) {
    const mapped = ARMOR_PROF_MAP[ap.toLowerCase()]
    if (mapped) armorProfValues.push(mapped)
    else        armorProfCustom.push(ap)
  }
  const langValues = (profs.languages || []).map(l => l.toLowerCase().replace(/\s+/g, ''))

  // Tool Proficiencies
  const tools = {}
  for (const [toolKey, lvl] of Object.entries(profs.tools || {})) {
    const tid    = makeId(`tool_${toolKey}`)
    tools[tid]   = { value: lvl === 'expertise' ? 2 : 1, ability: 'int' }
  }

  // ── Speed ─────────────────────────────────────────────
  const speed = computed.speed || {}

  // ── Actor Identifiers ─────────────────────────────────
  const raceName    = character.species?.raceId?.split('__')[0] || ''
  const subraceName = character.species?.subraceId?.split('__')[0] || ''
  const bgName      = character.background?.backgroundId?.split('__')[0] || ''
  const sizeCode    = SIZE_MAP[character.species?.size || 'M'] || 'med'
  const darkvision  = character.species?.darkvision || 0

  // ── Resources: erste 3 aktive → primary/secondary/tertiary ──
  const activeResources = (computed.resources || []).filter(r => r.type !== 'passive')
  const resSlots = ['primary', 'secondary', 'tertiary']
  const resources = {}
  for (const slot of resSlots) {
    const res = activeResources.shift()
    resources[slot] = res
      ? {
          value: res.current ?? res.max ?? 0,
          max:   res.max || 0,
          sr:    res.recharge === 'short_rest',
          lr:    res.recharge === 'long_rest',
          label: res.name,
        }
      : { value: 0, max: 0, sr: false, lr: false, label: '' }
  }

  // ════════════════════════════════════════════════════
  // ITEMS AUFBAUEN
  // ════════════════════════════════════════════════════

  // 1. Klassen
  const classItems = (character.classes || []).map(cls => makeClassItem(cls, character))

  // 2. Subklassen
  const subclassItems = (character.classes || [])
    .filter(cls => cls.subclassId)
    .map(cls => makeSubclassItem(cls, character))

  // 3. Klassen-Features — uses both shared patches AND per-class full item docs
  const classFeatureItems = []
  const seenFeatures = new Set()   // deduplicate by "className|featureName|level"

  for (const cls of (character.classes || [])) {
    const subName = cls.subclassId?.split('__')[0] || null

    // ── A: Per-class full item docs (have img + description + effects/activities)
    //   Stored in CLASS_INDEX.classes[classId].classFeature / .subclassFeature
    const perClassFeatures = [
      ...(CLASS_INDEX.classes[cls.classId]?.classFeature    || []),
      ...(CLASS_INDEX.classes[cls.classId]?.subclassFeature || []),
    ]

    // ── B: Shared patches (_shared.classFeature — may add AEs to features
    //   that are already covered by A, but can also be standalone patches)
    const sharedPatches = (CLASS_INDEX._shared?.classFeature || [])

    // Merge: per-class docs first, then fill in from shared if not already present
    const allPatches = [...perClassFeatures]
    for (const sp of sharedPatches) {
      if (!sp?.name) continue
      if (!allPatches.some(f => f.className === cls.classId && f.name === sp.name)) {
        allPatches.push(sp)
      }
    }

    for (const f of allPatches) {
      if (!f?.name) continue
      // Filter: must belong to this class
      const fClass = f.className || f.classIdentifier || cls.classId
      if (fClass !== cls.classId) continue
      // Filter: must not exceed character's level in this class
      if ((f.level ?? 0) > cls.level) continue
      // Filter: subclass features only if character has this subclass
      const fSub = f.subclassShortName || f.subclassIdentifier || null
      if (fSub && fSub !== subName) continue

      // Include if: has any meaningful content (effects, activities, description,
      // img, entryData like proficiency grants, or at minimum a name)
      const hasContent = !!f.name

      if (!hasContent) continue

      const dedupKey = `${cls.classId}|${f.name}|${f.level ?? 0}`
      if (seenFeatures.has(dedupKey)) continue
      seenFeatures.add(dedupKey)

      classFeatureItems.push(makeClassFeatureItem(f, cls, character))
    }
  }

  // 4. Feats
  const featItems = (character.feats || []).map(feat => makeFeatItem(feat, character))

  // 5. Zauber (dedupliziert)
  // ─────────────────────────────────────────────────────────────────────
  // The spell pipeline is heavily filtered to avoid two classic failure modes:
  //   (a) Pseudo-spells like "Bard Spells" / "Wizard Cantrips" that leak in
  //       from expanded-spell-list choice UIs and make Foundry reject the
  //       whole actor import.
  //   (b) Every spell getting level=0 because spellMetadata defaulted level.
  //       Fixed inside makeSpellItem by preferring LIVE_SPELL_MAP over charMeta.
  // ─────────────────────────────────────────────────────────────────────
  const spellItems  = []
  const addedSpells = new Set()

  function addSpell(name, level, mode, srcClass) {
    if (isFakeSpellName(name)) return
    // Innate + race-granted spells must NOT carry a sourceClass — otherwise
    // Foundry tries to bind them to a (potentially non-existent) class.
    const cleanSrcClass = (mode === 'innate') ? null : srcClass
    const key = `${name}__${cleanSrcClass || 'g'}`
    if (addedSpells.has(key)) return
    addedSpells.add(key)
    spellItems.push(makeSpellItem(name, level, mode, cleanSrcClass, character))
  }

  for (const cls of (character.classes || [])) {
    const prepMode = cls.casterProgression === 'pact' ? 'pact'
                   : PREPARED_CASTERS.has(cls.classId) ? 'prepared' : 'always'
    for (const choices of Object.values(cls.levelChoices || {})) {
      for (const s of (choices.cantrips      || [])) addSpell(s, 0,    'prepared', cls.classId)
      for (const s of (choices.startingSpells|| [])) addSpell(s, null, prepMode,   cls.classId)
      for (const s of (choices.knownSpells   || [])) addSpell(s, null, prepMode,   cls.classId)
      for (const s of (choices.preparedSpells|| [])) addSpell(s, null, prepMode,   cls.classId)
      // Optional-Feature-Spells an diesem Level (Blessed Warrior, Pact of the
      // Tome, Magic Initiate via Feat, …). Müssen auch durch den Fake-Filter.
      for (const spArr of Object.values(choices.optFeatureSpells || {})) {
        for (const s of (spArr || [])) addSpell(s, null, prepMode, cls.classId)
      }
    }
    for (const s of (cls.knownSpells   || [])) addSpell(s, null, prepMode, cls.classId)
    for (const s of (cls.preparedSpells|| [])) addSpell(s, null, prepMode, cls.classId)
  }

  // Rassen-Zauber
  const raceSpellSources = [
    ...(character.species?.raceSpells    || []),
    ...(character.species?.subraceSpells || []),
    ...(character.species?.spellChoices  || []),
  ]
  for (const s of raceSpellSources) {
    const n = typeof s === 'string' ? s : s?.name
    if (n) addSpell(n, null, 'innate', null)
  }

  // Feat-Zauber
  for (const feat of (character.feats || [])) {
    for (const s of [...(feat.choices?.spells || []), ...(feat.additionalSpells || [])]) {
      const n = typeof s === 'string' ? s : s?.name
      if (n) addSpell(n, null, 'innate', null)
    }
  }

  // Custom Zauber (mit Filter)
  for (const spell of (character.custom?.spells || [])) {
    if (!spell.name || isFakeSpellName(spell.name)) continue
    const key = `${spell.name}__custom`
    if (addedSpells.has(key)) continue
    addedSpells.add(key)
    spellItems.push(makeCustomSpellItem(spell, character))
  }

  // 6. Inventar (regular + custom items)
  const inventoryItems = [
    ...(character.inventory?.items || []).map(item => makeInventoryItem(item, edition)),
    ...(character.custom?.items || []).map(item => makeInventoryItem({
      ...item, id: item._id, grantedBy: 'custom',
    }, edition)),
  ]

  // ── Put loot items into the first Backpack container ──
  const backpackItem = inventoryItems.find(i => i.type === 'container')
  if (backpackItem) {
    const backpackId = backpackItem._id
    for (const item of inventoryItems) {
      if (item.type === 'loot' && !item.system.container) {
        item.system.container = backpackId
      }
    }
  }

  // Custom Feats als Feat Items
  for (const feat of (character.custom?.feats || [])) {
    featItems.push({
      _id:    makeId(`cfeat_${feat.name}`),
      name:   feat.name,
      type:   'feat',
      img:    'icons/svg/book.svg',
      system: {
        description: { value: feat.description || '', chat: '' },
        source:      { book: feat.source || 'Custom', custom: feat.source || 'Custom' },
        type:        { value: 'feat', subtype: '' },
        properties:  [],
        requirements: '',
        activities:  {},
      },
      sort: 0,
      effects: [],
    })
  }

  // 7. Race Item
  const raceItem = raceName ? makeRaceItem(character) : null

  // 8. Background Item
  const backgroundItem = bgName ? makeBackgroundItem(character) : null

  // 9. Racial Trait Items (Darkvision, Fey Ancestry, etc.)
  const racialTraitItems = raceName ? makeRacialTraitItems(character) : []

  // ── prototypeToken ─────────────────────────────────────
  const prototypeToken = {
    name:         character.info.name || 'Unnamed Character',
    displayName:  0,
    actorLink:    true,
    width:  1, height: 1,
    texture: {
      src:            character.appearance?.portrait || '',
      anchorX: 0.5,  anchorY: 0.5,
      offsetX: 0,    offsetY: 0,
      fit:     'contain',
      scaleX:  1,    scaleY: 1,
      rotation: 0,   tint: '#ffffff',
      alphaThreshold: 0.75,
    },
    lockRotation: false,
    rotation:     0,
    alpha:        1,
    disposition:  1,         // FRIENDLY
    displayBars:  20,        // OWNER
    bar1: { attribute: 'attributes.hp' },
    bar2: { attribute: null },
    light: {
      negative: false, priority: 0, alpha: 0.5,
      angle: 360, bright: 0, color: null, coloration: 1,
      dim: 0, attenuation: 0.5, luminosity: 0.5,
      saturation: 0, contrast: 0, shadows: 0,
      animation: { type: null, speed: 5, intensity: 5, reverse: false },
      darkness: { min: 0, max: 1 },
    },
    sight: {
      enabled:     true,
      range:       darkvision || 0,
      angle:       360,
      visionMode:  darkvision ? 'darkvision' : 'basic',
      color:       null,
      attenuation: 0.1,
      brightness:  0,
      saturation:  darkvision ? -1 : 0,
      contrast:    0,
    },
    detectionModes:  [],
    occludable:      { radius: 0 },
    ring: {
      enabled: false,
      colors:  { ring: null, background: null },
      effects: 1,
      subject: { scale: 1, texture: null },
    },
    flags:            {},
    randomImg:        false,
    appendNumber:     false,
    prependAdjective: false,
  }

  // ════════════════════════════════════════════════════
  // ACTOR ZUSAMMENBAUEN
  // ════════════════════════════════════════════════════
  return {
    name: character.info.name || 'Unnamed Character',
    type: 'character',
    img:  character.appearance?.portrait || '',

    system: {
      // Währung
      currency: {
        pp: character.inventory?.currency?.pp || 0,
        gp: character.inventory?.currency?.gp || 0,
        ep: character.inventory?.currency?.ep || 0,
        sp: character.inventory?.currency?.sp || 0,
        cp: character.inventory?.currency?.cp || 0,
      },

      // Attribute
      abilities,

      // Globale Boni
      bonuses: {
        mwak:      { attack: '', damage: '' },
        rwak:      { attack: '', damage: '' },
        msak:      { attack: '', damage: '' },
        rsak:      { attack: '', damage: '' },
        abilities: { check: '', save: '', skill: '' },
        spell:     { dc: '' },
      },

      // Skills
      skills,
      tools,

      // Zauber-Slots
      spells: spellSlots,

      // Kampf-Attribute
      attributes: {
        ac:   { calc: 'default' },
        init: { ability: 'dex', bonus: '', roll: { ...rollBlock } },
        movement: {
          burrow: speed.burrow || 0,
          climb:  speed.climb  || 0,
          fly:    speed.fly    || 0,
          swim:   speed.swim   || 0,
          walk:   speed.walk   || 30,
          units:  'ft',
          hover:  false,
        },
        attunement: { max: character.inventory?.attunementSlots || 3 },
        senses: {
          darkvision,
          blindsight: 0, tremorsense: 0, truesight: 0,
          units: 'ft', special: '',
        },
        spellcasting: spellcastingAbility || '',
        exhaustion:   0,
        hp: {
          value:   currentHp,
          max:     maxHp,
          temp:    tempHp,
          tempmax: 0,
          bonuses: { level: '', overall: '' },
        },
        // Death saves (inkl. vollständigem roll-Block für Foundry v5)
        death: {
          roll:    { ...rollBlock },
          success: character.status?.deathSaves?.successes || 0,
          failure: character.status?.deathSaves?.failures  || 0,
          bonuses: { save: '' },
        },
        inspiration: character.status?.inspiration || false,
        concentration: {
          bonuses: { save: '' },
          limit:   1,
          roll:    { ...rollBlock },
        },
        loyalty: {},
      },

      // Foundry v13 Bastion (leer, aber Feld muss existieren)
      bastion: { name: '', description: '' },

      // Charakter-Details
      details: {
        biography: {
          value:  character.personality?.backstory || '',
          public: '',
        },
        alignment:     character.info?.alignment || '',
        ideal:         character.personality?.ideals || '',
        bond:          character.personality?.bonds  || '',
        flaw:          character.personality?.flaws  || '',
        trait:         character.personality?.traits || '',
        race:          `${raceName}${subraceName ? ` (${subraceName})` : ''}`,
        background:    bgName,
        originalClass: character.classes[0]?.classId || '',
        xp:            { value: character.info?.experience || 0 },
        appearance:    character.appearance?.description || '',
        gender:        '',
        eyes:          character.appearance?.eyes   || '',
        height:        character.appearance?.height || '',
        hair:          character.appearance?.hair   || '',
        skin:          character.appearance?.skin   || '',
        age:           character.appearance?.age    || '',
        weight:        character.appearance?.weight || '',
        faith:         '',
      },

      // Traits & Proficiencies
      traits: {
        size: sizeCode,
        di: { value: [], custom: '', bypasses: [] },   // damage immunity
        dr: { value: [], custom: '', bypasses: [] },   // damage resistance
        dv: { value: [], custom: '', bypasses: [] },   // damage vulnerability
        dm: { amount: {}, bypasses: [] },              // damage modification (v5 neu)
        ci: { value: [], custom: '' },                 // condition immunity
        languages: {
          value:         langValues,
          custom:        '',
          communication: {},                           // v13 neu
        },
        weaponProf: {
          value:   weaponProfValues,
          custom:  parseTags(weaponProfCustom.join(';')),
          mastery: { value: [], bonus: [] },           // v5 neu
        },
        armorProf: {
          value:  armorProfValues,
          custom: parseTags(armorProfCustom.join(';')),
        },
      },

      // Klassen-Ressourcen (erste 3 aktive)
      resources,

      // Favoriten (leer, wird im Sheet befüllt)
      favorites: [],
    },

    prototypeToken,

    // Items in korrekter Reihenfolge
    items: [
      ...classItems,
      ...subclassItems,
      ...(raceItem ? [raceItem] : []),
      ...(backgroundItem ? [backgroundItem] : []),
      ...racialTraitItems,
      ...classFeatureItems,
      ...featItems,
      ...spellItems,
      ...inventoryItems,
    ],

    effects: [],

    flags: {
      dnd5e: {
        savageAttacks:           false,
        weaponCriticalThreshold: 20,
        wildMagic:               false,
        spellSniper:             false,
        initiativeHalfProf:      false,
      },
      dndCharacterBuilder: {
        version:    character.meta?.version  || 1,
        edition:    character.meta?.edition  || '5e',
        exportedAt: new Date().toISOString(),
      },
    },

    // Actor-Level _stats
    _stats: {
      ...SYSTEM_VERSION,
      createdTime:    Date.now(),
      modifiedTime:   Date.now(),
      lastModifiedBy: null,
      exportSource: {
        ...SYSTEM_VERSION,
        uuid:    '',
        worldId: '',
      },
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DOWNLOAD HELPER
// Löst einen Browser-Download des Foundry Actor JSON aus.
// ═══════════════════════════════════════════════════════════════════════

export async function downloadFoundryJSON(character) {
  const actor    = await exportToFoundry(character)
  const json     = JSON.stringify(actor, null, 2)
  const filename = `${(character.info.name || 'character')
    .replace(/[^a-z0-9]/gi, '_')}_foundry.json`

  // In Tauri: save to configured export path
  if (window.__TAURI_INTERNALS__) {
    try {
      const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
      const { appDataDir, resolve } = await import('@tauri-apps/api/path')

      let exportDir = localStorage.getItem('dndbuilder_export_path')
      if (!exportDir) {
        // Default: exe directory / export / foundry
        const { resourceDir } = await import('@tauri-apps/api/path')
        try {
          exportDir = await resolve(await resourceDir(), '..', 'export', 'foundry')
        } catch {
          exportDir = await resolve(await appDataDir(), 'export', 'foundry')
        }
      }

      // Create directory if it doesn't exist
      try {
        const dirExists = await exists(exportDir)
        if (!dirExists) await mkdir(exportDir, { recursive: true })
      } catch {
        await mkdir(exportDir, { recursive: true }).catch(() => {})
      }

      const filePath = await resolve(exportDir, filename)
      await writeTextFile(filePath, json)
      alert(`Exportiert nach:\n${filePath}`)
      return
    } catch (e) {
      console.warn('[Export] Tauri filesystem failed, falling back to browser download:', e)
      // Fall through to browser download
    }
  }

  // Browser fallback
  const blob     = new Blob([json], { type: 'application/json' })
  const url      = URL.createObjectURL(blob)
  const a        = document.createElement('a')
  a.href         = url
  a.download     = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}