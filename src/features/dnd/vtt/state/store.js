// Central VTT store. Single source of truth for the whole feature.
//
// Design goals:
//   - Renderer-agnostic: holds plain data, no Pixi references. The Pixi
//     renderer SUBSCRIBES and reconciles; React panels subscribe via hooks.
//   - High-frequency-safe: token drags fire many updates/sec. We use a tiny
//     external store (useSyncExternalStore) so only components selecting the
//     changed slice re-render — the canvas doesn't go through React at all.
//   - Sync-transparent: every mutation goes through `apply(op)`. Local writes
//     apply the op AND hand it to the SyncAdapter to broadcast; inbound ops
//     from the adapter call `applyRemote(op)` (same reducer, no re-broadcast).
//     UI never knows whether it's local or networked.

import { ROLES } from '../lib/constants';
import { segmentsIntersect } from '../lib/visibility';

// When a token moves across a "see-through" loop wall, it flips inside↔outside
// (came from outside → counts as inside, and vice versa). Odd number of wall
// crossings on the move segment = toggle. `inside` stays undefined until the
// token first crosses such a wall (then geometry no longer matters; the manual
// token-context toggle can still override). Returns the new inside value.
function nextInside(t, nx, ny, wallsMap) {
  let crossings = 0;
  for (const id in wallsMap) {
    const w = wallsMap[id];
    if (!w.seeThrough || w.mapId !== t.mapId) continue;
    if ((w.level || null) !== (t.level || null)) continue;
    if (segmentsIntersect({ x: t.x, y: t.y }, { x: nx, y: ny }, w.a, w.b)) crossings++;
  }
  if (crossings % 2 === 1) return !t.inside; // undefined → true (outside → inside)
  return t.inside;
}

let state = freshState();
const listeners = new Set();
let adapter = null; // set via connectSync()

function freshState() {
  return {
    session: { userId: 'local-dm', role: ROLES.DM, name: 'DM' },
    maps: {},          // id -> map { id, name, imageUrl, width, height, grid }
    activeMapId: null,
    tokens: {},        // id -> token
    zones: {},         // id -> zone
    walls: {},         // id -> wall { id, mapId, a:{x,y}, b:{x,y}, kind, level }
    transitions: {},   // id -> { id, mapId, level, col, row, toLevel, kind } (stairs/ladder)
    lights: {},        // id -> { id, mapId, level, x, y, brightFt, dimFt, color, enabled }
    fog: {},           // mapId -> { stamps: [{poly, mode:'reveal'|'hide'}, …] }  (ordered manual fog)
    initiative: { order: [], activeIndex: 0, round: 1, active: false }, // entries: {id, tokenId, name, value}
    journal: [],       // persisted handouts: [{id, title, imageUrl, imagePath, body, createdAt}]
    presentedHandout: null, // id of the handout the DM is currently showing to everyone
    paused: false,     // DM froze the session: players can't move/act (synced)
    pings: [],         // transient {id, x, y, mapId, color, at}
    ruler: null,       // transient {from:{x,y}, to:{x,y}} while measuring
    ui: { tool: 'select', selectedTokenId: null, selectedTokenIds: [], selectedZoneId: null, selectedWallId: null, zoneType: 'circle', zoneColor: '#ff5252', wallKind: 'both', doorDouble: false, activeLevel: null, transitionKind: 'stairs', transitionTarget: null, selectedTransitionId: null, selectedLightId: null, viewedMapId: null, fogBrushCells: 1.5, lightMode: 'light', darkBrushCells: 2, pendingWallChain: null,
      lightDefaults: { brightFt: 20, dimFt: 40, color: '#ffd9a0', heightFt: 0 },
      zoneParams: { radiusFt: 20, sideFt: 15, lengthFt: 30, widthFt: 5, directionDeg: 0 },
      terrainSelection: [], terrainHeightFt: 5, terrainVisible: true, terrainKind: 'climb',
      selectedTerrainId: null, terrainEdgeEdit: false,
      // Targeting flow (action/spell range + target picking). Architecture for
      // the future rules layer: { originTokenId, rangeFt, area, targets:[id], label }.
      targeting: null },
  };
}

// ---- subscription plumbing -------------------------------------------------
export function getState() { return state; }
// Dev/debug convenience: inspect live state from the console (window.__vtt()).
if (typeof window !== 'undefined') window.__vtt = getState;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { state = { ...state }; listeners.forEach((fn) => fn()); }

