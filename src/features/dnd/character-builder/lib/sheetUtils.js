// lib/sheetUtils.js
// Pure helpers shared across the reworked character sheet.
// No React, no side effects — safe to import anywhere.

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']

export const ABILITY_LABELS = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
}

export const SCHOOL_NAMES = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
  V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation', P: 'Psionic',
  U: 'Universal',
}

// ── Formatters ──────────────────────────────────────────────

export function modStr(n) { return n >= 0 ? `+${n}` : `${n}` }

export function ordinal(n) {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

export function spellLevelLabel(lvl) {
  return lvl === 0 ? 'Cantrips' : `${ordinal(lvl)} Level`
}

export function formatToolName(key) {
  // Strip 5etools `{@item Foo|XPHB}` wrappers + bare `|SOURCE` suffixes
  // BEFORE title-casing so we don't render `{@Item Thieves' Tools|Xphb}`
  // on the sheet. Class data ships tool references in either shape;
  // normalising at the display layer keeps every callsite safe even
  // when the source data leaks raw tags through.
  const stripped = String(key || '')
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .replace(/\|[A-Za-z]+$/, '')
  return stripped.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function formatSkillName(skill) {
  return String(skill).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}

// ── 5.5e Weapon Mastery short-descriptions ─────────────────
// Map of mastery name → tiny pill-sized German label the sheet shows
// next to the mastery name so the player remembers what each does
// without expanding a tooltip. Keys are case-insensitive on lookup.
const MASTERY_SHORT_DESC = {
  cleave:    '+Damage an benachbartes Ziel',
  graze:     'Bei Miss: STR-Mod Schaden',
  nick:      'Free TWF',
  push:      'Ziel 10 ft. zurückstoßen',
  sap:       'Ziel: Nachteil nächste Attacke',
  slow:      '−10 ft. Speed Ziel',
  topple:    'Save oder Prone',
  vex:       'Vorteil nächste Attacke',
}
export function masteryShortDesc(mastery) {
  if (!mastery) return ''
  return MASTERY_SHORT_DESC[String(mastery).toLowerCase().trim()] || ''
}

// ── Fake spell-name filter (mirrors foundryExport.js) ───────
// Spell-list-picker UIs sometimes leak header rows like "Bard Spells".
// Filtering them keeps the sheet (and Foundry export) clean.
const FAKE_SPELL_NAMES = new Set([
  'bard spells', 'cleric spells', 'druid spells', 'paladin spells', 'ranger spells',
  'sorcerer spells', 'warlock spells', 'wizard spells', 'artificer spells',
  'bard cantrips', 'cleric cantrips', 'druid cantrips',
  'sorcerer cantrips', 'warlock cantrips', 'wizard cantrips',
])

export function isFakeSpellName(name) {
  if (!name || typeof name !== 'string') return true
  const n = name.toLowerCase().trim()
  if (!n) return true
  if (FAKE_SPELL_NAMES.has(n)) return true
  if (/\s(spells|cantrips)$/i.test(n) && n.split(/\s+/).length <= 3) return true
  return false
}

// ── Collect EVERY spell the character knows ─────────────────
// The old sheet only read levelChoices[1], so every spell learned
// from level 2 onward was invisible. This mirrors the foundryExport
// pipeline and walks ALL level-up choices plus the flat class arrays.
export function collectCharacterSpells(character) {
  const map = new Map()  // lowercase name -> entry

  // `granted` marks spells handed out automatically (domain / subclass /
  // optional-feature grants) — they are always castable. The plain class
  // pools (knownSpells / preparedSpells) are NOT granted: for prepared
  // casters those still need to be prepared before they can be cast.
  const add = (raw, origin, sourceClass, granted = false) => {
    const name = typeof raw === 'string' ? raw : raw?.name
    if (!name || isFakeSpellName(name)) return
    const key = name.toLowerCase()
    let e = map.get(key)
    if (!e) { e = { name, origins: new Set(), sourceClasses: new Set(), granted: false }; map.set(key, e) }
    e.origins.add(origin)
    if (sourceClass) e.sourceClasses.add(sourceClass)
    if (granted) e.granted = true
  }

  for (const cls of (character.classes || [])) {
    for (const ch of Object.values(cls.levelChoices || {})) {
      for (const s of (ch.cantrips || []))       add(s, 'class', cls.classId)
      for (const s of (ch.startingSpells || [])) add(s, 'class', cls.classId)
      for (const s of (ch.knownSpells || []))    add(s, 'class', cls.classId)
      for (const s of (ch.preparedSpells || [])) add(s, 'class', cls.classId)
      // optFeatureSpells = subclass / feature grants → always castable.
      for (const arr of Object.values(ch.optFeatureSpells || {}))
        for (const s of (arr || [])) add(s, 'class', cls.classId, true)
    }
    for (const s of (cls.knownSpells || []))    add(s, 'class', cls.classId)
    for (const s of (cls.preparedSpells || [])) add(s, 'class', cls.classId)
  }

  // Class/subclass features whose text declares an automatic spell
  // grant ("you always have the Hunter's Mark spell prepared",
  // "you always have Bane prepared", etc.). Pulled dynamically from
  // each active feature's `entries` so 5.5e Ranger Favored Enemy
  // grants Hunter's Mark, Twilight Cleric grants Faerie Fire, …
  // without naming any feature in code. The grants count as
  // `granted: true` so the picker treats them as always castable.
  for (const f of (character?.__activeFeatures || [])) {
    if (!f?.entries) continue
    const raw = (f.entries || []).map(e => typeof e === 'string' ? e : '').join(' ')
    const grants = raw.matchAll(/you\s+(?:always\s+have|gain)\s+(?:the\s+)?\{@spell\s+([^|}]+)(?:\|[^}]*)?\}[^.]*?(?:spell\s+prepared|prepared)/gi)
    for (const m of grants) {
      const name = String(m[1] || '').trim()
      if (name) add(name, 'class', f.classId || null, true)
    }
  }

  for (const s of (character.species?.raceSpells || []))    add(s, 'race', null)
  for (const s of (character.species?.subraceSpells || [])) add(s, 'race', null)
  for (const s of (character.species?.spellChoices || []))  add(s, 'race', null)

  for (const feat of (character.feats || [])) {
    for (const s of (feat.choices?.spells || []))  add(s, 'feat', null)
    for (const s of (feat.additionalSpells || [])) add(s, 'feat', null)
  }

  for (const s of (character.custom?.spells || [])) add(s?.name, 'custom', null)

  return [...map.values()].map(e => ({
    name: e.name,
    origins: [...e.origins],
    sourceClasses: [...e.sourceClasses],
    granted: e.granted,
  }))
}

