// src/features/dnd/character-builder/lib/campaigns.js
// Supabase helpers for the D&D Campaigns feature.

import { supabase } from './supabase'

// Crockford-ish alphabet — no ambiguous characters (no 0/O, 1/I, etc.).
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A short, human-typeable campaign join code, e.g. "K7QM2F". */
export function makeJoinToken(len = 6) {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)]
  }
  return s
}

/**
 * Build the denormalized "card" snapshot stored on a campaign membership.
 * Players see each other through this snapshot — never the full character
 * `data` — so no character data leaks between players.
 */
export function buildCharacterCard(row) {
  const d = row?.data || {}
  const classes = (d.classes || []).map(c => ({ classId: c.classId, level: c.level || 1 }))
  const raceName = d.species?.raceId?.split('__')[0] || ''
  const subraceName = d.species?.subraceId?.split('__')[0] || ''
  return {
    name:       row?.name || d.info?.name || 'Unbenannt',
    portrait:   d.appearance?.portrait || null,
    edition:    d.meta?.edition || '5e',
    race:       subraceName ? `${subraceName} (${raceName})` : raceName,
    background: d.background?.backgroundId?.split('__')[0] || '',
    alignment:  d.info?.alignment || '',
    classes,
    totalLevel: classes.reduce((s, c) => s + (c.level || 0), 0),
  }
}

export function classLine(card) {
  const cs = card?.classes || []
  if (!cs.length) return '—'
  const line = cs.map(c => `${c.classId} ${c.level}`).join(' / ')
  return cs.length > 1 ? `${line} · L${card.totalLevel}` : line
}

// ── Campaigns ───────────────────────────────────────────────

