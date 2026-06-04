// fiveeImporter.js
//
// Parsen einer 5e.tools-URL → Entity-Lookup in den lokalen JSON-Daten
// → "auf Charakter anwenden". Unterstützt drei Entity-Typen für MVP:
//   • Spells   (spells.html#name_source)
//   • Items    (items.html#name_source)
//   • Feats    (feats.html#name_source)
//
// Optional Features (Maneuvers, Invocations, Metamagic, Fighting
// Styles, …) sind ausgeklammert — die haben "wo gehört es hin?"-
// Semantik (welche Klasse, welcher Picks-Slot), und MVP soll erstmal
// 80 % der Use-Cases abdecken.
//
// Cross-Edition:
// Eine 5e-URL kann auf einem 5.5e-Char importiert werden und
// umgekehrt. Das Resultat trägt dann das Flag `_crossEdition: true`
// damit die UI das markieren kann (Pille "5e"/"5.5e" am Eintrag).
// User kann das in den DnD-Settings (`hideCrossEditionMarker`) aus-
// schalten wenn er sich die Marker spart.

import { loadSpellList, loadFeatList, loadItemList } from './dataLoader'

// 5e.tools-Pfade → unser interner Entity-Typ.
const PATH_TO_TYPE = {
  'spells.html':           'spell',
  'items.html':            'item',
  'feats.html':            'feat',
  'optionalfeatures.html': 'optionalfeature',
  'classes.html':          'class',
  'backgrounds.html':      'background',
  'races.html':            'race',
  'species.html':          'race',
  'bestiary.html':         'monster',
}

// Edition-Detection: 2014.5e.tools = 5e (2014), alles andere unter
// 5e.tools = 5.5e (2024, der aktuelle Default). User kann die
// Edition im Modal aber explizit overriden.
function editionFromHost(host) {
  const h = String(host || '').toLowerCase()
  if (h === '2014.5e.tools' || h.endsWith('.2014.5e.tools')) return '5e'
  if (h === '5e.tools' || h.endsWith('.5e.tools')) return '5.5e'
  return null
}

