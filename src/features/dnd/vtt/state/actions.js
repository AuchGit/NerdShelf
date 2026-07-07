// Action creators — the verbs the UI and renderer call. Each wraps apply()
// (sync) or applyLocal() (local-only UI). Keeping them here means components
// never hand-write op objects and the op vocabulary stays in one place.
import { apply, applyLocal, getState } from './store';
import { toast } from '../lib/toast';
import { DEFAULT_GRID, PING_TTL_MS, DEFAULT_LIGHT, LIGHT_PRESETS, DISPOSITIONS } from '../lib/constants';
import { getPingDurationS } from '../lib/vttPrefs';
import { patchCombat } from '../sync/characterBinding';

const uid = (p = '') => p + Math.random().toString(36).slice(2, 10);

// ---- session (client-local identity; never broadcast) ----
export const setSession = (session) => applyLocal({ type: 'session/set', session });

// ---- maps ----
// `extra` = additional map fields (fog/light/terrain/levels/…) applied in the
// SAME map/add op — a follow-up updateMap would race the INSERT over HTTP and
// silently hit 0 rows (the "shared map lost its terrain" bug).
export function addMap({ name, imageUrl, imageUrlFull, imageFullName, imagePath, width, height, grid, extra }) {
  const baseLevel = { id: uid('lvl_'), name: 'Erdgeschoss', floor: 0 };
  const map = {
    id: uid('map_'),
    name: name || 'Neue Map',
    imageUrl,
    imageUrlFull: imageUrlFull || null, // legacy baked relay URL
    imageFullName: imageFullName || null, // relative key of the full-res original (relay serves it live)
    imagePath: imagePath || null,
    width,
    height,
    grid: { ...DEFAULT_GRID, ...grid },
    levels: [baseLevel],
    ...(extra || {}),
  };
  apply({ type: 'map/add', map });
  setActiveLevel((extra?.levels?.[0] || baseLevel).id);
  return map.id;
}

// Active (DM-edited) level — client-local. The base level of a map.
export const baseLevelId = (map) => map?.levels?.[0]?.id || null;
export const setActiveLevel = (levelId) => applyLocal({ type: 'ui/set', ui: { activeLevel: levelId } });
// Ebenen tragen einen ganzzahligen `floor` (0 = Standard/Erdgeschoss, negativ =
// Keller, positiv = höhere Stockwerke). Die Basiskarte (levels[0]) ist floor 0.
export function levelFloor(map, levelId) {
  const l = (map?.levels || []).find((x) => x.id === levelId);
  return l ? (l.floor ?? 0) : 0;
}
export function addLevel(mapId, name, extra) {
  const map = getState().maps[mapId];
  if (!map) return;
  const floors = (map.levels || []).map((l) => l.floor ?? 0);
  const floor = extra && 'floor' in extra ? extra.floor : (floors.length ? Math.max(...floors) + 1 : 1);
  const lvl = { id: uid('lvl_'), name: name || `Ebene ${floor}`, floor, ...(extra || {}) };
  updateMap(mapId, { levels: [...(map.levels || []), lvl] });
  setActiveLevel(lvl.id);
  return lvl.id;
}
// Neue Ebene über (dir=+1) oder unter (dir=-1) allen bisherigen anlegen.
export function addLevelDir(mapId, dir, extra) {
  const map = getState().maps[mapId];
  if (!map) return;
  const floors = (map.levels || []).map((l) => l.floor ?? 0);
  const floor = dir >= 0 ? (floors.length ? Math.max(...floors) + 1 : 1) : (floors.length ? Math.min(...floors) - 1 : -1);
  return addLevel(mapId, extra?.name || (floor < 0 ? `Keller ${-floor}` : `Ebene ${floor}`), { ...extra, floor });
}
// Eine Ebene bearbeiten (eigenes Kartenbild / Grid / Name). Merge in
// map.levels; der Renderer nutzt Bild/Grid der angezeigten Ebene.
export function updateLevel(mapId, levelId, patch) {
  const map = getState().maps[mapId];
  if (!map) return;
  const levels = (map.levels || []).map((l) => (l.id === levelId ? { ...l, ...patch } : l));
  updateMap(mapId, { levels });
}
export function removeLevel(mapId, levelId) {
  const map = getState().maps[mapId];
  if (!map || (map.levels || []).length <= 1) return; // Ebene 1 bleibt
  const levels = (map.levels || []).filter((l) => l.id !== levelId);
  updateMap(mapId, { levels });
  setActiveLevel(levels[0]?.id || null);
}
// The level new entities are created on (the DM's active level, else map base).
const creationLevel = () => {
  const s = getState();
  return s.ui.activeLevel || baseLevelId(s.maps[s.activeMapId]);
};
export const updateMap = (id, patch) => apply({ type: 'map/update', id, patch });
export const removeMap = (id) => apply({ type: 'map/remove', id });
export const setActiveMap = (mapId) => apply({ type: 'map/setActive', mapId });
// Per-client: which map THIS viewer looks at (players may browse DM-exposed
// maps). null = follow the shared active map.
export const setViewedMap = (mapId) => applyLocal({ type: 'ui/set', ui: { viewedMapId: mapId } });
// DM toggles whether a map appears in the players' map navigation.
export const setMapPlayerVisible = (mapId, playerVisible) => apply({ type: 'map/update', id: mapId, patch: { playerVisible } });
// Persist the FULL merged grid (not just the patch): the DB `grid` column is
// overwritten wholesale on write and echoed back by the postgres_changes
// backstop, so sending only a partial patch would wipe the other grid fields
// (offset/style/thickness/opacity) → NaN inputs + a broken grid.
export const setGrid = (mapId, gridPatch) => {
  const cur = getState().maps[mapId]?.grid || {};
  apply({ type: 'map/setGrid', mapId, grid: { ...cur, ...gridPatch } });
};

