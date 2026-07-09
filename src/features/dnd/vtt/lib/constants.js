// Domain constants for the VTT. Renderer-agnostic.

// One grid cell is always 5 ft in D&D 5e. All distances derive from this.
export const FEET_PER_CELL = 5;

export const ROLES = { DM: 'dm', PLAYER: 'player' };

// Grid line rendering styles. The renderer maps these to a dash pattern.
export const GRID_STYLES = {
  solid: { label: 'Durchgängig', dash: null },
  dashed: { label: 'Gestrichelt', dash: [8, 6] },
  dotted: { label: 'Punkte', dash: [2, 6] },
};

// Default appearance for a freshly added map's grid.
export const DEFAULT_GRID = {
  size: 70, // px per cell in map-space
  offsetX: 0,
  offsetY: 0,
  color: '#000000',
  opacity: 0.35,
  thickness: 1,
  style: 'solid', // key of GRID_STYLES
  snapMapToGrid: false, // when true, grid size is forced so the map fits whole cells
};

// Conditions. Placeholder icons (single glyph) until real art is dropped in.
// `icon` is rendered in a token corner; `color` tints the badge.
export const CONDITIONS = [
  { id: 'blinded', label: 'Blinded', icon: '/Assets/conditions/blinded.svg', color: '#6b7280' },
  { id: 'charmed', label: 'Charmed', icon: '/Assets/conditions/charmed.svg', color: '#ec4899' },
  { id: 'deafened', label: 'Deafened', icon: '/Assets/conditions/deafened.svg', color: '#6b7280' },
  { id: 'frightened', label: 'Frightened', icon: '/Assets/conditions/frightened.svg', color: '#a855f7' },
  { id: 'grappled', label: 'Grappled', icon: '/Assets/conditions/grappled.svg', color: '#92400e' },
  { id: 'incapacitated', label: 'Incapacitated', icon: '/Assets/conditions/incapacitated.svg', color: '#eab308' },
  { id: 'invisible', label: 'Invisible', icon: '/Assets/conditions/invisible.svg', color: '#38bdf8' },
  { id: 'paralyzed', label: 'Paralyzed', icon: '/Assets/conditions/paralyzed.svg', color: '#eab308' },
  { id: 'petrified', label: 'Petrified', icon: '/Assets/conditions/petrified.svg', color: '#78716c' },
  { id: 'poisoned', label: 'Poisoned', icon: '/Assets/conditions/poisoned.svg', color: '#22c55e' },
  { id: 'prone', label: 'Prone', icon: '/Assets/conditions/prone.svg', color: '#f97316' },
  { id: 'restrained', label: 'Restrained', icon: '/Assets/conditions/restrained.svg', color: '#92400e' },
  { id: 'stunned', label: 'Stunned', icon: '/Assets/conditions/stunned.svg', color: '#eab308' },
  { id: 'unconscious', label: 'Unconscious', icon: '/Assets/conditions/unconscious.svg', color: '#ef4444' },
  { id: 'concentration', label: 'Concentration', icon: '/Assets/conditions/concentration.svg', color: '#6c8cff' },
];
export const CONDITION_BY_ID = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));

// Zone / AoE template kinds. `params` documents the shape-specific fields each
// stores (all distances in ft; angle in degrees).
export const ZONE_TYPES = {
  circle: { label: 'Sphere / Circle', params: ['radiusFt'] },
  cone:   { label: 'Cone',            params: ['lengthFt', 'directionDeg'] },
  square: { label: 'Square / Cube',   params: ['sideFt'] },
};

// 5e cone is as wide as it is long; this is the half-angle used to draw it.
export const CONE_HALF_ANGLE_DEG = 26.57; // atan(0.5) — width = length

// Default colors offered when placing a zone.
export const ZONE_COLORS = ['#ff5252', '#ffb300', '#42a5f5', '#66bb6a', '#ab47bc', '#ffffff'];

export const PING_TTL_MS = 3000;

// Wall kinds. Foundry-style: walls block movement and (optionally) light/sight.
//   both     — blocks movement AND light (a solid wall)
//   movement — blocks movement only (e.g. a low railing / difficult terrain edge,
//              or an invisible barrier you can see past)
export const WALL_TYPES = {
  both:     { label: 'Wand (Licht + Bewegung)', color: '#ff5d5d', blocksLight: true,  blocksMovement: true,  blocksSight: true },
  movement: { label: 'Nur Bewegung',            color: '#5db4ff', blocksLight: false, blocksMovement: true,  blocksSight: false },
  shadow:   { label: 'Nur Schatten (Licht)',    color: '#8b5cf6', blocksLight: true,  blocksMovement: false, blocksSight: false },
  // Bush / cover: blocks light + sight from OUTSIDE, but a token within
  // `seeOutFt` of it (standing in/at the edge) can see past it. Movement free.
  cover:    { label: 'Busch / Deckung',         color: '#3fb56b', blocksLight: true,  blocksMovement: false, blocksSight: true, cover: true },
  door:     { label: 'Tür',                     color: '#ffd24a', blocksLight: true,  blocksMovement: true,  blocksSight: true },
  // Window: blocks movement but lets sight AND light through even when "closed"
  // (a closed door blocks both; a window never does). A `milky` window dims the
  // light that passes through by one step (handled in the light compositor).
  window:   { label: 'Fenster',                 color: '#67d4e0', blocksLight: false, blocksMovement: true,  blocksSight: false, window: true },
};

