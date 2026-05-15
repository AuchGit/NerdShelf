// src/features/mtg/match-hud/services/playerColors.js
//
// Player colour palette for the Match HUD. The HUD fills the entire tile with
// the player's chosen colour, so the swatches need to be:
//   1. Visually distinct at a glance across a tabletop
//   2. Strong enough to read on a phone in mixed lighting
//   3. Paired with a deterministic foreground (text) colour that hits WCAG AA
//      against the tile background
//
// We pre-compute the text colour per swatch — picking white vs. near-black
// based on perceived luminance. This is cheaper and more predictable than
// computing contrast on every render.

const RAW = [
  { id: 'red',    label: 'Red',    bg: '#c0392b', text: '#ffffff' },
  { id: 'blue',   label: 'Blue',   bg: '#2563eb', text: '#ffffff' },
  { id: 'green',  label: 'Green',  bg: '#2f9e44', text: '#ffffff' },
  { id: 'white',  label: 'White',  bg: '#f3f1e7', text: '#1b1c1f' },
  { id: 'black',  label: 'Black',  bg: '#1f1f24', text: '#f5f5f7' },
  { id: 'purple', label: 'Purple', bg: '#7c3aed', text: '#ffffff' },
  { id: 'orange', label: 'Orange', bg: '#e07a1f', text: '#1b1c1f' },
  { id: 'teal',   label: 'Teal',   bg: '#0d9488', text: '#ffffff' },
];

export const PLAYER_COLORS = RAW;

const BY_ID = Object.fromEntries(RAW.map(c => [c.id, c]));

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** Parse a hex string to {r,g,b}. Returns null on garbage input. */
function parseHex(raw) {
  if (!raw || !HEX_RE.test(raw)) return null;
  const c = raw.replace('#', '');
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

/** Pick the foreground colour for a given background using perceptual
 *  luminance (the cheap approximation — close enough for WCAG AA on the
 *  large life numerals we render). */
export function contrastText(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return '#ffffff';
  const L = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return L > 0.6 ? '#1b1c1f' : '#ffffff';
}

/** Normalise an arbitrary colour reference to its canonical hex form, or
 *  return null if it's a preset id. Used by the picker to detect "is this a
 *  custom hex value?" without parsing the same regex twice in the UI. */
export function isCustomColor(value) {
  if (!value) return false;
  if (BY_ID[value]) return false;
  return HEX_RE.test(value);
}

/** Resolve a colour reference to its full swatch.
 *
 *  Accepts both:
 *   - preset ids ('red', 'blue', …) → returns the curated swatch
 *   - hex strings ('#aabbcc')        → wraps in {bg, text} with auto contrast
 *
 *  Falls back to red so the UI never renders a blank tile if a stale id
 *  arrives over realtime. */
export function getColor(value) {
  if (value && BY_ID[value]) return BY_ID[value];
  if (isCustomColor(value)) {
    const hex = value.startsWith('#') ? value : `#${value}`;
    return { id: hex, label: hex.toUpperCase(), bg: hex, text: contrastText(hex) };
  }
  return RAW[0];
}

/** Pick the next colour that isn't already taken. Used when a player joins
 *  without explicitly choosing — keeps each tile visually distinct. */
export function pickAvailableColor(takenIds = []) {
  const taken = new Set(takenIds);
  for (const c of RAW) {
    if (!taken.has(c.id)) return c.id;
  }
  // All exhausted (>8 players) — recycle from the start.
  return RAW[takenIds.length % RAW.length].id;
}
