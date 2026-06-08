// homebrewSync.js
//
// Optionale Cloud-Sync via Supabase. Table: dnd_homebrew
//   id uuid PK, user_id uuid FK, kind text, name text, source text,
//   data jsonb (komplett 5etools-shape inkl. _localMeta),
//   created_at timestamptz, updated_at timestamptz
//
// RLS: nur owner kann select/insert/update/delete (siehe SQL-Script
// scripts/dnd-homebrew-schema.sql).
//
// Sync-Model: push (lokaler Stand → Cloud) und pull (Cloud → lokal).
// Konflikt-Resolution: updated_at-Vergleich; neuer gewinnt.
// User-Triggered via Sync-Button pro Eintrag.

import { supabase } from '../../character-builder/lib/supabase'
import { saveHomebrew, deleteHomebrew, listHomebrew } from './homebrewStore'

const TABLE = 'dnd_homebrew'

/**
 * Push a single entry to the cloud.
 * @param {string} kind
 * @param {object} entry  Local homebrew entry (with _localMeta)
 * @param {object} opts
 * @param {boolean} [opts.isPublic=false] When true, other users can SELECT
 *   this entry via the public RLS policy. Default false = private/owner-only.
 */
export async function pushOne(kind, entry, opts = {}) {
  const meta = entry?._localMeta || {}
  if (!meta.id) throw new Error('Eintrag hat keine lokale ID — bitte zuerst lokal speichern.')
  const isPublic = !!opts.isPublic || !!meta.public
  const payload = {
    id: meta.syncId || undefined,
    kind,
    name: entry.name || 'Unbenannt',
    source: entry.source || 'HB',
    data: entry,
    updated_at: meta.updated || new Date().toISOString(),
    is_public: isPublic,
  }
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ ...payload, local_id: meta.id }, { onConflict: 'user_id,kind,local_id' })
    .select()
    .single()
  if (error) throw error
  const updated = {
    ...entry,
    _localMeta: {
      ...meta,
      syncId: data.id,
      synced: new Date().toISOString(),
      public: isPublic,
    },
  }
  await saveHomebrew(kind, updated)
  return updated
}

export async function pullAll(kind) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('kind', kind)
  if (error) throw error
  let imported = 0
  for (const row of (data || [])) {
    const entry = row.data || {}
    // SyncId/Timestamps verlinken
    const localMeta = {
      ...(entry._localMeta || {}),
      id: entry._localMeta?.id || row.local_id,
      syncId: row.id,
      synced: new Date().toISOString(),
      updated: row.updated_at,
    }
    await saveHomebrew(kind, { ...entry, _localMeta: localMeta })
    imported++
  }
  return imported
}

export async function deleteFromCloud(kind, syncId) {
  if (!syncId) return
  const { error } = await supabase.from(TABLE).delete().eq('id', syncId)
  if (error) throw error
}

export async function pushAll(kind) {
  const list = await listHomebrew(kind)
  let count = 0
  for (const entry of list) {
    try { await pushOne(kind, entry); count++ }
    catch (e) { console.warn('[homebrewSync] push failed', entry.name, e?.message || e) }
  }
  return count
}

/** Browse public homebrew shared by ALL users. RLS allows
 *  is_public=true reads to any authenticated user. */
export async function listPublic(kind, opts = {}) {
  const limit = opts.limit || 200
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, kind, name, source, data, user_id, updated_at, is_public')
    .eq('kind', kind)
    .eq('is_public', true)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  // Join optional: player_name from profiles
  const userIds = [...new Set((data || []).map(d => d.user_id).filter(Boolean))]
  let nameByUid = {}
  if (userIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles').select('id, player_name').in('id', userIds)
    if (profs) for (const p of profs) nameByUid[p.id] = p.player_name || null
  }
  return (data || []).map(row => ({
    ...row,
    author: nameByUid[row.user_id] || null,
  }))
}

/** Import a public entry into the local library. Strips the original
 *  syncId so it's treated as a NEW entry owned by the current user. */
export async function importPublic(kind, publicRow) {
  if (!publicRow?.data) throw new Error('Eintrag hat keine Daten.')
  const clone = JSON.parse(JSON.stringify(publicRow.data))
  // Fresh _localMeta — neue ID, kein syncId (das wäre der Cloud-Eintrag
  // des Original-Authors). Der Spieler kann den Import dann selber
  // wieder pushen — landet als sein eigener Cloud-Eintrag.
  clone._localMeta = {
    id: undefined,                                  // saveHomebrew vergibt neue ID
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    importedFrom: publicRow.id,
    importedFromAuthor: publicRow.author || null,
  }
  return await saveHomebrew(kind, clone)
}