// ── Spell slots ─────────────────────────────────────────────

const SLOT_TABLE = {
  1: [2,0,0,0,0,0,0,0,0],  2: [3,0,0,0,0,0,0,0,0],  3: [4,2,0,0,0,0,0,0,0],
  4: [4,3,0,0,0,0,0,0,0],  5: [4,3,2,0,0,0,0,0,0],  6: [4,3,3,0,0,0,0,0,0],
  7: [4,3,3,1,0,0,0,0,0],  8: [4,3,3,2,0,0,0,0,0],  9: [4,3,3,3,1,0,0,0,0],
  10:[4,3,3,3,2,0,0,0,0],  11:[4,3,3,3,2,1,0,0,0],  12:[4,3,3,3,2,1,0,0,0],
  13:[4,3,3,3,2,1,1,0,0],  14:[4,3,3,3,2,1,1,0,0],  15:[4,3,3,3,2,1,1,1,0],
  16:[4,3,3,3,2,1,1,1,0],  17:[4,3,3,3,2,1,1,1,1],  18:[4,3,3,3,3,1,1,1,1],
  19:[4,3,3,3,3,2,1,1,1],  20:[4,3,3,3,3,2,2,1,1],
}

const WARLOCK_TABLE = {
  1:{slots:1,level:1},  2:{slots:2,level:1},  3:{slots:2,level:2},  4:{slots:2,level:2},
  5:{slots:2,level:3},  6:{slots:2,level:3},  7:{slots:2,level:4},  8:{slots:2,level:4},
  9:{slots:2,level:5},  10:{slots:2,level:5}, 11:{slots:3,level:5}, 12:{slots:3,level:5},
  13:{slots:3,level:5}, 14:{slots:3,level:5}, 15:{slots:3,level:5}, 16:{slots:3,level:5},
  17:{slots:4,level:5}, 18:{slots:4,level:5}, 19:{slots:4,level:5}, 20:{slots:4,level:5},
}

