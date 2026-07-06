// SupabaseAdapter — real-time + persistence for the VTT, campaign-scoped.
//
// Implements the SyncAdapter contract (see SyncAdapter.js): the store calls
// send(op) for every local mutation and applies inbound ops from onMessage().
//
// Path layering (same idea as MTG's useMatchSession):
//   1. local optimistic apply (store, before send)
//   2. broadcast the op on the campaign channel — instant peer sync
//   3. durable DB write (debounced for hot token drags)
//   4. postgres_changes — backstop that converges anything a broadcast missed
//   5. snapshot hydrate on connect (late joiners get current state from the DB)
//
// Column mapping: store ops use camelCase + text ids; the DB uses snake_case
// (see scripts/vtt-schema.sql). Maps store an `image_path` in Storage; clients
// get a public URL.

import { toast } from '../lib/toast';

const BUCKET = 'vtt-maps';
const MOVE_DEBOUNCE_MS = 250;
const LOCAL_ONLY = (t) => !t || t.startsWith('ui/') || t === '__reqState' || t === '__snapshot' || t === 'session/set' || t === 'ruler/set' || t.startsWith('ping/');

export class SupabaseAdapter {
  constructor({ supabase, campaignId, userId }) {
    this.sb = supabase;
    this.campaignId = campaignId;
    this.userId = userId;
    this.handler = null;
    this.channel = null;
    this.senderId = `${userId}:${Math.random().toString(36).slice(2)}`;
    this._moveTimers = new Map(); // tokenId -> timeout (debounced position writes)
  }

  onMessage(fn) { this.handler = fn; }