// Parsen einer 5e.tools-URL.
//   Erwartetes Format: https://5e.tools/<page>.html#<name>_<source>[,flags]
// Liefert { type, name, source, edition } oder null wenn nicht parsebar.
export function parseFiveEUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  let u
  try { u = new URL(rawUrl.trim()) } catch { return null }
  const edition = editionFromHost(u.host)
  if (!edition) return null
  // Trailing-Slashes wegschneiden, dann Letztes Path-Segment.
  const seg = (u.pathname || '').split('/').filter(Boolean).pop() || ''
  const type = PATH_TO_TYPE[seg]
  if (!type) return null
  const hash = decodeURIComponent((u.hash || '').replace(/^#/, ''))
  if (!hash) return null
  // 5etools-Hashes haben gelegentlich Flags hinter Kommas
  // (`name_source,flag`). Wir interessieren uns nur für den
  // "name_source"-Teil.
  const main = hash.split(',')[0]
  const ix = main.lastIndexOf('_')
  if (ix < 0) return null
  const name   = main.slice(0, ix).replace(/%20/g, ' ').trim()
  const source = main.slice(ix + 1).trim().toLowerCase()
  if (!name || !source) return null
  return { type, name, source, edition }
}

// Lookup im lokalen Datensatz. `currentEdition` ist die Charakter-
// Edition; wenn der Eintrag in der URL-Edition gefunden wird aber die
// von der Charakter-Edition abweicht, markieren wir crossEdition.
// Wenn die URL-Edition KEINEN Treffer hat, probieren wir noch die
// andere Edition als Fallback (5etools dedupliziert Phänomene wie
// "Fireball" über beide Editionen — der User soll sich nicht ans
// Edition-Toggle erinnern müssen).
export async function lookupEntry({ type, name, source, edition, currentEdition }) {
  const loaders = {
    spell: loadSpellList,
    feat:  loadFeatList,
    item:  loadItemList,
  }
  const loader = loaders[type]
  if (!loader) return { found: false, reason: 'unsupported-type' }
  const nameLow = String(name).toLowerCase()
  async function lookupIn(ed) {
    const list = await loader(ed).catch(() => [])
    // Erst by-name (case-insensitive) — case in 5etools-Hash ist
    // selten exakt der Datei-Case, deshalb lowercase Vergleich.
    return (list || []).find(e =>
      String(e?.name || '').toLowerCase() === nameLow,
    ) || null
  }
  let hit = await lookupIn(edition)
  let foundEdition = edition
  if (!hit) {
    const other = edition === '5e' ? '5.5e' : '5e'
    hit = await lookupIn(other)
    if (hit) foundEdition = other
  }
  if (!hit) return { found: false, reason: 'not-found' }
  return {
    found: true,
    entry: hit,
    type,
    foundEdition,
    crossEdition: foundEdition !== currentEdition,
    source,
  }
}

// Eintrag auf den Charakter anwenden. Schreibt in character.custom.*
// — denselben Bucket wie der existierende Manual-Add-Flow nutzt,
// also keinen Sonderfall für Display / Foundry-Export.
//
// Idempotent: wenn ein Eintrag mit gleichem Namen + Quelle schon im
// Custom-Bucket steht, wird er NICHT verdoppelt — wir liefern in dem
// Fall `{ ok: false, reason: 'duplicate' }` zurück.
export function applyImport(applyCharacter, { type, entry, crossEdition, foundEdition, source }) {
  if (!applyCharacter || !entry || !type) {
    return { ok: false, reason: 'invalid-args' }
  }
  const meta = {
    _isCustom: true,
    _isImported: true,
    _crossEdition: !!crossEdition,
    _importEdition: foundEdition,
    _importSource: source,
  }
  if (type === 'spell') {
    const sp = entry
    const payload = {
      name: sp.name,
      level: sp.level ?? 0,
      school: sp.school || '',
      castingTime: sp.castingTime || '1 action',
      range: sp.range || '—',
      duration: sp.duration || '—',
      concentration: !!sp.concentration,
      ritual: !!sp.ritual,
      description: (Array.isArray(sp.entries) ? sp.entries : [])
        .filter(e => typeof e === 'string').join('\n\n'),
      source: sp.source || source.toUpperCase(),
      grantedBy: '5etools Import',
      entries: sp.entries || [],
      entriesHigherLevel: sp.entriesHigherLevel || [],
      components: sp.components || {},
      classes: sp.classes || [],
      ...meta,
    }
    return runApply(applyCharacter, d => {
      if (!d.custom) d.custom = { spells: [], feats: [], items: [], asi: {} }
      if (!Array.isArray(d.custom.spells)) d.custom.spells = []
      const dup = d.custom.spells.find(s =>
        String(s.name).toLowerCase() === String(payload.name).toLowerCase()
        && String(s.source || '').toLowerCase() === String(payload.source || '').toLowerCase())
      if (dup) return 'duplicate'
      d.custom.spells.push(payload)
      return null
    })
  }
  if (type === 'feat') {
    const f = entry
    const payload = {
      name: f.name,
      description: (Array.isArray(f.entries) ? f.entries : [])
        .filter(e => typeof e === 'string').join('\n\n'),
      source: f.source || source.toUpperCase(),
      abilityBonus: f.ability || {},
      proficiencies: { skills: [], tools: [], weapons: [], armor: [] },
      entries: f.entries || [],
      ...meta,
    }
    return runApply(applyCharacter, d => {
      if (!d.custom) d.custom = { spells: [], feats: [], items: [], asi: {} }
      if (!Array.isArray(d.custom.feats)) d.custom.feats = []
      const dup = d.custom.feats.find(x =>
        String(x.name).toLowerCase() === String(payload.name).toLowerCase()
        && String(x.source || '').toLowerCase() === String(payload.source || '').toLowerCase())
      if (dup) return 'duplicate'
      d.custom.feats.push(payload)
      return null
    })
  }
  if (type === 'item') {
    const it = entry
    // 5etools-Type-Codes (M, R, LA, MA, HA, S, G, …) sind nicht immer
    // im Brew-Pack normalisiert. Wir leiten isWeapon/isArmor direkt
    // vom Code ab — gleiche Logik wie dataLoader.loadItemIndex.
    const code = String(it.type || '').split('|')[0]
    const isWeapon = !!it.isWeapon || ['M','R'].includes(code) || !!it.weaponCategory
    const isArmor  = !!it.isArmor  || ['LA','MA','HA','S'].includes(code)
    const payload = {
      name: it.name,
      type: it.type || 'G',
      quantity: 1,
      weight: it.weight || 0,
      value: it.value || 0,
      ac: it.ac || null,
      dmg1: it.dmg1 || null,
      dmgType: it.dmgType || null,
      weaponCategory: it.weaponCategory || null,
      properties: it.property || [],
      rarity: it.rarity || 'none',
      equipped: false,
      attuned: false,
      description: (Array.isArray(it.entries) ? it.entries : [])
        .filter(e => typeof e === 'string').join('\n\n'),
      entries: it.entries || [],
      isWeapon, isArmor,
      // Magic-Boni 1:1 weitergeben damit rulesEngine sie greift sobald
      // das Item equipped wird (Cloak of Protection +1 AC + 1 Save,
      // +1 Weapon, Robe of the Archmagi etc.).
      bonusAc:            it.bonusAc            || null,
      bonusWeapon:        it.bonusWeapon        || null,
      bonusWeaponAttack:  it.bonusWeaponAttack  || null,
      bonusWeaponDamage:  it.bonusWeaponDamage  || null,
      bonusSpellAttack:   it.bonusSpellAttack   || null,
      bonusSpellSaveDc:   it.bonusSpellSaveDc   || null,
      bonusSavingThrow:   it.bonusSavingThrow   || null,
      bonusAbilityCheck:  it.bonusAbilityCheck  || null,
      reqAttune:          it.reqAttune          || false,
      // Wondrous-Flag mitnehmen — entscheidet datadriven über
      // Wondrous-vs-Loot-Kategorie in der InventoryTab.
      wondrous:           !!it.wondrous,
      source: it.source || source.toUpperCase(),
      ...meta,
    }
    return runApply(applyCharacter, d => {
      if (!d.custom) d.custom = { spells: [], feats: [], items: [], asi: {} }
      if (!Array.isArray(d.custom.items)) d.custom.items = []
      const dup = d.custom.items.find(x =>
        String(x.name).toLowerCase() === String(payload.name).toLowerCase()
        && String(x.source || '').toLowerCase() === String(payload.source || '').toLowerCase())
      if (dup) return 'duplicate'
      d.custom.items.push(payload)
      return null
    })
  }
  return { ok: false, reason: 'unsupported-type' }
}

// Wrappt den applyCharacter-Aufruf so dass der Mutator entweder null
// (erfolg) oder einen String-Grund zurückgeben kann.
function runApply(applyCharacter, mutator) {
  let reason = null
  applyCharacter(d => { reason = mutator(d) }, { changedPaths: ['custom'] })
  if (reason === 'duplicate') return { ok: false, reason: 'duplicate' }
  return { ok: true }
}

// 5e.tools-URL für die "Browse"-Fenster bauen. Edition + Page-Typ.
export function buildFiveEUrl(edition, type) {
  const host = edition === '5e' ? 'https://2014.5e.tools' : 'https://5e.tools'
  const page = type === 'item'  ? 'items.html'
             : type === 'feat'  ? 'feats.html'
             : 'spells.html'
  return `${host}/${page}`
}

// Live-Fallback: fetcht die JSON-Daten direkt von 5e.tools wenn der
// Eintrag im lokalen Mirror nicht gefunden wurde. Spiegelt die
// Datei-Struktur die der lokale Loader nutzt (gleicher Aufbau, weil
// unsere lokalen Files exakt von 5e.tools stammen).
//
// Hinweis: CORS — 5e.tools served typischerweise mit permissivem
// Origin-Header für Daten-Dateien (sonst funktionierten ihre eigenen
// Fan-Tools nicht). Sollte ein WebView2 trotzdem blocken, schluckt
// der Catch das und der Modal zeigt "not-found" — keine Crash.
//
// Per-Session-Cache (in-memory) damit wiederholte Imports denselben
// Quellbuch nicht jedes Mal neu ziehen.
const _liveCache = new Map()
async function _liveFetchJson(url) {
  if (_liveCache.has(url)) return _liveCache.get(url)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      _liveCache.set(url, null)
      return null
    }
    const j = await res.json()
    _liveCache.set(url, j)
    return j
  } catch (e) {
    console.warn('[fiveeImporter] live fetch failed', url, e?.message || e)
    _liveCache.set(url, null)
    return null
  }
}