/** Every campaign the current user runs or plays in (RLS filters to mine). */
export async function listMyCampaigns() {
  const { data, error } = await supabase
    .from('dnd_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getCampaign(id) {
  const { data, error } = await supabase
    .from('dnd_campaigns').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createCampaign({ gmId, name, description, image }) {
  // Retry on the (astronomically unlikely) token collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const join_token = makeJoinToken()
    const { data, error } = await supabase
      .from('dnd_campaigns')
      .insert({ gm_id: gmId, name, description: description || '', image: image || null, join_token })
      .select()
      .single()
    if (!error) return data
    if (error.code !== '23505') throw error   // 23505 = unique violation
  }
  throw new Error('Konnte keinen freien Join-Code erzeugen.')
}

export async function updateCampaign(id, patch) {
  const { error } = await supabase.from('dnd_campaigns').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteCampaign(id) {
  const { error } = await supabase.from('dnd_campaigns').delete().eq('id', id)
  if (error) throw error
}

/** GM-only: flip the live-session flag on the campaign. RLS only lets
 *  the GM update (existing dnd_campaigns_update policy). */
export async function setSessionActive(campaignId, active) {
  const { error } = await supabase
    .from('dnd_campaigns')
    .update({ session_active: !!active })
    .eq('id', campaignId)
  if (error) throw error
}

/** All membership rows belonging to the current user, across every
 *  campaign they're in. Used by the campaigns dashboard to render the
 *  "Session beitreten" entry-point for active sessions. */
export async function listMyMemberships(userId) {
  const { data, error } = await supabase
    .from('dnd_campaign_members')
    .select('id, campaign_id, character_id, player_name, card')
    .eq('user_id', userId)
  if (error) throw error
  return data || []
}

// ── Members ─────────────────────────────────────────────────

/** All members of a campaign (RLS: visible to GM + fellow members). */
export async function listMembers(campaignId) {
  const { data, error } = await supabase
    .from('dnd_campaign_members')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data || []
}

/** Member counts for a set of campaigns, keyed by campaign id. */
export async function memberCounts(campaignIds) {
  if (!campaignIds.length) return {}
  const { data, error } = await supabase
    .from('dnd_campaign_members')
    .select('campaign_id')
    .in('campaign_id', campaignIds)
  if (error) throw error
  const counts = {}
  for (const r of (data || [])) counts[r.campaign_id] = (counts[r.campaign_id] || 0) + 1
  return counts
}

/** Join a campaign by token with a chosen character (via the SECURITY DEFINER RPC). */
export async function joinCampaign({ token, characterRow, playerName }) {
  const card = buildCharacterCard(characterRow)
  const { data, error } = await supabase.rpc('dnd_join_campaign', {
    p_token: token.trim(),
    p_character_id: characterRow.id,
    p_player_name: playerName || '',
    p_card: card,
  })
  if (error) {
    if (/CAMPAIGN_NOT_FOUND/.test(error.message)) throw new Error('Keine Campaign mit diesem Token gefunden.')
    if (/CHARACTER_NOT_OWNED/.test(error.message)) throw new Error('Dieser Charakter gehört dir nicht.')
    throw error
  }
  return data   // campaign id
}

/** Refresh the current user's own card snapshot for a membership. */
export async function refreshMemberCard(memberId, characterRow, playerName) {
  const card = buildCharacterCard(characterRow)
  const { error } = await supabase
    .from('dnd_campaign_members')
    .update({ card, player_name: playerName || '' })
    .eq('id', memberId)
  if (error) throw error
}

export async function removeMember(memberId) {
  const { error } = await supabase.from('dnd_campaign_members').delete().eq('id', memberId)
  if (error) throw error
}

/** GM-only per-member notes for the session overview. RLS (dnd-session-schema.sql)
 *  lets the GM both read (via dnd_members_select) and update. */
export async function updateMemberGmNotes(memberId, gmNotes) {
  const { error } = await supabase
    .from('dnd_campaign_members')
    .update({ gm_notes: gmNotes ?? '' })
    .eq('id', memberId)
  if (error) throw error
}

/**
 * Shared write path for combat state (HP, temporary HP, conditions,
 * death saves) keyed by character id. Routes through the dnd_patch_combat_state
 * RPC so the same call works for the character owner OR the GM of any
 * campaign the character belongs to. Patch may carry any subset of the
 * whitelisted keys; unknown keys are dropped server-side.
 *
 * Returns the new `data.status` object.
 */
export async function patchCombatState(characterId, patch) {
  const { data, error } = await supabase.rpc('dnd_patch_combat_state', {
    p_char_id: characterId,
    p_patch:   patch || {},
  })
  if (error) {
    if (/NOT_AUTHORIZED/.test(error.message)) throw new Error('Keine Rechte für diesen Charakter.')
    if (/NOT_AUTHENTICATED/.test(error.message)) throw new Error('Nicht eingeloggt.')
    if (/CHARACTER_NOT_FOUND/.test(error.message)) throw new Error('Charakter nicht gefunden.')
    throw error
  }
  return data
}

// ── Events ──────────────────────────────────────────────────

// Notify the calendar-notification hook (and anything else interested)
// that dnd_events rows just changed so the badge updates without waiting
// for the next poll. Picked up by useCalendarNotification.
function notifyEventsChanged() {
  try { window.dispatchEvent(new Event('dnd-events-changed')) }
  catch { /* non-browser — ignore */ }
}

/** Events for one campaign, soonest first. */
export async function listCampaignEvents(campaignId) {
  const { data, error } = await supabase
    .from('dnd_events')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('starts_at', { ascending: true })
  if (error) throw error
  return data || []
}

/** Every event the user is invited to (RLS: campaigns they GM or play in). */
export async function listMyEvents() {
  const { data, error } = await supabase
    .from('dnd_events')
    .select('*, campaign:dnd_campaigns(name)')
    .order('starts_at', { ascending: true })
  if (error) throw error
  return data || []
}

/** Next upcoming event per campaign, keyed by campaign id. */
export async function nextEventByCampaign(campaignIds) {
  if (!campaignIds.length) return {}
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('dnd_events')
    .select('campaign_id, starts_at, title')
    .in('campaign_id', campaignIds)
    .gte('starts_at', nowIso)
    .order('starts_at', { ascending: true })
  if (error) throw error
  const next = {}
  for (const e of (data || [])) {
    if (!next[e.campaign_id]) next[e.campaign_id] = e
  }
  return next
}

export async function createEvent({ campaignId, title, description, location, startsAt, createdBy }) {
  const { error } = await supabase.from('dnd_events').insert({
    campaign_id: campaignId,
    title,
    description: description || '',
    location: location || '',
    starts_at: startsAt,
    created_by: createdBy,
  })
  if (error) throw error
  notifyEventsChanged()
}

export async function updateEvent(id, patch) {
  const { error } = await supabase.from('dnd_events').update(patch).eq('id', id)
  if (error) throw error
  notifyEventsChanged()
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('dnd_events').delete().eq('id', id)
  if (error) throw error
  notifyEventsChanged()
}

// ── Date helpers ────────────────────────────────────────────

/** Whole days from now until `dateIso` (negative if in the past). */
export function daysUntil(dateIso) {
  if (!dateIso) return null
  const ms = new Date(dateIso).getTime() - Date.now()
  return Math.ceil(ms / 86400000)
}

export function formatDateTime(dateIso) {
  if (!dateIso) return '—'
  return new Date(dateIso).toLocaleString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatDate(dateIso) {
  if (!dateIso) return '—'
  return new Date(dateIso).toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

/** Human countdown label, e.g. "in 3 Tagen", "heute", "morgen". */
export function countdownLabel(dateIso) {
  const d = daysUntil(dateIso)
  if (d == null) return ''
  if (d < 0) return 'vorbei'
  if (d === 0) return 'heute'
  if (d === 1) return 'morgen'
  return `in ${d} Tagen`
}
