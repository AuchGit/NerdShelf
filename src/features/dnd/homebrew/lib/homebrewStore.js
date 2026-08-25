// homebrewStore.js
//
// Online-First Homebrew Storage via Supabase. Jeder Save geht DIREKT
// in die Cloud — keine lokalen Files mehr. In-Memory-Cache pro Kind
// damit Loader (loadItemIndex / loadSpellList / …) nicht jeden Render
// eine Netzwerk-Roundtrip machen. Cache wird bei jedem Mutation-Call
// invalidiert.
//
// Browser-Fallback (kein Login = anonyme Browse-Sicht): kein Storage.
// Token-Sharing (siehe dnd-homebrew-tokens.sql):
//   • makeToken / shareViaToken — Token generieren + auf Eintrag setzen
//   • fetchByToken — Empfänger holt sich den Eintrag über den Token
//   • importByToken — fetch + lokal speichern

import { supabase } from '../../character-builder/lib/supabase'

const TABLE = 'dnd_homebrew'

// Hinweis: die kind-Spalte hat eine CHECK-Constraint in der DB. Neue Kinds
// brauchen die Migration scripts/dnd-homebrew-kinds.sql, sonst schlägt der
// Upsert mit einer Constraint-Verletzung fehl.
const KINDS = ['items', 'spells', 'spelllists', 'backgrounds', 'races', 'classes', 'creatures', 'features']

const ROOT_KEY = {
  items:       'item',
  spells:      'spell',
  spelllists:  'spellList',
  backgrounds: 'background',
  races:       'race',
  classes:     'class',
  creatures:   'monster',
  features:    'classFeature',
}

export const HOMEBREW_KINDS = KINDS
export const HOMEBREW_ROOT_KEY = ROOT_KEY

// ── In-memory Cache ─────────────────────────────────────────
const _cache = {}  // { [kind]: array }
function invalidate(kind) { delete _cache[kind] }
export function invalidateHomebrewCache(kind) {
  if (kind) invalidate(kind)
  else for (const k of KINDS) invalidate(k)
}

function rowToEntry(row) {
  // Row → User-facing entry. Daten-shape (data jsonb) bleibt 5etools-
  // konform; _localMeta wird aus den Server-Feldern frisch zusammen-
  // gebaut damit es nicht auseinanderläuft.
  if (!row) return null
  const base = (row.data && typeof row.data === 'object') ? row.data : {}
  return {
    ...base,
    _localMeta: {
      id: row.local_id,
      syncId: row.id,
      created: row.created_at,
      updated: row.updated_at,
      public: !!row.is_public,
      token: row.share_token || null,
    },
  }
}

