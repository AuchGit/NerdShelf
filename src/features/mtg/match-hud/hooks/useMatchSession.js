// src/features/mtg/match-hud/hooks/useMatchSession.js
//
// Hook owning a single live Match HUD session. Realtime sync runs on three
// complementary layers, in this priority order:
//
//   1. Local optimistic state — every mutation patches the in-memory players
//      array first. Zero latency on the screen that's tapping.
//   2. Broadcast over the realtime channel — a single WebSocket frame to all
//      connected peers. Typically <100 ms; carries just the field patch.
//   3. Durable DB write + postgres_changes — the WAL-derived echo from the
//      DB. Slower (200-600 ms), occasionally out of order on rapid bursts,
//      but the only thing fresh joiners see when they first connect.
//
// Two subtle race conditions plagued an earlier version of this hook and
// were causing exactly the symptoms the user reported (HP "jumping back"
// after a poison tap, peer counters not updating consistently):
//
//   • Postgres-changes events arrive out-of-order during rapid taps. If you
//     +1 HP and then +1 poison, the WAL echo of the HP update — which still
//     carries the older poison value — could arrive AFTER the poison
//     broadcast and overwrite the freshly-incremented poison back to 0.
//
//   • For the tapping screen specifically, *our own* postgres-changes echo
//     is never useful — we already have the freshest value locally and the
//     DB ACK confirms it landed. Applying that echo can only ever revert
//     state to an older snapshot.
//
// The fixes are:
//
//   • Per-field "freshness" timestamps (`freshRef`). When any UPDATE-style
//     event happens for a (player, field) — local mutation, broadcast
//     received, manual reconcile — we stamp the moment. When a slower
//     postgres-changes echo arrives, fields with a recent stamp are left
//     alone; only the stale fields are accepted from the WAL row.
//
//   • Outright skip postgres-changes UPDATE events for the current user's
//     own row. Local state + DB ACK is authoritative there. INSERT (joining
//     in another tab) and DELETE (being kicked / leaving from another tab)
//     are still applied.
//
//   • Initial fetch is sequenced *before* the channel subscription opens,
//     so the very first frames of channel traffic can never out-race the
//     baseline snapshot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import {
  fetchMatch, fetchMatchPlayers, updatePlayer, leaveMatch, updateMatch,
} from '../services/matchApi';

const SUB_DEBUG = false;
const log = (...args) => { if (SUB_DEBUG) console.log('[match-hud]', ...args); };

const BROADCAST_PATCH = 'player_patch';