export function computeSpellSlots(character) {
  let casterLevel = 0
  let warlockSlots = null
  const is55e = (character?.meta?.edition || '5e') === '5.5e'

  for (const cls of (character.classes || [])) {
    const prog = cls.casterProgression
    if (prog === 'full') {
      casterLevel += cls.level
    } else if (prog === 'artificer') {
      // 5.5e XPHB Paladin & Ranger both ship `casterProgression:
      // "artificer"` (the 2024 PHB merged half-caster + Artificer
      // into one progression that casts from L1). Same row mapping
      // as Artificer in 5e: caster-equivalent level = ⌈class
      // level / 2⌉. Without this branch the prog string fell out of
      // every case and Ranger / Paladin came up with zero spell
      // slots — sheet showed no Prepare button.
      casterLevel += Math.ceil(cls.level / 2)
    } else if (prog === 'half' || prog === '1/2') {
      // 5e PHB: half-caster starts at L2 — floor(level/2) maps L1→0,
      // L2→1, L4→2, … (no L1 slots).
      // 5.5e XPHB: half-casters now cast from L1 — ceil(level/2)
      // maps L1→1, L3→2, L5→3, matching the 2024 Ranger / Paladin
      // table. Using floor here was the silent reason the Ranger
      // sheet showed "No spell slots available yet" and the prepare
      // modal's pool stayed empty (maxSpellLvl = 0).
      casterLevel += is55e ? Math.ceil(cls.level / 2) : Math.floor(cls.level / 2)
    } else if (prog === '1/3') {
      // Eldritch Knight / Arcane Trickster — still starts at L3 in
      // both editions; the floor formula already matches the table.
      casterLevel += Math.floor(cls.level / 3)
    } else if (prog === 'pact') {
      warlockSlots = WARLOCK_TABLE[cls.level] || null
    }
  }

  const lvl = Math.min(20, Math.round(casterLevel))
  const slots = lvl > 0 ? SLOT_TABLE[lvl] : null
  return { slots, warlockSlots }
}

// ── Currency ────────────────────────────────────────────────

export const COIN_TYPES = [
  { key: 'cp', label: 'Copper',   color: '#b87333' },
  { key: 'sp', label: 'Silver',   color: '#c0c0c0' },
  { key: 'ep', label: 'Electrum', color: '#7ec8e3' },
  { key: 'gp', label: 'Gold',     color: 'var(--accent-yellow)' },
  { key: 'pp', label: 'Platinum', color: '#e5e5e5' },
]

export function totalGoldValue(currency = {}) {
  return (currency.pp || 0) * 10 + (currency.gp || 0) + (currency.ep || 0) * 0.5
       + (currency.sp || 0) * 0.1 + (currency.cp || 0) * 0.01
}

