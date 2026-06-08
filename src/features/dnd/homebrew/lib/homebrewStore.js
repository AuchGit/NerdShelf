// homebrewStore.js
//
// Local-first homebrew storage. Eine JSON-Datei pro Kind im
// Tauri-AppData-Verzeichnis (`<appData>/homebrew/<kind>.json`) im
// 5etools-Root-Shape — exakt das Format das die existierenden Loader
// schon konsumieren. Beispiel `items.json`:
//   { "item": [ { name, source, type, ... }, ... ] }
//
// Jeder Eintrag bekommt zusätzlich ein `_localMeta`-Subobjekt mit
// Timestamps + optionaler Sync-Identität:
//   _localMeta: { id, updated, created, synced?: ISOString, syncId?: uuid }
// Das Feld wird von 5etools-Loadern ignoriert (unknown property →
// fällt durch). Wir können also ungestraft eigene Metadaten anhängen.
//
// Browser-Fallback (Tauri nicht verfügbar → DevTools / Web-Build):
// localStorage unter `dndbuilder_homebrew_<kind>`. Selbe Struktur,
// funktioniert für Dev-Tests; in der gebauten Tauri-App geht der
// Filesystem-Pfad.

const KINDS = ['items', 'spells', 'backgrounds', 'races', 'creatures', 'features']

// 5etools Top-Level-Key pro Kind. Vorsicht: items uses 'item' (singular)
// als Top-Level-Array; das Gleiche bei spells, background, race,
// monster, classFeature. monster ist 5etools-Naming für Creature.
const ROOT_KEY = {
  items:       'item',
  spells:      'spell',
  backgrounds: 'background',
  races:       'race',
  creatures:   'monster',
  features:    'classFeature',
}

const STORAGE_PREFIX = 'dndbuilder_homebrew_'

// ── Tauri vs. Browser Detection ─────────────────────────────
function isTauri() {
  try { return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__ }
  catch { return false }
}

// Lazy-load Tauri-Module damit der Browser-Build nicht kracht.
async function tauriFs() {
  return await import('@tauri-apps/plugin-fs')
}

// ── Pfade ────────────────────────────────────────────────────
// Storage: User-Wunsch ist NEBEN DER EXE damit ein Sub-Folder
// `homebrew/` portabel mitwandert (USB-Stick / shared drive). Tauri-
// BaseDirectory.Resource zeigt im installierten Modus auf den
// Installations-Ordner (wo die .exe liegt), im Dev-Modus auf
// `src-tauri/resources/` — beides ist "next-to-exe-ish".
// Falls Resource im Resource-only-Modus read-only ist, fallen wir
// auf AppData zurück; das wird aber selten bei einer installierten
// Windows-Tauri-App passieren.
async function ensureHomebrewDir() {
  if (!isTauri()) return null
  const { BaseDirectory, exists, mkdir } = await tauriFs()
  try {
    const dirExists = await exists('homebrew', { baseDir: BaseDirectory.Resource })
    if (!dirExists) await mkdir('homebrew', { baseDir: BaseDirectory.Resource, recursive: true })
    return { baseDir: BaseDirectory.Resource, dir: 'homebrew' }
  } catch (e) {
    // Fallback wenn Resource nicht beschreibbar ist
    console.warn('[homebrew] Resource mkdir failed, fallback to AppData', e?.message || e)
    try {
      const dirExists = await exists('homebrew', { baseDir: BaseDirectory.AppData })
      if (!dirExists) await mkdir('homebrew', { baseDir: BaseDirectory.AppData, recursive: true })
    } catch (e2) { console.warn('[homebrew] AppData mkdir also failed', e2) }
    return { baseDir: BaseDirectory.AppData, dir: 'homebrew' }
  }
}

function pathFor(kind) {
  return `homebrew/${kind}.json`
}

// Welcher BaseDirectory wird gerade benutzt — cached für read/write.
let _baseDirPref = null
async function getBaseDir() {
  if (_baseDirPref) return _baseDirPref
  const info = await ensureHomebrewDir()
  _baseDirPref = info?.baseDir
  return _baseDirPref
}