// ---- tokens ----
export function addToken(token) {
  const t = {
    id: uid('tok_'),
    mapId: getState().activeMapId, // tokens persist per map (map_id NOT NULL)
    kind: 'npc',           // 'player' | 'npc'
    ownerId: null,
    name: 'Token',
    imageUrl: null,
    color: '#888',
    x: 0, y: 0,
    sizeCells: 1,
    hp: null, hpMax: null,
    conditions: [],
    level: creationLevel(),
    ...token,
  };
  apply({ type: 'token/add', token: t });
  return t.id;
}
export const updateToken = (id, patch) => apply({ type: 'token/update', id, patch });
export const moveToken = (id, x, y) => apply({ type: 'token/move', id, x, y });
// Dev/test: teleport a token (bypasses input collision) for smoke tests.
if (import.meta.env.DEV && typeof window !== 'undefined') window.__vttMove = moveToken;
export const removeToken = (id) => apply({ type: 'token/remove', id });

// D&D creature size → token footprint in cells (5e: T/S/M = 1×1, L = 2×2,
// H = 3×3, G = 4×4). Derived from the statblock, never hardcoded per monster.
const SIZE_CELLS = { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4 };
const HOSTILE = DISPOSITIONS.find((d) => d.id === 'hostile').color;

// Arm CLICK-TO-PLACE: the next left-click on the map creates the token on the
// clicked grid cell (Esc cancels). Local-only UI state — nothing spawns until
// the DM picks the spot.
export function armTokenPlacement(tokenDef) {
  applyLocal({ type: 'ui/set', ui: { pendingTokenPlace: tokenDef } });
  toast(`Klicke ein Feld, um „${tokenDef?.name || 'Token'}" zu platzieren (Esc bricht ab)`, 'info');
}
export const cancelTokenPlacement = () => applyLocal({ type: 'ui/set', ui: { pendingTokenPlace: null } });

// Prepare an NPC token from a 5etools-shaped bestiary statblock (DM only).
// Name, HP and footprint come straight from the statblock; the DM then clicks
// the grid cell where it should spawn (armTokenPlacement).
export function createTokenFromStatblock(monster) {
  const s = getState();
  const map = s.maps[s.activeMapId];
  if (!map || !monster) return null;
  const sizeKey = Array.isArray(monster.size) ? monster.size[0] : monster.size;
  const sizeCells = SIZE_CELLS[sizeKey] || 1;
  const hp = monster.hp?.average ?? null;
  armTokenPlacement({
    kind: 'npc',
    name: monster.name || 'Monster',
    hp, hpMax: hp,
    ac: statblockAc(monster.ac),
    imageUrl: monsterTokenUrl(monster),
    statblock: monster, // raw 5etools statblock → DM double-click overlay
    sizeCells,
    color: HOSTILE, // monsters default to hostile; DM can recolor in the menu
  });
  return null;
}

// AC out of a 5etools statblock: `ac` is an array of numbers or {ac,from}.
function statblockAc(ac) {
  if (Array.isArray(ac)) {
    const first = ac[0];
    if (typeof first === 'number') return first;
    if (first && typeof first.ac === 'number') return first.ac;
  }
  return typeof ac === 'number' ? ac : null;
}

// 5etools token image. Convention: img/bestiary/tokens/<source>/<name>.webp.
// We always try (the site hosts tokens for ~every monster); the token layer
// falls back to the colored disc if it 404s or CORS-blocks. An explicit
// `tokenUrl` on the statblock wins.
function monsterTokenUrl(m) {
  if (m.tokenUrl) return /^https?:/.test(m.tokenUrl) ? m.tokenUrl : `https://5e.tools/img/${String(m.tokenUrl).replace(/^\/?img\//, '')}`;
  if (m.name && m.source) return `https://5e.tools/img/bestiary/tokens/${m.source}/${encodeURIComponent(m.name)}.webp`;
  return null;
}