function _liveHost(edition) {
  return edition === '5e' ? 'https://2014.5e.tools' : 'https://5e.tools'
}

async function _fetchLiveEntry({ type, name, source, edition }) {
  const base = _liveHost(edition)
  const nameLow = String(name || '').toLowerCase()
  const srcLow  = String(source || '').toLowerCase()
  if (type === 'spell') {
    // spells haben pro Quelle ein eigenes File; index.json mappt
    // <source-code> → <filename>.
    const idx = await _liveFetchJson(`${base}/data/spells/index.json`)
    if (idx && typeof idx === 'object') {
      const file = idx[srcLow] || idx[source] || null
      if (file) {
        const data = await _liveFetchJson(`${base}/data/spells/${file}`)
        if (data) {
          const hit = (data.spell || []).find(s => String(s.name).toLowerCase() === nameLow)
          if (hit) return hit
        }
      }
    }
    // Kein Treffer im Core-Index → Homebrew durchsuchen.
    return _fetchLiveHomebrew({ type: 'spell', name, source })
  }
  if (type === 'feat') {
    const data = await _liveFetchJson(`${base}/data/feats.json`)
    if (data) {
      const hit = (data.feat || []).find(f =>
        String(f.name).toLowerCase() === nameLow
        && (!srcLow || String(f.source || '').toLowerCase() === srcLow),
      )
      if (hit) return hit
    }
    return _fetchLiveHomebrew({ type: 'feat', name, source })
  }
  if (type === 'item') {
    // Magic Items leben in items.json, Base Items in items-base.json.
    // Wir probieren beide und nehmen den ersten Treffer.
    for (const file of ['items.json', 'items-base.json']) {
      const data = await _liveFetchJson(`${base}/data/${file}`)
      if (!data) continue
      const list = data.item || data.baseitem || []
      const hit = list.find(it =>
        String(it.name).toLowerCase() === nameLow
        && (!srcLow || String(it.source || '').toLowerCase() === srcLow),
      )
      if (hit) return hit
    }
    return _fetchLiveHomebrew({ type: 'item', name, source })
  }
  return null
}

