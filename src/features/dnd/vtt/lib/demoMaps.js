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
  const patch = {
    fogMode: m.fogMode, lightingEnabled: m.lightingEnabled, lightStyle: m.lightStyle, lightBaseline: m.lightBaseline,
    darkness: m.darkness || [], terrain: m.terrain || [], memoryStyle: m.memoryStyle,
    memoryStrength: m.memoryStrength, lightContrast: m.lightContrast, lightBlur: m.lightBlur,
    bloodyTokens: m.bloodyTokens, turnMarkerScope: m.turnMarkerScope, turnMarkerView: m.turnMarkerView,
    turnMarkerStyle: m.turnMarkerStyle, tokenBadgeScale: m.tokenBadgeScale,
  };
  // Drop undefined keys so we don't overwrite fresh-map defaults with nulls.
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  if (Array.isArray(m.levels) && m.levels.length) patch.levels = m.levels;
  A.updateMap(newMapId, patch);
  const strip = (e) => { const c = { ...e }; delete c.id; delete c.mapId; return c; };
  if ((snap.walls || []).length) A.addWalls(newMapId, snap.walls.map(strip));
  if ((snap.lights || []).length) A.addLights(newMapId, snap.lights.map(strip));
  for (const z of (snap.zones || [])) A.addZone({ ...strip(z), mapId: newMapId });
  for (const t of (snap.transitions || [])) A.addTransition({ ...strip(t), mapId: newMapId });
  A.setActiveMap(newMapId);
  return newMapId;
}
