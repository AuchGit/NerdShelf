// src/features/mtg/match-hud/services/matchApi.js
//
// Thin async wrappers around Supabase for the Match HUD. Centralising the
// queries here keeps the realtime hook small and makes the data contract
// easy to reason about — every shape returned to React lives in this file.
//
// All functions return either { data, error: null } or { data: null, error }
// so callers can branch with a single check.

import { supabase } from '../../../../core/supabase/client';
import { newJoinCode, normaliseCode } from './matchCodes';

const MAX_CREATE_RETRIES = 5;

/** Create a new match. Retries on the unique-violation race so we never
 *  bubble up a UX failure caused by an unlucky 1-in-a-billion collision. */
export async function createMatch({ userId, startingLife = 20 }) {
  if (!userId) return { data: null, error: new Error('Not signed in') };
  for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
    const join_code = newJoinCode();
    const { data, error } = await supabase
      .from('mtg_matches')
      .insert({
        created_by: userId,
        join_code,
        starting_life: startingLife,
        status: 'lobby',
      })
      .select()
      .single();
    if (!error) return { data, error: null };
    // Code 23505 is the postgres unique-violation. Retry once with a fresh
    // join code; anything else is propagated.
    if (error.code !== '23505') return { data: null, error };
  }
  return { data: null, error: new Error('Konnte keinen freien Join-Code erzeugen') };
}

/** Look up a match by its short join code. Returns null (not an error) when
 *  the code is valid but no match exists — the join UI distinguishes between
 *  "not found" and "lookup failed". */
export async function findMatchByCode(rawCode) {
  const code = normaliseCode(rawCode);
  if (!code) return { data: null, error: null };
  const { data, error } = await supabase
    .from('mtg_matches')
    .select('*')
    .eq('join_code', code)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data, error: null };
}

/** Load a match by primary key. Used by the live HUD page on first mount. */
export async function fetchMatch(matchId) {
  if (!matchId) return { data: null, error: null };
  const { data, error } = await supabase
    .from('mtg_matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  return { data, error };
}

/** Load the full player list for a match. Used on first mount before the
 *  realtime channel takes over. */
export async function fetchMatchPlayers(matchId) {
  if (!matchId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('mtg_match_players')
    .select('*')
    .eq('match_id', matchId)
    .order('joined_at', { ascending: true });
  return { data: data || [], error };
}

/** Insert (or upsert) the current user's seat in a match. Idempotent: if the
 *  user reloads the page, we reuse their existing row instead of creating a
 *  duplicate — see the (match_id, user_id) UNIQUE constraint. */
export async function joinMatch({
  matchId, userId, playerName, deckId, deckName, color, startingLife,
}) {
  if (!matchId || !userId) return { data: null, error: new Error('Match oder Nutzer fehlt') };
  const payload = {
    match_id: matchId,
    user_id: userId,
    player_name: playerName || '',
    deck_id: deckId || null,
    deck_name: deckName || '',
    color: color || 'red',
    life: startingLife ?? 20,
    poison: 0,
  };
  const { data, error } = await supabase
    .from('mtg_match_players')
    .upsert(payload, { onConflict: 'match_id,user_id' })
    .select()
    .single();
  return { data, error };
}

/** Patch the current user's row. RLS enforces "self only". Returns the
 *  updated row so optimistic UI can reconcile with the server. */
export async function updatePlayer({ playerId, userId, patch }) {
  if (!playerId || !userId) return { data: null, error: new Error('Spieler fehlt') };
  const { data, error } = await supabase
    .from('mtg_match_players')
    .update(patch)
    .eq('id', playerId)
    .eq('user_id', userId)
    .select()
    .single();
  return { data, error };
}

/** Remove the current player from a match (leave). */
export async function leaveMatch({ playerId, userId }) {
  if (!playerId || !userId) return { error: new Error('Spieler fehlt') };
  const { error } = await supabase
    .from('mtg_match_players')
    .delete()
    .eq('id', playerId)
    .eq('user_id', userId);
  return { error };
}

/** Patch match-level fields (creator only — RLS enforces this). */
export async function updateMatch({ matchId, patch }) {
  if (!matchId) return { error: new Error('Match fehlt') };
  const { data, error } = await supabase
    .from('mtg_matches')
    .update(patch)
    .eq('id', matchId)
    .select()
    .single();
  return { data, error };
}

/** Delete a match. Creator only via RLS. Cascade removes player rows. */
export async function deleteMatch({ matchId }) {
  if (!matchId) return { error: new Error('Match fehlt') };
  const { error } = await supabase
    .from('mtg_matches')
    .delete()
    .eq('id', matchId);
  return { error };
}

/** List the matches the current user is involved in (created or joined). The
 *  dashboard uses this to surface "rejoin" links after a refresh. */
export async function listUserMatches({ userId }) {
  if (!userId) return { data: [], error: null };
  // Pull joined-as-player matches first, then merge with created matches.
  // Two cheap queries beat a SQL OR across two unrelated columns.
  const [createdRes, joinedRes] = await Promise.all([
    supabase.from('mtg_matches').select('*').eq('created_by', userId),
    supabase.from('mtg_match_players').select('match_id, mtg_matches(*)').eq('user_id', userId),
  ]);
  if (createdRes.error) return { data: [], error: createdRes.error };
  if (joinedRes.error) return { data: [], error: joinedRes.error };
  const map = new Map();
  for (const m of createdRes.data || []) map.set(m.id, m);
  for (const row of joinedRes.data || []) {
    const m = row.mtg_matches;
    if (m && !map.has(m.id)) map.set(m.id, m);
  }
  const all = [...map.values()].sort((a, b) =>
    (b.updated_at || '').localeCompare(a.updated_at || '')
  );
  return { data: all, error: null };
}