export function toggleCondition(id, conditionId, token) {
  const has = token.conditions.includes(conditionId);
  const conditions = has
    ? token.conditions.filter((c) => c !== conditionId)
    : [...token.conditions, conditionId];
  // Bound tokens mirror a real character: write through the combat-state RPC
  // (the binding re-projects). Standalone tokens carry their own conditions.
  if (token.characterId != null) { patchCombat(token.characterId, { conditions }); return; }
  updateToken(id, { conditions });
}

// Apply an HP delta (e.g. -7 damage, +5 heal). Clamps to [0, hpMax] if hpMax set.
export function applyHpDelta(id, delta, token) {
  if (token.hp == null) return;
  let hp = token.hp + delta;
  if (token.hpMax != null) hp = Math.min(token.hpMax, hp);
  hp = Math.max(0, hp);
  // Bound tokens write currentHp on the character via the RPC (see above).
  if (token.characterId != null) { patchCombat(token.characterId, { currentHp: hp }); return; }
  updateToken(id, { hp });
}

// ---- zones ----
export function addZone(zone) {
  const z = { id: uid('zone_'), mapId: getState().activeMapId, createdBy: null, color: '#ff5252', opacity: 0.35, level: creationLevel(), ...zone };
  apply({ type: 'zone/add', zone: z });
  return z.id;
}
export const updateZone = (id, patch) => apply({ type: 'zone/update', id, patch });
export const removeZone = (id) => apply({ type: 'zone/remove', id });

// ---- walls ----
export function addWall(wall) {
  const w = { id: uid('wall_'), kind: 'both', level: creationLevel(), ...wall };
  apply({ type: 'wall/add', wall: w });
  return w.id;
}
export const updateWall = (id, patch) => apply({ type: 'wall/update', id, patch });
// Klick-Spam-Schutz für Tür-/Licht-Toggles: der ERSTE Klick wirkt sofort
// (optimistisch, lokal), Folgeklicks im Cooldown-Fenster werden geschluckt —
// verhindert Op-/RPC-Stürme durch Doppel-/Schnellklicks, ohne die Snappiness
// des ersten Klicks zu kosten.
const _toggleAt = new Map();
function toggleCooled(key, ms = 250) {
  const now = Date.now();
  if (now - (_toggleAt.get(key) || 0) < ms) return false;
  _toggleAt.set(key, now);
  return true;
}
// Toggle a door/window open/closed. Optimistic + broadcast for instant feedback;
// a non-GM also calls the security-definer RPC so it PERSISTS (the wall table is
// GM-only under RLS — without this the DB echo reverts the door, "springs back").
export function toggleDoor(id) {
  if (!toggleCooled(`d:${id}`)) return;
  const w = getState().walls[id];
  if (!w) return;
  apply({ type: 'wall/update', id, patch: { open: !w.open } });
  // RPC only when the direct table write can NOT land (a real non-GM player).
  // A GM in player VIEW still writes directly — calling the toggle-RPC on top
  // would flip the fresh value straight back ("Tür geht sofort wieder zu").
  const sess = getState().session;
  // Spieler dürfen Türen UND Fenster öffnen/schließen (Fenster blockt zu die
  // Sicht) — die security-definer-RPC persistiert es trotz GM-only-RLS.
  if (sess.role !== 'dm' && !sess.realGM && (w.kind === 'door' || w.kind === 'window')) {
    import('../../../../core/supabase/client')
      .then(({ supabase }) => supabase.rpc('vtt_toggle_door', { p_wall: id }))
      .then((res) => res?.error && toast('Status evtl. nicht gespeichert', 'warning'))
      .catch(() => toast('Status evtl. nicht gespeichert', 'warning'));
  }
}
export const removeWall = (id) => apply({ type: 'wall/remove', id });
// Batch insert (e.g. UVTT import) — one op, one reconcile.
export function addWalls(mapId, wallDefs) {
  const level = creationLevel();
  const walls = wallDefs.map((w) => ({ id: uid('wall_'), mapId, level, kind: 'both', ...w }));
  apply({ type: 'wall/addMany', walls });
  return walls.length;
}