// ---- sync wiring -----------------------------------------------------------
// On connect we run a snapshot handshake so a LATE JOINER gets current state:
// the new client broadcasts `__reqState`; any existing peer replies with a full
// `__snapshot`. This mirrors how the SupabaseAdapter will hydrate from the DB
// (an existing player opening their tab after the DM set up the table).
export function connectSync(a) {
  adapter = a;
  adapter.onMessage((op) => {
    if (op.type === '__reqState') { adapter.send({ type: '__snapshot', snapshot: serialize() }); return; }
    if (op.type === '__snapshot') { hydrate(op.snapshot); return; }
    applyRemote(op);
  });
  const r = adapter.connect?.();
  adapter.send({ type: '__reqState' });
  return r;
}

// Push a full snapshot to the transport for durable persistence (relay mode:
// the host relay caches it to disk so state survives everyone disconnecting).
// No-op/harmless on Supabase (the DB is already the source of truth).
export function persistSnapshot() {
  adapter?.send({ type: '__persist', snapshot: serialize() });
}

// Serializable shared state (everything except client-local session/ui/transient).
function serialize() {
  return {
    maps: state.maps,
    activeMapId: state.activeMapId,
    tokens: state.tokens,
    zones: state.zones,
    walls: state.walls,
    transitions: state.transitions,
    lights: state.lights,
    fog: state.fog,
    initiative: state.initiative,
    journal: state.journal,
    presentedHandout: state.presentedHandout,
    paused: state.paused,
  };
}

function hydrate(snap) {
  if (!snap) return;
  state.maps = snap.maps || {};
  state.activeMapId = snap.activeMapId || null;
  state.tokens = snap.tokens || {};
  state.zones = snap.zones || {};
  state.walls = snap.walls || {};
  state.transitions = snap.transitions || {};
  state.lights = snap.lights || {};
  state.fog = snap.fog || {};
  state.initiative = snap.initiative || state.initiative;
  state.journal = snap.journal || [];
  state.presentedHandout = snap.presentedHandout || null;
  state.paused = !!snap.paused;
  emit();
}

// ---- undo (Ctrl+Z) ----------------------------------------------------------
// Before each local mutation we capture its inverse (read from the CURRENT
// state) and push it on a stack. undo() applies the inverse like a normal op,
// so it broadcasts/persists and every client converges. Consecutive drags of
// the same token collapse to one entry.
let undoStack = [];
let applyingHistory = false;

function inverseOf(op) {
  const st = state;
  switch (op.type) {
    case 'token/add':    return { type: 'token/remove', id: op.token.id };
    case 'token/remove': return st.tokens[op.id] ? { type: 'token/add', token: st.tokens[op.id] } : null;
    case 'token/update': return st.tokens[op.id] ? { type: 'token/update', id: op.id, patch: pick(st.tokens[op.id], op.patch) } : null;
    case 'token/move':   return st.tokens[op.id] ? { type: 'token/move', id: op.id, x: st.tokens[op.id].x, y: st.tokens[op.id].y } : null;
    case 'zone/add':     return { type: 'zone/remove', id: op.zone.id };
    case 'zone/remove':  return st.zones[op.id] ? { type: 'zone/add', zone: st.zones[op.id] } : null;
    case 'zone/update':  return st.zones[op.id] ? { type: 'zone/update', id: op.id, patch: pick(st.zones[op.id], op.patch) } : null;
    case 'wall/add':     return { type: 'wall/remove', id: op.wall.id };
    case 'wall/remove':  return st.walls[op.id] ? { type: 'wall/add', wall: st.walls[op.id] } : null;
    case 'wall/update':  return st.walls[op.id] ? { type: 'wall/update', id: op.id, patch: pick(st.walls[op.id], op.patch) } : null;
    case 'transition/add':    return { type: 'transition/remove', id: op.transition.id };
    case 'transition/remove': return st.transitions[op.id] ? { type: 'transition/add', transition: st.transitions[op.id] } : null;
    case 'transition/update': return st.transitions[op.id] ? { type: 'transition/update', id: op.id, patch: pick(st.transitions[op.id], op.patch) } : null;
    case 'light/add':    return { type: 'light/remove', id: op.light.id };
    case 'light/remove': return st.lights[op.id] ? { type: 'light/add', light: st.lights[op.id] } : null;
    case 'light/update': return st.lights[op.id] ? { type: 'light/update', id: op.id, patch: pick(st.lights[op.id], op.patch) } : null;
    case 'map/update':   return st.maps[op.id] ? { type: 'map/update', id: op.id, patch: pick(st.maps[op.id], op.patch) } : null;
    case 'initiative/set': return { type: 'initiative/set', initiative: st.initiative };
    default: return null; // addMany / fog / map-add / setActive / ui: not undoable
  }
}
function pick(obj, patch) { const o = {}; for (const k in patch) o[k] = obj[k]; return o; }