// 5e.tools-Homebrew lebt im separaten GitHub-Repo
// `TheGiddyLimit/homebrew`. Brew-Daten werden NICHT von 5e.tools
// selbst gehostet (5e.tools' Brew-Loader fetcht zur Laufzeit von
// raw.githubusercontent.com). GitHub-Raw setzt
// `Access-Control-Allow-Origin: *` → fetch() funktioniert direkt aus
// einer WebView ohne Proxy.
//
// Struktur des Repos:
//   /_generated/index.json            ← Master-Index pro Kategorie
//   /item/Item;<author>;<title>.json  ← Brew-Files
//   /spell/Spell;<author>;<title>.json
//   /feat/Feat;<author>;<title>.json
//   ...
//
// Index-Format pro Kategorie:
//   [{
//     name: "Critical Role: Tal'Dorei Campaign Setting Reborn",
//     fileName: "Item;Critical Role; Tal'Dorei Campaign Setting Reborn.json",
//     _meta: { sources: [{ json: "TDCSR", abbreviation: "TDCSR",
//                          full: "Tal'Dorei Campaign Setting Reborn",
//                          ... }] }
//   }, ...]
//
// URL-Hashes für Brew benutzen entweder den kurzen Source-Code
// (`tdcsr`) ODER den lowercase-alphanumerisch-bereinigten Long-Form
// (`taldoreicampaignsettingreborn`). Wir match'n gegen BEIDE per
// Simplified-Vergleich auf sources.json UND sources.full.
// 5e.tools-Homebrew lebt im GitHub-Repo `TheGiddyLimit/homebrew`.
// GitHub-Raw setzt `Access-Control-Allow-Origin: *` → fetch() klappt
// aus jeder WebView ohne Proxy. Die wirkliche URL- und Index-Struktur
// (verifiziert per direktem curl):
//
//   /_generated/index-sources.json
//     → { "TalDoreiCampaignSettingReborn":
//         "collection/Darrington Press; Tal'Dorei Campaign Setting Reborn.json",
//         "TDCSR_Bestiary": "creature/...json", ... }
//     Mapping `<source-code>` → relativer Pfad zur Brew-Datei.
//     Source-Codes können camelCase sein; URL-Hashes sind lowercase-
//     alphanumerisch → wir matchen über _simplified.
//
//   <repo>/collection/<filename>.json
//     → { _meta: { sources: [...] }, item: [...], spell: [...], ... }
//     Brew-Files können MEHRERE Kategorien gleichzeitig enthalten,
//     besonders "collection"-Packs (Tal'Dorei hat item + monster +
//     race + class + ...).
//
// Filenames enthalten Spaces, Semikolons, Unicode-Apostroph U+2019.
// `encodeURI` (statt encodeURIComponent) erhält das `/` zwischen
// Directory und Filename und encoded den Rest properly.
const BREW_REPO_RAW = 'https://raw.githubusercontent.com/TheGiddyLimit/homebrew/master'
const BREW_SOURCES_INDEX_URL = `${BREW_REPO_RAW}/_generated/index-sources.json`

