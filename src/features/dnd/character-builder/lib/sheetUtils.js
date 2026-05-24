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
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function formatSkillName(skill) {
  return String(skill).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
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

  for (const cls of (character.classes || [])) {
    const prog = cls.casterProgression
    if (prog === 'full')                          casterLevel += cls.level
    else if (prog === 'half' || prog === '1/2')   casterLevel += Math.floor(cls.level / 2)
    else if (prog === '1/3')                      casterLevel += Math.floor(cls.level / 3)
    else if (prog === 'pact')                     warlockSlots = WARLOCK_TABLE[cls.level] || null
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