function pushUndo(op) {
  if (applyingHistory) return;
  // Collapse a run of token moves (a drag) into one undo entry.
  if (op.type === 'token/move') {
    const last = undoStack[undoStack.length - 1];
    if (last && last.type === 'token/move' && last.id === op.id) return;
  }
  const inv = inverseOf(op);
  if (!inv) return;
  undoStack.push(inv);
  if (undoStack.length > 100) undoStack.shift();
}

export function undo() {
  const inv = undoStack.pop();
  if (!inv) return;
  applyingHistory = true;
  try { reduce(inv); emit(); adapter?.send(inv); }
  finally { applyingHistory = false; }
}

// Local mutation entry point: apply + broadcast.
// When did WE last move a token locally? The postgres_changes backstop echoes
// our own (possibly slightly stale) position back as a token/add or token/move;
// applying it yanks the token backwards mid-WASD/drag. Broadcasts already keep
// peers live, so we ignore the DB echo's POSITION for a token we just moved.
const _localMoveAt = new Map();
const LOCAL_MOVE_GUARD_MS = 2500;

export function apply(op) {
  pushUndo(op);
  if (op.type === 'token/move') _localMoveAt.set(op.id, Date.now());
  reduce(op);
  emit();
  adapter?.send(op);
}

// Inbound from a peer / backstop: apply only, never re-broadcast (avoids echo
// loops). Position from a token echo is dropped if WE moved that token just now.
export function applyRemote(op) {
  const recent = (id) => (Date.now() - (_localMoveAt.get(id) || 0)) < LOCAL_MOVE_GUARD_MS;
  if (op.type === 'token/move' && recent(op.id)) return; // our own stale echo
  if (op.type === 'token/add' && op.token && recent(op.token.id)) {
    // Keep everything the backstop refreshed EXCEPT the position we own locally.
    const { x, y, ...rest } = op.token; void x; void y;
    op = { ...op, token: rest };
  }
  reduce(op);
  emit();
}

