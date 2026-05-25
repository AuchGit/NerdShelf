// src/features/mtg/match-hud/hooks/useMatchSession.js
//
// Realtime sync engine for one MTG match. The goal is "the other phones at
// the table see your tap before your finger lifts" — no perceived latency,
// no wrong values, no flicker. The path to that goal is layered redundancy:
//
//   1. Local optimistic update — instant, drives the screen the user is
//      tapping on.
//   2. Broadcast (immediately, full row + sender timestamp) — single WS
//      frame to peers, typically <100 ms. Carries the ENTIRE row state
//      (not just the delta) so a single received broadcast is enough to
//      bring a peer into perfect alignment, even if earlier broadcasts
//      were lost on a flaky network.
//   3. Durable DB write — REST PATCH. The result is authoritative.
//   4. Confirmation broadcast (after the DB write returns) — same full
//      row but carrying the server-authoritative values. If the optimistic
//      broadcast was dropped this still catches the peer up.
//   5. Postgres-changes echo — slowest path (~300-600 ms). Only used as
//      a last-resort backstop for events that slipped through 1-4.
//   6. Periodic refetch (every 15 s) and on-reconnect refetch — catches
//      drift accumulated during a WebSocket dropout (phone backgrounded,
//      tunnel switch, …) so divergence is bounded.
//
// Out-of-order arrival is handled by per-row sender timestamps: each
// broadcast carries `Date.now()` from the sender, and the receiver only
// accepts broadcasts newer than the last one it applied for that row.
// Per-row timestamps are sender-monotonic (one writer per row — RLS),
// so this is safe without any cross-clock synchronisation.
//
// Architecture note — playersRef as the synchronous source of truth:
//   React 18 batches setState calls inside event handlers and does NOT
//   guarantee that the updater function runs synchronously. Earlier
//   versions of this hook captured `playerId` / `patch` / `nextRow`
//   inside the setPlayers updater and then used them on the line below
//   to fire broadcast + DB write. In the batched case the updater ran
//   AFTER the side effects, so those closure variables were still null,
//   the broadcast was silently skipped, and peers only saw the update
//   when the NEXT tap forced a render — which is exactly the user-
//   reported symptom of "HP doesn't change until I also tap poison".
//
//   The fix: everything mutateSelf needs is computed BEFORE setPlayers
//   from `playersRef.current`, which is kept in lock-step with React
//   state — updated synchronously inside every setPlayers updater AND
//   by a useEffect as a safety net. Side effects then run with values
//   that are guaranteed correct, regardless of React's batching mood.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import {
  fetchMatch, fetchMatchPlayers, updatePlayer, leaveMatch, updateMatch,
  closeMatch as apiCloseMatch,
} from '../services/matchApi';

const SUB_DEBUG = false;
const log = (...args) => { if (SUB_DEBUG) console.log('[match-hud]', ...args); };

const BROADCAST_PATCH = 'player_patch';

// Hold-off window after a local mutation / inbound broadcast for a field —
// during this window we trust the local value over any postgres-changes
// echo that might be carrying a stale snapshot of the same field.
const FRESH_WINDOW_MS = 3000;

