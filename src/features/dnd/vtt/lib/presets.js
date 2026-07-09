// Effektive Wand-/Licht-Presets für alle Picker (ToolSettings, Toolbar,
// WallEditor, TokenContextMenu): Built-ins (constants) minus die vom Nutzer
// deaktivierten, plus die eigenen Presets aus den VTT-Einstellungen.
//
// Eigene Wand-Presets erzeugen KEINE neuen kinds (DB/Renderer kennen nur die
// Built-ins): sie sind kind 'both' + explizite Block-Overrides — exakt das
// Toggle-System des Wand-Editors. Eigene Licht-Presets sind einfache
// {label, brightFt, dimFt, color}-Sätze ohne Icon.
import { useMemo } from 'react';
import { WALL_TYPES, LIGHT_PRESETS } from './constants';
import {
  getCustomWallPresets, getDisabledWallPresets, useCustomWallPresets, useDisabledWallPresets,
  getCustomLightPresets, getDisabledLightPresets, useCustomLightPresets, useDisabledLightPresets,
} from './vttPrefs';

// Ein eigenes Wand-Preset → die Wall-Felder, die beim Platzieren/Anwenden
// zusätzlich zu kind 'both' gesetzt werden.
export function wallOverridesOf(p) {
  return {
    blockMove: !!p.blockMove,
    blockLight: !!p.blockLight,
    blockSight: !!p.blockSight,
    seeOutFt: p.blockSight && p.seeOutFt > 0 ? p.seeOutFt : null,
    seeFarFt: p.blockSight && p.seeOutFt > 0 && p.seeFarFt > 0 ? p.seeFarFt : null,
  };
}

function mergeWallPresets(custom, disabled) {
  const off = new Set(disabled || []);
  const out = [];
  for (const [id, def] of Object.entries(WALL_TYPES)) {
    if (off.has(id)) continue;
    out.push({ id, kind: id, label: def.label, color: def.color, builtin: true });
  }
  for (const p of custom || []) {
    if (!p || !p.id) continue;
    out.push({ id: p.id, kind: 'both', label: p.label || 'Preset', color: p.color || '#8899ff', custom: true, overrides: wallOverridesOf(p) });
  }
  return out;
}

function mergeLightPresets(custom, disabled) {
  const off = new Set(disabled || []);
  const out = [];
  for (const [id, def] of Object.entries(LIGHT_PRESETS)) {
    if (off.has(id)) continue;
    out.push({ id, ...def, builtin: true });
  }
  for (const p of custom || []) {
    if (!p || !p.id) continue;
    out.push({ id: p.id, label: p.label || 'Licht', brightFt: p.brightFt ?? 20, dimFt: p.dimFt ?? 40, color: p.color || '#ffd9a0', icon: null, custom: true });
  }
  return out;
}

export function getWallPresets() { return mergeWallPresets(getCustomWallPresets(), getDisabledWallPresets()); }
export function getLightPresets() { return mergeLightPresets(getCustomLightPresets(), getDisabledLightPresets()); }

export function useWallPresets() {
  const custom = useCustomWallPresets();
  const disabled = useDisabledWallPresets();
  return useMemo(() => mergeWallPresets(custom, disabled), [custom, disabled]);
}
export function useLightPresets() {
  const custom = useCustomLightPresets();
  const disabled = useDisabledLightPresets();
  return useMemo(() => mergeLightPresets(custom, disabled), [custom, disabled]);
}