// ---- the reducer -----------------------------------------------------------
// Ops are plain {type, ...payload}. Mutates `state` in place; emit() snapshots.
function reduce(op) {
  switch (op.type) {
    case 'session/set':
      state.session = { ...state.session, ...op.session };
      break;

    case 'map/add':
      state.maps[op.map.id] = op.map;
      break;
    case 'map/update':
      if (state.maps[op.id]) state.maps[op.id] = { ...state.maps[op.id], ...op.patch };
      break;
    case 'map/setActive':
      state.activeMapId = op.mapId;
      // The active map is shown to the table, so it's player-visible by default.
      if (state.maps[op.mapId]) state.maps[op.mapId] = { ...state.maps[op.mapId], playerVisible: true };
      break;
    case 'map/setGrid':
      if (state.maps[op.mapId]) {
        // New map object (not in-place) so React selectors (GridControls slider)
        // detect the change — the canvas reconciles regardless, but the controls
        // need a fresh reference to re-render.
        state.maps[op.mapId] = { ...state.maps[op.mapId], grid: { ...state.maps[op.mapId].grid, ...op.grid } };
      }
      break;
    case 'map/remove': {
      delete state.maps[op.id];
      delete state.fog[op.id];
      if (state.activeMapId === op.id) state.activeMapId = null;
      const onMap = (e) => e.mapId === op.id;
      for (const k in state.tokens) if (onMap(state.tokens[k])) delete state.tokens[k];
      for (const k in state.walls) if (onMap(state.walls[k])) delete state.walls[k];
      for (const k in state.zones) if (onMap(state.zones[k])) delete state.zones[k];
      for (const k in state.transitions) if (onMap(state.transitions[k])) delete state.transitions[k];
      for (const k in state.lights) if (onMap(state.lights[k])) delete state.lights[k];
      break;
    }

    case 'token/add': {
      // The realtime backstop re-adds a token from its DB row (e.g. after a
      // move). If any rich field came back null/undefined (statblock, image,
      // light, ac, …), keep the value we already have so re-selecting a token
      // doesn't lose its data.
      const ex = state.tokens[op.token.id];
      if (ex) {
        const merged = { ...ex };
        for (const k in op.token) if (op.token[k] != null) merged[k] = op.token[k];
        state.tokens[op.token.id] = merged;
      } else {
        state.tokens[op.token.id] = op.token;
      }
      break;
    }
    case 'token/update':
      if (state.tokens[op.id]) state.tokens[op.id] = { ...state.tokens[op.id], ...op.patch };
      break;
    case 'token/move': // hot path during drag
      if (state.tokens[op.id]) {
        const t = state.tokens[op.id];
        const inside = nextInside(t, op.x, op.y, state.walls);
        state.tokens[op.id] = inside === t.inside
          ? { ...t, x: op.x, y: op.y }
          : { ...t, x: op.x, y: op.y, inside };
      }
      break;
    case 'token/remove':
      delete state.tokens[op.id];
      break;

    case 'zone/add':
      state.zones[op.zone.id] = op.zone;
      break;
    case 'zone/update':
      if (state.zones[op.id]) state.zones[op.id] = { ...state.zones[op.id], ...op.patch };
      break;
    case 'zone/remove':
      delete state.zones[op.id];
      break;

    case 'wall/add':
      state.walls[op.wall.id] = op.wall;
      break;
    case 'wall/addMany':
      for (const w of op.walls) state.walls[w.id] = w;
      break;
    case 'wall/update':
      if (state.walls[op.id]) state.walls[op.id] = { ...state.walls[op.id], ...op.patch };
      break;
    case 'wall/remove':
      delete state.walls[op.id];
      break;

    case 'transition/add':
      state.transitions[op.transition.id] = op.transition;
      break;
    case 'transition/update':
      if (state.transitions[op.id]) state.transitions[op.id] = { ...state.transitions[op.id], ...op.patch };
      break;
    case 'transition/remove':
      delete state.transitions[op.id];
      break;

    case 'light/add':
      state.lights[op.light.id] = op.light;
      break;
    case 'light/addMany':
      for (const lt of op.lights) state.lights[lt.id] = lt;
      break;
    case 'light/update':
      if (state.lights[op.id]) state.lights[op.id] = { ...state.lights[op.id], ...op.patch };
      break;
    case 'light/remove':
      delete state.lights[op.id];
      break;

    // Manual fog = an ORDERED list of brush stamps; later strokes override
    // earlier ones (reveal erases a previous hide and vice-versa). The renderer
    // replays them into a bitmap mask.
    case 'fog/reveal': {
      const f = state.fog[op.mapId] || { stamps: [] };
      state.fog[op.mapId] = { stamps: [...(f.stamps || []), { poly: op.polygon, mode: 'reveal' }] };
      break;
    }
    case 'fog/hide': {
      const f = state.fog[op.mapId] || { stamps: [] };
      state.fog[op.mapId] = { stamps: [...(f.stamps || []), { poly: op.polygon, mode: 'hide' }] };
      break;
    }
    case 'fog/reset':
      state.fog[op.mapId] = { stamps: [] };
      break;

    case 'journal/set':
      state.journal = op.journal || [];
      break;
    case 'handout/present':
      state.presentedHandout = op.id || null;
      break;
    case 'session/pause':
      state.paused = !!op.paused;
      break;
    case 'initiative/set':
      state.initiative = op.initiative;
      break;

    case 'ping/add':
      state.pings = [...state.pings, op.ping];
      break;
    case 'ping/expire':
      state.pings = state.pings.filter((p) => p.id !== op.id);
      break;

    case 'ruler/set': // transient, local-only is fine but we broadcast for "shared ruler"
      state.ruler = op.ruler;
      break;

    case 'ui/set': // local-only UI; never reaches the adapter (see apply callers)
      state.ui = { ...state.ui, ...op.ui };
      break;

    default:
      // Unknown op: ignore. Lets newer clients send ops older ones skip safely.
      break;
  }
}

// Convenience for purely-local UI state that must NOT sync.
export function applyLocal(op) { reduce(op); emit(); }
