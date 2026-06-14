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
import { isContainerItem } from './sheetUtils'
import { loadClassData, loadRaceList } from './dataLoader'

// ─── Minimal-Hydration für den Export ────────────────────────────
// Im Live-Sheet befüllt CharacterSheetPage.hydrateClassDataAndRecompute
// das `character`-Object mit transient-fields wie __fixedSkills (für race-
// granted Skills wie Half-Orc Menacing oder Elf Keen Senses) und einer
// classDataMap. Beim Bulk-Export werden die Charaktere direkt aus
// Supabase geladen — ohne diese Felder bleibt z.B. eine race-fixed
// Skill-Proficiency unsichtbar UND Expertise-Picks darauf greifen nicht.
//
// hydrateForExport macht denselben Aufruf-Pfad async ein einziges Mal,
// fügt die Hilfsfelder an und liefert den klassDataMap zurück damit
// computeCharacter ihn korrekt nutzt.
async function hydrateForExport(character) {
  const edition = character?.meta?.edition || '5e'
  const out = { ...character }
  // ── classDataMap (subclass + level-table lookups) ──
  const classes = (character.classes || []).map(c => c.classId).filter(Boolean)
  const unique = [...new Set(classes)]
  const loaded = await Promise.all(unique.map(id => loadClassData(edition, id).catch(() => null)))
  const classDataMap = {}
  unique.forEach((cid, i) => { if (loaded[i]) classDataMap[cid] = loaded[i] })

  // ── Race-derived __fixedSkills ──
  try {
    const raceId = character?.species?.raceId
    if (raceId) {
      const races = await loadRaceList(edition).catch(() => [])
      const race = races.find(r => r.id === raceId || r.name === raceId)
      if (race) {
        const sub = (race.subraces || []).find(s =>
          s.id === character.species.subraceId || s.name === character.species.subraceId
        )
        const skillBlocks = [
          ...(race.skillProficiencies || []),
          ...(sub?.skillProficiencies || []),
        ]
        const fixedSkills = []
        for (const block of skillBlocks) {
          if (!block || typeof block !== 'object') continue
          if (block.choose || typeof block.any === 'number') continue
          for (const [k, v] of Object.entries(block)) {
            if (v === true && k !== 'choose' && k !== 'any') fixedSkills.push(k)
          }
        }
        if (fixedSkills.length > 0) {
          out.species = { ...(out.species || {}), __fixedSkills: fixedSkills }
        }
      }
    }
  } catch (e) { console.warn('[Export] race hydration failed:', e?.message || e) }

  // ── __activeFeatures (class + subclass features ≤ level) ──
  // Used by Zeile 2697 für spell-resource-matching ("Favored Enemy"
  // grants Hunter's Mark → 2x kostenlos → Resource-Counter im Actor).
  // Vollständige Sub-Feature-Option-Logik (PrimalOrder/etc.) brauchen wir
  // hier nicht — Top-Level-Features reichen für die Always-Prepared-Scans.
  const activeFeatures = []
  for (const cls of (character.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    const subId = cls.subclassId
    const cleanSubId = subId ? String(subId).split(/__|\|/)[0].trim() : null
    const sub = cleanSubId
      ? (cd.subclasses || []).find(s =>
          s.id === subId || s.name === subId
          || s.id === cleanSubId || s.name === cleanSubId
          || s.shortName === cleanSubId)
      : null

    // Top-level class features
    for (const f of (cd.classFeature || cd.features || [])) {
      if (!f?.name) continue
      const lvl = f.level || 1
      if (lvl > cls.level) continue
      // Edition-Match: 5.5e bevorzugt XPHB/XDMG/XMM
      activeFeatures.push({
        classId: cls.classId,
        source: 'class',
        name: f.name,
        level: lvl,
        entries: f.entries || [],
      })
    }
    // Subclass features at ≤ cls.level
    if (sub) {
      const subFeats = [
        ...(Array.isArray(sub.features) ? sub.features : []),
        ...(sub.featuresPerLevel
          ? Object.entries(sub.featuresPerLevel).flatMap(([lvl, fs]) =>
              (fs || []).map(f => ({ ...f, level: parseInt(lvl, 10) || 1 })))
          : []),
        // 5etools subclassFeature[] (flat structure)
        ...(Array.isArray(cd.subclassFeature)
          ? cd.subclassFeature.filter(f =>
              f.className === cd.name
              && (f.subclassShortName === sub.shortName || f.subclassShortName === sub.name))
          : []),
      ]
      for (const f of subFeats) {
        if (!f?.name) continue
        const lvl = f.level || 1
        if (lvl > cls.level) continue
        activeFeatures.push({
          classId: cls.classId,
          source: 'subclass',
          subclassId: subId,
          name: f.name,
          level: lvl,
          entries: f.entries || [],
        })
      }
    }
  }
  // Dedup nach (classId, name, level)
  const seenAf = new Set()
  out.__activeFeatures = activeFeatures.filter(f => {
    const k = `${f.classId}|${f.name}|${f.level}`
    if (seenAf.has(k)) return false
    seenAf.add(k)
    return true
  })

  // ── __grantedSpells (additionalSpells.prepared scans) ──
  // Cleric Domain Spells, Paladin Oath Spells, Sorcerer Origin Spells,
  // Warlock Patron Spells, etc. — collectCharacterSpells (sheetUtils)
  // liest character.__grantedSpells als zusätzliche always-prepared
  // Spells. Ohne diesen Feed fehlt z.B. einem Cleric L1 alle Domain-
  // Spells im Foundry-Actor.
  const grantedSpells = []
  const seenGs = new Set()
  const pushGranted = (name, classId, sourceFeature) => {
    if (!name) return
    const key = `${classId}|${String(name).toLowerCase()}`
    if (seenGs.has(key)) return
    seenGs.add(key)
    grantedSpells.push({ name: String(name), classId, sourceFeature })
  }
  const consumeAdditional = (additionalSpells, level, classId, sourceFeature) => {
    for (const block of (additionalSpells || [])) {
      if (!block || typeof block !== 'object') continue
      const prep = block.prepared
      if (!prep || typeof prep !== 'object') continue
      for (const [lvlKey, arr] of Object.entries(prep)) {
        const lv = parseInt(lvlKey, 10)
        if (!Number.isFinite(lv) || lv > level) continue
        for (const raw of (Array.isArray(arr) ? arr : [])) {
          const name = typeof raw === 'string'
            ? raw.split('|')[0].replace(/\b\w/g, c => c.toUpperCase()).trim()
            : null
          if (name) pushGranted(name, classId, sourceFeature)
        }
      }
    }
  }
  for (const cls of (character.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    consumeAdditional(cd.additionalSpells, cls.level, cls.classId, cls.classId)
    const subId = cls.subclassId
    if (!subId) continue
    const cleanSubId = String(subId).split(/__|\|/)[0].trim()
    const sub = (cd.subclasses || []).find(s =>
      s.id === subId || s.name === subId
      || s.id === cleanSubId || s.name === cleanSubId
      || s.shortName === cleanSubId
    )
    if (sub) consumeAdditional(sub.additionalSpells, cls.level, cls.classId, subId)
  }
  // 5.5e XPHB-Pattern: subclasses encoden Always-Prepared via inline
  // {type:'table'} mit colLabels ["<Class> Level", "Spells"]. Wir scannen
  // jedes activeFeature auf solche Tabellen.
  const SPELL_TAG_RE = /\{@spell\s+([^|}]+)(?:\|[^}]*)?\}/g
  const scanForSpellTables = (feature, classId, classLevel) => {
    if (!feature?.entries) return
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { for (const x of node) walk(x); return }
      if (node.type === 'table' && Array.isArray(node.colLabels) && Array.isArray(node.rows)) {
        const isLevelCol = /\blevel\b/i.test(node.colLabels[0] || '')
        const isSpellCol = /\bspell/i.test(node.colLabels[1] || '')
        if (isLevelCol && isSpellCol) {
          for (const row of node.rows) {
            const lvCell = row?.[0]
            const spCell = row?.[1]
            const lv = parseInt(typeof lvCell === 'string' ? lvCell : (lvCell?.roll?.exact ?? lvCell), 10)
            if (!Number.isFinite(lv) || lv > classLevel) continue
            const cellText = typeof spCell === 'string' ? spCell : JSON.stringify(spCell || '')
            for (const m of cellText.matchAll(SPELL_TAG_RE)) {
              const name = String(m[1] || '').trim()
              if (name) pushGranted(name, classId, feature.name)
            }
          }
        }
      }
      if (Array.isArray(node.entries)) walk(node.entries)
      if (Array.isArray(node.items))   walk(node.items)
    }
    walk(feature.entries)
  }
  for (const f of out.__activeFeatures) {
    if (!f?.classId) continue
    const cls = (character.classes || []).find(c => c.classId === f.classId)
    if (!cls) continue
    scanForSpellTables(f, f.classId, cls.level)
  }
  out.__grantedSpells = grantedSpells

  return { hydrated: out, classDataMap }
}
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
let FOUNDRY_FEATS_BY_KEY = null   // foundry-feats.json — name||source → { effects, system, … }
// items-base.json entries indexed by `Name||Source`. Foundry's item
// index ships empty descriptions for several XPHB entries (Leather
// Armor||XPHB, Padded Armor||XPHB, etc.); this is the data-driven
// fallback so the rules text still makes it into Foundry.
let ITEM_ENTRIES_BY_KEY = null
// Edition the current cache was loaded for. Changes between exports
// invalidate the cache so 5e and 5.5e descriptions/effects don't mix
// (Alert XPHB vs Alert PHB have different bonuses, different sources).
let LOADED_EDITION = null