// How often to do a full reconcile from the DB as a safety net against
// drift. Realtime carries every change already; this is purely a fallback
// for the rare case the websocket silently dropped. 60 s is a sweet spot:
// users notice >1min of divergence, but 4 reads/min/phone (vs 16/min on
// 15 s) makes a huge difference at the free-tier connection budget.
const SAFETY_REFETCH_MS = 60000;

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

  const channelRef       = useRef(null);
  const channelReadyRef  = useRef(false);
  const freshRef         = useRef(new Map());
  const lastBroadcastTsRef = useRef(new Map());
  const everSubscribedRef = useRef(false);
  const senderSeqRef     = useRef(0);

  // Synchronous mirror of `players`. Every code path that calls setPlayers
  // also updates this ref inside the same updater (or for non-updater
  // setPlayers, immediately afterward), so reads are always in lock-step
  // with React state. The useEffect below is a defensive backstop in case
  // any future setPlayers caller forgets to keep the ref in sync.
  const playersRef = useRef([]);
  useEffect(() => { playersRef.current = players; }, [players]);

  // Helper: setState + sync ref in one place. Accepts either a functional
  // updater or a plain value, matching React's setState signature.
  const writePlayers = useCallback((updaterOrValue) => {
    if (typeof updaterOrValue === 'function') {
      setPlayers(prev => {
        const next = updaterOrValue(prev);
        // Setting refs from inside a setState updater is safe — refs
        // don't trigger renders, and even if the updater runs twice in
        // StrictMode, the value derived from `prev` is deterministic.
        playersRef.current = next;
        return next;
      });
    } else {
      playersRef.current = updaterOrValue;
      setPlayers(updaterOrValue);
    }
  }, []);

  const nextSenderTs = useCallback(() => {
    const t = Math.max(Date.now(), senderSeqRef.current + 1);
    senderSeqRef.current = t;
    return t;
  }, []);

  const markFresh = useCallback((playerId, patch) => {
    if (!playerId || !patch) return;
    const ts = Date.now();
    for (const k of Object.keys(patch)) {
      if (k === '_ts' || k === 'id' || k === 'updated_at') continue;
      freshRef.current.set(`${playerId}:${k}`, ts);
    }
  }, []);

  // Apply an inbound full-row broadcast. Drops out-of-order events.
  const applyBroadcast = useCallback((payload) => {
    if (!payload?.id || !payload?.row) return;
    const ts = Number(payload.ts) || 0;
    const last = lastBroadcastTsRef.current.get(payload.id) || 0;
    if (ts > 0 && ts < last) {
      log('drop stale broadcast', { id: payload.id, ts, last });
      return;
    }
    if (ts > last) lastBroadcastTsRef.current.set(payload.id, ts);
    markFresh(payload.id, payload.row);
    writePlayers(prev => {
      const idx = prev.findIndex(p => p.id === payload.id);
      if (idx === -1) return [...prev, payload.row];
      const merged = { ...prev[idx], ...payload.row };
      if (shallowEqual(merged, prev[idx])) return prev;
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
  }, [markFresh, writePlayers]);

  // Send a full-row broadcast for a player.
  const sendBroadcast = useCallback((row) => {
    if (!row) return;
    const ch = channelRef.current;
    if (!ch || !channelReadyRef.current) return;
    const ts = nextSenderTs();
    ch.send({
      type: 'broadcast',
      event: BROADCAST_PATCH,
      payload: { id: row.id, row, ts },
    }).catch(() => { /* DB write + pg-changes are the durable backstop */ });
  }, [nextSenderTs]);

  // Pull the latest snapshot from the DB and merge it in without
  // clobbering fields that were touched locally within the freshness
  // window. Used for initial load, reconnect, and the safety net.
  const reconcileFromDb = useCallback(async () => {
    if (!matchId) return;
    const { data } = await fetchMatchPlayers(matchId);
    if (!data) return;
    writePlayers(prev => {
      const byId = new Map(prev.map(p => [p.id, p]));
      const now = Date.now();
      return data.map(serverRow => {
        const local = byId.get(serverRow.id);
        if (!local) return serverRow;
        const merged = { ...serverRow };
        for (const k of Object.keys(local)) {
          const stamp = freshRef.current.get(`${serverRow.id}:${k}`);
          if (stamp && now - stamp < FRESH_WINDOW_MS) {
            merged[k] = local[k];
          }
        }
        return merged;
      });
    });
  }, [matchId, writePlayers]);

  // ── Initial fetch + channel subscription ─────────────
  useEffect(() => {
    if (!matchId) {
      writePlayers([]);
      setMatch(null); setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let channel = null;
    let safetyTimer = null;
    setLoading(true);
    setError(null);
    freshRef.current = new Map();
    lastBroadcastTsRef.current = new Map();
    everSubscribedRef.current = false;

    (async () => {
      const [mRes, pRes] = await Promise.all([
        fetchMatch(matchId),
        fetchMatchPlayers(matchId),
      ]);
      if (cancelled) return;
      if (mRes.error)   { setError(mRes.error.message); setLoading(false); return; }
      if (!mRes.data)   { setError('Match nicht gefunden'); setLoading(false); return; }
      setMatch(mRes.data);
      writePlayers(pRes.data || []);
      setLoading(false);

      channel = supabase.channel(`mtg-match:${matchId}`, {
        config: {
          presence: { key: userId || 'anon' },
          broadcast: { self: false, ack: false },
        },
      });
      channelRef.current = channel;

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mtg_matches', filter: `id=eq.${matchId}` },
        (payload) => {
          if (payload.eventType === 'DELETE')  setMatch(null);
          else if (payload.new)                setMatch(payload.new);
        }
      );

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mtg_match_players', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const row = payload.new;
          if (payload.eventType === 'DELETE') {
            const id = payload.old?.id;
            if (id) writePlayers(prev => prev.filter(p => p.id !== id));
            return;
          }
          if (!row) return;
          // Own row UPDATEs: local state is already authoritative.
          if (payload.eventType === 'UPDATE' && row.user_id === userId) return;
          writePlayers(prev => mergePeerRow(prev, row, freshRef.current));
        }
      );

      channel.on('broadcast', { event: BROADCAST_PATCH }, ({ payload }) => {
        applyBroadcast(payload);
      });

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
          const isReconnect = everSubscribedRef.current;
          everSubscribedRef.current = true;
          channelReadyRef.current = true;
          if (userId) {
            await channel.track({ user_id: userId, online_at: new Date().toISOString() });
          }
          if (isReconnect) {
            log('reconnect — reconciling from DB');
            reconcileFromDb();
          }
        } else {
          channelReadyRef.current = false;
        }
      });

      safetyTimer = setInterval(() => {
        if (cancelled) return;
        reconcileFromDb();
      }, SAFETY_REFETCH_MS);
    })();

    return () => {
      cancelled = true;
      channelReadyRef.current = false;
      channelRef.current = null;
      if (safetyTimer) clearInterval(safetyTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, userId, applyBroadcast, reconcileFromDb, writePlayers]);

  // ── Derived selectors ────────────────────────────────
  const me = useMemo(
    () => players.find(p => p.user_id === userId) || null,
    [players, userId]
  );
  const others = useMemo(
    () => players.filter(p => p.user_id !== userId),
    [players, userId]
  );

  // ── Mutators (optimistic, synchronous side-effect ordering) ──────
  const mutateSelf = useCallback((derive) => {
    if (!userId) return;

    // Read the freshest local state from the ref. This is the critical
    // change vs. the previous implementation, which captured these
    // values INSIDE the setPlayers updater — under React 18 batching
    // that capture happened after the broadcast / DB code below, so
    // mutations silently no-op'd.
    const prev = playersRef.current;
    const idx = prev.findIndex(p => p.user_id === userId);
    if (idx === -1) return;
    const before = prev[idx];
    const playerId = before.id;
    const patch = derive(before);
    if (!patch || Object.keys(patch).length === 0) return;
    const nextRow = { ...before, ...patch };

    // Apply locally + sync ref in one shot.
    const newPlayers = prev.slice();
    newPlayers[idx] = nextRow;
    writePlayers(newPlayers);

    // Side effects with values that are guaranteed populated.
    markFresh(playerId, patch);
    sendBroadcast(nextRow);

    // Durable DB write.
    updatePlayer({ playerId, userId, patch }).then(({ data, error: err }) => {
      if (err) {
        // Refetch the row from DB and reconcile — but only sync local if
        // no NEWER local mutation has overwritten the fields we just
        // tried to write. Without this guard, a slow / failed write of
        // the FIRST tap could roll back the SECOND tap's value.
        fetchMatchPlayers(matchId).then(({ data: rows }) => {
          if (!rows) return;
          const serverRow = rows.find(r => r.id === playerId);
          if (!serverRow) return;
          const localRow = playersRef.current.find(r => r.id === playerId);
          if (!localRow) return;
          const stillMatchesOurWrite = Object.keys(patch).every(k => localRow[k] === patch[k]);
          if (!stillMatchesOurWrite) return; // newer mutation; leave local
          const updated = { ...localRow, ...serverRow };
          writePlayers(p => p.map(x => x.id === playerId ? updated : x));
          markFresh(playerId, updated);
          sendBroadcast(updated);
        });
        setError(err.message);
        return;
      }
      if (data) {
        // Confirmation: only fold server data into local if our local
        // values for the patched fields STILL match what we wrote — i.e.
        // no rapid follow-up tap has already moved them past this. If
        // they don't match anymore, the follow-up tap already started
        // its own broadcast+DB roundtrip and we leave it alone.
        const localRow = playersRef.current.find(r => r.id === playerId);
        if (!localRow) return;
        const stillMatchesOurWrite = Object.keys(patch).every(k => localRow[k] === patch[k]);
        if (stillMatchesOurWrite) {
          const updated = { ...localRow, ...data };
          writePlayers(p => p.map(x => x.id === playerId ? updated : x));
          sendBroadcast(updated);
        } else {
          // Local is ahead — just re-broadcast our current local row
          // so peers stay aligned with the newest value, even if the
          // newer mutation's own broadcast was dropped on the wire.
          sendBroadcast(localRow);
        }
      }
    });
  }, [userId, markFresh, sendBroadcast, writePlayers, matchId]);

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

  const isCreator = match && userId && match.created_by === userId;
  const updateMatchPatch = useCallback(async (patch) => {
    if (!isCreator) return { error: new Error('Nur Ersteller darf Match ändern') };
    return updateMatch({ matchId: match.id, patch });
  }, [match, isCreator]);

  // Creator-only: flip status to 'ended'. The realtime postgres-changes
  // echo on mtg_matches pushes the new status to every connected peer,
  // who will then see the "Match wurde beendet" screen in their session
  // page instead of the HUD.
  const closeMatch = useCallback(async () => {
    if (!isCreator) return { error: new Error('Nur Ersteller darf Match beenden') };
    return apiCloseMatch({ matchId: match.id });
  }, [match, isCreator]);

  return {
    match, players, me, others, presence, loading, error,
    isCreator,
    adjustLife, adjustPoison, setLife, setPoison, setColor,
    setPlayerName, setDeck, leave,
    updateMatchPatch, closeMatch,
  };
}

/**
 * Merge a postgres-changes UPDATE/INSERT row for a *peer* row. Per-field
 * freshness gating means a slow WAL echo can't undo a faster broadcast
 * we already applied.
 */
function mergePeerRow(prev, row, freshMap) {
  if (!row) return prev;
  const idx = prev.findIndex(p => p.id === row.id);
  if (idx === -1) return [...prev, row];
  const current = prev[idx];
  const merged = { ...current };
  const now = Date.now();
  for (const k of Object.keys(row)) {
    const stamp = freshMap.get(`${row.id}:${k}`);
    if (stamp && now - stamp < FRESH_WINDOW_MS) continue;
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
