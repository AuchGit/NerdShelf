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

export async function pushOne(kind, entry) {
  const meta = entry?._localMeta || {}
  if (!meta.id) throw new Error('Eintrag hat keine lokale ID — bitte zuerst lokal speichern.')
  const payload = {
    id: meta.syncId || undefined,
    kind,
    name: entry.name || 'Unbenannt',
    source: entry.source || 'HB',
    data: entry,
    updated_at: meta.updated || new Date().toISOString(),
  }
  // upsert via UNIQUE (user_id, kind, local_id) — local_id im data._localMeta.id
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({
      ...payload,
      local_id: meta.id,
    }, { onConflict: 'user_id,kind,local_id' })
    .select()
    .single()
  if (error) throw error
  // Sync-Id zurück in den lokalen Eintrag schreiben.
  const updated = {
    ...entry,
    _localMeta: { ...meta, syncId: data.id, synced: new Date().toISOString() },
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