// ── Encumbrance ─────────────────────────────────────────────
// Pure informational: never restricts speed/checks (the user said
// "soll aber nichts einschränken falls man sich dazu entscheidet
// encumbrance nicht zu verwenden"). Most 5e tables ignore the rules
// anyway; we just compute and display.
//
// 5e RAW:
//   max carry = STR × 15
//   encumbered (push/drag halved) at STR × 5
//   heavily encumbered (speed −20, disadvantage) at STR × 10
// Coins: 50 of any denomination weigh 1 lb (RAW).
export function computeEncumbrance(character, abilityScores) {
  const items = [
    ...(character.inventory?.items || []),
    ...(character.custom?.items || []),
  ]
  let carried = 0
  for (const item of items) {
    const w = Number(item.weight || 0)
    const q = Number(item.quantity || 1)
    if (Number.isFinite(w) && Number.isFinite(q)) carried += w * q
  }
  const currency = character.inventory?.currency || {}
  const coinTotal = Object.values(currency).reduce((s, n) => s + (Number(n) || 0), 0)
  carried += coinTotal / 50

  const str = abilityScores?.str || 10
  const max   = str * 15
  const enc   = str * 5
  const heavy = str * 10
  const state =
    carried > max   ? 'over'  :
    carried > heavy ? 'heavy' :
    carried > enc   ? 'enc'   :
    'ok'
  return {
    carried: Math.round(carried * 10) / 10,
    max, enc, heavy, state,
    pct: max > 0 ? Math.min(100, (carried / max) * 100) : 0,
  }
}

// ── Containers ──────────────────────────────────────────────
// Containers are a sheet-only organisational aid (the Foundry export
// keeps its own backpack-stowing logic untouched).

const CONTAINER_NAME_RE = /\b(backpack|pouch|chest|sack|quiver|bag|case|haversack|barrel|pack|crate|basket|bandolier|saddlebag)\b/i

export function isContainerItem(item) {
  if (!item) return false
  if (item.isContainer === true) return true
  if (item.packContents) return true
  return CONTAINER_NAME_RE.test(item.name || item.itemId || '')
}

// Stable identity for an inventory item across both stores.
export function itemKey(item) {
  return item?.id || item?._id || item?.name || ''
}

// ── Item type metadata ──────────────────────────────────────

export const ITEM_TYPES = [
  { id: 'M',  label: 'Melee Weapon',  isWeapon: true },
  { id: 'R',  label: 'Ranged Weapon', isWeapon: true },
  { id: 'LA', label: 'Light Armor',   isArmor: true },
  { id: 'MA', label: 'Medium Armor',  isArmor: true },
  { id: 'HA', label: 'Heavy Armor',   isArmor: true },
  { id: 'S',  label: 'Shield',        isArmor: true },
  { id: 'G',  label: 'Gear / Tool' },
  { id: 'P',  label: 'Potion / Consumable' },
  { id: 'W',  label: 'Wondrous Item' },
]

export const WEAPON_PROPERTIES = [
  'Finesse', 'Versatile', 'Light', 'Heavy', 'Two-Handed', 'Thrown',
  'Ammunition', 'Reach', 'Loading', 'Special',
]

export const DAMAGE_TYPES = [
  'slashing', 'piercing', 'bludgeoning', 'fire', 'cold', 'lightning',
  'thunder', 'acid', 'poison', 'necrotic', 'radiant', 'force', 'psychic',
]

export function itemTypeMeta(typeId) {
  const code = String(typeId || '').split('|')[0]
  return ITEM_TYPES.find(t => t.id === code) || { id: code, label: code || 'Item' }
}

/**
 * "Singleton" items are kept as one row per physical object — anything
 * whose identity, equipped/attuned state or contents matters per-instance:
 *
 *   - Weapons (M, R)                    — one is equipped, the other isn't
 *   - Armor + shields (LA, MA, HA, S)   — can't wear two at once
 *   - Wondrous items (W)                — rings/cloaks/amulets, individually attuned
 *   - Containers (anything isContainer) — each holds different stuff
 *
 * Everything else (P potions, G generic gear, ammunition, rations…) stays
 * stackable since the quantity column carries the meaningful state.
 *
 * Driven off `itemTypeMeta` + the existing flags so the singleton rule
 * stays in lockstep with ITEM_TYPES — adding a new weapon/armor type
 * there with isWeapon/isArmor automatically flips it to singleton.
 */
export function isSingletonItem(item) {
  if (!item) return false
  const meta = itemTypeMeta(item.type)
  if (meta.isWeapon || meta.isArmor) return true
  if (item.isWeapon || item.isArmor) return true
  if (item.type === 'W') return true
  if (isContainerItem(item)) return true
  return false
}
