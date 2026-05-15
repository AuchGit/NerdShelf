// src/features/wh40k/combat/persistence.js
//
// Local persistence layer for Combat Helper sessions. Sessions are
// frequently mutated (every CP tick, every unit toggle), so this layer:
//
//   - Writes to localStorage under a single index + per-session keys.
//   - Uses a tiny debounced flush so rapid edits don't thrash storage.
//   - Validates schema version on load and runs forward migrations when
//     it bumps (none yet — placeholder for the inevitable v2).
//   - Never throws on a quota / parse error: returns null and lets the
//     hook recreate the session.
//
// Storage layout:
//   ns:wh40k:combat:index               -> { ids: string[] }
//   ns:wh40k:combat:session:<id>        -> full serialised CombatSession
//
// Future: a Supabase-backed sync adapter can layer on top by exposing
// the same load/save/list/delete API.

import { COMBAT_SCHEMA_VERSION } from './schema.js';

const INDEX_KEY = 'ns:wh40k:combat:index';
const SESSION_PREFIX = 'ns:wh40k:combat:session:';

const DEBOUNCE_MS = 300;
const flushTimers = new Map(); // sessionId → timeout handle

/* ─────────────────── index ─────────────────── */

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { ids: [] };
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.ids)) return { ids: [] };
    return v;
  } catch { return { ids: [] }; }
}
function writeIndex(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* quota */ }
}

/* ─────────────────── migrations ─────────────────── */

function migrate(session) {
  if (!session) return null;
  if (session.schemaVersion === COMBAT_SCHEMA_VERSION) return session;
  // Future migrations land here. Each step bumps by one and is its own
  // small, reversible transform.
  // v0 -> v1: never existed; current is v1.
  if (typeof session.schemaVersion !== 'number') {
    return { ...session, schemaVersion: COMBAT_SCHEMA_VERSION };
  }
  // Unknown forward version: refuse rather than corrupt.
  if (session.schemaVersion > COMBAT_SCHEMA_VERSION) return null;
  return session;
}

/* ─────────────────── API ─────────────────── */

export function listSessions() {
  const { ids } = readIndex();
  return ids
    .map(id => {
      try {
        const raw = localStorage.getItem(SESSION_PREFIX + id);
        if (!raw) return null;
        const s = migrate(JSON.parse(raw));
        if (!s) return null;
        return {
          id: s.id, name: s.name, armyName: s.armyName,
          currentRound: s.currentRound, currentPhase: s.currentPhase,
          updatedAt: s.updatedAt, vp: s.vp, opponentVp: s.opponentVp,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function loadSession(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + id);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch { return null; }
}

export function saveSession(session) {
  if (!session?.id) return;
  const idx = readIndex();
  if (!idx.ids.includes(session.id)) {
    idx.ids.push(session.id);
    writeIndex(idx);
  }
  const stamped = { ...session, savedAt: new Date().toISOString() };
  try { localStorage.setItem(SESSION_PREFIX + session.id, JSON.stringify(stamped)); }
  catch (e) { console.warn('[combat] save failed', e); }
}

/** Debounced flush — UI calls this on every mutation; the actual write
 *  is coalesced. */
export function saveSessionDebounced(session) {
  if (!session?.id) return;
  if (flushTimers.has(session.id)) clearTimeout(flushTimers.get(session.id));
  const handle = setTimeout(() => {
    flushTimers.delete(session.id);
    saveSession(session);
  }, DEBOUNCE_MS);
  flushTimers.set(session.id, handle);
}

export function deleteSession(id) {
  if (!id) return;
  try { localStorage.removeItem(SESSION_PREFIX + id); } catch { /* */ }
  const idx = readIndex();
  writeIndex({ ids: idx.ids.filter(x => x !== id) });
  if (flushTimers.has(id)) {
    clearTimeout(flushTimers.get(id));
    flushTimers.delete(id);
  }
}