// ---- level transitions (stairs / ladder fields) ----
// A transition field sits on one cell of a level and has 0+ `exits`, each an
// {toLevel,col,row} you can come out at. A token entering picks an exit (auto
// if one, prompt if several).
export function addTransition({ mapId, level, col, row, kind, exits, name }) {
  const t = { id: uid('tr_'), mapId, level, col, row, kind: kind || 'stairs', exits: exits || [], name: name || '' };
  apply({ type: 'transition/add', transition: t });
  return t.id;
}
export const updateTransition = (id, patch) => apply({ type: 'transition/update', id, patch });
export function addTransitionExit(id, exit) {
  const t = getState().transitions[id];
  if (!t) return;
  updateTransition(id, { exits: [...(t.exits || []), exit] });
}
// Zwei Treppen/Leitern gegenseitig verbinden (Ein-/Ausgang hin & zurück) oder
// die Verbindung wieder lösen. Exit = {toLevel, col, row} der Gegenseite.
export function toggleTransitionLink(aId, bId) {
  const s = getState();
  const a = s.transitions[aId]; const b = s.transitions[bId];
  if (!a || !b) return;
  const hasExit = (t, o) => (t.exits || []).some((e) => e.toLevel === o.level && e.col === o.col && e.row === o.row);
  const linked = hasExit(a, b) && hasExit(b, a);
  if (linked) {
    updateTransition(aId, { exits: (a.exits || []).filter((e) => !(e.toLevel === b.level && e.col === b.col && e.row === b.row)) });
    updateTransition(bId, { exits: (b.exits || []).filter((e) => !(e.toLevel === a.level && e.col === a.col && e.row === a.row)) });
  } else {
    if (!hasExit(a, b)) updateTransition(aId, { exits: [...(a.exits || []), { toLevel: b.level, col: b.col, row: b.row }] });
    if (!hasExit(b, a)) updateTransition(bId, { exits: [...(b.exits || []), { toLevel: a.level, col: a.col, row: a.row }] });
  }
}
export const removeTransition = (id) => apply({ type: 'transition/remove', id });
export const selectTransition = (selectedTransitionId) => applyLocal({ type: 'ui/set', ui: { selectedTransitionId } });
export const setTransitionTool = (transitionKind, transitionTarget) =>
  applyLocal({ type: 'ui/set', ui: { tool: 'transition', transitionKind, transitionTarget } });

// Move a token through a transition exit (change level + position to the cell).
export function travelToken(tokenId, exit, grid) {
  const cx = grid.offsetX + (exit.col + 0.5) * grid.size;
  const cy = grid.offsetY + (exit.row + 0.5) * grid.size;
  updateToken(tokenId, { level: exit.toLevel, x: cx, y: cy });
  // Anzeige der bewegenden Person auf die Ziel-Ebene mitnehmen: der DM folgt
  // dem Token, das er durch die Treppe/Portal geschickt hat; beim Spieler
  // folgt die Ansicht ohnehin seinem eigenen Token (displayedLevel) — das
  // setActiveLevel hält beide konsistent auf der neuen Etage.
  if (exit.toLevel) setActiveLevel(exit.toLevel);
}

// ---- dynamic light ----
// Standalone light sources (a brazier, a glowing rune, …). Position in
// map-space px; radii in feet. Light-blocking walls cast shadows at render.
export function addLight(light) {
  const lt = {
    id: uid('light_'),
    mapId: getState().activeMapId,
    level: creationLevel(),
    x: 0, y: 0,
    ...DEFAULT_LIGHT,
    ...(getState().ui.lightDefaults || {}), // DM's chosen placement defaults
    ...light,
  };
  apply({ type: 'light/add', light: lt });
  return lt.id;
}
export const updateLight = (id, patch) => apply({ type: 'light/update', id, patch });
// Toggle a player-switchable light on/off. Optimistic local update + broadcast
// (instant for everyone); a non-GM also calls the security-definer RPC so the
// change persists (the normal light table write is GM-only under RLS).
export function toggleLight(id) {
  if (!toggleCooled(`l:${id}`)) return;
  const lt = getState().lights[id];
  if (!lt) return;
  const enabled = !(lt.enabled !== false);
  apply({ type: 'light/update', id, patch: { enabled } });
  // Same double-toggle guard as toggleDoor: a real GM's direct write already
  // persisted; the toggle-RPC would flip it right back.
  const sessL = getState().session;
  if (sessL.role !== 'dm' && !sessL.realGM) {
    import('../../../../core/supabase/client')
      .then(({ supabase }) => supabase.rpc('vtt_toggle_light', { p_light: id }))
      .then((res) => res?.error && toast('Licht-Status evtl. nicht gespeichert', 'warning'))
      .catch(() => toast('Licht-Status evtl. nicht gespeichert', 'warning'));
  }
}
// Default parameters for newly placed lights (set in the light tool settings).
export const setLightDefaults = (patch) => applyLocal({ type: 'ui/set', ui: { lightDefaults: { ...getState().ui.lightDefaults, ...patch } } });
export const removeLight = (id) => apply({ type: 'light/remove', id });

