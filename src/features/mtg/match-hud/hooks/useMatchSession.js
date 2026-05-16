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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import {
  fetchMatch, fetchMatchPlayers, updatePlayer, leaveMatch, updateMatch,
} from '../services/matchApi';

const SUB_DEBUG = false;
const log = (...args) => { if (SUB_DEBUG) console.log('[match-hud]', ...args); };

const BROADCAST_PATCH = 'player_patch';

// Hold-off window after a local mutation / inbound broadcast for a field —
// during this window we trust the local value over any postgres-changes
// echo that might be carrying a stale snapshot of the same field.
const FRESH_WINDOW_MS = 3000;

// How often to do a full reconcile from the DB as a safety net against
// drift. 15 s keeps the cost trivial (one tiny SELECT per match per 15 s
// per phone) while bounding any divergence to a quarter of a minute.
const SAFETY_REFETCH_MS = 15000;

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

  // Refs that mutators reach through to avoid re-running the subscription
  // effect every render.
  const channelRef       = useRef(null);
  const channelReadyRef  = useRef(false);
  // Per-field freshness — keyed `${playerId}:${field}` → local ts.
  // Used to suppress stale postgres-changes echoes that arrive AFTER a
  // newer broadcast has already updated the field.
  const freshRef         = useRef(new Map());
  // Per-row last-applied broadcast ts. Drops out-of-order broadcasts so
  // rapid-fire mutations always settle on the LATEST value, never on a
  // late-arriving older one.
  const lastBroadcastTsRef = useRef(new Map());
  // True after the first SUBSCRIBED — any subsequent transition into
  // SUBSCRIBED therefore represents a RECONNECT and triggers a refetch.
  const everSubscribedRef = useRef(false);
  // Stable per-sender base used to keep our own broadcast timestamps
  // monotonic even across page reloads (Date.now() is, but small clock
  // adjustments could theoretically reverse it).
  const senderSeqRef = useRef(0);

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
    setPlayers(prev => {
      const idx = prev.findIndex(p => p.id === payload.id);
      if (idx === -1) {
        // Brand-new player — could be a join we missed.
        return [...prev, payload.row];
      }
      const merged = { ...prev[idx], ...payload.row };
      if (shallowEqual(merged, prev[idx])) return prev;
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
  }, [markFresh]);

  // Send a full-row broadcast for a player. Caller passes the local row
  // they just mutated; we tag it with the next sender ts.
  const sendBroadcast = useCallback((row) => {
    if (!row) return;
    const ch = channelRef.current;
    if (!ch || !channelReadyRef.current) return;
    const ts = nextSenderTs();
    ch.send({
      type: 'broadcast',
      event: BROADCAST_PATCH,
      payload: { id: row.id, row, ts },
    }).catch(() => { /* fire-and-forget; pg-changes is the backstop */ });
  }, [nextSenderTs]);

  // Pull the latest snapshot of the players from the DB and merge it in
  // without clobbering fresh local fields. Used on initial load, on
  // reconnect, and on the periodic safety net.
  const reconcileFromDb = useCallback(async () => {
    if (!matchId) return;
    const { data } = await fetchMatchPlayers(matchId);
    if (!data) return;
    setPlayers(prev => {
      const byId = new Map(prev.map(p => [p.id, p]));
      const next = data.map(serverRow => {
        const local = byId.get(serverRow.id);
        if (!local) return serverRow;
        // For each field, prefer local if it was modified recently
        // (fresh window) — otherwise trust the server.
        const merged = { ...serverRow };
        const now = Date.now();
        for (const k of Object.keys(local)) {
          const stamp = freshRef.current.get(`${serverRow.id}:${k}`);
          if (stamp && now - stamp < FRESH_WINDOW_MS) {
            merged[k] = local[k];
          }
        }
        return merged;
      });
      return next;
    });
  }, [matchId]);

  // ── Initial fetch + channel subscription ─────────────
  useEffect(() => {
    if (!matchId) {
      setMatch(null); setPlayers([]); setLoading(false);
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
      setPlayers(pRes.data || []);
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
            if (id) setPlayers(prev => prev.filter(p => p.id !== id));
            return;
          }
          if (!row) return;
          // Own row UPDATEs: local state + DB ACK are already authoritative.
          // INSERT we still process (joining in another tab counts).
          if (payload.eventType === 'UPDATE' && row.user_id === userId) return;
          setPlayers(prev => mergePeerRow(prev, row, freshRef.current));
        }
      );

      // Broadcast: instant peer-to-peer, full row with sender timestamp.
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
          // First connect: snapshot already loaded above. Subsequent
          // connects (re-establishment after a WS drop): refetch the
          // players to catch up anything we missed while offline.
          if (isReconnect) {
            log('reconnect — reconciling from DB');
            reconcileFromDb();
          }
        } else {
          channelReadyRef.current = false;
        }
      });

      // Safety-net refetch. Bounded drift, trivial bandwidth — one tiny
      // SELECT every 15 s per phone in the session.
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
  }, [matchId, userId, applyBroadcast, reconcileFromDb]);

  // ── Derived selectors ────────────────────────────────
  const me = useMemo(
    () => players.find(p => p.user_id === userId) || null,
    [players, userId]
  );
  const others = useMemo(
    () => players.filter(p => p.user_id !== userId),
    [players, userId]
  );

  // ── Mutators (optimistic, three-broadcast path) ──────
  const mutateSelf = useCallback((derive) => {
    if (!userId) return;
    let playerId = null;
    let before = null;
    let patch = null;
    let nextRow = null;

    setPlayers(prev => {
      const idx = prev.findIndex(p => p.user_id === userId);
      if (idx === -1) return prev;
      before = prev[idx];
      playerId = before.id;
      patch = derive(before);
      if (!patch || Object.keys(patch).length === 0) return prev;
      nextRow = { ...before, ...patch };
      const next = prev.slice();
      next[idx] = nextRow;
      return next;
    });
    if (!playerId || !patch || !nextRow) return;

    // Mark all patched fields fresh so any laggy WAL echo can't undo them.
    markFresh(playerId, patch);
    // Optimistic broadcast — full row + ts. Peers see this within a frame.
    sendBroadcast(nextRow);

    // Durable DB write. On success we issue a CONFIRMATION broadcast
    // that carries the server-authoritative row — this is the failsafe
    // that brings any peer up to date even if every optimistic broadcast
    // was dropped on the way. On error we re-fetch the row and resync.
    updatePlayer({ playerId, userId, patch }).then(({ data, error: err }) => {
      if (err) {
        // Refetch the canonical state for this row and snap local + peers
        // to whatever the DB says — much more reliable than trying to
        // unwind partial state that might already have other patches
        // layered on top of it.
        fetchMatchPlayers(matchId).then(({ data: rows }) => {
          if (!rows) return;
          const serverRow = rows.find(r => r.id === playerId);
          if (!serverRow) return;
          setPlayers(prev => prev.map(p => p.id === playerId ? serverRow : p));
          markFresh(playerId, serverRow);
          sendBroadcast(serverRow);
        });
        setError(err.message);
        return;
      }
      if (data) {
        // Sync local own row to the server's authoritative copy (in case
        // a trigger added fields like updated_at) and re-broadcast as
        // confirmation.
        setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, ...data } : p));
        sendBroadcast({ ...nextRow, ...data });
      }
    });
  }, [userId, markFresh, sendBroadcast, matchId]);

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

  return {
    match, players, me, others, presence, loading, error,
    isCreator,
    adjustLife, adjustPoison, setLife, setPoison, setColor,
    setPlayerName, setDeck, leave,
    updateMatchPatch,
  };
}

/**
 * Merge a postgres-changes UPDATE/INSERT row for a *peer* row into the
 * players array. Per-field freshness gating means a slow WAL echo can't
 * undo a faster broadcast we already applied.
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