  publicUrl(path) {
    if (!path) return null;
    return this.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async connect() {
    const snapshot = await this.fetchSnapshot();
    this.handler?.({ type: '__snapshot', snapshot });

    const cid = this.campaignId;
    this.channel = this.sb
      .channel(`vtt:${cid}`, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'op' }, ({ payload }) => {
        if (payload?.senderId === this.senderId) return; // ignore our echo
        if (payload?.op) this.handler?.(payload.op);
      });

    // postgres_changes backstop for every table (converges missed broadcasts)
    const tables = ['vtt_tokens', 'vtt_walls', 'vtt_zones', 'vtt_transitions', 'vtt_lights', 'vtt_maps', 'vtt_fog', 'vtt_campaign_state'];
    for (const table of tables) {
      this.channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `campaign_id=eq.${cid}` },
        (e) => { const op = this.rowEventToOp(table, e); if (op) this.handler?.(op); });
    }
    // The first fetchSnapshot() can race an unready session/auth/RLS on VTT entry
    // and come back empty (blank map + tokens until a manual F5). Once the
    // realtime channel is actually LIVE, re-fetch ONCE to converge — the DB is the
    // source of truth at load, and hydrate replaces state idempotently.
    this._converged = false;
    this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !this._converged) {
        this._converged = true;
        this.fetchSnapshot()
          .then((s) => this.handler?.({ type: '__snapshot', snapshot: s }))
          .catch(() => { /* backstop + next op will still converge */ });
      }
    });
  }

  send(op) {
    if (LOCAL_ONLY(op.type)) return;
    // 2) broadcast immediately
    this.channel?.send({ type: 'broadcast', event: 'op', payload: { senderId: this.senderId, op } });
    // 3) durable write (token drags debounced)
    if (op.type === 'token/move') this.debouncedMove(op);
    else {
      this.persist(op)
        .then((res) => { if (res?.error) { console.warn('[vtt] persist error', op.type, res.error.message); toast(`Änderung nicht gespeichert (${op.type}) — ${res.error.message}`); } })
        .catch((err) => { console.warn('[vtt] persist failed', op.type, err?.message); toast(`Änderung nicht gespeichert (${op.type})`); });
    }
  }

  debouncedMove(op) {
    clearTimeout(this._moveTimers.get(op.id));
    this._moveTimers.set(op.id, setTimeout(() => {
      this._moveTimers.delete(op.id);
      this.sb.from('vtt_tokens').update({ x: op.x, y: op.y }).eq('id', op.id)
        .then(({ error }) => error && console.warn('[vtt] move write', error.message));
    }, MOVE_DEBOUNCE_MS));
  }

  async persist(op) {
    const sb = this.sb, cid = this.campaignId;
    switch (op.type) {
      case 'map/add':       return upsertMapResilient(sb, mapToRow(op.map, cid)).then((r) => (r.ok ? {} : { error: r.error }));
      case 'map/update':    return sb.from('vtt_maps').update(mapPatchToRow(op.patch)).eq('id', op.id);
      case 'map/setGrid':   return sb.from('vtt_maps').update({ grid: op.grid }).eq('id', op.mapId);
      case 'map/remove':    return sb.from('vtt_maps').delete().eq('id', op.id); // FK cascade clears children
      case 'map/setActive': return sb.from('vtt_campaign_state').upsert({ campaign_id: cid, active_map_id: op.mapId });

      case 'token/add':     return sb.from('vtt_tokens').upsert(tokenToRow(op.token, cid));
      case 'token/update':  return sb.from('vtt_tokens').update(tokenPatchToRow(op.patch)).eq('id', op.id);
      case 'token/remove':  return sb.from('vtt_tokens').delete().eq('id', op.id);

      case 'zone/add':      return sb.from('vtt_zones').upsert(zoneToRow(op.zone, cid));
      case 'zone/update':   return sb.from('vtt_zones').update(zonePatchToRow(op.patch)).eq('id', op.id);
      case 'zone/remove':   return sb.from('vtt_zones').delete().eq('id', op.id);

      case 'wall/add':      return sb.from('vtt_walls').upsert(wallToRow(op.wall, cid));
      case 'wall/addMany':  return sb.from('vtt_walls').upsert(op.walls.map((w) => wallToRow(w, cid)));
      case 'wall/update':   return sb.from('vtt_walls').update(wallPatchToRow(op.patch)).eq('id', op.id);
      case 'wall/remove':   return sb.from('vtt_walls').delete().eq('id', op.id);

      case 'transition/add':    return sb.from('vtt_transitions').upsert(transitionToRow(op.transition, cid));
      case 'transition/update': return sb.from('vtt_transitions').update(transitionPatchToRow(op.patch)).eq('id', op.id);
      case 'transition/remove': return sb.from('vtt_transitions').delete().eq('id', op.id);

      case 'light/add':     return sb.from('vtt_lights').upsert(lightToRow(op.light, cid));
      case 'light/addMany': return sb.from('vtt_lights').upsert(op.lights.map((l) => lightToRow(l, cid)));
      case 'light/update':  return sb.from('vtt_lights').update(lightPatchToRow(op.patch)).eq('id', op.id);
      case 'light/remove':  return sb.from('vtt_lights').delete().eq('id', op.id);

      case 'fog/reveal':    return sb.from('vtt_fog').insert({ id: 'fog_' + Math.random().toString(36).slice(2), campaign_id: cid, map_id: op.mapId, polygon: op.polygon, mode: 'reveal' });
      case 'fog/hide':      return sb.from('vtt_fog').insert({ id: 'fog_' + Math.random().toString(36).slice(2), campaign_id: cid, map_id: op.mapId, polygon: op.polygon, mode: 'hide' });
      case 'fog/reset':     return sb.from('vtt_fog').delete().eq('map_id', op.mapId);

      case 'initiative/set': return sb.from('vtt_campaign_state').upsert({ campaign_id: cid, initiative: op.initiative });
      case 'journal/set':    return sb.from('vtt_campaign_state').upsert({ campaign_id: cid, journal: op.journal });
      case 'handout/present': return sb.from('vtt_campaign_state').upsert({ campaign_id: cid, presented_handout: op.id });
      case 'session/pause':  return sb.from('vtt_campaign_state').upsert({ campaign_id: cid, paused: op.paused });
      default: return Promise.resolve();
    }
  }

  async fetchSnapshot() {
    const sb = this.sb, cid = this.campaignId;
    const eq = (t) => sb.from(t).select('*').eq('campaign_id', cid);
    const [maps, tokens, zones, walls, transitions, lights, fog, meta] = await Promise.all([
      eq('vtt_maps'), eq('vtt_tokens'), eq('vtt_zones'), eq('vtt_walls'), eq('vtt_transitions'), eq('vtt_lights'), eq('vtt_fog'),
      sb.from('vtt_campaign_state').select('*').eq('campaign_id', cid).maybeSingle(),
    ]);
    const errs = [maps, tokens, zones, walls, transitions, lights, fog, meta].filter((r) => r.error);
    if (errs.length) {
      console.warn('[vtt] snapshot load errors:', errs.map((r) => r.error.message).join('; '));
      toast('Kampagnen-Daten unvollständig geladen — wird automatisch erneut versucht', 'warning');
    }
    return {
      maps: keyBy((maps.data || []).map((r) => this.rowToMap(r))),
      tokens: keyBy((tokens.data || []).map(rowToToken)),
      zones: keyBy((zones.data || []).map(rowToZone)),
      walls: keyBy((walls.data || []).map(rowToWall)),
      transitions: keyBy((transitions.data || []).map(rowToTransition)),
      lights: keyBy((lights.data || []).map(rowToLight)),
      fog: foldFog(fog.data || []),
      activeMapId: meta.data?.active_map_id || null,
      initiative: meta.data?.initiative || undefined,
      journal: meta.data?.journal || [],
      presentedHandout: meta.data?.presented_handout || null,
      paused: !!meta.data?.paused,
      announcedRelayUrl: meta.data?.relay_url || null,
    };
  }

  // postgres_changes row event → store op (for the backstop path).
  rowEventToOp(table, e) {
    const del = e.eventType === 'DELETE';
    const row = del ? e.old : e.new;
    if (!row) return null;
    switch (table) {
      case 'vtt_tokens':      return del ? { type: 'token/remove', id: row.id } : { type: 'token/add', token: rowToToken(row) };
      case 'vtt_walls':       return del ? { type: 'wall/remove', id: row.id } : { type: 'wall/add', wall: rowToWall(row) };
      case 'vtt_zones':       return del ? { type: 'zone/remove', id: row.id } : { type: 'zone/add', zone: rowToZone(row) };
      case 'vtt_transitions': return del ? { type: 'transition/remove', id: row.id } : { type: 'transition/add', transition: rowToTransition(row) };
      case 'vtt_lights':      return del ? { type: 'light/remove', id: row.id } : { type: 'light/add', light: rowToLight(row) };
      case 'vtt_maps':        return del ? { type: 'map/remove', id: row.id } : { type: 'map/add', map: this.rowToMap(row) };
      case 'vtt_fog':         return del ? { type: 'fog/reset', mapId: row.map_id } : { type: row.mode === 'hide' ? 'fog/hide' : 'fog/reveal', mapId: row.map_id, polygon: row.polygon };
      case 'vtt_campaign_state':
        if (del) return null;
        if (row.active_map_id) this.handler?.({ type: 'map/setActive', mapId: row.active_map_id });
        if (row.journal) this.handler?.({ type: 'journal/set', journal: row.journal });
        this.handler?.({ type: 'handout/present', id: row.presented_handout || null });
        this.handler?.({ type: 'session/pause', paused: !!row.paused });
        this.handler?.({ type: 'relay/announce', url: row.relay_url || null });
        return row.initiative ? { type: 'initiative/set', initiative: row.initiative } : null;
      default: return null;
    }
  }

  rowToMap(r) {
    return {
      id: r.id, name: r.name, imageUrl: this.publicUrl(r.image_path), imagePath: r.image_path,
      width: r.width, height: r.height, grid: r.grid, fogMode: r.fog_mode,
      levels: r.levels || [], playerVisible: r.player_visible,
      lightingEnabled: r.lighting_enabled !== false,
      lightStyle: r.light_style || 'modern',
      lightBaseline: r.light_baseline || 'bright',
      enclosedDark: r.enclosed_dark === true,
      worldShadowDir: r.world_shadow_dir ?? 135,
      worldShadowStrength: r.world_shadow_strength ?? 0,
      darkness: r.darkness || [],
      terrain: r.terrain || [],
      memoryStyle: r.memory_style || 'darkened',
      memoryStrength: r.memory_strength ?? 0.55,
      lightContrast: r.light_contrast ?? 0.5,
      lightBlur: r.light_blur ?? 0,
      bloodyTokens: r.bloody_tokens === true,
      turnMarkerScope: r.turn_marker_scope || 'all',
      turnMarkerView: r.turn_marker_view || 'all',
      turnMarkerStyle: r.turn_marker_style || 'ring',
      tokenBadgeScale: r.token_badge_scale ?? 1,
      imageUrlFull: r.image_url_full || null,
      imageFullName: r.image_full_name || null,
    };
  }

  disconnect() {
    for (const t of this._moveTimers.values()) clearTimeout(t);
    if (this.channel) this.sb.removeChannel(this.channel);
  }
}