// Subclass spellcasting map: subclassName → { progression, ability }
// Built from 5etools class files; only populated for subclasses that grant casting (EK, AT, …)
let SUBCLASS_SPELL_MAP = null

// ASI levels per class: className → number[]  (e.g. Fighter → [4,6,8,12,14,16,19])
let CLASS_ASI_LEVELS = null

// Class feature lists from 5etools:
// Map<className, { classFeatures, subclassFeatures, subclassShortNames }>
let CLASS_FEATURES_MAP = null

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

/**
 * Build a list of Foundry items defensively: if a single source entry is
 * malformed and its builder throws, that one entry is skipped and logged
 * instead of aborting the entire export. Guarantees an importable actor.
 */
function safeMap(arr, fn, label) {
  const out = []
  const list = Array.isArray(arr) ? arr : []
  for (let i = 0; i < list.length; i++) {
    try {
      const r = fn(list[i], i)
      if (r != null) out.push(r)
    } catch (e) {
      console.warn(`[Export] skipped ${label}[${i}]:`, e)
    }
  }
  return out
}

async function ensureIndexes(edition = '5e') {
  // Cache hits ONLY when the same edition has already loaded — otherwise
  // we'd be serving PHB data for a 5.5e character and silently dropping
  // every XPHB feat/race/background description and Active Effect.
  if (CLASS_INDEX && LOADED_EDITION === edition) return

  const root = edition === '5.5e' ? '/data/5.5e' : '/data/5e'

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

  let foundryFeats
  ;[CLASS_INDEX, SPELL_INDEX, FEAT_INDEX, ITEM_FNDRY, SPELL_DESC, RACE_FNDRY, OPTFEAT_FNDRY, RACE_DATA, BG_DATA, CF_DESC, FEATS_DATA, OPTFEAT_DATA, foundryFeats] =
    await Promise.all([
      fetch(`${root}/foundry-class-index.json`).then(r => r.json()),
      fetch(`${root}/foundry-spell-index.json`).then(r => r.json()),
      fetch(`${root}/foundry-feat-index.json`).then(r => r.json()),
      fetch(`${root}/foundry-item-foundry-index.json`).then(r => r.json()),
      fetch(`${root}/spells/spell-desc-index.json`).then(r => r.json()),
      fetch(`${root}/foundry-races.json`).then(r => r.json()),
      fetch(`${root}/foundry-optionalfeatures.json`).then(r => r.json()),
      fetch(`${root}/races.json`).then(r => r.json()),
      fetch(`${root}/backgrounds.json`).then(r => r.json()),
      fetch(`${root}/class-feature-desc-index.json`).then(r => r.json()).catch(() => ({})),
      fetch(`${root}/feats.json`).then(r => r.json()).catch(() => ({ feat: [] })),
      fetch(`${root}/optionalfeatures.json`).then(r => r.json()).catch(() => ({ optionalfeature: [] })),
      // foundry-feats.json carries ActiveEffects per feat (Alert: +PB
      // init flag, Lucky: extra luck point, etc.). The Foundry feat
      // index alone doesn't have these — we need this separate file
      // so the exported feat actually grants its mechanical bonus.
      fetch(`${root}/foundry-feats.json`).then(r => r.json()).catch(() => ({ feat: [] })),
    ])

  // Fallback-Entries-Index für Item-Descriptions im Foundry-Export.
  // Wird gezogen wenn foundry-item-foundry-index.json einen leeren
  // description-String hat (passiert für Leather Armor|XPHB + viele
  // XPHB-Items) ODER der Charakter-Eintrag selbst noch keine
  // `entries` trägt (Legacy-Chars von vor backfillItemMetadata).
  //
  // Magic Items leben in items.json (≈2400 Einträge), Standard-Items
  // (Waffen, Rüstung, Gear) in items-base.json. Bei einem Mage-Item
  // wie "Cloak of Elvenkind" oder "Wand of Magic Missiles" hätte
  // der frühere items-base.json-only-Pfad GAR keinen Fallback gehabt
  // — der Foundry-Export landete dann mit leerer Description. Jetzt
  // mergen wir beide Quellen, items.json gewinnt bei Kollisionen
  // (sollte aber nicht passieren — disjunkte Namespaces).
  const [itemsBase, itemsFull] = await Promise.all([
    fetch(`${root}/items-base.json`).then(r => r.json()).catch(() => ({ baseitem: [] })),
    fetch(`${root}/items.json`).then(r => r.json()).catch(() => ({ item: [] })),
  ])
  ITEM_ENTRIES_BY_KEY = {}
  const addToIndex = (it) => {
    if (!it?.name || !Array.isArray(it.entries) || it.entries.length === 0) return
    const k = `${it.name}||${it.source || ''}`
    ITEM_ENTRIES_BY_KEY[k] = it.entries
    if (!ITEM_ENTRIES_BY_KEY[it.name]) ITEM_ENTRIES_BY_KEY[it.name] = it.entries
  }
  for (const it of (itemsBase.baseitem || [])) addToIndex(it)
  for (const it of (itemsBase.item     || [])) addToIndex(it)
  for (const it of (itemsFull.item     || [])) addToIndex(it)

  // Index foundry-feats by `Name||Source` so makeFeatItem can pull
  // effects/system patches the same way it pulls FEAT_INDEX img/desc.
  FOUNDRY_FEATS_BY_KEY = {}
  const ffArr = Array.isArray(foundryFeats)
    ? foundryFeats
    : (foundryFeats.feat || Object.values(foundryFeats))
  for (const ff of (ffArr || [])) {
    if (!ff?.name) continue
    const key = `${ff.name}||${ff.source || ''}`
    FOUNDRY_FEATS_BY_KEY[key] = ff
    if (!FOUNDRY_FEATS_BY_KEY[ff.name]) FOUNDRY_FEATS_BY_KEY[ff.name] = ff
  }

  // Build SUBCLASS_SPELL_MAP from 5etools class files so subclasses that grant
  // spellcasting (Eldritch Knight, Arcane Trickster, …) get the correct progression.
  // 5.5e (XPHB) drops Artificer from the player-side class list, so we skip
  // it gracefully when the file is absent.
  const classFileNames = ['artificer','barbarian','bard','cleric','druid','fighter','monk','paladin','ranger','rogue','sorcerer','warlock','wizard']
  const classDataFiles = await Promise.all(
    classFileNames.map(n => fetch(`${root}/class/class-${n}.json`).then(r => r.json()).catch(() => ({})))
  )
  SUBCLASS_SPELL_MAP  = new Map()
  CLASS_ASI_LEVELS    = new Map()
  CLASS_FEATURES_MAP  = new Map()
  for (const data of classDataFiles) {
    // Subclass spellcasting
    for (const sub of (data.subclass || [])) {
      if (sub.casterProgression && sub.name && !SUBCLASS_SPELL_MAP.has(sub.name)) {
        SUBCLASS_SPELL_MAP.set(sub.name, {
          progression: normFoundryProg(sub.casterProgression),
          ability:     sub.spellcastingAbility || '',
        })
      }
    }

    for (const cls of (data.class || [])) {
      // ASI levels
      const asiLevels = (data.classFeature || [])
        .filter(f => f.className === cls.name && f.name === 'Ability Score Improvement')
        .map(f => f.level)
        .sort((a, b) => a - b)
      if (asiLevels.length) CLASS_ASI_LEVELS.set(cls.name, asiLevels)

      // Subclass lookup maps: fullName → shortName, and identity feature names to skip
      const subclassShortNames   = new Map()   // fullName → shortName
      const subclassIdentityNames = new Set()  // feature names that are just "you chose this subclass"
      for (const sub of (data.subclass || [])) {
        const sn = sub.shortName || sub.name
        subclassShortNames.set(sub.name, sn)
        // A subclass "identity" feature has the same name as the subclass itself.
        // We skip it (it's redundant with the Subclass item). Only skip if the
        // feature belongs to that same subclass (prevents skipping "War Magic" in EK).
        subclassIdentityNames.add(sub.name + '||' + sn)   // "War Magic||War", "Eldritch Knight||Eldritch Knight"
      }

      // Class features: skip ASI and class-feature-variants.
      // `entries` is kept so the feature item gets a real description even
      // when the class-feature-desc index misses it.
      const classFeatures = (data.classFeature || [])
        .filter(f => f.className === cls.name && !f.isClassFeatureVariant)
        .filter(f => !f.name.startsWith('Ability Score Improvement'))
        .sort((a, b) => a.level - b.level)
        .map(f => ({ name: f.name, level: f.level, source: f.source || 'PHB', entries: f.entries || [] }))

      // Subclass features: skip ASI, variants, and identity entries
      const subclassFeatures = (data.subclassFeature || [])
        .filter(f => !f.isClassFeatureVariant)
        .filter(f => !f.name.startsWith('Ability Score Improvement'))
        .filter(f => !subclassIdentityNames.has(f.name + '||' + f.subclassShortName))
        .sort((a, b) => a.level - b.level)
        .map(f => ({ name: f.name, level: f.level, source: f.source || 'PHB', subclassShortName: f.subclassShortName, entries: f.entries || [] }))

      CLASS_FEATURES_MAP.set(cls.name, { classFeatures, subclassFeatures, subclassShortNames })
    }
  }

  LOADED_EDITION = edition
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
// Spell school → Foundry core icon fallback. Every path here is verified to
// exist in the Foundry v13 core icon set.
const SCHOOL_ICONS = {
  abj: 'icons/magic/defensive/shield-barrier-flaming-diamond-teal.webp',
  con: 'icons/magic/nature/beam-hand-leaves-green.webp',
  div: 'icons/magic/perception/eye-ringed-glow-angry-small-teal.webp',
  enc: 'icons/magic/control/buff-flight-wings-purple.webp',
  evo: 'icons/magic/fire/flame-burning-hand-orange.webp',
  ill: 'icons/magic/movement/trail-streak-zigzag-yellow.webp',
  nec: 'icons/magic/death/bones-crossed-gray.webp',
  trs: 'icons/magic/air/air-burst-spiral-blue-gray.webp',
}

// Item type → Foundry core icon fallback. All paths verified against the
// Foundry v13 core icon set.
const ITEM_TYPE_ICONS = {
  // Weapons
  M:   'icons/weapons/swords/greatsword-crossguard-blue.webp',
  R:   'icons/weapons/bows/bow-ornamental-carved-brown.webp',
  // Armor
  LA:  'icons/equipment/chest/breastplate-banded-steel.webp',
  MA:  'icons/equipment/chest/breastplate-banded-steel.webp',
  HA:  'icons/equipment/chest/breastplate-banded-blue.webp',
  S:   'icons/equipment/shield/buckler-iron-cross-gray.webp',
  // Consumables
  P:   'icons/consumables/potions/bottle-bulb-corked-green.webp',
  SC:  'icons/sundries/scrolls/scroll-bound-blue-brown.webp',
  // Gear
  G:   'icons/containers/bags/case-leather-tan.webp',
  AT:  'icons/tools/hand/awl-steel-brown.webp',
}

// Which casters get mode="prepared" (can swap spells on long rest) vs "always"
// Prepared casters in either edition. 5.5e adds Ranger as a prepared
// caster (it lost spells-known in XPHB) and keeps Paladin prepared as
// well; 5e Ranger is technically a "known" caster but Foundry's
// preparation UI is the same widget, so showing a prep count is the
// helpful default.
const PREPARED_CASTERS = new Set([
  'Cleric', 'Druid', 'Wizard', 'Paladin', 'Artificer', 'Ranger',
])

// ─────────────────────────────────────────────────────────────────────────
// Recharge / Uses table for class features and feats.
// Keyed by "Name||Parent" where Parent is the className for class features
// or the source book for feats. Falls back to a name-only lookup so feats
// that aren't class-bound still match.
//
// `max` accepts an int-string ('1', '2'), a Foundry scale-value formula
// (e.g. '@scale.fighter.action-surges' which the dnd5e system tracks
// per-class-level), or any roll-formula expression.
// `period`: 'sr' (short rest), 'lr' (long rest), 'day', 'turn', 'round'.
// `type` defaults to 'recoverAll' when omitted.
// ─────────────────────────────────────────────────────────────────────────
// Per-class-level formula expressions for features whose max scales by level.
// We use Math.floor / ternary expressions instead of @scale.* references —
// scale-values only exist on SRD compendium class items, not on ones we
// generate here, so any @scale.<class>.<id> reference resolves to nothing
// and Foundry shows a "missing data" warning on the item.
const FEATURE_USES = {
  // Fighter
  'Second Wind||Fighter':           { max: '1', period: 'sr' },
  // Action Surge: 1 use at L2, 2 uses at L17
  'Action Surge||Fighter':          { max: '@classes.fighter.levels < 17 ? 1 : 2', period: 'sr' },
  // Indomitable: 1@L9, 2@L13, 3@L17
  'Indomitable||Fighter':           { max: '@classes.fighter.levels < 13 ? 1 : (@classes.fighter.levels < 17 ? 2 : 3)', period: 'lr' },

  // Wizard
  'Arcane Recovery||Wizard':        { max: '1', period: 'lr' },

  // Cleric — Channel Divinity: 1@L2, 2@L6, 3@L18
  'Channel Divinity||Cleric':       { max: '@classes.cleric.levels < 6 ? 1 : (@classes.cleric.levels < 18 ? 2 : 3)', period: 'sr' },
  'Divine Intervention||Cleric':    { max: '1', period: 'lr' },

  // Paladin
  'Channel Divinity||Paladin':      { max: '1', period: 'sr' },
  'Lay on Hands||Paladin':          { max: '@classes.paladin.levels * 5', period: 'lr' },
  'Divine Sense||Paladin':          { max: '1 + @abilities.cha.mod',      period: 'lr' },
  'Cleansing Touch||Paladin':       { max: '@abilities.cha.mod',          period: 'lr' },

  // Bard
  'Bardic Inspiration||Bard':       { max: '@abilities.cha.mod', period: 'sr' },

  // Druid — Wild Shape: 2/sr (PHB) until L20 unlimited
  'Wild Shape||Druid':              { max: '2', period: 'sr' },

  // Monk — Ki points equal to monk level
  'Ki||Monk':                       { max: '@classes.monk.levels', period: 'sr' },
  'Wholeness of Body||Monk':        { max: '1', period: 'lr' },

  // Sorcerer
  'Font of Magic||Sorcerer':        { max: '@classes.sorcerer.levels', period: 'lr' },
  'Sorcery Points||Sorcerer':       { max: '@classes.sorcerer.levels', period: 'lr' },

  // Warlock
  'Mystic Arcanum||Warlock':        { max: '1', period: 'lr' },

  // Barbarian — Rage: 2@L1, 3@L3, 4@L6, 5@L12, 6@L17, unlimited@L20
  'Rage||Barbarian':                { max: '@classes.barbarian.levels < 3 ? 2 : (@classes.barbarian.levels < 6 ? 3 : (@classes.barbarian.levels < 12 ? 4 : (@classes.barbarian.levels < 17 ? 5 : 6)))', period: 'lr' },

  // Ranger
  'Favored Foe||Ranger':            { max: '@prof', period: 'lr' },

  // Rogue
  'Stroke of Luck||Rogue':          { max: '1', period: 'sr' },

  // Common feats (key includes source so reprints don't collide)
  'Lucky||PHB':                     { max: '3', period: 'lr' },
  'Healer||PHB':                    { max: '1', period: 'sr' },
  'Magic Initiate||PHB':            { max: '1', period: 'lr' },
  'Fey Touched||TCE':               { max: '1', period: 'lr' },
  'Shadow Touched||TCE':            { max: '1', period: 'lr' },
  'Telekinetic||TCE':               { max: '@prof', period: 'lr' },
  'Telepathic||TCE':                { max: '1', period: 'lr' },
  'Chef||TCE':                      { max: '@prof', period: 'lr' },
}

/**
 * Build a Foundry `uses` block from FEATURE_USES.
 * `parent` is the class name (for class features) or the source (for feats).
 * Returns the empty default if the feature isn't tracked.
 *
 * Caller-supplied uses (custom features with a user-defined recharge) take
 * priority — pass them via `prefer`.
 */
function buildUsesBlock(name, parent, prefer) {
  if (prefer && (prefer.max || prefer.period)) {
    return {
      spent: prefer.spent ?? 0,
      max:   String(prefer.max ?? ''),
      recovery: prefer.period
        ? [{ period: prefer.period, type: prefer.type || 'recoverAll' }]
        : [],
    }
  }
  if (!name) return { spent: 0, max: '', recovery: [] }
  const entry = FEATURE_USES[`${name}||${parent}`] || FEATURE_USES[name]
  if (!entry) return { spent: 0, max: '', recovery: [] }
  return {
    spent: 0,
    max:   String(entry.max ?? ''),
    recovery: entry.period
      ? [{ period: entry.period, type: entry.type || 'recoverAll' }]
      : [],
  }
}

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
 * Falls back to a source-agnostic scan so items without source (e.g. Backpack)
 * still get their containerCapacity and are correctly typed as 'container'.
 */
function lookupItemFoundry(name, source, itemFndry) {
  if (!name) return {}
  const exact = itemFndry[`${name}||${source || ''}`]
  if (exact) return exact
  if (itemFndry[name]) return itemFndry[name]
  const prefix = `${name}||`
  const fuzzyKey = Object.keys(itemFndry).find(k => k.startsWith(prefix))
  return fuzzyKey ? itemFndry[fuzzyKey] : {}
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

/**
 * Single entry point for resolving a feat/feature/racial-trait description.
 * Sources, in priority order:
 *   1. `prefer` — caller-supplied description (user-edited custom feat, etc.)
 *   2. Class-feature index, when `className` is given ("Name||Class")
 *   3. Feat index (FEAT_INDEX → feats.json runtime fallback)
 *   4. Optional-feature index (Eldritch Invocations, Maneuvers, …)
 *   5. 5etools `entries` array, rendered to HTML
 * Logs a warning when nothing turns up so we can spot data gaps.
 */
function resolveFeatureDescription({ name, source, className, entries, prefer, kind = 'feature' } = {}) {
  if (typeof prefer === 'string' && prefer.trim()) return prefer
  if (!name) return ''

  if (className) {
    const cf = lookupClassFeatureDesc(name, className)
    if (cf) return cf
  }

  const feat = lookupFullFeatDesc(name, source)
  if (feat) return feat

  const opt = lookupOptionalFeatureDesc(name, source)
  if (opt) return opt

  if (Array.isArray(entries) && entries.length) {
    const html = entriesToHtml(entries)
    if (html) return html
  }

  const ctx = [source && `src=${source}`, className && `cls=${className}`].filter(Boolean).join(', ')
  console.warn(`[Export] No description found for ${kind} "${name}"${ctx ? ` (${ctx})` : ''}`)
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

// Foundry's allowed enums — anything outside these breaks import validation.
const VALID_DURATION_UNITS = new Set(['inst', 'round', 'minute', 'hour', 'day', 'perm', 'spec', 'turn'])
const VALID_RANGE_UNITS    = new Set(['', 'self', 'touch', 'spec', 'any', 'ft', 'mi', 'mile'])

/**
 * Defensive sanitizer for activity/system `duration`. Foundry refuses to import
 * an actor when duration.value is a non-numeric, non-formula string like
 * "Instantaneous". We normalize:
 *   - if value is an alphabetic string, re-parse via parseDuration() so unit
 *     names ("Instantaneous", "Until dispelled") become null + the right units
 *   - if units is not in the allowed enum, snap to 'inst'
 * Other flags (concentration, override, special) pass through untouched.
 */
function sanitizeDuration(d) {
  if (d == null || typeof d !== 'object') {
    return { ...parseDuration(d), concentration: false, override: false }
  }
  let { value, units, ...rest } = d
  // Alphabetic value (e.g. "Instantaneous") is a unit-name, not a magnitude.
  // Re-route through parseDuration and adopt its units regardless of incoming.
  if (typeof value === 'string' && value && !/^[\d.+\-@]/.test(value.trim())) {
    const reparsed = parseDuration(value)
    value = reparsed.value
    units = reparsed.units
  }
  if (!VALID_DURATION_UNITS.has(units)) units = 'inst'
  return { value: value ?? null, units, ...rest }
}

/** Same idea as sanitizeDuration, applied to range. */
function sanitizeRange(r) {
  if (r == null || typeof r !== 'object') {
    return { ...parseRange(r), special: '', override: false }
  }
  let { value, units, ...rest } = r
  if (typeof value === 'string' && value && !/^[\d.+\-@]/.test(value.trim())) {
    const reparsed = parseRange(value)
    value = reparsed.value
    units = reparsed.units
  }
  if (!VALID_RANGE_UNITS.has(units)) units = ''
  return { value: value ?? null, units, ...rest }
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
    duration: sanitizeDuration({
      value:         actDur.value,
      units:         actDur.units,
      concentration: meta?.concentration ?? false,
      override:      false,
    }),
    // Effekt-Referenzen: foundryId → tatsächliche _id auflösen
    effects: (patch.effects || []).map(e => {
      const rid = effectIdMap[e.foundryId]
      if (!rid) return null
      const entry = { _id: rid }
      if (e.onSave !== undefined) entry.onSave = e.onSave
      return entry
    }).filter(Boolean),
    range: sanitizeRange({
      value:    actRange.value ?? '',
      units:    actRange.units,
      special:  '',
      override: false,
    }),
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

  const dur   = parseDuration(spell.duration)
  const range = parseRange(spell.range)

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
      duration:     sanitizeDuration(dur),
      level:        levelNum,
      materials:    { value: '', consumed: false, cost: 0, supply: 0 },
      preparation:  { mode: isCantrip ? 'prepared' : 'always', prepared: true },
      properties:   buildSpellProperties(
        {}, spell.concentration || false, spell.ritual || false
      ),
      range:        sanitizeRange(range),
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
          duration: sanitizeDuration({ value: dur.value, units: dur.units, concentration: spell.concentration || false, override: false }),
          effects: [],
          range: sanitizeRange({ value: range.value, units: range.units, special: '', override: false }),
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

const SAVE_ABBR = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
  str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha',
}

// Pull the first dice expression ({@damage 1d10}, {@dice 1d8}, …) from a
// 5etools entries array.
function firstSpellDice(entries) {
  const m = JSON.stringify(entries || [])
    .match(/\{@(?:damage|dice|scaledamage|scaledice) (\d+)d(\d+)/)
  return m ? { number: parseInt(m[1], 10), denomination: parseInt(m[2], 10) } : null
}

// Build a rollable spell activity (attack / save / heal) from live 5etools
// spell data, so damage can actually be rolled in Foundry. Falls back to a
// plain utility activity when the spell has no damage / save / healing.
function buildDefaultSpellActivity(live, levelNum, baseActivity) {
  const isCantrip  = levelNum === 0
  const dice       = firstSpellDice(live.entries)
  const damageType = (live.damageType || [])[0] || ''
  const attackKind = (live.spellAttack || [])[0]    // 'R' | 'M'
  const saveRaw    = (live.savingThrow || [])[0]    // 'dexterity', …
  const scaling    = isCantrip
    ? { mode: 'whole', number: 1, formula: '' }
    : { mode: '', number: null, formula: '' }
  const damagePart = dice ? {
    number: dice.number, denomination: dice.denomination, bonus: '',
    types: damageType ? [damageType] : [],
    custom: { enabled: false, formula: '' },
    scaling,
  } : null

  // Attack spell (Eldritch Blast, Fire Bolt, …)
  if (attackKind && damagePart) {
    return {
      ...baseActivity, type: 'attack',
      attack: {
        ability: 'spellcasting', bonus: '', critical: {}, flat: false,
        type: { value: attackKind === 'M' ? 'melee' : 'ranged', classification: 'spell' },
      },
      damage: { critical: {}, includeBase: true, parts: [damagePart] },
    }
  }

  // Saving-throw spell (Fireball, Frostbite, …)
  if (saveRaw) {
    const act = {
      ...baseActivity, type: 'save',
      save: {
        ability: [SAVE_ABBR[String(saveRaw).toLowerCase()] || 'dex'],
        dc: { formula: '', calculation: 'spellcasting' },
      },
    }
    if (damagePart) act.damage = { parts: [damagePart], onSave: 'half' }
    return act
  }

  // Healing spell (Cure Wounds, Healing Word, …)
  if (dice && !damageType && /regain|hit point/i.test(JSON.stringify(live.entries || []))) {
    return {
      ...baseActivity, type: 'heal',
      healing: {
        number: dice.number, denomination: dice.denomination, bonus: '@mod',
        types: ['healing'], custom: { enabled: false, formula: '' }, scaling,
      },
    }
  }

  return { ...baseActivity, type: 'utility', roll: { prompt: false, visible: false } }
}

function makeSpellItem(name, rawLevel, prepMode, sourceClass, character, opts = {}) {
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
    // Default activity generated from live spell data — a rollable attack /
    // save / heal where the spell deals damage or heals, otherwise utility.
    const actId = makeId(`act_${name}_default`)
    const baseActivity = {
      _id:  actId,
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
      duration: sanitizeDuration({
        value:         dur.value,
        units:         dur.units,
        concentration: meta.concentration ?? false,
        override:      false,
      }),
      effects: [],
      range: sanitizeRange({
        value:   range.value ?? '',
        units:   range.units,
        special: '',
        override: false,
      }),
      target: {
        template: { contiguous: false, units: 'ft' },
        affects:  { choice: false },
        override: false,
        prompt:   true,
      },
      uses: { spent: 0, recovery: [] },
    }
    activities[actId] = buildDefaultSpellActivity(live, levelNum, baseActivity)
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
    duration:     sanitizeDuration(dur),
    level:        levelNum,
    materials:    { value: matText, consumed: matConsumed, cost: matCost, supply: 0 },
    preparation:  {
      mode:     isPact ? 'pact' : isInnate ? 'innate' : isAlways ? 'always' : 'prepared',
      // For mode="prepared" the caller can opt the spell IN or OUT of
      // the prepared list (5.5e Ranger/Paladin export every spell on
      // their class list, but only the player's current picks are
      // `prepared: true`). Innate/always/pact ignore the opt and
      // stay always-castable; cantrips (level 0) are always prepared.
      prepared: isInnate ? false
        : isPact ? true
        : isAlways ? true
        : levelNum === 0 ? true
        : (opts.prepared != null ? !!opts.prepared : true),
    },
    properties,
    range:        sanitizeRange(range),
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

const CLASS_PRIMARY_ABILITY = {
  Barbarian: 'str', Bard: 'cha', Cleric: 'wis', Druid: 'wis', Fighter: 'str',
  Monk: 'dex', Paladin: 'str', Ranger: 'dex', Rogue: 'dex', Sorcerer: 'cha',
  Warlock: 'cha', Wizard: 'int', Artificer: 'int',
}

// dnd5e prepared-spell formula, e.g. "max(@abilities.int.mod + @classes.wizard.levels, 1)".
// Foundry needs this on prepared-caster class items to compute the prepared limit.
function buildPreparationFormula(cls) {
  const ability = cls.spellcastingAbility
  if (!ability) return null
  const id = cls.classId.toLowerCase().replace(/\s+/g, '-')
  const prog = cls.casterProgression
  // 5.5e half-casters (Ranger / Paladin in XPHB) use the "artificer"
  // progression name and get slots from L1 — match Foundry by using
  // ceil(level/2) so the prep count tracks the early-game uptick.
  const lvlExpr =
    (prog === 'half' || prog === '1/2') ? `floor(@classes.${id}.levels / 2)`
    : prog === 'artificer'               ? `ceil(@classes.${id}.levels / 2)`
    :                                       `@classes.${id}.levels`
  return `max(@abilities.${ability}.mod + ${lvlExpr}, 1)`
}

// Class items have no description in the 5etools class data — build a concise
// summary (hit die, saves, casting ability) plus a feature list.
function buildClassDescription(cls) {
  const lines = [`<p><strong>Hit Die:</strong> 1d${cls.hitDie || 8}</p>`]
  const saves = (cls.proficiency?.length ? cls.proficiency : CLASS_SAVES[cls.classId]) || []
  if (saves.length) {
    lines.push(`<p><strong>Saving Throws:</strong> ${saves.map(s => String(s).toUpperCase()).join(', ')}</p>`)
  }
  if (cls.spellcastingAbility) {
    lines.push(`<p><strong>Spellcasting Ability:</strong> ${cls.spellcastingAbility.toUpperCase()}</p>`)
  }
  const feats = (CLASS_FEATURES_MAP?.get(cls.classId)?.classFeatures || [])
    .filter(f => f.level <= (cls.level || 1))
  if (feats.length) {
    lines.push('<h3>Class Features</h3><ul>')
    for (const f of feats) lines.push(`<li><strong>Level ${f.level}:</strong> ${f.name}</li>`)
    lines.push('</ul>')
  }
  return lines.join('\n')
}

function makeClassItem(cls, character) {
  const edition  = character.meta?.edition || '5e'
  const classKey = `class_${cls.classId}`
  const prepFormula = PREPARED_CASTERS.has(cls.classId) && cls.spellcastingAbility
    ? buildPreparationFormula(cls) : null

  // ── HP Advancement ────────────────────────────────────
  // Every level from 1..cls.level must have a value — Foundry uses this to
  // compute max HP. Missing entries mean "no HP gained at that level".
  //
  // 5e/5.5e rule: only the *primary* class (the character's L1 class)
  // grants max HP at its level 1. Multiclassed levels — even the
  // multiclass class's own level 1 — get average or rolled HP. Marking
  // both classes' L1 as 'max' overcounted by (max - avg) HP per extra
  // class: Ranger d10 max(10) vs avg(6) = 4 extra HP, which is exactly
  // the discrepancy we were seeing for a Rogue3 / Ranger4 character.
  const isPrimaryClass = character.classes?.[0]?.classId === cls.classId
  const hpValue = {}
  for (let lv = 1; lv <= cls.level; lv++) {
    if (lv === 1 && isPrimaryClass) {
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
  // isPrimaryClass already computed earlier (HP advancement gate).

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
    // AbilityScoreImprovement — one entry per ASI level (Fighter: 4,6,8,12,14,16,19 etc.)
    ...((CLASS_ASI_LEVELS?.get(cls.classId) || []).map(lvl => ({
      _id:           makeId(`adv_asi_${classKey}_${lvl}`),
      type:          'AbilityScoreImprovement',
      configuration: { cap: 2, fixed: {}, locked: [], points: 2 },
      value:         { type: 'feat', feat: {} },
      level:         lvl,
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
               || CF_DESC?.[`_class||${cls.classId}`] || buildClassDescription(cls),
        chat: ''
      },
      identifier:        cls.classId.toLowerCase().replace(/\s+/g, '-'),
      source:            makeSource(cls.source || 'PHB', edition),
      startingEquipment: [],
      wealth:            '',
      levels:            cls.level,
      primaryAbility:    {
        value: [CLASS_PRIMARY_ABILITY[cls.classId] || cls.spellcastingAbility || 'str'],
        all:   false,
      },
      hd: {
        denomination: `d${cls.hitDie || 8}`,
        spent:        0,
        additional:   '',
      },
      spellcasting: {
        progression: normFoundryProg(cls.casterProgression),
        ability:     cls.spellcastingAbility || '',
        preparation: prepFormula ? { formula: prepFormula } : {},
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

// Convert 5etools casterProgression ('1/3', '1/2') to Foundry's string values.
function normFoundryProg(prog) {
  if (!prog) return 'none'
  if (prog === '1/3') return 'third'
  if (prog === '1/2') return 'half'
  return prog
}

// Returns the spellcasting object for a subclass item.
// Subclasses that grant spellcasting (EK = 'third/int', AT = 'third/int') are
// looked up from SUBCLASS_SPELL_MAP; all others default to progression:'none'.
function buildSubclassSpellcasting(subclassName) {
  const entry = SUBCLASS_SPELL_MAP?.get(subclassName)
  if (entry) return { progression: entry.progression, ability: entry.ability }
  return { progression: 'none' }
}

// Fallback subclass description: a list of the subclass's features by level.
function buildSubclassDescription(cls, subclassName) {
  const fmap = CLASS_FEATURES_MAP?.get(cls.classId)
  if (!fmap) return ''
  const short = fmap.subclassShortNames?.get(subclassName) || subclassName
  const feats = (fmap.subclassFeatures || [])
    .filter(f => f.subclassShortName === short && f.level <= (cls.level || 1))
  if (!feats.length) return ''
  const lines = ['<h3>Subclass Features</h3><ul>']
  for (const f of feats) lines.push(`<li><strong>Level ${f.level}:</strong> ${f.name}</li>`)
  lines.push('</ul>')
  return lines.join('\n')
}

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
          || CF_DESC?.[`_subclass||${subclassName}||${cls.classId}`]
          || buildSubclassDescription(cls, subclassName),
        chat: ''
      },
      identifier:      subclassName.toLowerCase().replace(/\s+/g, '-'),
      source:          makeSource(cls.source || 'PHB', edition),
      classIdentifier: cls.classId.toLowerCase().replace(/\s+/g, '-'),
      spellcasting:    buildSubclassSpellcasting(subclassName),
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
  // DDB format: if subrace already contains the base race name (e.g. "High Elf" ⊃ "Elf"),
  // use the subrace alone; otherwise prepend subrace ("Variant" + "Human" → "Variant Human").
  const displayName = subrace
    ? (subrace.toLowerCase().includes(raceName.toLowerCase()) ? subrace : `${subrace} ${raceName}`)
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

    const descHtml = resolveFeatureDescription({
      name:    traitName,
      source:  raceSource,
      entries: entry.entries,
      kind:    'racial trait',
    })

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
        uses:          buildUsesBlock(traitName, raceName),
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
        value: resolveFeatureDescription({
          name:    featData.name,
          source:  featData.source || cls.source,
          className: cls.classId,
          entries: featData.entries,
          prefer:  featData.system?.description?.value,
          kind:    'class feature',
        }),
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
      uses:          buildUsesBlock(featData.name, cls.classId, featData.system?.uses),
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
  const featDesc = resolveFeatureDescription({
    name:   feat.featId,
    source: feat.source,
    prefer: feat.description,
    kind:   'feat',
  })

  // Foundry feat patches (foundry-feats.json) carry the ActiveEffects
  // that grant the feat's mechanical bonus — Alert's
  // flags.dnd5e.initiativeAlert, Archery's +2 RWAK attack, etc. Without
  // them the exported feat is decorative-only and the player would have
  // to re-create the bonus by hand in Foundry.
  const patch = FOUNDRY_FEATS_BY_KEY?.[`${feat.featId}||${feat.source || ''}`]
             || FOUNDRY_FEATS_BY_KEY?.[feat.featId]
             || null
  const effects = (patch?.effects || []).map((effPatch, i) =>
    buildEffect(effPatch, makeId(`feat_eff_${feat.featId}_${i}`), feat.featId)
  )

  // Some patches also carry system-level overrides (e.g. uses block,
  // type subtype). Treat them like the spell patches do.
  const systemPatch = patch?.system || null

  const system = {
    description:   { value: featDesc, chat: '' },
    identifier:    feat.featId.toLowerCase().replace(/\s+/g, '-'),
    source:        makeSource(feat.source || 'PHB', edition),
    prerequisites: { repeatable: false },
    properties:    [],
    requirements:  '',
    type:          { value: 'feat', subtype: '' },
    advancement:   [],
    activities:    {},
    uses:          buildUsesBlock(feat.featId, feat.source || 'PHB', feat.uses),
    crewed:        false,
    enchant:       {},
  }
  if (systemPatch) applyDotOverrides(system, systemPatch)

  return {
    _id:  makeId(`feat_${feat.featId}`),
    name: feat.featId,
    type: 'feat',
    img:  featImg || lookupIcon(feat.featId, ICON_FEATS) || 'icons/svg/item-bag.svg',
    system,
    effects,
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
  // Defensive: legacy inventory rows from the wizard's pre-fix path
  // landed with isArmor/isWeapon=false because item-index.json's
  // source-suffixed type code (`LA|XPHB`) skipped the equality check.
  // Re-derive from the type code so an old character still exports
  // its leather armor as `type: 'equipment'` and can actually be
  // equipped in Foundry.
  const typeCode = String(item.type || '').split('|')[0]
  if (!item.isArmor && ['LA','MA','HA','S'].includes(typeCode)) item = { ...item, isArmor: true }
  if (!item.isWeapon && ['M','R'].includes(typeCode))           item = { ...item, isWeapon: true }
  // item.value ist in CP gespeichert → in GP umrechnen (gerundet auf 4 Dezimalstellen)
  const priceGp = item.value != null ? +(item.value / 100).toFixed(4) : 0

  const { img: itemFoundryImg, description: itemFoundryDesc } =
    lookupItemFoundry(item.name || item.itemId, item.source, ITEM_FNDRY)
  const itemTypeIcon = ITEM_TYPE_ICONS[(item.type || '').split('|')[0]] || 'icons/svg/item-bag.svg'
  const itemImg = itemFoundryImg || lookupIcon(item.name || item.itemId, ICON_ITEMS) || itemTypeIcon
  // Fall back to 5etools `entries` when the Foundry item index gives us
  // nothing — e.g. Leather Armor||XPHB ships with an empty description
  // string in foundry-item-foundry-index.json so the equipment item
  // arrives in Foundry with no rules text. Try the item's own entries
  // first (newer inventory rows carry these now), then items-base.json
  // by name+source, then a freeform `description` override.
  const baseEntries = ITEM_ENTRIES_BY_KEY?.[`${item.name}||${item.source || ''}`]
                   || ITEM_ENTRIES_BY_KEY?.[item.name]
                   || null
  const itemDesc = itemFoundryDesc
    || (Array.isArray(item.entries) && item.entries.length ? entriesToHtml(item.entries) : '')
    || (baseEntries ? entriesToHtml(baseEntries) : '')
    || (item.description && String(item.description).trim() ? item.description : '')

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

    // dnd5e's CONFIG.DND5E.armorIds uses camelCase slugs without the
    // trailing " Armor" — e.g. Studded Leather → studdedLeather,
    // Chain Mail → chainMail, Shield → shield. Foundry's equip toggle
    // and proficiency check both key off this slug; without it the
    // item arrives as a generic "Equipment" and the row's equipped
    // checkbox stays inert.
    const baseItem = (item.name || '')
      .replace(/\s+Armor\s*$/i, '')
      .trim()
      .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
      .replace(/^([A-Z])/, c => c.toLowerCase())

    return {
      _id:  makeId(`inv_${item.id || item.name}`),
      name: item.name || 'Unknown Item',
      type: 'equipment',
      img:  itemImg,
      system: {
        ...baseSystem,
        crewed:     false,
        armor:      { value: item.ac ?? null, magicalBonus: null, dex: dexCap },
        proficient: null,
        properties: [],
        strength:   item.strength || 0,
        type:       { value: armorType, baseItem },
      },
      effects: [],
      folder:  null,
      sort:    0,
      flags:   {},
      _stats:  makeStats(),
    }
  }

  // ── Container (Backpack, Pouch, Chest, etc.) ────────
  // Two sources tell us this is a container:
  //   1. foundry-item-foundry-index gives a `containerCapacity` block
  //      (canonical PHB/XPHB items: Backpack, Pouch, Quiver, …).
  //   2. The sheet's own classifier — name regex for sack/crate/case/
  //      bandolier/… and the explicit `isContainer` flag the player can
  //      set on a custom item. Without (2) a custom or generically-named
  //      container becomes a loose `loot` item and Foundry refuses to
  //      nest its contents, defeating the export's container hierarchy.
  const itemFndryEntry = lookupItemFoundry(item.name || item.itemId, item.source, ITEM_FNDRY)
  const containerCap   = itemFndryEntry.containerCapacity || null
  const sheetThinksContainer = isContainerItem(item)
  if (containerCap || sheetThinksContainer) {
    const capWeight = Array.isArray(containerCap?.weight)
      ? containerCap.weight.reduce((a,b) => a+b, 0)
      : 0
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
  // typeCode already computed at the top of makeInventoryItem.
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
  const characterEdition = character.meta?.edition || '5e'
  await ensureIndexes(characterEdition)

  // Bulk-Export aus der Campaign-Übersicht zieht den Char-Datensatz roh
  // aus Supabase — ohne die transient-Felder die das Live-Sheet auf
  // `character` stasht (__fixedSkills, classDataMap). Wir hydratieren
  // hier minimal: race-fixed skills + classDataMap. featureChoices
  // (Expertise, Languages, Tools) brauchen die Skill-Proficiencies aus
  // der Race um korrekt auf Expertise upzugraden.
  const { hydrated, classDataMap } = await hydrateForExport(character)
  character = hydrated

  // Load live spell data for accurate levels/schools/descriptions. Cache
  // is keyed by the edition we loaded for; if it changed since the last
  // export we must rebuild (XPHB spells differ from PHB on level / class
  // list / casting time for several spells).
  if (!LIVE_SPELL_MAP || LIVE_SPELL_MAP._edition !== characterEdition) {
    try {
      const { loadSpellList } = await import('./dataLoader')
      const spells = await loadSpellList(characterEdition)
      LIVE_SPELL_MAP = new Map()
      LIVE_SPELL_MAP._edition = characterEdition
      for (const sp of spells) {
        LIVE_SPELL_MAP.set(sp.name.toLowerCase(), sp)
      }
    } catch (e) {
      console.warn('[Export] Could not load spell data:', e)
      LIVE_SPELL_MAP = new Map()
      LIVE_SPELL_MAP._edition = characterEdition
    }
  }

  // ── Computed Character Stats ─────────────────────────
  // classDataMap-Argument ist wichtig damit Subclass-Features, Level-
  // Table-Resources (Ki/Bardic Inspiration/etc), und scaling-dice
  // (Sneak Attack) korrekt aufgelöst werden.
  const computed  = computeCharacter(character, classDataMap) || {}
  const scores    = computeAbilityScores(character)
  const modifiers = computeModifiers(scores)
  const profBonus = getProficiencyBonus(character)
  const edition   = character.meta?.edition || '5e'
  const profs     = computed.proficiencies || {}

  // ── Ability Scores mit vollständigem roll-Block ──────
  // We don't emit feature-derived check/save bonuses here. The class /
  // subclass / race items we export each carry their own Active
  // Effects (e.g. Fey Wanderer's Otherworldly Glamour, Paladin's Aura
  // of Protection), and Foundry applies those at runtime. Emitting the
  // same bonus on `abilities.<ab>.bonuses.check` would stack on top of
  // the active effect — every Fey Wanderer's CHA check would be
  // doubled. `value` already reflects feat ASIs via
  // computeAbilityScores, which is the *only* score-level adjustment
  // that doesn't have an equivalent Foundry item granting it.
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
    else if (prog === 'half' || prog === '1/2') casterLevel += Math.floor(cls.level / 2)
    // 5.5e half-casters (Ranger/Paladin in XPHB) get slots at L1 already —
    // 5etools labels this progression "artificer". Use ceil to match.
    else if (prog === 'artificer') casterLevel += Math.ceil(cls.level / 2)
    else if (prog === '1/3')  casterLevel += Math.floor(cls.level / 3)
    else if (prog === 'pact') warlockData  = WARLOCK_SLOTS[cls.level] || null
  }
  const effCL  = Math.min(20, Math.round(casterLevel))
  const slotArr = effCL > 0 ? FULL_CASTER_SLOTS[effCL] : null

  // ── Prepared-Spell maximum (system.spells.prep.max in dnd5e v5+) ──
  // Foundry zeigt unten am Spell-Tab "Prepared X/Y" — Y kommt aus diesem
  // aggregierten Wert. dnd5e v5+ rechnet das normalerweise selber aus
  // den class-item preparation.formulas, aber wir pre-computen den Wert
  // damit das Sheet sofort nach Import korrekt anzeigt (ohne dass der
  // User erst ein Long-Rest klickt um Recompute zu triggern).
  // Per-Klasse: max(abilityMod + classLevel|half|ceil, 1). Multi-Class
  // summiert die einzelnen Maxima.
  let prepMax = 0
  const PREP_CASTERS_SET = PREPARED_CASTERS
  for (const cls of (character.classes || [])) {
    if (!PREP_CASTERS_SET.has(cls.classId)) continue
    const ab = cls.spellcastingAbility
    if (!ab) continue
    const abMod = modifiers[ab] || 0
    const prog = cls.casterProgression
    const lvl = cls.level || 0
    let classCount = 0
    if (prog === 'half' || prog === '1/2') classCount = Math.floor(lvl / 2)
    else if (prog === 'artificer')         classCount = Math.ceil(lvl / 2)
    else                                   classCount = lvl
    prepMax += Math.max(abMod + classCount, 1)
  }

  // dnd5e v5+: system.spells ist NUR die Slot-Mapping (spell1..spell9
  // + pact). Keine top-level prep-Felder — die "Prepared X/Y"-Anzeige
  // unten am Spell-Tab wird DYNAMISCH vom Foundry-Sheet aus:
  //   • Class-Items mit system.spellcasting.preparation.formula (Y, max)
  //   • Spell-Items mit preparation.mode='prepared' + prepared=true (X)
  // gerendert. Wir setzen die formula auf den Klass-Items unten
  // (siehe buildPreparationFormula). Manuelles prepValue/prepMax hier
  // würde von Foundry beim Import ignoriert (nicht im Schema).
  const spellSlots = {
    spell1: { value: slotArr?.[0] || 0 }, spell2: { value: slotArr?.[1] || 0 },
    spell3: { value: slotArr?.[2] || 0 }, spell4: { value: slotArr?.[3] || 0 },
    spell5: { value: slotArr?.[4] || 0 }, spell6: { value: slotArr?.[5] || 0 },
    spell7: { value: slotArr?.[6] || 0 }, spell8: { value: slotArr?.[7] || 0 },
    spell9: { value: slotArr?.[8] || 0 }, pact:   { value: warlockData?.slots || 0 },
  }
  // prepMax wird oben berechnet als Sanity-Log + Validation; Foundry
  // selbst kommt aus den class-item-formulas.
  void prepMax

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
  // Foundry erkennt einen festen Set Standard-Sprachen mit fixierten
  // IDs. Unbekannte Namen (Homebrew, Subrace-specific) landen sonst
  // in value und werden in der Sheet stumm verschluckt — wir routen
  // sie deshalb in custom (semicolon-separated).
  const FOUNDRY_LANGS = new Set([
    'common','dwarvish','elvish','giant','gnomish','goblin','halfling','orc',
    'abyssal','celestial','draconic','deepspeech','infernal','primordial','sylvan','undercommon',
    'druidic','thievescant','signlanguage','aarakocra','gith','aquan','auran','ignan','terran',
  ])
  const langValuesAll = (profs.languages || []).map(l => String(l || '').trim()).filter(Boolean)
  const langValues = []
  const langCustom = []
  for (const l of langValuesAll) {
    const norm = l.toLowerCase().replace(/[\s'-]/g, '')
    if (FOUNDRY_LANGS.has(norm)) langValues.push(norm)
    else langCustom.push(l)
  }

  // Tool Proficiencies
  const tools = {}
  for (const [toolKey, lvl] of Object.entries(profs.tools || {})) {
    const tid    = makeId(`tool_${toolKey}`)
    // featureChoices schreibt `lvl = true` (boolean) — alles was wahr
    // ist aber nicht explicit 'expertise' = profValue 1.
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
  const classItems = safeMap(character.classes, cls => makeClassItem(cls, character), 'class')

  // 2. Subklassen
  const subclassItems = safeMap(
    (character.classes || []).filter(cls => cls.subclassId),
    cls => makeSubclassItem(cls, character), 'subclass')

  // 3. Klassen-Features
  // Source of truth: CLASS_FEATURES_MAP (5etools) — all features per class/subclass.
  // CLASS_INDEX patches provide rich data (activities, effects, img) where available;
  // features not in the patch index still get a basic item with description from CF_DESC.
  const classFeatureItems = []
  const seenFeatures = new Set()

  for (const cls of (character.classes || [])) {
    const subName     = cls.subclassId?.split('__')[0] || null
    const clsFeatData = CLASS_FEATURES_MAP?.get(cls.classId)

    // Resolve character's subclass fullName → 5etools shortName (e.g. 'War Magic' → 'War')
    const subShortName = subName && clsFeatData
      ? (clsFeatData.subclassShortNames.get(subName) || subName)
      : subName

    // Build patch map from CLASS_INDEX: featureName → patch (activities, effects, img …)
    const patchMap = new Map()
    const perClassPatches = [
      ...(CLASS_INDEX.classes[cls.classId]?.classFeature    || []),
      ...(CLASS_INDEX.classes[cls.classId]?.subclassFeature || []),
    ]
    const sharedPatches = (CLASS_INDEX._shared?.classFeature || [])
    const allPatches = [...perClassPatches]
    for (const sp of sharedPatches) {
      if (!sp?.name) continue
      if (!allPatches.some(p => p.className === cls.classId && p.name === sp.name)) {
        allPatches.push(sp)
      }
    }
    for (const p of allPatches) { if (p?.name) patchMap.set(p.name, p) }

    // All features for this class up to the character's level
    const allFeatures = [
      ...(clsFeatData?.classFeatures || []),
      ...(clsFeatData?.subclassFeatures || []).filter(f => f.subclassShortName === subShortName),
    ]

    for (const feat of allFeatures) {
      if (feat.level > cls.level) continue

      const dedupKey = `${cls.classId}|${feat.name}|${feat.level}`
      if (seenFeatures.has(dedupKey)) continue
      seenFeatures.add(dedupKey)

      const patch = patchMap.get(feat.name) || {}
      try {
        classFeatureItems.push(makeClassFeatureItem({
          name:              feat.name,
          level:             feat.level,
          source:            feat.source,
          className:         cls.classId,
          subclassShortName: feat.subclassShortName || null,
          entries:           feat.entries     || [],
          img:               patch.img        || null,
          effects:           patch.effects    || [],
          activities:        patch.activities || [],
          system:            patch.system     || {},
        }, cls, character))
      } catch (e) {
        console.warn(`[Export] skipped class feature "${feat.name}":`, e)
      }
    }
  }

  // 4. Feats
  const featItems = safeMap(character.feats, feat => makeFeatItem(feat, character), 'feat')

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

  function addSpell(name, level, mode, srcClass, opts = {}) {
    if (isFakeSpellName(name)) return
    // Innate + race-granted spells must NOT carry a sourceClass — otherwise
    // Foundry tries to bind them to a (potentially non-existent) class.
    const cleanSrcClass = (mode === 'innate') ? null : srcClass
    const key = `${name}__${cleanSrcClass || 'g'}`
    // De-dupe but UPGRADE prepared status: a later add() with
    // `prepared: true` overrides an earlier add() with `prepared: false`,
    // so when we first export the whole class spell list (unprepared)
    // and then loop the player's actual prepared list, the picks
    // flip to prepared without us having to re-order the calls.
    if (addedSpells.has(key)) {
      if (opts.prepared === true) {
        const existing = spellItems.find(s => s.name === name && s.system?.sourceClass === cleanSrcClass)
        if (existing?.system?.preparation) existing.system.preparation.prepared = true
      }
      return
    }
    addedSpells.add(key)
    try {
      spellItems.push(makeSpellItem(name, level, mode, cleanSrcClass, character, opts))
    } catch (e) {
      console.warn(`[Export] skipped spell "${name}":`, e)
    }
  }

  // Map of granted-spell-name (lowercase) → resource info for the
  // matching feature, so always-prepared spells like Hunter's Mark
  // export with their per-day uses (e.g. Ranger's Favored Enemy = PB
  // casts/day). Mirrors the resKeyOf logic on the sheet so the export
  // and the sheet show the same numbers.
  const grantedSpellUses = (() => {
    const computedRes = (computed?.resources || [])
    const usedRes = character?.status?.usedResources || {}
    const out = new Map()
    const findRes = (spellName) => {
      const lower = String(spellName).toLowerCase()
      if (/hunter's\s*mark/.test(lower)) {
        return computedRes.find(r => /favored\s*(?:enemy|foe)/i.test(r.name))
      }
      // Generic substring match against resource names.
      return computedRes.find(r => r.name && lower.includes(String(r.name).toLowerCase()))
    }
    for (const f of (character?.__activeFeatures || [])) {
      if (!f?.entries) continue
      const flat = (f.entries || []).map(e => typeof e === 'string' ? e : '').join(' ')
      const grants = flat.matchAll(/you\s+(?:always\s+have|gain)\s+(?:the\s+)?\{@spell\s+([^|}]+)(?:\|[^}]*)?\}[^.]*?(?:spell\s+prepared|prepared)/gi)
      for (const m of grants) {
        const spellName = String(m[1] || '').trim()
        if (!spellName) continue
        const res = findRes(spellName)
        if (!res || !res.max) continue
        out.set(spellName.toLowerCase(), {
          max: res.max,
          spent: Math.min(res.max, usedRes[res.id] || 0),
        })
      }
    }
    return out
  })()

  for (const cls of (character.classes || [])) {
    const prepMode = cls.casterProgression === 'pact' ? 'pact'
                   : PREPARED_CASTERS.has(cls.classId) ? 'prepared' : 'always'
    const isPrepared = prepMode === 'prepared'

    // 5.5e prepared casters (Ranger/Paladin via `casterProgression:
    // "artificer"`) also count as prepared.
    const is55Prepared = isPrepared
      || cls.casterProgression === 'artificer'
      || cls.casterProgression === 'half'
      || cls.casterProgression === '1/2'
    const effectiveMode = is55Prepared ? 'prepared' : prepMode

    // Cap exports to spell levels this class alone can actually cast.
    // For multiclass we use the CLASS's own caster level (not combined),
    // because a Ranger L4 can only prepare L1 Ranger spells even if
    // some other class hands them higher slots.
    const ownCL =
      cls.casterProgression === 'full' ? cls.level
      : cls.casterProgression === 'artificer' ? Math.ceil(cls.level / 2)
      : (cls.casterProgression === 'half' || cls.casterProgression === '1/2') ? Math.floor(cls.level / 2)
      : cls.casterProgression === '1/3' ? Math.floor(cls.level / 3)
      : cls.casterProgression === 'pact' ? cls.level
      : 0
    const ownSlots = ownCL > 0 ? (FULL_CASTER_SLOTS[Math.min(20, ownCL)] || []) : []
    let maxSpellLevel = 0
    for (let i = ownSlots.length - 1; i >= 0; i--) {
      if (ownSlots[i] > 0) { maxSpellLevel = i + 1; break }
    }
    // Warlocks cap by their pact slot level (also progression-driven).
    if (cls.casterProgression === 'pact') {
      const pact = WARLOCK_SLOTS[cls.level]
      if (pact?.level) maxSpellLevel = pact.level
    }

    for (const choices of Object.values(cls.levelChoices || {})) {
      for (const s of (choices.cantrips      || [])) addSpell(s, 0,    'prepared', cls.classId, { prepared: true })
      for (const s of (choices.startingSpells|| [])) addSpell(s, null, effectiveMode, cls.classId, { prepared: true })
      for (const s of (choices.knownSpells   || [])) addSpell(s, null, effectiveMode, cls.classId, { prepared: true })
      for (const s of (choices.preparedSpells|| [])) addSpell(s, null, effectiveMode, cls.classId, { prepared: true })
      for (const spArr of Object.values(choices.optFeatureSpells || {})) {
        for (const s of (spArr || [])) addSpell(s, null, effectiveMode, cls.classId, { prepared: true })
      }
    }
    for (const s of (cls.knownSpells   || [])) addSpell(s, null, effectiveMode, cls.classId, { prepared: true })
    for (const s of (cls.preparedSpells|| [])) addSpell(s, null, effectiveMode, cls.classId, { prepared: true })

    // 5.5e + 5e sheet's Prepare modal stores the daily list here.
    // Export each as the player's actual prepared pick.
    for (const s of (character?.status?.preparedSpells?.[cls.classId] || [])) {
      addSpell(s, null, effectiveMode, cls.classId, { prepared: true })
    }

    // Prepared casters: export the ENTIRE class spell list so the
    // player can re-prepare on long rest inside Foundry without
    // re-importing. Spells they haven't picked land with
    // `prepared: false`; their actual picks were added above with
    // `prepared: true` (addSpell upgrades the dedup match).
    if (is55Prepared && LIVE_SPELL_MAP) {
      const wantClass = (cls.classId || '').toLowerCase()
      for (const sp of LIVE_SPELL_MAP.values()) {
        if (sp.level < 1) continue // cantrips handled separately above
        if (sp.level > maxSpellLevel) continue // class can't cast it yet
        const inList = (sp.classes || []).some(c => String(c).toLowerCase() === wantClass)
        if (!inList) continue
        addSpell(sp.name, sp.level, effectiveMode, cls.classId, { prepared: false })
      }
    }
  }

  // For spells granted by a class feature that ALSO gives free casts
  // (Hunter's Mark via Favored Enemy, etc.) we want both views in
  // Foundry: an entry in the regular spell list (no uses) so the
  // player can prepare and cast it with a slot like any other spell,
  // AND a separate "At-Will" entry carrying the per-day free-cast pool
  // from the source feature's resource. The original entry stays
  // unmodified; we clone it into an at-will copy with uses attached
  // and slot consumption disabled.
  const atWillCopies = []
  for (const sp of spellItems) {
    const info = grantedSpellUses.get(String(sp.name).toLowerCase())
    if (!info) continue
    const clone = JSON.parse(JSON.stringify(sp))
    clone._id = makeId(`atwill_${sp.name}_${sp.system?.sourceClass || 'g'}`)
    clone.system.preparation = { mode: 'atwill', prepared: true }
    clone.system.uses = {
      spent:    info.spent || 0,
      max:      String(info.max),
      recovery: [{ period: 'lr', type: 'recoverAll' }],
    }
    // At-will casts don't burn a slot — they spend the spell's own
    // uses pool. Wire each activity accordingly.
    for (const act of Object.values(clone.system.activities || {})) {
      if (act?.consumption) {
        act.consumption.spellSlot = false
        act.consumption.targets = [
          ...(act.consumption.targets || []).filter(t => t?.type !== 'itemUses'),
          { type: 'itemUses', target: '', value: '1', scaling: { mode: '', formula: '' } },
        ]
      }
    }
    atWillCopies.push(clone)
  }
  spellItems.push(...atWillCopies)

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

  // Prepared-Count wird in dnd5e v5+ NICHT in system.spells abgelegt.
  // Foundry zählt selbst beim Render der Spell-Tab: alle spell-items mit
  // preparation.mode='prepared' + prepared=true + level>0. Wir müssen
  // also nur sicherstellen dass die Items selbst korrekt markiert sind
  // (siehe makeSpellItem) — was bereits geschieht.

  // 6. Inventar (regular + custom items)
  // Track each row's sheet-side `containerId` alongside the Foundry item so
  // we can rebuild the container hierarchy below. The sheet's container link
  // is `containerId` -> another item's `_key` (`id || _id || name`); we map
  // those keys to the corresponding Foundry `_id` via `makeId('inv_<key>')`.
  // Sheet uses `itemKey(item) = item.id || item._id || item.name` to set
  // `containerId`. We mirror that here so this side's lookup map shares
  // the same keys, and we feed the same key as `id` into
  // makeInventoryItem so the resulting Foundry `_id`
  // (`makeId('inv_<id>')`) stays in sync between parents and children.
  const sheetKey = (it) => it.id || it._id || it.name
  const sheetRows = [
    ...((character.inventory?.items || []).map(it => ({
      it, key: sheetKey(it),
      mk: () => makeInventoryItem({ ...it, id: sheetKey(it) }, edition),
    }))),
    ...((character.custom?.items || []).map(it => ({
      it, key: sheetKey(it),
      mk: () => makeInventoryItem({ ...it, id: sheetKey(it), grantedBy: 'custom' }, edition),
    }))),
  ]

  const inventoryItems = []
  const keyToFoundryId = new Map()
  for (const row of sheetRows) {
    try {
      const fItem = row.mk()
      if (!fItem) continue
      inventoryItems.push(fItem)
      if (row.key) keyToFoundryId.set(row.key, fItem._id)
    } catch (e) {
      console.warn('[Export] skipped inventory item:', row.it?.name, e)
    }
  }

  // The sheet is the single source of truth for container placement
  // and equipped state. Items with no containerId stay loose (Foundry
  // shows them in the "Carried" group); items the player explicitly
  // placed into a container get their Foundry parent set.
  for (const row of sheetRows) {
    if (!row.it.containerId) continue
    const parentId = keyToFoundryId.get(row.it.containerId)
    if (!parentId) continue
    const fId = keyToFoundryId.get(row.key)
    if (!fId || fId === parentId) continue // guard against self-link
    const fItem = inventoryItems.find(f => f._id === fId)
    if (!fItem) continue
    fItem.system.container = parentId
  }

  // Custom Feats als Feat Items
  for (const feat of (character.custom?.feats || [])) {
    const cFeatDesc = resolveFeatureDescription({
      name:   feat.name,
      source: feat.source,
      prefer: feat.description,
      kind:   'custom feat',
    })
    featItems.push({
      _id:    makeId(`cfeat_${feat.name}`),
      name:   feat.name,
      type:   'feat',
      img:    'icons/svg/book.svg',
      system: {
        description: { value: cFeatDesc, chat: '' },
        source:      { book: feat.source || 'Custom', custom: feat.source || 'Custom' },
        type:        { value: 'feat', subtype: '' },
        properties:  [],
        requirements: '',
        activities:  {},
        uses:        buildUsesBlock(feat.name, feat.source || 'Custom', feat.uses),
      },
      sort: 0,
      effects: [],
    })
  }

  // 7. Race Item
  let raceItem = null
  try { raceItem = raceName ? makeRaceItem(character) : null }
  catch (e) { console.warn('[Export] skipped race item:', e) }

  // 8. Background Item
  let backgroundItem = null
  try { backgroundItem = bgName ? makeBackgroundItem(character) : null }
  catch (e) { console.warn('[Export] skipped background item:', e) }

  // 9. Racial Trait Items (Darkvision, Fey Ancestry, etc.)
  let racialTraitItems = []
  try { racialTraitItems = raceName ? makeRacialTraitItems(character) : [] }
  catch (e) { console.warn('[Export] skipped racial traits:', e) }

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
          max:     null,
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
          custom:        langCustom.join(';'),
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
// Speichert das Foundry Actor JSON. In Tauri über einen Speichern-Dialog,
// im Browser / PWA über einen Blob-Download. Fehler werden immer sichtbar
// gemeldet — nichts schlägt mehr stillschweigend fehl.
// ═══════════════════════════════════════════════════════════════════════

export async function downloadFoundryJSON(character) {
  // ── 1. Actor-JSON bauen ──────────────────────────────────────────────
  let json
  try {
    const actor = await exportToFoundry(character)
    json = JSON.stringify(actor, null, 2)
  } catch (e) {
    console.error('[Export] Actor build failed:', e)
    alert('FoundryVTT-Export fehlgeschlagen beim Erzeugen des Charakters:\n\n' +
          (e?.message || String(e)))
    return
  }

  // Filename: "<Player>_<Character>_foundry.json" — the player name is
  // prepended so exports group by player. Falls back to just the character
  // name when no player is set.
  const slug = s => String(s || '').replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '')
  const playerPart = slug(character.info?.player)
  const namePart = slug(character.info?.name) || 'character'
  const filename = `${playerPart ? playerPart + '_' : ''}${namePart}_foundry.json`

  // ── 2. Tauri-Desktop: Speichern-Dialog → Datei schreiben ─────────────
  if (window.__TAURI_INTERNALS__) {
    try {
      const { save }          = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      const { downloadDir }   = await import('@tauri-apps/api/path')

      // Letzten Ordner als Vorschlag wiederverwenden; sonst Downloads.
      // OHNE expliziten Ordner würde der Dialog im CWD des Prozesses
      // öffnen, was bei "als Admin starten" zu C:\Windows\System32
      // führt. Daher ist ein absoluter Default-Pfad Pflicht.
      const lastDir = localStorage.getItem('dndbuilder_export_path')
      let baseDir = lastDir
      if (!baseDir) {
        try { baseDir = await downloadDir() } catch { baseDir = null }
      }
      const defaultPath = baseDir
        ? `${baseDir.replace(/[\\/]+$/, '')}/${filename}`
        : filename

      const target = await save({
        title: 'FoundryVTT Actor speichern',
        defaultPath,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!target) return  // Nutzer hat abgebrochen

      await writeTextFile(target, json)

      // Ordner für den nächsten Export merken.
      try {
        const dir = target.replace(/[\\/][^\\/]*$/, '')
        if (dir && dir !== target) localStorage.setItem('dndbuilder_export_path', dir)
      } catch { /* ignore */ }

      alert('Erfolgreich exportiert nach:\n' + target)
    } catch (e) {
      console.error('[Export] Tauri save failed:', e)
      alert('Speichern fehlgeschlagen:\n\n' + (e?.message || String(e)) +
            '\n\nFalls hier eine fehlende Berechtigung steht, muss die App ' +
            'nach diesem Update neu gebaut werden.')
    }
    return
  }

  // ── 3. Browser / PWA: Blob-Download ──────────────────────────────────
  try {
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('[Export] Browser download failed:', e)
    alert('Download fehlgeschlagen:\n\n' + (e?.message || String(e)))
  }
}