const _simplified = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function _fetchLiveHomebrew({ type, name, source }) {
  const nameLow = String(name || '').toLowerCase()
  const srcSimp = _simplified(source)
  if (!srcSimp) return null

  const sourceIndex = await _liveFetchJson(BREW_SOURCES_INDEX_URL)
  if (!sourceIndex || typeof sourceIndex !== 'object') return null

  // Pfad finden: URL-Source-Slug ist lowercase-alphanumerisch
  // bereinigt. Index-Keys sind camelCase (z.B. "TalDoreiCampaign
  // SettingReborn"). Wir matchen über _simplified beider Seiten.
  let path = null
  for (const k of Object.keys(sourceIndex)) {
    if (_simplified(k) === srcSimp) {
      path = sourceIndex[k]
      break
    }
  }
  if (!path) return null

  const url = `${BREW_REPO_RAW}/${encodeURI(path)}`
  const data = await _liveFetchJson(url)
  if (!data || typeof data !== 'object') return null

  // Brew-File-Format: top-level `item`/`spell`/`feat`/... als Arrays.
  // Bei einem Collection-Pack kann das gesuchte Item in `item` stehen
  // selbst wenn die URL-Klasse eigentlich ein Items-Browse war.
  const list = Array.isArray(data[type]) ? data[type] : []
  if (list.length === 0) return null
  // Name-only Match — die Source ist über den Index schon validiert,
  // also brauchen wir den e.source-Vergleich nicht nochmal.
  const hit = list.find(e => String(e?.name || '').toLowerCase() === nameLow)
  return hit || null
}


export async function lookupEntryLive({ type, name, source, edition, currentEdition }) {
  let hit = await _fetchLiveEntry({ type, name, source, edition })
  let foundEdition = edition
  if (!hit) {
    const other = edition === '5e' ? '5.5e' : '5e'
    hit = await _fetchLiveEntry({ type, name, source, edition: other })
    if (hit) foundEdition = other
  }
  if (!hit) return { found: false, reason: 'not-found-live' }
  return {
    found: true,
    entry: hit,
    type,
    foundEdition,
    crossEdition: foundEdition !== currentEdition,
    source,
    via: 'live',
  }
}