// ── op → row (camelCase → snake_case) ──
// Maps sind seltene, wichtige Kampagnen-Assets — sie dürfen NICHT nur in einem
// flüchtigen Relay-Snapshot leben (ein schnelles Schließen nach dem Import
// verlor sie). Dieser Helfer schreibt die Map-Zeile DURABEL nach Supabase
// (await + Retry), unabhängig vom Live-Transport. Beim nächsten Öffnen lädt
// der Supabase-Snapshot die Map garantiert.
// Fehlt in der Fehlermeldung eine Spalte (nicht migrierte DB), wird genau die
// aus der Zeile entfernt und erneut versucht — so persistiert die Map auch
// ohne die neuesten Migrations-Spalten (nur die betroffene Funktion, z.B. der
// Full-Res-Original-Link, fehlt dann bis zur Migration).
const MISSING_COL_RE = /Could not find the '([^']+)' column/i;
export async function upsertMapResilient(supabase, row) {
  const r = { ...row };
  for (let attempt = 0; attempt < 6; attempt++) {
    const { error } = await supabase.from('vtt_maps').upsert(r);
    if (!error) return { ok: true, dropped: Object.keys(row).filter((k) => !(k in r)) };
    const m = MISSING_COL_RE.exec(error.message || '');
    if (m && m[1] in r) { delete r[m[1]]; continue; } // Spalte weglassen, nochmal
    return { ok: false, error };
  }
  return { ok: false, error: new Error('zu viele fehlende Spalten') };
}

