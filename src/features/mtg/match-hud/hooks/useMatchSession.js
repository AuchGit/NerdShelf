// src/features/mtg/match-hud/hooks/useMatchSession.js
//
// Hook owning a single live Match HUD session. Responsibilities:
//
//   1. Initial load of the match row + all player rows from Supabase.
//   2. Realtime subscription (Postgres Changes) on both tables, keeping the
//      local state in sync without polling. INSERT / UPDATE / DELETE events
//      each merge into the players array.
//   3. A small mutator API (updateLife / updatePoison / setColor / leave …)
//      that performs *optimistic* local updates first, then issues the
//      Supabase write. If the write fails the optimistic patch is reverted —
//      keeps the HUD feeling instant even on slow phone connections.
//   4. Lightweight presence channel that tracks online/offline state per
//      player, surfaced as `presence[user_id] === true` when they're live.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import {
  fetchMatch, fetchMatchPlayers, updatePlayer, leaveMatch, updateMatch,
} from '../services/matchApi';

const SUB_DEBUG = false;
const log = (...args) => { if (SUB_DEBUG) console.log('[match-hud]', ...args); };

/**
 * @param {string|null} matchId
 * @param {string|null} userId
 */
export default function useMatchSession(matchId, userId) {
  const [match, setMatch] = useState(null);
  const [players, setPlayers] = useState([]);
  const [presence, setPresence] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Track the in-flight optimistic updates so we can ignore a realtime echo
  // of our own write — otherwise rapid +1/-1 taps flicker.
  const pendingRef = useRef(new Map());

  // ── Initial fetch ────────────────────────────────────
  useEffect(() => {
    if (!matchId) {
      setMatch(null); setPlayers([]); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const [mRes, pRes] = await Promise.all([
        fetchMatch(matchId),
        fetchMatchPlayers(matchId),
      ]);
      if (cancelled) return;
      if (mRes.error) { setError(mRes.error.message); setLoading(false); return; }
      if (!mRes.data)  { setError('Match nicht gefunden'); setLoading(false); return; }
      setMatch(mRes.data);
      setPlayers(pRes.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  // ── Realtime subscriptions ───────────────────────────
  useEffect(() => {
    if (!matchId) return;
    const channel = supabase.channel(`mtg-match:${matchId}`, {
      config: { presence: { key: userId || 'anon' } },
    });

    // Match-level changes (status, starting_life, …)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mtg_matches', filter: `id=eq.${matchId}` },
      (payload) => {
        log('match change', payload);
        if (payload.eventType === 'DELETE') {
          setMatch(null);
        } else if (payload.new) {
          setMatch(payload.new);
        }
      }
    );

    // Player-level changes (life, poison, color, joins, leaves)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mtg_match_players', filter: `match_id=eq.${matchId}` },
      (payload) => {
        log('player change', payload);
        setPlayers(prev => mergePlayer(prev, payload, pendingRef.current));
      }
    );

    // Presence: each tab that opens the channel calls track() with its
    // user_id. The peers can see who's still online from the presence state.
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const next = {};
      for (const entries of Object.values(state)) {
        for (const e of entries) {
          if (e?.user_id) next[e.user_id] = true;
        }
      }
      setPresence(next);
    });

    channel.subscribe(async (status) => {
      log('channel status', status);
      if (status === 'SUBSCRIBED' && userId) {
        await channel.track({ user_id: userId, online_at: new Date().toISOString() });
      }
    });

    return () => {
      log('unsubscribing', matchId);
      supabase.removeChannel(channel);
    };
  }, [matchId, userId]);

  // ── Derived selectors ────────────────────────────────
  const me = useMemo(
    () => players.find(p => p.user_id === userId) || null,
    [players, userId]
  );
  const others = useMemo(
    () => players.filter(p => p.user_id !== userId),
    [players, userId]
  );

  // ── Mutators (optimistic) ────────────────────────────
  // Internal helper: apply a *derived* patch using a functional state update
  // so rapid taps always read the freshest local value. The supplied
  // `derive(current)` returns the partial patch (or null to no-op). We tag
  // the pending write so the realtime echo from our own change can be
  // ignored — otherwise the optimistic state briefly flickers back to the
  // server's older value during a series of rapid taps.
  const mutateSelf = useCallback((derive) => {
    if (!userId) return;
    let playerId = null;
    let before = null;
    let patch = null;
    setPlayers(prev => {
      const idx = prev.findIndex(p => p.user_id === userId);
      if (idx === -1) return prev;
      before = prev[idx];
      playerId = before.id;
      patch = derive(before);
      if (!patch) return prev;
      const merged = { ...before, ...patch };
      pendingRef.current.set(playerId, { ...patch, _ts: Date.now() });
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
    if (!playerId || !patch) return;
    updatePlayer({ playerId, userId, patch }).then(({ error: err }) => {
      pendingRef.current.delete(playerId);
      if (err) {
        setPlayers(prev => prev.map(p => p.id === playerId ? before : p));
        setError(err.message);
      }
    });
  }, [userId]);

  const adjustLife = useCallback((delta) => {
    mutateSelf(cur => ({ life: cur.life + delta }));
  }, [mutateSelf]);

  const adjustPoison = useCallback((delta) => {
    mutateSelf(cur => ({ poison: Math.max(0, cur.poison + delta) }));
  }, [mutateSelf]);

  const setLife = useCallback((value) => {
    mutateSelf(() => ({ life: Number(value) || 0 }));
  }, [mutateSelf]);

  const setPoison = useCallback((value) => {
    mutateSelf(() => ({ poison: Math.max(0, Number(value) || 0) }));
  }, [mutateSelf]);

  const setColor = useCallback((color) => {
    mutateSelf(() => ({ color }));
  }, [mutateSelf]);

  const setPlayerName = useCallback((name) => {
    mutateSelf(() => ({ player_name: name || '' }));
  }, [mutateSelf]);

  const setDeck = useCallback(({ deckId, deckName }) => {
    mutateSelf(() => ({ deck_id: deckId || null, deck_name: deckName || '' }));
  }, [mutateSelf]);

  const leave = useCallback(async () => {
    if (!me || !userId) return { error: null };
    return leaveMatch({ playerId: me.id, userId });
  }, [me, userId]);

  // Creator-only operations. Caller is expected to guard these via the UI
  // (we check ownership too — defence in depth alongside RLS).
  const isCreator = match && userId && match.created_by === userId;
  const updateMatchPatch = useCallback(async (patch) => {
    if (!isCreator) return { error: new Error('Nur Ersteller darf Match ändern') };
    return updateMatch({ matchId: match.id, patch });
  }, [match, isCreator]);

  return {
    match, players, me, others, presence, loading, error,
    isCreator,
    adjustLife, adjustPoison, setLife, setPoison, setColor,
    setPlayerName, setDeck, leave,
    updateMatchPatch,
  };
}

/** Merge a postgres_changes payload into the player array. */
function mergePlayer(prev, payload, pendingMap) {
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    return prev.filter(p => p.id !== id);
  }
  const row = payload.new;
  if (!row) return prev;
  const pending = pendingMap.get(row.id);
  // If we have an outstanding optimistic write, prefer our local state for
  // the keys we just wrote — the server echo will catch up momentarily.
  const merged = { ...row };
  if (pending) {
    for (const k of Object.keys(pending)) {
      if (k === '_ts') continue;
      // Keep the local optimistic value; the upcoming update result will
      // reconcile the rest.
      const local = prev.find(p => p.id === row.id);
      if (local && k in local) merged[k] = local[k];
    }
  }
  const idx = prev.findIndex(p => p.id === row.id);
  if (idx === -1) return [...prev, merged];
  const next = prev.slice();
  next[idx] = merged;
  return next;
}
