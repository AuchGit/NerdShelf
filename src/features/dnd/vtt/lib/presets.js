// Effektive Wand-/Licht-Presets für alle Picker (ToolSettings, Toolbar,
// WallEditor, TokenContextMenu): Built-ins (constants) — inkl. der in den
// VTT-Einstellungen gemachten BEARBEITUNGEN — minus die deaktivierten, plus
// die eigenen Presets.
//
// Eigene/bearbeitete Wand-Presets erzeugen KEINE neuen kinds (DB/Renderer
// kennen nur die Built-ins): Verhalten steckt in Block-Overrides — exakt das
// Toggle-System des Wand-Editors. Licht-Presets tragen zusätzlich
// `playerSwitch` (dürfen Spieler das platzierte Licht schalten?).
import { useMemo } from 'react';
import { WALL_TYPES, LIGHT_PRESETS, wallBaseBlocks } from './constants';
import {
  getCustomWallPresets, getDisabledWallPresets, useCustomWallPresets, useDisabledWallPresets,
  getCustomLightPresets, getDisabledLightPresets, useCustomLightPresets, useDisabledLightPresets,
  getBuiltinWallEdits, useBuiltinWallEdits, getBuiltinLightEdits, useBuiltinLightEdits,
} from './vttPrefs';

// Ein eigenes Wand-Preset (oder ein Built-in-Edit mit Verhaltens-Feldern) →
// die Wall-Felder, die beim Platzieren/Anwenden gesetzt werden.
export function wallOverridesOf(p) {
  return {
    blockMove: !!p.blockMove,
    blockLight: !!p.blockLight,
    blockSight: !!p.blockSight,
    seeOutFt: p.blockSight && p.seeOutFt > 0 ? p.seeOutFt : null,
    seeFarFt: p.blockSight && p.seeOutFt > 0 && p.seeFarFt > 0 ? p.seeFarFt : null,
  };
}

// Hat ein Built-in-Edit Verhaltens-Felder (nicht nur Label/Farbe)?
const WALL_BEHAVIOR_KEYS = ['blockMove', 'blockLight', 'blockSight', 'seeOutFt', 'seeFarFt'];

function mergeWallPresets(custom, disabled, edits) {
  const off = new Set(disabled || []);
  const out = [];
  for (const [id, def] of Object.entries(WALL_TYPES)) {
    // Tür/Fenster sind KEINE Presets (eigenes Platzier-/Toggle-Verhalten):
    // immer vorhanden, nicht deaktivierbar, nicht editierbar.
    const fixed = id === 'door' || id === 'window';
    if (!fixed && off.has(id)) continue;
    const edit = fixed ? {} : ((edits || {})[id] || {});
    const p = { id, kind: id, label: edit.label || def.label, color: edit.color || def.color, builtin: true };
    // Verhaltens-Edit → wie ein eigenes Preset: kind bleibt (Tür/Fenster-
    // Spezialverhalten!), aber die Toggles werden als Overrides mitplatziert.
    if (WALL_BEHAVIOR_KEYS.some((k) => k in edit)) {
      const base = wallBaseBlocks(id);
      p.overrides = wallOverridesOf({
        blockMove: edit.blockMove ?? base.move,
        blockLight: edit.blockLight ?? base.light,
        blockSight: edit.blockSight ?? base.sight,
        seeOutFt: edit.seeOutFt, seeFarFt: edit.seeFarFt,
      });
    }
    out.push(p);
  }
  for (const p of custom || []) {
    if (!p || !p.id) continue;
    out.push({ id: p.id, kind: 'both', label: p.label || 'Preset', color: p.color || '#8899ff', custom: true, overrides: wallOverridesOf(p) });
  }
  return out;
}

function mergeLightPresets(custom, disabled, edits) {
  const off = new Set(disabled || []);
  const out = [];
  for (const [id, def] of Object.entries(LIGHT_PRESETS)) {
    if (off.has(id)) continue;
    const edit = (edits || {})[id] || {};
    out.push({ id, ...def, ...edit, builtin: true });
  }
  for (const p of custom || []) {
    if (!p || !p.id) continue;
    out.push({ id: p.id, label: p.label || 'Licht', brightFt: p.brightFt ?? 20, dimFt: p.dimFt ?? 40, color: p.color || '#ffd9a0', icon: null, playerSwitch: p.playerSwitch !== false, custom: true });
  }
  return out;
}

export function getWallPresets() { return mergeWallPresets(getCustomWallPresets(), getDisabledWallPresets(), getBuiltinWallEdits()); }
export function getLightPresets() { return mergeLightPresets(getCustomLightPresets(), getDisabledLightPresets(), getBuiltinLightEdits()); }

export function useWallPresets() {
  const custom = useCustomWallPresets();
  const disabled = useDisabledWallPresets();
  const edits = useBuiltinWallEdits();
  return useMemo(() => mergeWallPresets(custom, disabled, edits), [custom, disabled, edits]);
}
export function useLightPresets() {
  const custom = useCustomLightPresets();
  const disabled = useDisabledLightPresets();
  const edits = useBuiltinLightEdits();
  return useMemo(() => mergeLightPresets(custom, disabled, edits), [custom, disabled, edits]);
}