// Light-tool sub-mode: 'light' places a light point; 'darkness' paints darkness
// with a circle brush; 'darkness-erase' rubs painted darkness back out. A light
// only illuminates where there IS darkness, so painting darkness is what makes
// placed lights visibly "work".
export const setLightMode = (lightMode) => applyLocal({ type: 'ui/set', ui: { tool: 'light', lightMode } });
export const setDarkBrush = (darkBrushCells) => applyLocal({ type: 'ui/set', ui: { darkBrushCells } });

// Darkness is painted as circle stamps on the map (map.darkness =
// [{id,x,y,r,level}]). One op per stroke (committed on pointer-up) to avoid
// flooding sync.
export function addDarknessStamps(stamps) {
  const map = getState().maps[getState().activeMapId];
  if (!map || !stamps || stamps.length === 0) return;
  const level = creationLevel();
  const add = stamps.map((s) => ({ id: uid('dark_'), level, ...s }));
  updateMap(map.id, { darkness: [...(map.darkness || []), ...add] });
}
// Remove darkness stamps whose centre falls within the eraser brush of any
// painted point in the stroke.
export function eraseDarknessAt(points, r) {
  const map = getState().maps[getState().activeMapId];
  if (!map || !points || points.length === 0) return;
  const keep = (map.darkness || []).filter((d) => !points.some((p) => Math.hypot(d.x - p.x, d.y - p.y) <= r + (d.r || 0)));
  if (keep.length !== (map.darkness || []).length) updateMap(map.id, { darkness: keep });
}
export function clearDarkness() {
  const map = getState().maps[getState().activeMapId];
  if (!map) return;
  updateMap(map.id, { darkness: [] });
}

// ---- terrain tool: climb-height / difficult-terrain as editable OBJECTS ----
// map.terrain = [{ id, kind:'climb'|'difficult', ft, level, cells:['col,row'],
//   visible, disabledEdges:['col,row:T|R|B|L'] }]. The DM configures the type
// FIRST (tool settings), paints cells (renderer fills ui.terrainSelection),
// then "Fertig" commits the selection as one object that can be selected,
// edited, moved, resized (paint more / erase) and have edges toggled.
export const setTerrainSelection = (cells) => applyLocal({ type: 'ui/set', ui: { terrainSelection: cells } });
export const setTerrainHeight = (ft) => applyLocal({ type: 'ui/set', ui: { terrainHeightFt: ft } });
export const setTerrainVisible = (v) => applyLocal({ type: 'ui/set', ui: { terrainVisible: !!v } });
export const setTerrainKind = (kind) => applyLocal({ type: 'ui/set', ui: { terrainKind: kind } });
export const setTerrainEdgeEdit = (on) => applyLocal({ type: 'ui/set', ui: { terrainEdgeEdit: !!on } });
export const clearTerrainSelection = () => applyLocal({ type: 'ui/set', ui: { terrainSelection: [] } });
export const selectTerrain = (id) => applyLocal({ type: 'ui/set', ui: { selectedTerrainId: id, terrainEdgeEdit: false, selectedTokenId: null, selectedTokenIds: [], selectedZoneId: null, selectedWallId: null, selectedLightId: null } });

// Migrate any legacy per-cell terrain entries to objects on read.
function terrainObjects(map) {
  const raw = map.terrain || [];
  const objs = raw.filter((t) => Array.isArray(t.cells));
  const legacy = raw.filter((t) => !Array.isArray(t.cells) && t.col != null);
  if (legacy.length) {
    for (const l of legacy) objs.push({ id: l.id || uid('terr_'), kind: l.kind, ft: l.ft || 0, level: l.level, cells: [`${l.col},${l.row}`], visible: l.visible !== false, disabledEdges: [] });
  }
  return objs;
}

