// Shared maps: cross-campaign map snapshots that ANY user can upload (under a
// unique name) and load as a fresh copy into their own campaign. No admin role
// is required anymore — RLS only restricts editing to the row's owner.
import { supabase } from '../../../../core/supabase/client';
import { getState } from '../state/store';
import * as A from '../state/actions';

const BUCKET = 'vtt-maps';
const rid = (p) => p + Math.random().toString(36).slice(2, 10);
export function demoPublicUrl(path) { return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null; }

export async function listDemoMaps() {
  try { const { data } = await supabase.from('vtt_demo_maps').select('*').order('created_at', { ascending: false }); return data || []; }
  catch { return []; }
}

// Upload the active map (+ its entities) as a NEW shared map under a unique
// name. Throws 'NAME_TAKEN' if the name already exists.
export async function uploadSharedMap(name) {
  const s = getState();
  const map = s.maps[s.activeMapId];
  if (!map) throw new Error('Keine aktive Map');
  const clean = (name || map.name || 'Map').trim();
  if (!clean) throw new Error('Name erforderlich');
  const existing = await listDemoMaps();
  if (existing.some((m) => (m.name || '').trim().toLowerCase() === clean.toLowerCase())) throw new Error('NAME_TAKEN');
  const onMap = (obj) => Object.values(obj).filter((e) => e.mapId === map.id);
  const snapshot = {
    // Save EVERY map-level setting so a loaded shared map looks/behaves exactly
    // like the original (walls/lights/zones/transitions keep their own fields via
    // the full objects below).
    map: {
      name: map.name, levels: map.levels, fogMode: map.fogMode,
      lightingEnabled: map.lightingEnabled, lightStyle: map.lightStyle, lightBaseline: map.lightBaseline,
      darkness: map.darkness || [], terrain: map.terrain || [],
      memoryStyle: map.memoryStyle, memoryStrength: map.memoryStrength, lightContrast: map.lightContrast, lightBlur: map.lightBlur,
      bloodyTokens: map.bloodyTokens, turnMarkerScope: map.turnMarkerScope, turnMarkerView: map.turnMarkerView,
      turnMarkerStyle: map.turnMarkerStyle, tokenBadgeScale: map.tokenBadgeScale,
      enclosedDark: map.enclosedDark, worldShadowDir: map.worldShadowDir, worldShadowStrength: map.worldShadowStrength,
    },
    walls: onMap(s.walls), lights: onMap(s.lights), zones: onMap(s.zones), transitions: onMap(s.transitions),
  };
  const row = { id: rid('shared_'), name: clean, image_path: map.imagePath || null, width: map.width, height: map.height, grid: map.grid, snapshot, created_by: s.session.userId };
  const { error } = await supabase.from('vtt_demo_maps').insert(row);
  if (error) throw error;
  return row.id;
}

// Create a fresh copy of a shared map in the current campaign (new ids).
export function loadDemoIntoCampaign(demo) {
  const snap = demo.snapshot || {};
  const m = snap.map || {};
  const newMapId = A.addMap({
    name: `${demo.name || m.name || 'Demo'} (Kopie)`,
    imagePath: demo.image_path || null,
    imageUrl: demoPublicUrl(demo.image_path),
    width: demo.width || 0,
    height: demo.height || 0,
    grid: demo.grid || {},
  });
  // Multi-level maps keep their original level objects (so entity level-ids still
  // match); single-level snapshots stay on the new map's fresh base level.
  const oldLevels = Array.isArray(m.levels) ? m.levels : [];
  const multi = oldLevels.length > 1;
  // Level remap BEFORE building the patch: terrain and darkness entries carry a
  // `level` id of the ORIGINAL map — kept verbatim they point at a level the new
  // map doesn't have and get filtered out everywhere ("Gelände wurde nicht
  // übernommen"). Same remap the walls/lights below always got.
  const newBase = getState().maps[newMapId]?.levels?.[0]?.id || null;
  const remapLevel = (lvl) => (multi && lvl ? lvl : newBase);
  const patch = {
    fogMode: m.fogMode, lightingEnabled: m.lightingEnabled, lightStyle: m.lightStyle, lightBaseline: m.lightBaseline,
    darkness: (m.darkness || []).map((d) => ({ ...d, level: remapLevel(d.level) })),
    terrain: (m.terrain || []).map((t) => ({ ...t, level: remapLevel(t.level) })),
    memoryStyle: m.memoryStyle,
    memoryStrength: m.memoryStrength, lightContrast: m.lightContrast, lightBlur: m.lightBlur,
    bloodyTokens: m.bloodyTokens, turnMarkerScope: m.turnMarkerScope, turnMarkerView: m.turnMarkerView,
    turnMarkerStyle: m.turnMarkerStyle, tokenBadgeScale: m.tokenBadgeScale,
    enclosedDark: m.enclosedDark, worldShadowDir: m.worldShadowDir, worldShadowStrength: m.worldShadowStrength,
  };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  if (multi) patch.levels = oldLevels;
  A.updateMap(newMapId, patch);
  // Activate the new map FIRST so creationLevel() targets it, then remap every
  // entity onto a level the new map actually has (the cause of "walls/lights
  // didn't carry over" was entities keeping the OLD map's level id → filtered out).
  A.setActiveMap(newMapId);
  const strip = (e) => { const c = { ...e }; delete c.id; delete c.mapId; c.level = remapLevel(c.level); return c; };
  if ((snap.walls || []).length) A.addWalls(newMapId, snap.walls.map(strip));
  if ((snap.lights || []).length) A.addLights(newMapId, snap.lights.map(strip));
  for (const z of (snap.zones || [])) A.addZone({ ...strip(z), mapId: newMapId });
  for (const t of (snap.transitions || [])) A.addTransition({ ...strip(t), mapId: newMapId });
  return newMapId;
}
