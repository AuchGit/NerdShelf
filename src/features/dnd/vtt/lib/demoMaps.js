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
  // Save the WHOLE map object minus identity/image fields — data-driven, so any
  // map setting added in the future rides along automatically instead of being
  // forgotten in a hand-maintained field list.
  const { id: _id, imagePath: _ip, imageUrl: _iu, imageUrlFull: _iuf, imageFullName: _ifn, ...mapSettings } = map;
  void _id; void _ip; void _iu; void _iuf; void _ifn;
  const snapshot = {
    map: mapSettings,
    walls: onMap(s.walls), lights: onMap(s.lights), zones: onMap(s.zones), transitions: onMap(s.transitions),
  };
  const row = { id: rid('shared_'), name: clean, image_path: map.imagePath || null, width: map.width, height: map.height, grid: map.grid, snapshot, created_by: s.session.userId };
  const { error } = await supabase.from('vtt_demo_maps').insert(row);
  if (error) throw error;
  return row.id;
}

// Delete an own shared map (RLS restricts deletion to created_by = auth.uid(),
// so only the uploader succeeds — the UI additionally only shows the button to
// them). Throws on error.
export async function deleteSharedMap(id) {
  const { error } = await supabase.from('vtt_demo_maps').delete().eq('id', id);
  if (error) throw error;
}

// Create a fresh copy of a shared map in the current campaign (new ids).
// ALL map settings from the snapshot ride along (data-driven spread); only
// identity/image/levels are rebuilt. Everything lands in ONE map/add op —
// a follow-up updateMap raced the INSERT over HTTP and silently hit 0 rows,
// which is why terrain & friends kept "vanishing" after a reload.
export function loadDemoIntoCampaign(demo) {
  const snap = demo.snapshot || {};
  const m = snap.map || {};
  // Multi-level maps keep their original level objects (so entity level-ids
  // still match); single-level snapshots get a fresh base level.
  const oldLevels = Array.isArray(m.levels) ? m.levels : [];
  const multi = oldLevels.length > 1;
  const newLevels = multi ? oldLevels : [{ id: rid('lvl_'), name: oldLevels[0]?.name || 'Ebene 1' }];
  const newBase = newLevels[0].id;
  // terrain/darkness entries carry a `level` id of the ORIGINAL map — kept
  // verbatim they point at a level the new map doesn't have and get filtered
  // out everywhere. Same remap the walls/lights below always got.
  const remapLevel = (lvl) => (multi && lvl ? lvl : newBase);
  const { id: _x, name: _n, imagePath: _a, imageUrl: _b, imageUrlFull: _c, imageFullName: _d, width: _w, height: _h, levels: _l, grid: mGrid, terrain, darkness, ...rest } = m;
  void _x; void _n; void _a; void _b; void _c; void _d; void _w; void _h; void _l;
  const newMapId = A.addMap({
    name: `${demo.name || m.name || 'Demo'} (Kopie)`,
    imagePath: demo.image_path || null,
    imageUrl: demoPublicUrl(demo.image_path),
    width: demo.width || m.width || 0,
    height: demo.height || m.height || 0,
    grid: mGrid || demo.grid || {},
    extra: {
      ...rest, // every other map setting, incl. future ones
      levels: newLevels,
      terrain: (terrain || []).map((t) => ({ ...t, level: remapLevel(t.level) })),
      darkness: (darkness || []).map((dd) => ({ ...dd, level: remapLevel(dd.level) })),
    },
  });
  A.setActiveMap(newMapId);
  // Entities reference the map row via FK — give the map INSERT a head start so
  // the entity upserts can't arrive first and fail silently.
  const strip = (e) => { const c = { ...e }; delete c.id; delete c.mapId; c.level = remapLevel(c.level); return c; };
  setTimeout(() => {
    if (getState().maps[newMapId] == null) return; // map deleted meanwhile
    if ((snap.walls || []).length) A.addWalls(newMapId, snap.walls.map(strip));
    if ((snap.lights || []).length) A.addLights(newMapId, snap.lights.map(strip));
    for (const z of (snap.zones || [])) A.addZone({ ...strip(z), mapId: newMapId });
    for (const t of (snap.transitions || [])) A.addTransition({ ...strip(t), mapId: newMapId });
  }, 400);
  return newMapId;
}