export async function saveMapRowDurable(supabase, map, campaignId) {
  const row = mapToRow(map, campaignId);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await upsertMapResilient(supabase, row);
      if (res.ok) {
        if (res.dropped?.length) toast(`Map gespeichert — Supabase-Migration fehlt (Spalten: ${res.dropped.join(', ')}). scripts/vtt-schema.sql ausführen für Voll-Auflösung/Direktverbindung.`, 'warning');
        else console.log('[vtt] Map durabel in Supabase gespeichert:', map.id, map.name);
        return true;
      }
      lastErr = res.error;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  toast(`Map „${map.name}" konnte nicht dauerhaft gespeichert werden: ${lastErr?.message || lastErr}`, 'error');
  return false;
}

function mapToRow(m, cid) {
  return { id: m.id, campaign_id: cid, name: m.name, image_path: m.imagePath || null,
    width: m.width, height: m.height, grid: m.grid, fog_mode: m.fogMode || 'none',
    levels: m.levels || [], player_visible: !!m.playerVisible, lighting_enabled: m.lightingEnabled !== false, light_style: m.lightStyle || 'modern',
    light_baseline: m.lightBaseline || 'bright', enclosed_dark: m.enclosedDark === true, world_shadow_dir: m.worldShadowDir ?? 135, world_shadow_strength: m.worldShadowStrength ?? 0, darkness: m.darkness || [], terrain: m.terrain || [],
    memory_style: m.memoryStyle || 'darkened', memory_strength: m.memoryStrength ?? 0.55,
    light_contrast: m.lightContrast ?? 0.5, light_blur: m.lightBlur ?? 0, bloody_tokens: m.bloodyTokens === true,
    turn_marker_scope: m.turnMarkerScope || 'all', turn_marker_view: m.turnMarkerView || 'all', turn_marker_style: m.turnMarkerStyle || 'ring', token_badge_scale: m.tokenBadgeScale ?? 1,
    image_url_full: m.imageUrlFull || null, image_full_name: m.imageFullName || null };
}
function mapPatchToRow(p) {
  const r = {};
  if ('name' in p) r.name = p.name;
  if ('fogMode' in p) r.fog_mode = p.fogMode;
  if ('levels' in p) r.levels = p.levels;
  if ('playerVisible' in p) r.player_visible = p.playerVisible;
  if ('lightingEnabled' in p) r.lighting_enabled = p.lightingEnabled;
  if ('lightStyle' in p) r.light_style = p.lightStyle;
  if ('lightBaseline' in p) r.light_baseline = p.lightBaseline;
  if ('enclosedDark' in p) r.enclosed_dark = p.enclosedDark;
  if ('worldShadowDir' in p) r.world_shadow_dir = p.worldShadowDir;
  if ('worldShadowStrength' in p) r.world_shadow_strength = p.worldShadowStrength;
  if ('darkness' in p) r.darkness = p.darkness;
  if ('terrain' in p) r.terrain = p.terrain;
  if ('memoryStyle' in p) r.memory_style = p.memoryStyle;
  if ('memoryStrength' in p) r.memory_strength = p.memoryStrength;
  if ('lightContrast' in p) r.light_contrast = p.lightContrast;
  if ('lightBlur' in p) r.light_blur = p.lightBlur;
  if ('bloodyTokens' in p) r.bloody_tokens = p.bloodyTokens;
  if ('turnMarkerScope' in p) r.turn_marker_scope = p.turnMarkerScope;
  if ('turnMarkerView' in p) r.turn_marker_view = p.turnMarkerView;
  if ('turnMarkerStyle' in p) r.turn_marker_style = p.turnMarkerStyle;
  if ('tokenBadgeScale' in p) r.token_badge_scale = p.tokenBadgeScale;
  if ('imageUrlFull' in p) r.image_url_full = p.imageUrlFull;
  if ('imageFullName' in p) r.image_full_name = p.imageFullName;
  if ('grid' in p) r.grid = p.grid;
  if ('imagePath' in p) r.image_path = p.imagePath;
  return r;
}
function tokenToRow(t, cid) {
  return { id: t.id, campaign_id: cid, map_id: t.mapId, level: t.level || null, kind: t.kind,
    owner_user_id: t.ownerId || null, character_id: t.characterId || null, name: t.name,
    image_url: t.imageUrl || null, color: t.color, x: t.x, y: t.y, size_cells: t.sizeCells,
    hp: t.hp ?? null, hp_max: t.hpMax ?? null, ac: t.ac ?? null, conditions: t.conditions || [], light: t.light || null, statblock: t.statblock || null, visible_to: t.visibleTo || [], auras: t.auras || [], sight_reset_at: t.sightResetAt ?? null, inside: t.inside ?? null, controllers: t.controllers || [], bloodied: t.bloodied ?? null };
}
function tokenPatchToRow(p) {
  const map = { mapId: 'map_id', ownerId: 'owner_user_id', characterId: 'character_id', imageUrl: 'image_url', sizeCells: 'size_cells', hpMax: 'hp_max', visibleTo: 'visible_to', sightResetAt: 'sight_reset_at' };
  const r = {};
  for (const k in p) r[map[k] || k] = p[k];
  return r;
}
function zoneToRow(z, cid) {
  return { id: z.id, campaign_id: cid, map_id: z.mapId, level: z.level || null, created_by: z.createdBy || null,
    type: z.type, x: z.x, y: z.y, params: z.params || {}, color: z.color, opacity: z.opacity, los_walls: z.losWalls !== false };
}
function zonePatchToRow(p) {
  const map = { mapId: 'map_id', createdBy: 'created_by', losWalls: 'los_walls' };
  const r = {}; for (const k in p) r[map[k] || k] = p[k]; return r;
}
function wallToRow(w, cid) {
  return { id: w.id, campaign_id: cid, map_id: w.mapId, level: w.level || null, a: w.a, b: w.b, kind: w.kind, open: !!w.open, see_out_ft: w.seeOutFt ?? null, height_ft: w.heightFt ?? null, no_roof: !!w.noRoof, see_through: !!w.seeThrough, milky: !!w.milky, color: w.color || null, width_cells: w.widthCells ?? null };
}
function wallPatchToRow(p) {
  const map = { mapId: 'map_id', seeOutFt: 'see_out_ft', heightFt: 'height_ft', noRoof: 'no_roof', seeThrough: 'see_through', widthCells: 'width_cells' };
  const r = {}; for (const k in p) r[map[k] || k] = p[k]; return r;
}
function transitionToRow(t, cid) {
  return { id: t.id, campaign_id: cid, map_id: t.mapId, level: t.level || null, col: t.col, row: t.row, kind: t.kind, exits: t.exits || [], name: t.name || null };
}
function transitionPatchToRow(p) {
  const map = { mapId: 'map_id' };
  const r = {}; for (const k in p) r[map[k] || k] = p[k]; return r;
}
function lightToRow(l, cid) {
  return { id: l.id, campaign_id: cid, map_id: l.mapId, level: l.level || null,
    x: l.x, y: l.y, bright_ft: l.brightFt, dim_ft: l.dimFt, color: l.color, enabled: l.enabled !== false, height_ft: l.heightFt ?? null, player_switch: !!l.playerSwitch, icon: l.icon || null };
}
function lightPatchToRow(p) {
  const map = { mapId: 'map_id', brightFt: 'bright_ft', dimFt: 'dim_ft', heightFt: 'height_ft', playerSwitch: 'player_switch' };
  const r = {}; for (const k in p) r[map[k] || k] = p[k]; return r;
}