// Default "see out from inside" distance for a cover/bush wall (ft).
export const DEFAULT_COVER_SEE_OUT_FT = 5;

// Basis-Blockverhalten einer Wand OHNE explizite Overrides, im GESCHLOSSENEN
// Zustand (Tür/Fenster offen wird separat behandelt). Das ist die Wahrheit, die
// die Checkboxen im Wand-Editor anzeigen, wenn kein Override gesetzt ist:
// die kinds sind nur PRESETS für diese drei Toggles.
export function wallBaseBlocks(kind) {
  if (kind === 'door') return { move: true, light: true, sight: true };
  // Geschlossenes klares Fenster blockt Licht + Sicht (trübe Scheibe); offen
  // bzw. milchig/farbig wird in den Effektiv-Funktionen behandelt.
  if (kind === 'window') return { move: true, light: true, sight: true };
  const def = WALL_TYPES[kind] || WALL_TYPES.both;
  return { move: def.blocksMovement, light: def.blocksLight, sight: def.blocksSight };
}

// Effektive Durchguck-Nähe (ft): ab dieser Distanz zur Wand sieht ein Token
// durch eine sicht-blockende Wand hindurch. 0 = nie. Busch/Deckung hat einen
// Default, alle anderen nur ein explizit gesetztes seeOutFt.
export function wallPeekFt(w) {
  if ((WALL_TYPES[w.kind] || {}).cover) return w.seeOutFt ?? DEFAULT_COVER_SEE_OUT_FT;
  return w.seeOutFt || 0;
}

// Fog of war mode per map.
//   none    — no fog; everyone sees the whole map
//   manual  — DM reveals rectangles by hand (Fog tool)
//   dynamic — line-of-sight: players see only what their token(s) can see,
//             computed against light-blocking walls
// Door icons (drop these SVGs into public/Assets/map/). A door is always one
// grid cell wide and sits within a wall; clicking it toggles open/closed.
export const DOOR_ICONS = {
  closed: '/Assets/map/closeddoor.svg',
  open: '/Assets/map/opendoor.svg',
};

// Level-transition field icons (drop SVGs into public/Assets/map/). A transition
// field sits on one cell of a level; a token entering it switches to toLevel.
export const TRANSITION_ICONS = {
  stairs: '/Assets/map/stairs.svg',
  ladder: '/Assets/map/ladder.svg',
  portal: '/Assets/map/portal.svg',
};
export const TRANSITION_KINDS = { stairs: 'Treppe', ladder: 'Leiter', portal: 'Portal' };

export const FOG_MODES = {
  none:    'Kein Fog',
  manual:  'Manuell (Rechtecke)',
  dynamic: 'Dynamisch (Sichtlinie)',
};

// ── Dynamic light ─────────────────────────────────────────────────────
// A light source emits bright light out to `brightFt`, then dim light out to
// `dimFt`; light-blocking walls cast shadows (same LoS math as fog). Colors
// are warm by default (torch/lantern). Radii in feet (1 cell = 5 ft).
export const DEFAULT_LIGHT = { brightFt: 20, dimFt: 40, color: '#ffd9a0', enabled: true };

// Token disposition → ring color. NPCs default to hostile; the DM can switch a
// token to friendly / neutral / a custom color in its context menu.
export const DISPOSITIONS = [
  { id: 'hostile',  label: 'Hostile',  color: '#e5484d' },
  { id: 'friendly', label: 'Friendly', color: '#46a758' },
  { id: 'neutral',  label: 'Neutral',  color: '#ffb224' },
];

// Quick presets for "luminous tokens" (a torch-bearer, a lantern, …). `null`
// turns a token's light off. Keyed list keeps the cycle order data-driven.
export const LIGHT_PRESETS = {
  torch:   { label: 'Fackel',   brightFt: 20, dimFt: 40, color: '#ffb866', icon: '/Assets/map/torch.svg' },
  lantern: { label: 'Laterne',  brightFt: 30, dimFt: 60, color: '#ffd9a0', icon: '/Assets/map/lantern.svg' },
  candle:  { label: 'Kerze',    brightFt: 5,  dimFt: 10, color: '#ffe0b0', icon: '/Assets/map/candle.svg' },
};

// Distinct, stable per-player colours (derived from the user id — no storage),
// used to tint the ring of NPC tokens a player owns/controls.
export const PLAYER_RING_COLORS = ['#4aa3ff', '#4ade80', '#e0af68', '#c678dd', '#ff6b6b', '#3fb56b', '#56b6c2', '#ff9533', '#d291ff', '#f7768e'];
export function playerColor(userId) {
  if (!userId) return '#8a8f98';
  const s = String(userId);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return PLAYER_RING_COLORS[h % PLAYER_RING_COLORS.length];
}

// Icon choices for a light / light switch (DM-pickable). `''` = the default
// light-switch glyph. Keys map to /Assets/map/*.svg.
export const LIGHT_ICONS = {
  '': { label: 'Schalter', src: '/Assets/map/lightswitch.svg' },
  torch: { label: 'Fackel', src: '/Assets/map/torch.svg' },
  lantern: { label: 'Laterne', src: '/Assets/map/lantern.svg' },
  candle: { label: 'Kerze', src: '/Assets/map/candle.svg' },
};
