// Per-user, per-device VTT preferences (localStorage, like crossEditionMarker).
// Personal display choices — not shared game state.
//
// initiativeRoll: show the d20 roll button in the initiative tracker (each user
//   opts in for themselves in the NerdShelf DnD settings). Off by default.
// uiScale: scales the VTT's UI/font sizes (sidebars, bars, menus). 1 = default.
// memoryStyle: how explored-but-unseen terrain renders in dynamic fog —
//   'grayscale' (true luminance B/W) or 'darkened' (dimmed, keeps colour).
import { useEffect, useState } from 'react';

const EVENT = 'nerdshelf:vtt-prefs-changed';
const fire = () => { try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* ignore */ } };

function read(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; } }
function write(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch { /* ignore */ }
  fire();
}

// Generic subscribe hook for any getter.
function usePref(getter) {
  const [v, setV] = useState(getter);
  useEffect(() => {
    const onChange = () => setV(getter());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

// ── initiative roll ──
const INIT_KEY = 'nerdshelf:vttInitiativeRoll';
export function getInitiativeRollEnabled() { return read(INIT_KEY, null) === '1'; }
export function setInitiativeRollEnabled(on) { write(INIT_KEY, on ? '1' : null); }
export function useInitiativeRollEnabled() { return usePref(getInitiativeRollEnabled); }

// ── UI scale (0.8 … 1.5) ──
const SCALE_KEY = 'nerdshelf:vttUiScale';
export function getUiScale() { const v = parseFloat(read(SCALE_KEY, '1')); return Number.isFinite(v) && v > 0 ? Math.min(1.6, Math.max(0.7, v)) : 1; }
export function setUiScale(v) { write(SCALE_KEY, v); }
export function useUiScale() { return usePref(getUiScale); }

// ── token badge size (personal; multiplies the DM's map-wide badge scale) ──
const BADGE_KEY = 'nerdshelf:vttTokenBadgeScale';
export function getTokenBadgeScale() { const v = parseFloat(read(BADGE_KEY, '1')); return Number.isFinite(v) && v > 0 ? Math.min(2.5, Math.max(0.4, v)) : 1; }
export function setTokenBadgeScale(v) { write(BADGE_KEY, v); }
export function useTokenBadgeScale() { return usePref(getTokenBadgeScale); }

// ── AC badge size (personal; on top of the general token-badge size) ──
const AC_KEY = 'nerdshelf:vttAcBadgeScale';
export function getAcBadgeScale() { const v = parseFloat(read(AC_KEY, '1')); return Number.isFinite(v) && v > 0 ? Math.min(2.5, Math.max(0.4, v)) : 1; }
export function setAcBadgeScale(v) { write(AC_KEY, v); }
export function useAcBadgeScale() { return usePref(getAcBadgeScale); }

// ── DM cursor light: warm local glow around the DM's mouse (never synced) ──
const DMCUR_KEY = 'nerdshelf:vttDmCursorLight';
export function getDmCursorLight() { return read(DMCUR_KEY, '1') !== '0'; }
export function setDmCursorLight(on) { write(DMCUR_KEY, on ? null : '0'); } // default on
export function useDmCursorLight() { return usePref(getDmCursorLight); }

// ── memory style ──
const MEM_KEY = 'nerdshelf:vttMemoryStyle';
export function getMemoryStyle() { return read(MEM_KEY, 'grayscale') === 'darkened' ? 'darkened' : 'grayscale'; }
export function setMemoryStyle(v) { write(MEM_KEY, v === 'darkened' ? 'darkened' : 'grayscale'); }
export function useMemoryStyle() { return usePref(getMemoryStyle); }

// ── explored-memory brightness (0..1; for colour mode the effective max is the
//    DM's baseline map brightness). Personal display choice. ──
const MEMB_KEY = 'nerdshelf:vttMemoryBrightness';
export function getMemoryBrightness() { const v = parseFloat(read(MEMB_KEY, '0.45')); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.45; }
export function setMemoryBrightness(v) { write(MEMB_KEY, v); }
export function useMemoryBrightness() { return usePref(getMemoryBrightness); }

// ── Ping-Größe/Deutlichkeit (pro Client). 1 = Standard, 0.5…2.5. ──
const PING_KEY = 'nerdshelf:vttPingScale';
export function getPingScale() { const v = parseFloat(read(PING_KEY, '1')); return Number.isFinite(v) ? Math.min(2.5, Math.max(0.5, v)) : 1; }
export function setPingScale(v) { write(PING_KEY, v); }
export function usePingScale() { return usePref(getPingScale); }

// ── Ping-Dauer in Sekunden (pro Client, gilt für die EIGENEN Pings). 1…8. ──
const PING_DUR_KEY = 'nerdshelf:vttPingDurationS';
export function getPingDurationS() { const v = parseFloat(read(PING_DUR_KEY, '3')); return Number.isFinite(v) ? Math.min(8, Math.max(1, v)) : 3; }
export function setPingDurationS(v) { write(PING_DUR_KEY, v); }
export function usePingDurationS() { return usePref(getPingDurationS); }

// ── DM-Ping-Farbe (pro Client). Default Gelb. ──
const DM_PING_KEY = 'nerdshelf:vttDmPingColor';
export function getDmPingColor() { return read(DM_PING_KEY, '#ffe066'); }
export function setDmPingColor(v) { write(DM_PING_KEY, v); }
export function useDmPingColor() { return usePref(getDmPingColor); }

// ── connection transport: 'supabase' (cloud) or 'relay' (direct via GM PC) ──
const CONN_KEY = 'nerdshelf:vttConnectionMode';
const RELAY_KEY = 'nerdshelf:vttRelayUrl';
export function getConnectionMode() { return read(CONN_KEY, 'supabase') === 'relay' ? 'relay' : 'supabase'; }
export function setConnectionMode(v) { write(CONN_KEY, v === 'relay' ? 'relay' : 'supabase'); }
export function useConnectionMode() { return usePref(getConnectionMode); }
export function getRelayUrl() { return read(RELAY_KEY, '') || ''; }
export function setRelayUrl(v) { write(RELAY_KEY, v || null); }
export function useRelayUrl() { return usePref(getRelayUrl); }

// ── show player-switchable light switches on the map (player choice) ──
const LSW_KEY = 'nerdshelf:vttShowLightSwitches';
export function getShowLightSwitches() { return read(LSW_KEY, '1') !== '0'; }
export function setShowLightSwitches(on) { write(LSW_KEY, on ? null : '0'); } // default on → store only the opt-out
export function useShowLightSwitches() { return usePref(getShowLightSwitches); }

// ── how terrain is shown to a player (personal display, not game state) ──
//   opacity 0..1; pattern 'fill' | 'hatch' | 'dots'; color '' = per-kind default.
const T_OPACITY = 'nerdshelf:vttTerrainOpacity';
const T_PATTERN = 'nerdshelf:vttTerrainPattern';
const T_COLOR = 'nerdshelf:vttTerrainColor';
export function getTerrainOpacity() { const v = parseFloat(read(T_OPACITY, '0.35')); return Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0.35; }
export function setTerrainOpacity(v) { write(T_OPACITY, v); }
export function useTerrainOpacity() { return usePref(getTerrainOpacity); }
export function getTerrainPattern() { const v = read(T_PATTERN, 'fill'); return ['fill', 'hatch', 'dots'].includes(v) ? v : 'fill'; }
export function setTerrainPattern(v) { write(T_PATTERN, v); }
export function useTerrainPattern() { return usePref(getTerrainPattern); }
export function getTerrainColor() { return read(T_COLOR, '') || ''; }
export function setTerrainColor(v) { write(T_COLOR, v || null); }
export function useTerrainColor() { return usePref(getTerrainColor); }

// ── climb-terrain height label prominence: 'loud' | 'normal' | 'minimal' | 'off' ──
const T_CLIMB = 'nerdshelf:vttClimbHeightStyle';
export function getClimbHeightStyle() { const v = read(T_CLIMB, 'normal'); return ['loud', 'normal', 'minimal', 'off'].includes(v) ? v : 'normal'; }
export function setClimbHeightStyle(v) { write(T_CLIMB, v); }
export function useClimbHeightStyle() { return usePref(getClimbHeightStyle); }

// ── difficult-terrain prominence: 'loud' | 'normal' | 'minimal' | 'off' ──
const T_DIFF = 'nerdshelf:vttDifficultStyle';
export function getDifficultStyle() { const v = read(T_DIFF, 'normal'); return ['loud', 'normal', 'minimal', 'off'].includes(v) ? v : 'normal'; }
export function setDifficultStyle(v) { write(T_DIFF, v); }
export function useDifficultStyle() { return usePref(getDifficultStyle); }

// ── Eigene Wand-/Licht-Presets + deaktivierte Built-ins (DM/VTT-Setup) ──
// Persönliches Setup-Werkzeug (localStorage), kein Shared Game State. Eigene
// Wand-Presets sind kind 'both' + Block-Overrides (blockMove/blockLight/
// blockSight/seeOutFt/seeFarFt); Licht-Presets {label, brightFt, dimFt, color}.
function readJson(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function writeJson(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  fire();
}

const WALL_CUSTOM_KEY = 'nerdshelf:vttCustomWallPresets';
export function getCustomWallPresets() { const v = readJson(WALL_CUSTOM_KEY, []); return Array.isArray(v) ? v : []; }
export function setCustomWallPresets(list) { writeJson(WALL_CUSTOM_KEY, list?.length ? list : null); }
export function useCustomWallPresets() { return usePref(getCustomWallPresets); }

const WALL_DISABLED_KEY = 'nerdshelf:vttDisabledWallPresets';
export function getDisabledWallPresets() { const v = readJson(WALL_DISABLED_KEY, []); return Array.isArray(v) ? v : []; }
export function setDisabledWallPresets(ids) { writeJson(WALL_DISABLED_KEY, ids?.length ? ids : null); }
export function useDisabledWallPresets() { return usePref(getDisabledWallPresets); }

const LIGHT_CUSTOM_KEY = 'nerdshelf:vttCustomLightPresets';
export function getCustomLightPresets() { const v = readJson(LIGHT_CUSTOM_KEY, []); return Array.isArray(v) ? v : []; }
export function setCustomLightPresets(list) { writeJson(LIGHT_CUSTOM_KEY, list?.length ? list : null); }
export function useCustomLightPresets() { return usePref(getCustomLightPresets); }

const LIGHT_DISABLED_KEY = 'nerdshelf:vttDisabledLightPresets';
export function getDisabledLightPresets() { const v = readJson(LIGHT_DISABLED_KEY, []); return Array.isArray(v) ? v : []; }
export function setDisabledLightPresets(ids) { writeJson(LIGHT_DISABLED_KEY, ids?.length ? ids : null); }
export function useDisabledLightPresets() { return usePref(getDisabledLightPresets); }

// Bearbeitungen der BUILT-IN-Presets: id → Partial (Label/Farbe/Werte/Toggles).
// Leeres Objekt = unverändert; ein „Zurücksetzen" löscht den Eintrag.
const WALL_EDITS_KEY = 'nerdshelf:vttBuiltinWallEdits';
export function getBuiltinWallEdits() { const v = readJson(WALL_EDITS_KEY, {}); return v && typeof v === 'object' ? v : {}; }
export function setBuiltinWallEdits(map) { writeJson(WALL_EDITS_KEY, map && Object.keys(map).length ? map : null); }
export function useBuiltinWallEdits() { return usePref(getBuiltinWallEdits); }

const LIGHT_EDITS_KEY = 'nerdshelf:vttBuiltinLightEdits';
export function getBuiltinLightEdits() { const v = readJson(LIGHT_EDITS_KEY, {}); return v && typeof v === 'object' ? v : {}; }
export function setBuiltinLightEdits(map) { writeJson(LIGHT_EDITS_KEY, map && Object.keys(map).length ? map : null); }
export function useBuiltinLightEdits() { return usePref(getBuiltinLightEdits); }

export const VTT_PREFS_EVENT = EVENT;