// ── IDs + Timestamps ────────────────────────────────────────
function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `hb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}
function nowIso() { return new Date().toISOString() }

// ── Load / Save (per kind) ──────────────────────────────────
async function readKind(kind) {
  if (!KINDS.includes(kind)) throw new Error(`unknown homebrew kind: ${kind}`)
  if (isTauri()) {
    try {
      const baseDir = await getBaseDir()
      const { exists, readTextFile } = await tauriFs()
      const file = pathFor(kind)
      const hasFile = await exists(file, { baseDir })
      if (!hasFile) return { [ROOT_KEY[kind]]: [] }
      const raw = await readTextFile(file, { baseDir })
      const parsed = JSON.parse(raw)
      if (!parsed[ROOT_KEY[kind]]) parsed[ROOT_KEY[kind]] = []
      return parsed
    } catch (e) {
      console.warn('[homebrew] read failed for', kind, e)
      return { [ROOT_KEY[kind]]: [] }
    }
  }
  // Browser fallback
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + kind)
    if (!raw) return { [ROOT_KEY[kind]]: [] }
    const parsed = JSON.parse(raw)
    if (!parsed[ROOT_KEY[kind]]) parsed[ROOT_KEY[kind]] = []
    return parsed
  } catch {
    return { [ROOT_KEY[kind]]: [] }
  }
}

async function writeKind(kind, data) {
  if (!KINDS.includes(kind)) throw new Error(`unknown homebrew kind: ${kind}`)
  const payload = JSON.stringify(data, null, 2)
  if (isTauri()) {
    const baseDir = await getBaseDir()
    const { writeTextFile } = await tauriFs()
    await writeTextFile(pathFor(kind), payload, { baseDir })
    return
  }
  try { localStorage.setItem(STORAGE_PREFIX + kind, payload) }
  catch (e) { console.warn('[homebrew] write failed', e) }
}

// ── Public API ──────────────────────────────────────────────

export const HOMEBREW_KINDS = KINDS
export const HOMEBREW_ROOT_KEY = ROOT_KEY

/** Get all homebrew entries for a kind. Returns array. */
export async function listHomebrew(kind) {
  const data = await readKind(kind)
  return data[ROOT_KEY[kind]] || []
}

/** Get one entry by its `_localMeta.id`. */
export async function getHomebrew(kind, id) {
  const all = await listHomebrew(kind)
  return all.find(e => e?._localMeta?.id === id) || null
}

/** Save (create or update) an entry. Assigns id + timestamp. */
export async function saveHomebrew(kind, entry) {
  const data = await readKind(kind)
  const arr = data[ROOT_KEY[kind]] || []
  const meta = entry._localMeta || {}
  const id = meta.id || makeId()
  const now = nowIso()
  const next = {
    ...entry,
    _localMeta: {
      ...meta,
      id,
      updated: now,
      created: meta.created || now,
    },
  }
  const idx = arr.findIndex(e => e?._localMeta?.id === id)
  if (idx >= 0) arr[idx] = next
  else arr.push(next)
  data[ROOT_KEY[kind]] = arr
  await writeKind(kind, data)
  return next
}

/** Delete an entry by id. */
export async function deleteHomebrew(kind, id) {
  const data = await readKind(kind)
  const arr = data[ROOT_KEY[kind]] || []
  data[ROOT_KEY[kind]] = arr.filter(e => e?._localMeta?.id !== id)
  await writeKind(kind, data)
}

/** All entries across all kinds — for a global "your homebrew" view. */
export async function listAllHomebrew() {
  const out = {}
  for (const k of KINDS) out[k] = await listHomebrew(k)
  return out
}

// ── Catalog Integration ─────────────────────────────────────
// `applyHomebrewToData(kind, rawDataFromFetch)` mergt die lokalen
// Homebrew-Einträge in die 5etools-Roh-Daten BEVOR der Loader sie
// parst. Aufgerufen aus dataLoader.fetchData für `items.json`,
// `spells/sources.json`, etc.
export async function applyHomebrewToData(kind, rawData) {
  if (!rawData || typeof rawData !== 'object') return rawData
  const list = await listHomebrew(kind)
  if (!list.length) return rawData
  const root = ROOT_KEY[kind]
  const next = { ...rawData }
  next[root] = [...(rawData[root] || []), ...list]
  return next
}