// How long after a local mutation / inbound broadcast a field is considered
// "fresh" — postgres-changes echoes for that field are suppressed during
// this window. Long enough to outlast the WAL replication delay (typically
// 200-600 ms; can spike to ~1.5 s under load); short enough that legitimate
// late-arriving real updates aren't held back.
const FRESH_WINDOW_MS = 3000;

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

  // Holds a stable reference to the channel so mutators can broadcast
  // without waiting for the subscription effect to re-run.
  const channelRef = useRef(null);
  // True once the channel has reached SUBSCRIBED. Broadcasts before this
  // would be dropped, so we gate on it.
  const channelReadyRef = useRef(false);
  // Per-field freshness map. Keyed by `${playerId}:${field}`, value is the
  // monotonic local timestamp the field was last touched on this client.
  const freshRef = useRef(new Map());

  const markFresh = useCallback((playerId, patch) => {
    if (!playerId || !patch) return;
    const ts = Date.now();
    for (const k of Object.keys(patch)) {
      if (k === '_ts' || k === 'id' || k === 'updated_at') continue;
      freshRef.current.set(`${playerId}:${k}`, ts);
    }
  }, []);

  // ── Realtime sync (sequenced after initial fetch) ─────────
  // One effect handles both: load the snapshot, then open the channel.
  // Splitting these into two effects would leave a window where channel
  // events arrive before the snapshot lands and could be applied to an
  // empty players array. Combining them eliminates that race.
  useEffect(() => {
    if (!matchId) {
      setMatch(null); setPlayers([]); setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let channel = null;
    setLoading(true);
    setError(null);
    freshRef.current = new Map();

    (async () => {
      // 1. Initial snapshot.
      const [mRes, pRes] = await Promise.all([
        fetchMatch(matchId),
        fetchMatchPlayers(matchId),
      ]);
      if (cancelled) return;
      if (mRes.error)   { setError(mRes.error.message); setLoading(false); return; }
      if (!mRes.data)   { setError('Match nicht gefunden'); setLoading(false); return; }
      setMatch(mRes.data);
      setPlayers(pRes.data || []);
      setLoading(false);

      // 2. Channel subscription. The snapshot is now in state, so any
      //    realtime event we receive can be merged correctly.
      channel = supabase.channel(`mtg-match:${matchId}`, {
        config: {
          presence: { key: userId || 'anon' },
          // self:false → our own broadcasts don't echo back. We already
          // applied them locally via the optimistic update.
          broadcast: { self: false, ack: false },
        },
      });
      channelRef.current = channel;

      // Match-level changes (status, starting_life, …).
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

      // Player-row changes via WAL (the durability backstop).
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mtg_match_players', filter: `match_id=eq.${matchId}` },
        (payload) => {
          log('player change (pg)', payload);
          const row = payload.new;

          if (payload.eventType === 'DELETE') {
            const id = payload.old?.id;
            if (id) setPlayers(prev => prev.filter(p => p.id !== id));
            return;
          }

          if (!row) return;

          // Skip UPDATE echoes for our OWN row. The local optimistic state
          // is already correct; the DB ACK confirmed it landed; the only
          // thing applying this echo could do is roll us back to a stale
          // snapshot (this was the source of the "HP jumps after poison
          // tap" bug).
          if (payload.eventType === 'UPDATE' && row.user_id === userId) {
            return;
          }

          setPlayers(prev => mergePeerRow(prev, row, freshRef.current));
        }
      );

      // Player-row changes via broadcast (the instant peer path). Carries
      // only the changed fields, so we merge instead of replace.
      channel.on('broadcast', { event: BROADCAST_PATCH }, ({ payload }) => {
        log('player change (bcast)', payload);
        if (!payload?.id || !payload?.patch) return;
        // Mark all patched fields fresh so any laggy WAL echo for the same
        // values can't undo them.
        markFresh(payload.id, payload.patch);
        setPlayers(prev => {
          const idx = prev.findIndex(p => p.id === payload.id);
          if (idx === -1) return prev;
          const next = prev.slice();
          next[idx] = { ...prev[idx], ...payload.patch };
          return next;
        });
      });

      // Presence: each tab tracks itself; peers see who's online.
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
        if (status === 'SUBSCRIBED') {
          channelReadyRef.current = true;
          // Re-track on every SUBSCRIBED — including reconnects after a
          // phone suspends/resumes the WebSocket — so presence stays live.
          if (userId) {
            await channel.track({ user_id: userId, online_at: new Date().toISOString() });
          }
        } else {
          channelReadyRef.current = false;
        }
      });
    })();

    return () => {
      cancelled = true;
      channelReadyRef.current = false;
      channelRef.current = null;
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, userId, markFresh]);

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
  // `derive(current)` returns the partial patch from the freshest local
  // state so rapid back-to-back taps always read the up-to-date value.
  // Returning null is a no-op.
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
      if (!patch || Object.keys(patch).length === 0) return prev;
      const merged = { ...before, ...patch };
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
    if (!playerId || !patch) return;

    // Mark fresh BEFORE broadcasting / writing — guards against the WAL
    // echo of an earlier mutation arriving after we've already moved on.
    markFresh(playerId, patch);

    // Instant peer sync. Fire-and-forget; the DB write below is the
    // durable record. Only attempt while the channel is actually ready;
    // a send() before SUBSCRIBED would be silently dropped.
    const ch = channelRef.current;
    if (ch && channelReadyRef.current) {
      ch.send({
        type: 'broadcast',
        event: BROADCAST_PATCH,
        payload: { id: playerId, patch },
      }).catch(() => { /* DB write is the source of truth */ });
    }

    // Durable DB write.
    updatePlayer({ playerId, userId, patch }).then(({ error: err }) => {
      if (!err) return;
      // Roll back JUST the fields we attempted to write, on the freshest
      // local row — rolling the whole row back to `before` would clobber
      // any later optimistic updates that succeeded in the meantime.
      setPlayers(prev => prev.map(p => {
        if (p.id !== playerId) return p;
        const reverted = { ...p };
        for (const k of Object.keys(patch)) {
          if (before && k in before) reverted[k] = before[k];
        }
        return reverted;
      }));
      setError(err.message);
      // Tell peers to revert too — and re-mark the fields fresh so the
      // revert isn't itself overwritten by an in-flight echo.
      if (ch && before && channelReadyRef.current) {
        const revert = Object.fromEntries(
          Object.keys(patch).map(k => [k, before[k]])
        );
        markFresh(playerId, revert);
        ch.send({
          type: 'broadcast',
          event: BROADCAST_PATCH,
          payload: { id: playerId, patch: revert },
        }).catch(() => {});
      }
    });
  }, [userId, markFresh]);

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

  // Creator-only operations (RLS-enforced; this is just a UX guard).
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

/**
 * Merge a postgres-changes UPDATE/INSERT row for a *peer* (never the
 * current user) into the players array, respecting per-field freshness so
 * a slow WAL echo can't undo a faster broadcast we already applied.
 */
function mergePeerRow(prev, row, freshMap) {
  if (!row) return prev;
  const idx = prev.findIndex(p => p.id === row.id);
  if (idx === -1) {
    // INSERT (or first time we see this player). No local row to merge
    // against; take the WAL row verbatim.
    return [...prev, row];
  }
  const current = prev[idx];
  const merged = { ...current };
  const now = Date.now();
  for (const k of Object.keys(row)) {
    const stamp = freshMap.get(`${row.id}:${k}`);
    if (stamp && now - stamp < FRESH_WINDOW_MS) {
      // We have a fresher local/broadcast value for this field. Leave it.
      continue;
    }
    merged[k] = row[k];
  }
  if (shallowEqual(merged, current)) return prev;
  const next = prev.slice();
  next[idx] = merged;
  return next;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}