// ── row → store object (snake_case → camelCase) ──
function rowToToken(r) {
  return { id: r.id, mapId: r.map_id, level: r.level, kind: r.kind, ownerId: r.owner_user_id,
    characterId: r.character_id, name: r.name, imageUrl: r.image_url, color: r.color,
    x: r.x, y: r.y, sizeCells: r.size_cells, hp: r.hp, hpMax: r.hp_max, ac: r.ac, conditions: r.conditions || [], light: r.light || null, statblock: r.statblock || null, visibleTo: r.visible_to || [], auras: r.auras || [], sightResetAt: r.sight_reset_at || 0, inside: r.inside ?? undefined, controllers: r.controllers || [], bloodied: r.bloodied ?? undefined };
}
function rowToZone(r) {
  return { id: r.id, mapId: r.map_id, level: r.level, createdBy: r.created_by, type: r.type,
    x: r.x, y: r.y, params: r.params || {}, color: r.color, opacity: r.opacity, losWalls: r.los_walls !== false };
}
function rowToWall(r) {
  return { id: r.id, mapId: r.map_id, level: r.level, a: r.a, b: r.b, kind: r.kind, open: r.open, seeOutFt: r.see_out_ft ?? null, heightFt: r.height_ft ?? null, noRoof: r.no_roof === true, seeThrough: r.see_through === true, milky: r.milky === true, color: r.color || null, widthCells: r.width_cells ?? null };
}
function rowToTransition(r) {
  return { id: r.id, mapId: r.map_id, level: r.level, col: r.col, row: r.row, kind: r.kind, exits: r.exits || [], name: r.name || '' };
}
function rowToLight(r) {
  return { id: r.id, mapId: r.map_id, level: r.level, x: r.x, y: r.y,
    brightFt: r.bright_ft, dimFt: r.dim_ft, color: r.color, enabled: r.enabled !== false, heightFt: r.height_ft ?? null, playerSwitch: r.player_switch === true, icon: r.icon || null };
}

function keyBy(arr) { const o = {}; for (const e of arr) o[e.id] = e; return o; }
function foldFog(rows) {
  const out = {};
  // Replay in insertion order so reveal/hide overrides are preserved on reload.
  const sorted = [...rows].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  for (const r of sorted) {
    (out[r.map_id] ??= { stamps: [] }).stamps.push({ poly: r.polygon, mode: r.mode === 'hide' ? 'hide' : 'reveal' });
  }
  return out;
}