function makeLocalId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `hb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

// ── Public CRUD ─────────────────────────────────────────────

/** Eingeloggter User? Nicht-eingeloggt → leere Liste statt Fehler. */
async function currentUser() {
  const { data } = await supabase.auth.getUser()
  return data?.user || null
}

/** Alle eigenen Einträge dieser Kategorie (RLS owner-policy). */
export async function listHomebrew(kind) {
  if (!KINDS.includes(kind)) throw new Error(`unknown homebrew kind: ${kind}`)
  if (_cache[kind]) return _cache[kind]
  const user = await currentUser()
  if (!user) { _cache[kind] = []; return [] }
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('kind', kind)
    .order('updated_at', { ascending: false })
  if (error) {
    console.warn('[homebrew] list failed', kind, error)
    return []
  }
  const list = (data || []).map(rowToEntry).filter(Boolean)
  _cache[kind] = list
  return list
}

/** Einen Eintrag per lokaler ID. */
export async function getHomebrew(kind, id) {
  const all = await listHomebrew(kind)
  return all.find(e => e?._localMeta?.id === id) || null
}

/** Erstellt oder updated einen Eintrag direkt in der Cloud.
 *  ID wird beim ersten Save vergeben. */
export async function saveHomebrew(kind, entry) {
  if (!KINDS.includes(kind)) throw new Error(`unknown homebrew kind: ${kind}`)
  const user = await currentUser()
  if (!user) throw new Error('Bitte einloggen — Homebrew wird direkt online gespeichert.')
  const meta = entry._localMeta || {}
  const localId = meta.id || makeLocalId()
  const now = new Date().toISOString()
  // Daten-Payload (5etools-shape + frisches _localMeta) in `data` jsonb.
  const dataPayload = {
    ...entry,
    _localMeta: {
      id: localId,
      created: meta.created || now,
      updated: now,
    },
  }
  const row = {
    kind,
    local_id: localId,
    name: entry.name || 'Unbenannt',
    source: entry.source || 'HB',
    data: dataPayload,
    updated_at: now,
    is_public: !!meta.public,
  }
  if (meta.syncId) row.id = meta.syncId
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'user_id,kind,local_id' })
    .select()
    .single()
  if (error) throw error
  invalidate(kind)
  return rowToEntry(data)
}

/** Löscht einen Eintrag. */
export async function deleteHomebrew(kind, id) {
  if (!KINDS.includes(kind)) throw new Error(`unknown homebrew kind: ${kind}`)
  const user = await currentUser()
  if (!user) throw new Error('Bitte einloggen.')
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('kind', kind)
    .eq('local_id', id)
  if (error) throw error
  invalidate(kind)
}

/** Toggle is_public flag — direkt am Server. */
export async function setHomebrewPublic(kind, id, isPublic) {
  const user = await currentUser()
  if (!user) throw new Error('Bitte einloggen.')
  const { data, error } = await supabase
    .from(TABLE)
    .update({ is_public: !!isPublic })
    .eq('kind', kind)
    .eq('local_id', id)
    .select()
    .single()
  if (error) throw error
  invalidate(kind)
  return rowToEntry(data)
}

// ── Token Sharing ───────────────────────────────────────────

/** Erzeugt (falls noch nicht vorhanden) einen Share-Token für den
 *  Eintrag. Returnt den Token-String. Idempotent — falls schon ein
 *  Token existiert, wird der bestehende zurückgegeben. */
export async function ensureShareToken(kind, id) {
  const user = await currentUser()
  if (!user) throw new Error('Bitte einloggen.')
  // Zuerst checken ob schon ein Token existiert.
  const { data: existing } = await supabase
    .from(TABLE)
    .select('share_token')
    .eq('kind', kind)
    .eq('local_id', id)
    .single()
  if (existing?.share_token) return existing.share_token
  // Neuen Token via RPC ziehen, dann auf den Eintrag schreiben.
  const { data: newTok, error: rpcErr } = await supabase.rpc('dnd_homebrew_make_token')
  if (rpcErr || !newTok) throw rpcErr || new Error('Token-Erzeugung fehlgeschlagen.')
  const { error: upErr } = await supabase
    .from(TABLE)
    .update({ share_token: newTok })
    .eq('kind', kind)
    .eq('local_id', id)
  if (upErr) throw upErr
  invalidate(kind)
  return newTok
}

/** Entfernt den Share-Token eines Eintrags (revoke). */
export async function revokeShareToken(kind, id) {
  const user = await currentUser()
  if (!user) throw new Error('Bitte einloggen.')
  const { error } = await supabase
    .from(TABLE)
    .update({ share_token: null })
    .eq('kind', kind)
    .eq('local_id', id)
  if (error) throw error
  invalidate(kind)
}

/** Holt einen fremden Eintrag per Token. Funktioniert via SECURITY-
 *  DEFINER RPC — der Empfänger muss eingeloggt sein, kennt aber nur
 *  den Token. Returnt {kind, data, author_name, ...} oder null. */
export async function fetchByToken(token) {
  if (!token || typeof token !== 'string') return null
  const { data, error } = await supabase
    .rpc('dnd_homebrew_fetch_by_token', { p_token: token.trim() })
  if (error) { console.warn('[homebrew] fetchByToken', error); return null }
  const row = Array.isArray(data) ? data[0] : data
  return row || null
}

/** Importiert einen fremden Eintrag per Token in die eigene Library
 *  (legt eine neue Kopie an, mit eigenem local_id + ohne share_token). */
export async function importByToken(token) {
  const row = await fetchByToken(token)
  if (!row) throw new Error('Token nicht gefunden oder ungültig.')
  const clone = JSON.parse(JSON.stringify(row.data || {}))
  clone._localMeta = {
    id: undefined,            // saveHomebrew vergibt neue ID
    importedFrom: row.id,
    importedFromAuthor: row.author_name || null,
    importedFromToken: token,
  }
  // Damit es nicht direkt wieder public ist, expliziert auf false.
  delete clone._localMeta.public
  return await saveHomebrew(row.kind, clone)
}

// ── Catalog-Integration für Loader ──────────────────────────
// Wird von dataLoader (loadItemIndex / loadSpellList / loadBackgroundList /
// loadRaceList) aufgerufen um Homebrew in die 5etools-Shape zu mergen
// BEVOR der Loader sie parsed.
export async function applyHomebrewToData(kind, rawData) {
  if (!rawData || typeof rawData !== 'object') return rawData
  const list = await listHomebrew(kind)
  if (!list.length) return rawData
  const root = ROOT_KEY[kind]
  const next = { ...rawData }
  next[root] = [...(rawData[root] || []), ...list]
  return next
}

/** Alle Kinds gleichzeitig — z.B. für Backup-Dialog. */
export async function listAllHomebrew() {
  const out = {}
  for (const k of KINDS) out[k] = await listHomebrew(k)
  return out
}