// Commit the current cell selection as a new terrain object (or extend the
// selected one if the selection was painted onto it).
export function commitTerrain() {
  const s = getState();
  const map = s.maps[s.activeMapId];
  if (!map) return;
  const sel = s.ui.terrainSelection || [];
  if (!sel.length) return;
  const objs = terrainObjects(map);
  const selId = s.ui.selectedTerrainId;
  const existing = selId ? objs.find((o) => o.id === selId) : null;
  let next; let newId = selId;
  if (existing) {
    const merged = [...new Set([...(existing.cells || []), ...sel])];
    next = objs.map((o) => (o.id === selId ? { ...o, cells: merged } : o));
  } else {
    const obj = { id: uid('terr_'), kind: s.ui.terrainKind || 'climb', ft: (s.ui.terrainKind || 'climb') === 'climb' ? (s.ui.terrainHeightFt || 0) : 0, level: creationLevel(), visible: s.ui.terrainVisible !== false, cells: [...sel], disabledEdges: [] };
    next = [...objs, obj];
    newId = obj.id;
  }
  updateMap(map.id, { terrain: next });
  applyLocal({ type: 'ui/set', ui: { terrainSelection: [], selectedTerrainId: newId } });
}
// Erase the selected cells from ALL terrain objects (resize down); drops empty.
export function eraseTerrainCells() {
  const s = getState();
  const map = s.maps[s.activeMapId];
  if (!map) return;
  const sel = new Set(s.ui.terrainSelection || []);
  if (!sel.size) return;
  const next = terrainObjects(map)
    .map((o) => ({ ...o, cells: (o.cells || []).filter((c) => !sel.has(c)) }))
    .filter((o) => o.cells.length);
  updateMap(map.id, { terrain: next });
  applyLocal({ type: 'ui/set', ui: { terrainSelection: [] } });
}
export function updateTerrain(id, patch) {
  const map = getState().maps[getState().activeMapId];
  if (!map) return;
  updateMap(map.id, { terrain: terrainObjects(map).map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}
export function removeTerrain(id) {
  const map = getState().maps[getState().activeMapId];
  if (!map) return;
  updateMap(map.id, { terrain: terrainObjects(map).filter((t) => t.id !== id) });
  applyLocal({ type: 'ui/set', ui: { selectedTerrainId: null } });
}
export function moveTerrain(id, dc, dr) {
  const map = getState().maps[getState().activeMapId];
  if (!map) return;
  const shift = (key) => { const [cell, side] = key.split(':'); const [col, row] = cell.split(',').map(Number); return `${col + dc},${row + dr}${side ? `:${side}` : ''}`; };
  updateMap(map.id, { terrain: terrainObjects(map).map((t) => (t.id === id ? { ...t, cells: t.cells.map(shift), disabledEdges: (t.disabledEdges || []).map(shift) } : t)) });
}
export function toggleTerrainEdge(id, edgeKey) {
  const map = getState().maps[getState().activeMapId];
  if (!map) return;
  updateMap(map.id, { terrain: terrainObjects(map).map((t) => {
    if (t.id !== id) return t;
    const de = new Set(t.disabledEdges || []);
    if (de.has(edgeKey)) de.delete(edgeKey); else de.add(edgeKey);
    return { ...t, disabledEdges: [...de] };
  }) });
}

// ---- journal / handouts (DM shows an image to all players) ----
// journal = persisted entries; presentedHandout = the one currently shown as a
// big overlay to everyone (each client can locally dismiss it).
const setJournal = (journal) => apply({ type: 'journal/set', journal });
export function addJournalEntry(entry) {
  const e = { id: uid('jr_'), createdAt: Date.now(), ...entry };
  setJournal([...(getState().journal || []), e]);
  return e.id;
}
export const updateJournalEntry = (id, patch) =>
  setJournal((getState().journal || []).map((e) => (e.id === id ? { ...e, ...patch } : e)));
export function removeJournalEntry(id) {
  setJournal((getState().journal || []).filter((e) => e.id !== id));
  if (getState().presentedHandout === id) presentHandout(null);
}
export const presentHandout = (id) => apply({ type: 'handout/present', id: id || null });

// Freeze the session: players can't move/act while paused (synced + persisted).
export const setPaused = (paused) => apply({ type: 'session/pause', paused: !!paused });

// ---- targeting (action/spell range + area + target picking) — ARCHITECTURE ----
// A future rules layer calls beginTargeting() with the known range/area; the
// player picks targets within range and confirms (DM sees the highlights).
// `area` (optional) = { type:'circle'|'cone'|'square', ...params } to preview an
// AoE zone at the cursor. Full validity rules come later.
export function beginTargeting({ originTokenId, rangeFt = 0, area = null, label = '' }) {
  applyLocal({ type: 'ui/set', ui: { tool: 'select', targeting: { originTokenId, rangeFt, area, targets: [], label } } });
}
export function toggleTarget(tokenId) {
  const t = getState().ui.targeting;
  if (!t) return;
  const has = t.targets.includes(tokenId);
  applyLocal({ type: 'ui/set', ui: { targeting: { ...t, targets: has ? t.targets.filter((x) => x !== tokenId) : [...t.targets, tokenId] } } });
}
export function confirmTargeting() {
  const t = getState().ui.targeting;
  if (!t) return null;
  // Hook for the future rules engine: resolve the action against t.targets /
  // t.area here. For an area effect we drop a matching zone so it's visible.
  if (t.area && t.area.type) {
    const origin = getState().tokens[t.originTokenId];
    if (origin) addZone({ type: t.area.type, x: origin.x, y: origin.y, params: t.area.params || {}, color: t.area.color || '#ffb300', createdBy: getState().session.userId });
  }
  applyLocal({ type: 'ui/set', ui: { targeting: null } });
  return t;
}
export const cancelTargeting = () => applyLocal({ type: 'ui/set', ui: { targeting: null } });
export const selectLight = (selectedLightId) =>
  applyLocal({ type: 'ui/set', ui: { selectedLightId, selectedLightIds: selectedLightId ? [selectedLightId] : [], selectedTokenId: null, selectedTokenIds: [], selectedZoneId: null, selectedWallId: null } });
// Mehrfachauswahl von Lichtern (Shift-Kasten / Shift-Klick) für Batch-Editing.
export const selectLights = (ids) =>
  applyLocal({ type: 'ui/set', ui: { selectedLightIds: ids, selectedLightId: ids[ids.length - 1] || null, selectedTokenId: null, selectedTokenIds: [], selectedZoneId: null, selectedWallId: null } });
// Batch insert (e.g. UVTT import) — one op, one reconcile.
export function addLights(mapId, lightDefs) {
  const level = creationLevel();
  const lights = lightDefs.map((l) => ({ id: uid('light_'), mapId, level, ...DEFAULT_LIGHT, ...l }));
  apply({ type: 'light/addMany', lights });
  return lights.length;
}

// Cycle a token's emitted light through the presets (off → torch → lantern →
// … → off). The light follows the token, so no separate placement is needed.
export function cycleTokenLight(id, token) {
  const keys = Object.keys(LIGHT_PRESETS);
  const curIx = token.light?.preset ? keys.indexOf(token.light.preset) : -1;
  const nextKey = keys[curIx + 1] || null; // past the last preset → off
  const light = nextKey ? { preset: nextKey, ...LIGHT_PRESETS[nextKey] } : null;
  updateToken(id, { light });
  return nextKey;
}

// ---- fog ----
export const revealFog = (mapId, polygon) => apply({ type: 'fog/reveal', mapId, polygon });
export const hideFog = (mapId, polygon) => apply({ type: 'fog/hide', mapId, polygon });
export const resetFog = (mapId) => apply({ type: 'fog/reset', mapId });
// Fog brush mode (local UI): false = reveal (erase fog), true = hide (paint fog).
export const setFogErase = (fogErase) => applyLocal({ type: 'ui/set', ui: { fogErase } });
export const setFogMode = (mapId, fogMode) => apply({ type: 'map/update', id: mapId, patch: { fogMode } });
// Fog brush radius in grid cells (local UI; DM-only paint tool).
export const setFogBrush = (fogBrushCells) => applyLocal({ type: 'ui/set', ui: { fogBrushCells } });

// ---- initiative / combat ----
export const setInitiative = (initiative) => apply({ type: 'initiative/set', initiative });

// Start combat from a set of tokens (the DM's current selection). Builds the
// order (value 10 by default, DM edits / rolls), marks combat active.
// opts.lair adds a "Lair Action" entry at initiative 20 that loses ties (it's
// flagged so the sort places it after other 20s — RAW: on initiative 20).
// opts.valueFor(token) → { value, pending } lets the caller pre-roll initiative
// (auto NPCs) or flag entries as awaiting a roll (players get prompted). Missing
// → the classic flat 10 the DM edits.
export function startCombat(tokenIds, tokensById, opts = {}) {
  const valueFor = opts.valueFor || (() => ({ value: 10 }));
  const order = tokenIds
    .map((id) => tokensById[id])
    .filter(Boolean)
    .map((t) => { const v = valueFor(t) || {}; return { id: 'ini_' + t.id, tokenId: t.id, name: t.name, value: v.value == null ? null : v.value, pending: !!v.pending }; });
  if (opts.lair) {
    order.push({ id: 'ini_lair_' + Math.random().toString(36).slice(2, 8), tokenId: null, name: 'Lair Action', value: 20, lair: true });
  }
  setInitiative({ order, activeIndex: 0, round: 1, active: true });
}
export const endCombat = () => setInitiative({ order: [], activeIndex: 0, round: 1, active: false });
// Weitere Tokens NACHTRÄGLICH zum laufenden Kampf hinzufügen (nur die, die
// noch nicht drin sind). Behält die bestehende Reihenfolge/aktive Runde.
export function addToCombat(tokenIds, tokensById) {
  const init = getState().initiative || { order: [], activeIndex: 0, round: 1, active: false };
  const have = new Set((init.order || []).map((o) => o.tokenId).filter(Boolean));
  const add = tokenIds.map((id) => tokensById[id]).filter((t) => t && !have.has(t.id))
    .map((t) => ({ id: 'ini_' + t.id, tokenId: t.id, name: t.name, value: 10 }));
  if (!add.length) return;
  const order = [...(init.order || []), ...add];
  setInitiative({ ...init, order, active: true });
}

// ---- pings ----
// `focus: true` (DM only, Ctrl+Alt-Klick) pans every player's camera to the
// ping so the whole table looks at the same spot.
export function ping(mapId, x, y, color = '#ffe066', focus = false) {
  const id = uid('ping_');
  // Dauer aus der eigenen Client-Einstellung (fällt auf die Konstante zurück).
  let ttl = PING_TTL_MS;
  try { ttl = Math.round(getPingDurationS() * 1000); } catch { /* Default */ }
  apply({ type: 'ping/add', ping: { id, mapId, x, y, color, at: Date.now(), focus: !!focus, ttl } });
  setTimeout(() => apply({ type: 'ping/expire', id }), ttl);
}

// ---- ruler (broadcast so the table sees the DM's measurement) ----
export const setRuler = (ruler) => apply({ type: 'ruler/set', ruler });

// ---- local UI ----
export const setTool = (tool) => applyLocal({ type: 'ui/set', ui: { tool } });
// Token currently hovered in a context menu (renderer draws a faint ring so the
// menu ↔ token coupling is visible). Local-only UI state.
export const setHoverToken = (hoverTokenId) => applyLocal({ type: 'ui/set', ui: { hoverTokenId } });
// Token ids whose context menu is open — while any is open, an empty map click
// won't deselect (so the menu's token stays the focus). Local-only.
export const setContextTokens = (contextTokenIds) => applyLocal({ type: 'ui/set', ui: { contextTokenIds } });
// Dash preview: when on, the active combatant's movement overlay extends to ×2
// speed (amber). Local-only per viewer (each player toggles their own preview).
export const setShowDash = (v) => applyLocal({ type: 'ui/set', ui: { showDash: !!v } });
// One exclusive selection across tokens / zones / walls. Token selection also
// supports a multi-set (selectedTokenIds) for marquee / shift-click → combat.
export const selectToken = (selectedTokenId) =>
  applyLocal({ type: 'ui/set', ui: { selectedTokenId, selectedTokenIds: selectedTokenId ? [selectedTokenId] : [], selectedZoneId: null, selectedWallId: null, selectedLightId: null } });
export const setTokenSelection = (ids) =>
  applyLocal({ type: 'ui/set', ui: { selectedTokenIds: ids, selectedTokenId: ids[ids.length - 1] || null, selectedZoneId: null, selectedWallId: null, selectedLightId: null } });
export function toggleTokenSelection(id) {
  const cur = getState().ui.selectedTokenIds || [];
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  setTokenSelection(next);
}
// Alle Objekt-Auswahlen (Zone/Wand/Licht/Terrain) auf einmal aufheben.
export const clearObjectSelection = () => applyLocal({ type: 'ui/set', ui: { selectedZoneId: null, selectedWallId: null, selectedWallIds: [], selectedLightId: null, selectedLightIds: [], selectedTerrainId: null, terrainEdgeEdit: false } });
export const selectZone = (selectedZoneId) => applyLocal({ type: 'ui/set', ui: { selectedZoneId, selectedTokenId: null, selectedTokenIds: [], selectedWallId: null, selectedLightId: null } });
export const selectWall = (selectedWallId) => applyLocal({ type: 'ui/set', ui: { selectedWallId, selectedWallIds: selectedWallId ? [selectedWallId] : [], selectedTokenId: null, selectedTokenIds: [], selectedZoneId: null, selectedLightId: null } });
// Select a whole set of walls (e.g. a connected loop via double-click) so the
// WallEditor can batch-edit them; selectedWallId stays the "primary" for the UI.
export const selectWalls = (ids) => applyLocal({ type: 'ui/set', ui: { selectedWallIds: ids, selectedWallId: ids[0] || null, selectedTokenId: null, selectedTokenIds: [], selectedZoneId: null, selectedLightId: null } });
export const setZoneTool = (zoneType, zoneColor) =>
  applyLocal({ type: 'ui/set', ui: { tool: 'zone', zoneType, ...(zoneColor ? { zoneColor } : {}) } });
// Exact zone dimensions set in the tool settings (used as the placement size).
export const setZoneParam = (key, val) =>
  applyLocal({ type: 'ui/set', ui: { zoneParams: { ...getState().ui.zoneParams, [key]: val } } });
export const setWallTool = (wallKind) => applyLocal({ type: 'ui/set', ui: { tool: 'walls', wallKind } });
// Continue/branch FROM a selected wall's endpoint ('a' or 'b'): switch to the
// walls tool and seed a wall chain at that vertex (renderer reads
// pendingWallChain). Branching from a junction simply starts another segment
// there — the existing walls are untouched.
export function extendWall(wall, end = 'b') {
  const v = wall && wall[end];
  if (!v) return;
  applyLocal({ type: 'ui/set', ui: { tool: 'walls', wallKind: wall.kind === 'door' ? 'both' : wall.kind, selectedWallId: null, pendingWallChain: { x: v.x, y: v.y } } });
}
export const clearPendingWallChain = () => applyLocal({ type: 'ui/set', ui: { pendingWallChain: null } });
export const setDoorDouble = (doorDouble) => applyLocal({ type: 'ui/set', ui: { doorDouble } });
