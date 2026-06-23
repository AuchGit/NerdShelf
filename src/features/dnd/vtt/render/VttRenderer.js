// VttRenderer — the imperative bridge between the store and PixiJS.
//
// Owns: one Pixi Application's stage content, the `world` container (pan/zoom
// target), the map background sprite, and every layer. Subscribes to the store
// and reconciles on change. Handles all canvas input and translates it into
// store actions. React never touches the canvas; it only renders DOM UI.
//
// Layer order (bottom → top): background, grid, zones, fog, tokens, pings, ruler.
import { Container, Sprite, Texture, Graphics, Text, RenderTexture, ColorMatrixFilter } from 'pixi.js';
import { Viewport } from './viewport';
import { loadTexture, loadIcon } from './textures';
import { GridLayer } from './layers/gridLayer';
import { ZoneLayer } from './layers/zoneLayer';
import { FogLayer } from './layers/fogLayer';
import { TokenLayer } from './layers/tokenLayer';
import { PingLayer } from './layers/pingLayer';
import { RulerLayer } from './layers/rulerLayer';
import { WallsLayer } from './layers/wallsLayer';
import { TransitionsLayer } from './layers/transitionsLayer';
import { TerrainLayer } from './layers/terrainLayer';
import { LightLayer } from './layers/lightLayer';
import { getState, subscribe, undo } from '../state/store';
import * as A from '../state/actions';
import { snapToGrid, pointToCell, feetToPx, cellCenter } from '../lib/geometry';
import { segmentsIntersect, visibilityPolygon, pointInAnyPolygon } from '../lib/visibility';
import { WALL_TYPES, DEFAULT_COVER_SEE_OUT_FT } from '../lib/constants';
import { getMemoryStyle, getMemoryBrightness, getShowLightSwitches, getTerrainOpacity, getTerrainPattern, getTerrainColor, getClimbHeightStyle, VTT_PREFS_EVENT } from '../lib/vttPrefs';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';

// Wall blocking, accounting for doors: an open door blocks neither.
const wallBlocksLight = (w) => !(w.kind === 'door' && w.open) && (WALL_TYPES[w.kind] || WALL_TYPES.both).blocksLight;
const wallBlocksMovement = (w) => !(w.kind === 'door' && w.open) && (WALL_TYPES[w.kind] || WALL_TYPES.both).blocksMovement;
// Sight ≠ light: a "shadow" wall blocks light but you can still SEE past it, so
// player vision uses this (not the light-blocking set).
const wallBlocksSight = (w) => !(w.kind === 'door' && w.open) && (WALL_TYPES[w.kind] || WALL_TYPES.both).blocksSight;

const DRAG_BROADCAST_MS = 50; // ~20 Hz peer updates while dragging (budget-aware)

export class VttRenderer {
  constructor(app, { onContextMenu, onTransitionPrompt, onTokenActivate } = {}) {
    this.app = app;
    this.onContextMenu = onContextMenu;
    this.onTransitionPrompt = onTransitionPrompt;
    this.onTokenActivate = onTokenActivate; // double-click → React (sheet/statblock)

    this.world = new Container();
    app.stage.addChild(this.world);
    this.viewport = new Viewport(this.world, app);

    this.bg = new Sprite();
    this.grid = new GridLayer();
    this.zones = new ZoneLayer();
    this.fog = new FogLayer(app);
    this.tokens = new TokenLayer();
    this.walls = new WallsLayer();
    this.transitions = new TransitionsLayer();
    this.terrain = new TerrainLayer();
    this.lights = new LightLayer();
    this.auras = new Container(); // colored ft range circles around tokens
    this.auras.eventMode = 'none';
    this.pings = new PingLayer();
    this.ruler = new RulerLayer();
    this.marqueeGfx = new Graphics();
    this.marqueeGfx.eventMode = 'none';
    this.brushGfx = new Graphics(); // fog brush cursor preview
    this.brushGfx.eventMode = 'none';
    this.lightMarkers = new Container(); // editable light handles (DM, light tool)
    this.flashGfx = new Graphics();
    this.flashGfx.eventMode = 'none';
    this.targetingGfx = new Graphics(); // range circle + target rings (P11)
    this.targetingGfx.eventMode = 'none';
    this.dragLabel = new Text({ text: '', style: { fill: '#fff', fontSize: 15, fontWeight: '700', stroke: { color: '#000', width: 4 } } });
    this.dragLabel.anchor.set(0.5, 1.6);
    this.dragLabel.visible = false;
    this.dragLabel.eventMode = 'none';
    this.flash = null; // { x, y, at }

    // --- Explored-memory compositor (player + dynamic fog) ---
    // bgGray:   desaturated map shown in explored-but-not-current areas.
    // ghosts:   gray "last seen" token markers in memory areas.
    // liveGroup: the full-colour live world (map/grid/zones/tokens), masked to
    //            the player's CURRENT vision so colour only shows where they
    //            can see right now. Everything else falls back to bgGray (gray
    //            memory) or the dark canvas (never seen).
    // bgGray = a container (mask = explored) holding the desaturated map + a
    // gray grid, so remembered areas look exactly like the live view (incl.
    // grid) but in true luminance grayscale.
    this.bgGrayMap = new Sprite();
    this._memFilter = new ColorMatrixFilter();
    this.bgGrayMap.filters = [this._memFilter];
    this.applyMemoryStyle();
    // Memory grid uses the SAME GridLayer rendering as the live grid, so the
    // explored-but-unseen grid looks exactly like the grid everywhere.
    this.bgGrayGrid = new GridLayer();
    this.bgGray = new Container();
    this.bgGray.addChild(this.bgGrayMap, this.bgGrayGrid.container);
    this.bgGray.visible = false;
    this.ghostLayer = new Container();
    this.ghostLayer.eventMode = 'none';
    this.currentMaskGfx = new Graphics(); // used as liveGroup mask (child of it)
    this.liveGroup = new Container();
    // Walls live INSIDE the live group so doors are masked by the player's
    // current vision (and shown to players); non-door walls stay DM-only via
    // per-node visibility in WallsLayer.
    // Walls/doors live ABOVE the fog (added to `world` below) so a door icon is
    // always fully drawn even where it pokes into fog of war.
    this.moveLayer = new Graphics(); // reachable-cells movement preview (on the floor)
    this.moveLayer.eventMode = 'none';
    this.liveGroup.addChild(this.bg, this.grid.container, this.zones.container, this.terrain.container, this.moveLayer, this.lights.container, this.auras, this.transitions.container, this.tokens.container, this.currentMaskGfx);

    this.lightSwitches = new Container(); // player-clickable light switches (everyone)
    this.lightSwitches.eventMode = 'static';
    this.world.addChild(
      this.bgGray, this.ghostLayer, this.liveGroup,
      this.fog.container, this.walls.container, this.lightMarkers, this.lightSwitches, this.pings.container, this.ruler.container,
      this.marqueeGfx, this.flashGfx, this.brushGfx, this.targetingGfx, this.dragLabel,
    );

    this.tokenMemory = {};      // tokenId -> {x,y,name,color} last-seen (per client)
    this._exploredRT = null;    // RenderTexture accumulating seen area for active map
    this._exploredFor = null;   // mapId the RT belongs to
    this._exploredSprite = null;

    this._bgUrl = null;
    this._fittedMapId = null;
    this.keys = { shift: false, space: false, alt: false, ctrl: false };
    this.drag = null;       // token drag state
    this.pan = null;        // panning state
    this.placing = null;    // zone/fog placement state
    this.zoneDrag = null;   // moving a selected zone
    this.handleDrag = null; // resizing/rotating a selected zone via a handle
    this.wallChain = null;  // in-progress chained wall
    this.wallHandleDrag = null; // dragging a selected wall's endpoint
    this.marquee = null;    // box multi-select
    this._lastBroadcast = 0;

    this.tokens.onTokenPointerDown = (id, e) => this.onTokenDown(id, e);
    this.tokens.onTokenRightClick = (id, e) => this.onTokenContext(id, e);
    this.tokens.onTokenDoubleClick = (id) => this.onTokenDoubleClick(id);
    this.zones.onZonePointerDown = (id, e) => this.onZoneDown(id, e);
    this.zones.onZoneHandle = (id, which, e) => this.onZoneHandleStart(id, which, e);
    this.walls.onWallPointerDown = (id, e) => this.onWallDown(id, e);
    this.walls.onWallHandle = (id, end, e) => this.onWallHandleStart(id, end, e);

    this.installInput();
    // Coalesce store changes into ONE reconcile per animation frame. A peer
    // dragging a token emits ~20 ops/sec; without this, every inbound op (× the
    // visibility-polygon recompute for all observers/lights) ran a full
    // reconcile. rAF batching caps that to ≤60 Hz regardless of op rate.
    this._rafId = 0;
    this.unsub = subscribe(() => this.scheduleReconcile());
    // React to VTT display-pref changes (memory style) live.
    this._onPrefs = () => { this.applyMemoryStyle(); this.reconcile(); };
    window.addEventListener(VTT_PREFS_EVENT, this._onPrefs);
    app.ticker.add(() => { const now = performance.now(); this.pings.tick(now); this.tickFlash(now); this.tickTween(now); });
    this.reconcile();
  }

  scheduleReconcile() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => { this._rafId = 0; this.reconcile(); });
  }

  destroy() {
    this.unsub?.();
    this.removeInput?.();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._onPrefs) window.removeEventListener(VTT_PREFS_EVENT, this._onPrefs);
  }

  // Memory (explored-but-unseen) look. `style` 'darkened' keeps colour but dims
  // it; 'grayscale' is true luminance B/W. `strength` (0..1) = how dark.
  // Map settings win; otherwise the per-client preference is the fallback.
  // Explored-memory look is a PERSONAL choice now: colour vs black-white +
  // a brightness slider. In colour mode the effective brightness is capped at
  // the DM's baseline map brightness (`baseline`), so memory never looks
  // brighter than the lit map. `baseline` defaults to the last map's value.
  applyMemoryStyle(baseline) {
    if (baseline) this._memBaseline = baseline;
    const st = getMemoryStyle() || 'grayscale';
    const bright = getMemoryBrightness(); // 0..1
    if (st === 'grayscale') {
      const g = Math.min(1, Math.max(0.06, bright));
      this._memFilter.matrix = [0.299 * g, 0.587 * g, 0.114 * g, 0, 0, 0.299 * g, 0.587 * g, 0.114 * g, 0, 0, 0.299 * g, 0.587 * g, 0.114 * g, 0, 0, 0, 0, 0, 1, 0];
    } else {
      const cap = this._memBaseline === 'dark' ? 0.3 : this._memBaseline === 'dim' ? 0.6 : 1;
      const b = Math.min(1, Math.max(0.05, bright * cap));
      this._memFilter.matrix = [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
    }
  }

  // ---- reconcile store → scene ----
  reconcile() {
    const s = getState();
    // Players may browse a DM-exposed map; the DM always views the active map.
    const viewId = (s.session.role !== 'dm' && s.ui.viewedMapId && s.maps[s.ui.viewedMapId]?.playerVisible)
      ? s.ui.viewedMapId : s.activeMapId;
    const map = viewId ? s.maps[viewId] : null;

    // End an in-progress wall chain if the DM switched tools.
    if (this.wallChain && s.ui.tool !== 'walls') this.finishWallChain();

    // background
    if (map?.imageUrl !== this._bgUrl) {
      this._bgUrl = map?.imageUrl || null;
      this._bgTries = 0;
      this.bg.texture = Texture.EMPTY;
      if (map?.imageUrl) {
        const want = map.imageUrl;
        loadTexture(want).then((tex) => {
          if (this._bgUrl !== want) return;
          if (tex) { this.bg.texture = tex; return; }
          // Failed (transient): retry after a short delay so the map image
          // appears without needing a full VTT restart (bounded attempts).
          if ((this._bgTries || 0) < 5) {
            this._bgTries = (this._bgTries || 0) + 1;
            setTimeout(() => { if (this._bgUrl === want) { this._bgUrl = null; this.scheduleReconcile?.(); } }, 700);
          }
        });
      }
    }
    this.bg.visible = !!map;

    if (map) {
      const isDM = s.session.role === 'dm';
      const mode = map.fogMode || (map.fogEnabled ? 'manual' : 'none');
      const base = map.levels?.[0]?.id || null;
      // Keep the DM's active level valid when maps change. activeLevel is a
      // single global UI value, but levels are per-map — switching to a map that
      // doesn't contain the current activeLevel (incl. a map with NO levels, base
      // = null) must reset it, otherwise the stale level filters out every token.
      if (isDM && s.ui.activeLevel && !(map.levels || []).some((l) => l.id === s.ui.activeLevel)) {
        A.setActiveLevel(base);
        return;
      }
      const level = this.displayedLevel(s, map, base); // the floor currently shown
      const onLevel = (e) => (e.level || base) === level;

      // Only entities on THIS map and the displayed level participate (tokens and
      // zones carry a mapId; without that filter a null-level token would leak
      // onto every other map that shares the same base level).
      const levelTokens = filterObj(s.tokens, (t) => t.mapId === map.id && onLevel(t));
      // Players don't see tokens with the 'invisible' condition unless the DM
      // explicitly granted them (token.visibleTo). The DM sees everything.
      const myId = s.session.userId;
      const invisibleHidden = isDM ? null : new Set(
        Object.values(levelTokens)
          .filter((t) => (t.conditions || []).includes('invisible') && !(t.visibleTo || []).includes(myId))
          .map((t) => t.id),
      );
      const levelZones = filterObj(s.zones, (z) => z.mapId === map.id && onLevel(z));
      const mapWalls = Object.values(s.walls).filter((w) => w.mapId === map.id && onLevel(w));
      const lightWalls = mapWalls.filter((w) => wallBlocksLight(w)); // cast shadows
      const sightWalls = mapWalls.filter((w) => wallBlocksSight(w)); // block vision
      const observers = this.fogObservers(s, map, level, base);

      const bounds = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
      const playerDynamic = mode === 'dynamic' && !isDM;
      // Walls that lie on a closed loop (non-bridge edges) = enclosing/roofed.
      const loopIds = loopWallIds(sightWalls);
      // Centroid of each see-through loop component (one-sided occlusion).
      const stCentroids = seeThroughCentroids(sightWalls);
      // Per-observer sight set:
      //  • a cover/bush wall is bypassed within its seeOutFt (peek out),
      //  • a low wall (heightFt>0) is seen over when the observer is elevated
      //    (climb terrain) to ≥ its height — UNLESS it encloses a roofed loop
      //    (a closed loop without `noRoof` stays opaque from above),
      //  • a "see-through" loop wall only blocks from its far side (the observer
      //    and the loop centre on the same side): from outside you see into the
      //    loop and the shadow falls only behind it; from inside it bounds normally.
      const sightWallsFor = (o) => {
        const H = terrainHeightAt(map, level, o.x, o.y);
        return sightWalls.filter((w) => {
          const def = WALL_TYPES[w.kind] || {};
          if (def.cover) {
            const reach = feetToPx(w.seeOutFt || DEFAULT_COVER_SEE_OUT_FT, map.grid.size);
            if (distPointToSeg(o, w.a, w.b) <= reach) return false;
          }
          if (w.heightFt > 0 && H >= w.heightFt && (w.noRoof || !loopIds.has(w.id))) return false;
          // one-sided see-through loop: drop the near wall (observer & loop centre
          // on opposite sides) so you look INTO the loop — unless this observer is
          // flagged as inside the loop (then it bounds them normally).
          if (w.seeThrough && stCentroids.has(w.id) && o.inside !== true && !sameSideOfSeg(o, stCentroids.get(w.id), w.a, w.b)) return false;
          return true;
        });
      };
      const visiblePolys = playerDynamic
        ? observers.map((o) => visibilityPolygon(o, sightWallsFor(o), bounds))
        : null;

      // DM "preview a token's sight": with dynamic fog and a selected token on
      // this level, the DM sees everything in grayscale except what that token
      // currently sees (in colour). Without a selection, the DM sees all colour.
      const previewTok = (isDM && mode === 'dynamic' && s.ui.selectedTokenId)
        ? levelTokens[s.ui.selectedTokenId] : null;
      const dmPreviewPolys = previewTok
        ? [visibilityPolygon({ x: previewTok.x, y: previewTok.y }, sightWallsFor(previewTok), bounds)] : null;

      // Light sources on this level: standalone lights + "luminous tokens"
      // (a token with a .light, positioned at the token). Glow + wall shadows.
      // The DM can switch dynamic light off per map (map.lightingEnabled).
      const lightSources = map.lightingEnabled === false ? [] : [
        ...Object.values(s.lights).filter((l) => l.mapId === map.id && onLevel(l)),
        ...Object.values(levelTokens)
          .filter((t) => t.light)
          .map((t) => {
            // Light radius is measured from the token's edge (its space), not
            // its center — add the token's half-footprint in feet.
            const halfFt = ((t.sizeCells || 1) * 5) / 2;
            // A luminous token's light sits at the token's elevation (climb
            // terrain) so it shines over lower walls when the token is raised.
            return { id: 'tl_' + t.id, x: t.x, y: t.y, ...t.light, brightFt: (t.light.brightFt || 0) + halfFt, dimFt: (t.light.dimFt || 0) + halfFt, heightFt: t.light.heightFt ?? terrainHeightAt(map, level, t.x, t.y) };
          }),
      ];
      // Baseline darkness + placed darkness regions only apply while dynamic
      // lighting is on; disabling lighting leaves the map fully lit.
      const lightingOn = map.lightingEnabled !== false;
      this.lights.update({
        renderer: this.app.renderer,
        sources: lightSources,
        grid: map.grid,
        walls: lightWalls,
        bounds,
        style: map.lightStyle || 'modern',
        baseline: lightingOn ? (map.lightBaseline || 'bright') : 'bright',
        darkness: lightingOn ? (map.darkness || []).filter((d) => (d.level || base) === level) : [],
        contrast: map.lightContrast ?? 0.5,
        blur: map.lightBlur ?? 0,
      });

      // Tool-gated visibility: walls / transitions only show to the DM while the
      // matching tool is active (doors are separate and always visible). Zones
      // (AoE shapes) are always visible to everyone.
      const tool = s.ui.tool;
      // "Wand erweitern": seed a fresh wall chain at the requested vertex so the
      // next click continues that wall.
      if (s.ui.pendingWallChain && tool === 'walls' && !this.wallChain) {
        const v = s.ui.pendingWallChain;
        this.wallChain = { start: v, last: v };
        this.walls.drawPreview(v, v, s.ui.wallKind);
        A.clearPendingWallChain();
      }
      // Explored door/transition memory: a player only sees a door/stairs once
      // its spot has been within their vision (accumulative; cleared on
      // sight-reset / map change in updateMemoryVision).
      if (!this._seenWalls) this._seenWalls = new Set();
      if (!this._seenTransitions) this._seenTransitions = new Set();
      let seenDoorIds = null; let seenTransIds = null;
      if (playerDynamic) {
        const polys = visiblePolys || [];
        const off = (map.grid.size || 70) * 0.2;
        for (const w of mapWalls) {
          if (w.kind !== 'door' && w.kind !== 'window') continue;
          // The door midpoint sits ON a wall = on the vision-polygon boundary
          // (which pointInPolygon excludes), so it would never count as "seen"
          // from the room it borders. Probe just to BOTH sides of the door along
          // its normal — if either side is visible, the player has seen the door.
          const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2;
          const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          if (pointInAnyPolygon(mx, my, polys)
            || pointInAnyPolygon(mx + nx * off, my + ny * off, polys)
            || pointInAnyPolygon(mx - nx * off, my - ny * off, polys)) this._seenWalls.add(w.id);
        }
        for (const tr of Object.values(s.transitions)) {
          if (tr.mapId !== map.id || (tr.level || base) !== level) continue;
          const c = cellCenter(tr.col, tr.row, map.grid);
          if (pointInAnyPolygon(c.x, c.y, polys)) this._seenTransitions.add(tr.id);
        }
        seenDoorIds = this._seenWalls; seenTransIds = this._seenTransitions;
      }
      this.grid.update(map);
      // Zones respect line-of-sight walls by default: clip each zone to the
      // visibility polygon from its origin (z.losWalls === false opts out).
      let zoneClips = null;
      for (const z of Object.values(levelZones)) {
        if (z.losWalls === false || z.preview) continue;
        if (!zoneClips) zoneClips = {};
        zoneClips[z.id] = visibilityPolygon({ x: z.x, y: z.y }, sightWalls, bounds);
      }
      this.zones.update(levelZones, map.grid, s.ui.selectedZoneId, zoneClips);
      this.walls.update(toObj(mapWalls), map.id, isDM, (s.ui.selectedWallIds && s.ui.selectedWallIds.length ? s.ui.selectedWallIds : s.ui.selectedWallId), map.grid.size, isDM && tool === 'walls', seenDoorIds);
      const terrObjs = (map.terrain || []).filter((t) => Array.isArray(t.cells) && (t.level || base) === level);
      this.terrain.update(terrObjs, map.grid, isDM, s.ui.selectedTerrainId, isDM && tool === 'terrain' ? (s.ui.terrainSelection || []) : [],
        isDM ? null : { opacity: getTerrainOpacity(), pattern: getTerrainPattern(), color: getTerrainColor(), climbHeightStyle: getClimbHeightStyle() });
      this.drawAuras(levelTokens, map.grid);
      const elevations = {};
      if ((map.terrain || []).some((t) => t.kind === 'climb')) {
        for (const tk of Object.values(levelTokens)) { const h = terrainHeightAt(map, level, tk.x, tk.y); if (h) elevations[tk.id] = h; }
      }
      // Both the marquee set AND the single click-selected token get the ring.
      const selectedTokenSet = [...(s.ui.selectedTokenIds || []), ...(s.ui.selectedTokenId ? [s.ui.selectedTokenId] : [])];
      // Combat turn markers (active + next-up token) + hovered-menu coupling.
      const init = s.initiative;
      const markers = { activeId: null, nextId: null, hoverId: s.ui.hoverTokenId || null };
      if (init?.active && init.order?.length) {
        markers.activeId = init.order[init.activeIndex]?.tokenId || null;
        markers.nextId = init.order[(init.activeIndex + 1) % init.order.length]?.tokenId || null;
      }
      this.tokens.update(levelTokens, map.grid, selectedTokenSet, this.drag?.id || this._tween?.id, invisibleHidden, isDM, myId, map.bloodyTokens === true, elevations, markers);
      this.updateMovementPreview(s, map, level, base, isDM);
      this.drawTargeting(levelTokens, map.grid);
      this.transitions.update(s.transitions, map.id, level, map.grid, isDM, s.ui.selectedTransitionId, seenTransIds);
      // Stairs/ladders are visible to everyone (players need to see where they
      // can travel). Editing — placing/selecting/connecting — stays DM-only and
      // is handled in onStageDown, gated to the transition tool.
      this.transitions.container.visible = true;
      const darkBrushTool = tool === 'light' && (s.ui.lightMode === 'darkness' || s.ui.lightMode === 'darkness-erase');
      if (tool !== 'fog' && !darkBrushTool) this.brushGfx.clear();
      // Editable light handles: DM + light tool only. Players/other tools see
      // only the glow (the LightLayer above), never the markers.
      if (isDM && tool === 'light') this.drawLightMarkers(map, level, base);
      else if (this.lightMarkers.visible) { this.lightMarkers.visible = false; this.lightMarkers.removeChildren().forEach((c) => c.destroy({ children: true })); }
      // Player-switchable light switches are visible & clickable for everyone.
      this.drawLightSwitches(map, level, base);
      this.pings.update(s.pings.filter((p) => p.mapId === map.id));
      this.ruler.update(s.ruler, map.grid, this.rulerMoveFt(s.ruler, map, level, base));

      // While the DM holds the fog tool, always show the manual fog mask in a
      // stark editing view (regardless of the map's fog mode) so painting is
      // visible — black = hidden, map shows through where revealed.
      const fogEditing = isDM && tool === 'fog';
      if (fogEditing) {
        this.disableMemoryVision();
        this.fog.update(map, s.fog[map.id], isDM, 'manual', null, true);
      } else if (playerDynamic && visiblePolys && visiblePolys.some((p) => p.length >= 3)) {
        // Compositor handles hiding (live group masked to current vision) +
        // darkened/grayscale memory of explored terrain + remembered ghosts.
        this.fog.hide();
        // Invisible tokens are excluded from memory/ghosts too (truly hidden).
        this.updateMemoryVision(map, visiblePolys, invisibleHidden ? filterObj(levelTokens, (t) => !invisibleHidden.has(t.id)) : levelTokens);
      } else if (playerDynamic) {
        // Dynamic fog but this viewer has NO vision source on this level (e.g.
        // a GM previewing the player view without a token here). Don't black the
        // whole map out — show it plainly instead of an empty vision mask.
        this.disableMemoryVision();
        this.fog.hide();
      } else if (dmPreviewPolys) {
        this.fog.hide();
        this.updateDmVision(map, dmPreviewPolys, levelTokens);
      } else {
        this.disableMemoryVision();
        this.fog.update(map, s.fog[map.id], isDM, mode, null);
      }

      // auto-fit when a new map becomes active
      if (this._fittedMapId !== map.id && map.width) {
        this.viewport.fit(map.width, map.height);
        this._fittedMapId = map.id;
      }
    }
  }

  // ---- explored-memory compositor (player + dynamic fog) ----
  updateMemoryVision(map, polys, tokens) {
    // DM "Sicht zurücksetzen": when one of THIS client's own tokens has a newer
    // sightResetAt, wipe the accumulated explored memory (forces a fresh RT).
    const myId = getState().session.userId;
    const myReset = Math.max(0, ...Object.values(tokens).filter((t) => t.ownerId === myId).map((t) => t.sightResetAt || 0));
    if (myReset > (this._sightEpoch || 0)) {
      this._sightEpoch = myReset;
      this._exploredFor = null; // invalidate → recreated empty below
      this.tokenMemory = {};
    }
    // (re)create the explored-accumulation RenderTexture per map
    if (this._exploredFor !== map.id || !this._exploredRT) {
      this._exploredRT?.destroy(true);
      this._exploredSprite?.destroy();
      this._exploredRT = RenderTexture.create({ width: map.width, height: map.height });
      this._exploredSprite = new Sprite(this._exploredRT);
      this.bgGray.addChild(this._exploredSprite); // mask lives under the masked sprite
      this._exploredFor = map.id;
      this.tokenMemory = {};
      // Forget explored doors/transitions too (sight-reset or new map).
      this._seenWalls?.clear();
      this._seenTransitions?.clear();
    }

    // accumulate current vision into the explored texture (never cleared)
    const acc = new Graphics();
    for (const poly of polys) if (poly.length >= 3) acc.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    if (polys.length) this.app.renderer.render({ container: acc, target: this._exploredRT, clear: false });
    acc.destroy();

    // Apply the DM's chosen memory look (map setting wins, else client pref).
    this.applyMemoryStyle(map.lightBaseline);
    // memory = the SAME view (map + grid), darkened/grayscaled, masked to
    // everything explored so far.
    this.bgGray.visible = true;
    if (this.bg.texture && this.bg.texture !== Texture.EMPTY) this.bgGrayMap.texture = this.bg.texture;
    this.drawGrayGrid(map);
    this.bgGray.mask = this._exploredSprite;

    // live colour world only within current vision (empty mask → nothing live)
    this.currentMaskGfx.clear();
    for (const poly of polys) if (poly.length >= 3) this.currentMaskGfx.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    this.liveGroup.mask = this.currentMaskGfx;

    // token memory: update last-seen for visible tokens; forget a remembered
    // spot once we look at it and the token isn't there.
    for (const t of Object.values(tokens)) {
      const vis = pointInAnyPolygon(t.x, t.y, polys);
      if (vis) this.tokenMemory[t.id] = { x: t.x, y: t.y, name: t.name, color: t.color, sizeCells: t.sizeCells, imageUrl: t.imageUrl };
      else {
        const mem = this.tokenMemory[t.id];
        if (mem && pointInAnyPolygon(mem.x, mem.y, polys)) delete this.tokenMemory[t.id];
      }
    }
    this.drawGhosts(map, polys, tokens);
  }

  // DM token-sight preview: the WHOLE map in grayscale, the selected token's
  // current vision in colour, and every out-of-sight token shown as a gray
  // marker at its real position (the DM still sees everything).
  updateDmVision(map, polys, tokens) {
    this.bgGray.visible = true;
    if (this.bg.texture && this.bg.texture !== Texture.EMPTY) this.bgGrayMap.texture = this.bg.texture;
    this.drawGrayGrid(map);
    this.bgGray.mask = null; // whole map is gray (DM sees all)

    this.currentMaskGfx.clear();
    for (const poly of polys) if (poly.length >= 3) this.currentMaskGfx.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    this.liveGroup.mask = this.currentMaskGfx;

    // gray markers for tokens outside the previewed vision (current positions)
    this.ghostLayer.visible = true;
    this.ghostLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const t of Object.values(tokens)) {
      if (pointInAnyPolygon(t.x, t.y, polys)) continue; // in colour view already
      const r = ((t.sizeCells || 1) * map.grid.size) / 2;
      const g = this.grayMarker(r, t.name, t.imageUrl);
      g.position.set(t.x, t.y);
      this.ghostLayer.addChild(g);
    }
  }

  // A "last seen / out of sight" marker: the token's PORTRAIT, processed to match
  // the map's memory style ('grayscale' → desaturated, 'darkened' → dimmed) so a
  // remembered token reads as a faded version of itself, not a bare letter. Falls
  // back to a tinted disc + initial only when the token has no image, and uses
  // the token colour (darkened) so it's still recognisable.
  grayMarker(r, name, imageUrl, color, style = 'darkened') {
    const g = new Container();
    const grayscale = style === 'grayscale';
    if (imageUrl) {
      const mask = new Graphics().circle(0, 0, r).fill(0xffffff);
      const ring = new Graphics().circle(0, 0, r).stroke({ width: 2, color: 0x99a0aa, alpha: 0.8 });
      const sp = new Sprite();
      sp.anchor.set(0.5);
      sp.mask = mask;
      const cm = new ColorMatrixFilter();
      if (grayscale) cm.desaturate(); else cm.brightness(0.45, false);
      sp.filters = [cm];
      g.addChild(mask, sp, ring);
      loadTexture(imageUrl).then((tex) => {
        if (!tex || sp.destroyed) return;
        sp.texture = tex;
        sp.scale.set((r * 2) / Math.min(tex.width || 1, tex.height || 1));
      });
    } else {
      // No image: darken the token's own colour so the ghost still reads as it.
      const base = grayscale ? 0x888888 : darkenColor(color || '#888888', 0.45);
      g.addChild(new Graphics().circle(0, 0, r).fill({ color: base, alpha: 0.92 }).stroke({ width: 2, color: 0x99a0aa, alpha: 0.8 }));
      const label = new Text({ text: (name || '?').slice(0, 1).toUpperCase(), style: { fill: '#dfe4ea', fontSize: r * 0.9, fontWeight: '700' } });
      label.anchor.set(0.5);
      g.addChild(label);
    }
    return g;
  }

  // Gray grid lines for the explored-memory layer (matches the live grid but
  // in monochrome, since memory is grayscale).
  drawGrayGrid(map) {
    // Identical to the live grid (same color/opacity/thickness/style).
    this.bgGrayGrid.update(map);
  }

  drawGhosts(map, polys, tokens) {
    this.ghostLayer.visible = true;
    this.ghostLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const style = map.memoryStyle || 'darkened';
    for (const [id, mem] of Object.entries(this.tokenMemory)) {
      const t = tokens[id];
      const visNow = t && pointInAnyPolygon(t.x, t.y, polys);
      if (visNow) continue; // currently seen live → no ghost
      const r = ((mem.sizeCells || 1) * map.grid.size) / 2;
      const g = this.grayMarker(r, mem.name, mem.imageUrl, mem.color, style);
      g.position.set(mem.x, mem.y);
      this.ghostLayer.addChild(g);
    }
  }

  disableMemoryVision() {
    this.liveGroup.mask = null;
    // The mask graphics is a child of liveGroup; once it's no longer a mask it
    // would render as a solid white shape, so clear it.
    this.currentMaskGfx.clear();
    this.bgGray.visible = false;
    this.bgGray.mask = null;
    if (this.ghostLayer.visible) {
      this.ghostLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.ghostLayer.visible = false;
    }
  }

  // ---- permissions ----
  // A player CONTROLS a token if they own it (their bound character) or the DM
  // granted them control (token.controllers includes their id or 'all'). Used
  // for selection, dragging and which tokens contribute the player's vision.
  canControl(token) {
    const s = getState();
    if (!token) return false;
    if (s.session.role === 'dm') return true;
    const uid = s.session.userId;
    const ctl = token.controllers || [];
    return (token.kind === 'player' && token.ownerId === uid) || ctl.includes(uid) || ctl.includes('all');
  }

  canDrag(token) {
    const s = getState();
    if (s.session.role === 'dm') return true;
    if (s.paused) return false; // frozen session: players can't move
    if (!this.canControl(token)) return false;
    // During combat a player may only move a combatant on ITS turn. Tokens not
    // in the initiative order (out of combat) are unrestricted.
    const init = s.initiative;
    if (init?.active && init.order?.some((o) => o.tokenId === token.id)) {
      if (init.order[init.activeIndex]?.tokenId !== token.id) return false;
    }
    return true;
  }

  // The floor currently shown: the DM views their active level; a player sees
  // the level their own token is on (so taking the stairs switches their view).
  displayedLevel(s, map, base) {
    if (s.session.role === 'dm') return s.ui.activeLevel || base;
    const mine = Object.values(s.tokens).filter((t) => t.kind === 'player'
      && t.mapId === map.id
      && (t.ownerId === s.session.userId || true)); // demo: any player token
    const owned = mine.find((t) => t.ownerId === s.session.userId) || mine[0];
    return (owned && owned.level) || s.ui.activeLevel || base;
  }

  // Observer points for dynamic fog. A player sees through every token they
  // CONTROL (own + DM-granted). With nothing selected → the union of all their
  // tokens' vision; with one of their tokens selected → only that token's view
  // (explored memory still accumulates across all of them over time = shared).
  fogObservers(s, map, level, base) {
    if ((map.fogMode || (map.fogEnabled ? 'manual' : 'none')) !== 'dynamic') return [];
    if (s.session.role === 'dm') return [];
    const onMap = Object.values(s.tokens).filter((t) => t.mapId === map.id && (t.level || base) === level);
    let controlled = onMap.filter((t) => this.canControl(t));
    if (!controlled.length) controlled = onMap.filter((t) => t.kind === 'player'); // demo fallback
    const sel = s.ui.selectedTokenId;
    if (sel && controlled.some((t) => t.id === sel)) controlled = controlled.filter((t) => t.id === sel);
    return controlled.map((t) => ({ x: t.x, y: t.y, inside: t.inside, id: t.id }));
  }

  // Is a straight move from→to blocked by a movement-blocking wall on `level`?
  // The DM is never blocked — they can drag tokens through walls freely.
  moveBlocked(from, to, level) {
    const s = getState();
    if (s.session.role === 'dm') return false;
    const base = s.maps[s.activeMapId]?.levels?.[0]?.id || null;
    for (const w of Object.values(s.walls)) {
      if (w.mapId !== s.activeMapId || (w.level || base) !== level) continue;
      if (!wallBlocksMovement(w)) continue;
      if (segmentsIntersect(from, to, w.a, w.b)) return true;
    }
    return false;
  }

  // Place a door on the wall nearest the click: the 1-cell portion under the
  // click becomes a door, and the original wall is split into the parts around
  // it. Doors can only be created on a wall.
  placeDoorOnWall(pos, map, level) {
    const s = getState();
    const grid = map.grid;
    const base = map.levels?.[0]?.id || null;
    let best = null, bestD = grid.size * 0.7;
    for (const w of Object.values(s.walls)) {
      if (w.mapId !== map.id || (w.level || base) !== level || w.kind === 'door') continue;
      const d = distToSegment(pos, w.a, w.b);
      if (d < bestD) { bestD = d; best = w; }
    }
    if (!best) return; // not on a wall → nothing
    const { a, b, kind } = best;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const cells = Math.max(1, Math.round(len / grid.size));
    const span = Math.min(getState().ui.doorDouble ? 2 : 1, cells); // double door = 2 cells
    if (cells <= span) { A.updateWall(best.id, { kind: 'door', open: false }); return; } // whole wall becomes the door
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let k = Math.floor(((pos.x - a.x) * ux + (pos.y - a.y) * uy) / grid.size);
    k = Math.max(0, Math.min(cells - span, k));
    const ds = { x: a.x + ux * grid.size * k, y: a.y + uy * grid.size * k };
    const de = { x: a.x + ux * grid.size * (k + span), y: a.y + uy * grid.size * (k + span) };
    A.removeWall(best.id);
    if (k > 0) A.addWall({ mapId: map.id, level, a, b: ds, kind });
    A.addWall({ mapId: map.id, level, a: ds, b: de, kind: 'door', open: false });
    if (k + span < cells) A.addWall({ mapId: map.id, level, a: de, b, kind });
  }

  // After a token move settles, switch its level if it stepped on a transition.
  checkTransition(tokenId) {
    const s = getState();
    const map = s.maps[s.activeMapId];
    const token = s.tokens[tokenId];
    if (!map || !token) return;
    const base = map.levels?.[0]?.id || null;
    const tLevel = token.level || base;
    const cell = pointToCell(token.x, token.y, map.grid);
    const field = Object.values(s.transitions).find(
      (tr) => tr.mapId === map.id && (tr.level || base) === tLevel && tr.col === cell.col && tr.row === cell.row);
    if (!field) return;
    const exits = (field.exits && field.exits.length)
      ? field.exits
      : (field.toLevel ? [{ toLevel: field.toLevel, col: cell.col, row: cell.row }] : []);
    if (exits.length === 0) return;
    if (exits.length === 1) { A.travelToken(tokenId, exits[0], map.grid); return; }
    this.onTransitionPrompt?.(tokenId, field.id); // several exits → player chooses
  }

  // ---- input wiring ----
  installInput() {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = { contains: () => true }; // whole screen

    const onDown = (e) => this.onStageDown(e);
    const onMove = (e) => this.onStageMove(e);
    const onUp = (e) => this.onStageUp(e);
    stage.on('pointerdown', onDown);
    stage.on('pointermove', onMove);
    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);

    const canvas = this.app.canvas;
    const onWheel = (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      // Wheel over a selected object adjusts it: plain = resize, Shift = rotate.
      // Ctrl always zooms (and so does plain wheel when nothing is selected).
      if (!e.ctrlKey && this.adjustSelectionWheel(dir, e.shiftKey)) return;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.viewport.zoomAt(e.offsetX, e.offsetY, factor);
    };
    const onCtx = (e) => e.preventDefault(); // suppress native menu; we use our own
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);

    const onKey = (down) => (e) => {
      if (e.key === 'Shift') this.keys.shift = down;
      if (e.code === 'Space') this.keys.space = down;
      if (e.key === 'Alt') this.keys.alt = down;
      if (e.key === 'Control') this.keys.ctrl = down;
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    // WASD = move selected token cell-by-cell; Delete = remove selected zone.
    const onAction = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // Ctrl/Cmd+Z = undo the last change (anywhere on the map).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); return; }
      if ((e.key === 'Escape' || e.key === 'Enter') && this.wallChain) { this.finishWallChain(); return; }
      if (e.key === 'Escape' && this.doorDraft) { this.doorDraft = null; this.walls.drawPreview(null, null); return; }
      const step = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] }[e.key.toLowerCase()];
      if (step) { this.moveSelectedByCell(step[0], step[1]); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const st = getState();
        if (st.ui.selectedZoneId) { A.removeZone(st.ui.selectedZoneId); A.selectZone(null); }
        else if (st.ui.selectedWallId) { (st.ui.selectedWallIds?.length ? st.ui.selectedWallIds : [st.ui.selectedWallId]).forEach((wid) => A.removeWall(wid)); A.selectWall(null); }
        else if (st.ui.selectedTransitionId) { A.removeTransition(st.ui.selectedTransitionId); A.selectTransition(null); }
        else if (st.ui.selectedLightId) { A.removeLight(st.ui.selectedLightId); A.selectLight(null); }
      }
    };
    window.addEventListener('keydown', onAction);
    const onDbl = () => this.finishWallChain();
    canvas.addEventListener('dblclick', onDbl);

    this.removeInput = () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('keydown', onAction);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }

  mapPos(e) {
    const g = e.global;
    return this.viewport.toMap(g.x, g.y);
  }

  // ---- stage-level pointer (empty space) ----
  onStageDown(e) {
    const s = getState();
    const map = s.activeMapId ? s.maps[s.activeMapId] : null;
    if (!map) return;
    const pos = this.mapPos(e);
    const level = this.displayedLevel(s, map, map.levels?.[0]?.id || null);

    // Alt-click = ping, in any tool.
    if (this.keys.alt) { A.ping(map.id, pos.x, pos.y); return; }

    // Right-click while drawing walls ends the chain (instead of panning).
    if (e.button === 2 && s.ui.tool === 'walls' && this.wallChain) { this.finishWallChain(); return; }

    // pan: middle mouse, or space+drag, or right-drag on empty space
    if (e.button === 1 || (e.button === 0 && this.keys.space) || e.button === 2) {
      this.pan = { lastX: e.global.x, lastY: e.global.y };
      return;
    }

    const tool = s.ui.tool;
    // Terrain edge-edit mode: clicks ONLY toggle the selected terrain's
    // perimeter edges (open/close passages) — never paint a new selection.
    if (s.session.role === 'dm' && s.ui.terrainEdgeEdit && s.ui.selectedTerrainId) {
      this.tryToggleTerrainEdge(pos, map, level);
      return;
    }
    if (tool === 'ruler') {
      this.placing = { kind: 'ruler', from: pos };
      A.setRuler({ from: pos, to: pos });
    } else if (tool === 'ping') {
      A.ping(map.id, pos.x, pos.y);
    } else if (tool === 'fog' && s.session.role === 'dm') {
      // Circle brush: stamp a revealed disc on down + along the drag.
      this.placing = { kind: 'fog', last: null };
      this.stampFog(pos);
    } else if (tool === 'light' && s.session.role === 'dm') {
      const mode = s.ui.lightMode || 'light';
      const r = (map.grid.size || 70) * (s.ui.darkBrushCells || 2);
      if (mode === 'darkness') {
        // Paint darkness with a circle brush (committed on pointer-up).
        this.placing = { kind: 'darkPaint', r, stamps: [], last: null };
        this.stampDarkness(pos);
      } else if (mode === 'darkness-erase') {
        this.placing = { kind: 'darkErase', r, points: [], last: null };
        this.stampDarkness(pos);
      } else {
        // Place a new light here and select it for editing.
        A.selectLight(A.addLight({ x: pos.x, y: pos.y }));
      }
    } else if (tool === 'walls' && s.ui.wallKind === 'door' && s.session.role === 'dm') {
      // Doors are drawn like a wall: click a start vertex (grid-snapped), then an
      // end vertex → a resizable door segment. Existing doors are selected/grabbed
      // via their body/handles first (those stopPropagation before reaching the
      // stage), so a click here always means "place a new door". Shift = free.
      const v = this.keys.shift ? pos : this.snapWallVertex(pos);
      if (!this.doorDraft) {
        this.doorDraft = { start: v };
        this.walls.drawPreview(v, v, 'door');
      } else {
        if (Math.hypot(v.x - this.doorDraft.start.x, v.y - this.doorDraft.start.y) > 2) {
          A.selectWall(A.addWall({ mapId: map.id, a: this.doorDraft.start, b: v, kind: 'door' }));
        }
        this.doorDraft = null;
        this.walls.drawPreview(null, null);
      }
    } else if (tool === 'walls' && s.session.role === 'dm') {
      // Chained walls: each click connects to the previous vertex so segments
      // share exact endpoints (no gaps). Right-click / Esc / Enter / dbl-click
      // ends the chain.
      let v = this.keys.shift ? pos : this.snapWallVertex(pos);
      // Clicking the MIDDLE of an existing wall splits it there, creating a
      // junction you can then connect to / drag (Shift = ignore, place freely).
      if (!this.keys.shift) {
        const sp = this.maybeSplitWall(pos, v, map, level);
        if (sp) { v = sp; this.flashAt(v.x, v.y); } // confirm the dock
        else if (this.snappedToExistingVertex(v)) this.flashAt(v.x, v.y);
      }
      if (!this.wallChain) {
        this.wallChain = { start: v, last: v };
      } else {
        A.addWall({ mapId: map.id, a: this.wallChain.last, b: v, kind: s.ui.wallKind });
        this.wallChain.last = v;
        // Closed the loop back to the start → finish this chain (so the next
        // click starts a NEW wall) but stay in the wall tool, and flash a brief
        // "closed" effect.
        if (this.wallChain.start && v.x === this.wallChain.start.x && v.y === this.wallChain.start.y) {
          this.flashAt(v.x, v.y);
          this.finishWallChain();
          return;
        }
      }
      this.walls.drawPreview(this.wallChain.last, v, s.ui.wallKind);
    } else if (tool === 'zone') {
      // Snap the zone origin to the nearest grid intersection (Ctrl = free), so
      // shapes line up with tokens consistently.
      const from = this.keys.ctrl ? pos : snapPointToGrid(pos, map.grid);
      this.placing = { kind: 'zone', from, to: from };
    } else if (tool === 'terrain' && s.session.role === 'dm') {
      // Cell selection: drag a box (Shift = add to existing); a click = one cell
      // (Shift-click toggles it).
      this.terrainMarquee = { from: pos, to: pos, add: this.keys.shift };
      this.drawTerrainMarquee();
    } else if (tool === 'transition' && s.session.role === 'dm') {
      // Click an existing field → select it. Click an empty cell on ANOTHER
      // level while a field is selected → connect them (two-way). Else place a
      // new field. Stairs/ladder fields move a token to a linked exit.
      const cell = pointToCell(pos.x, pos.y, map.grid);
      const lvl = s.ui.activeLevel || map.levels?.[0]?.id;
      const at = (l, c) => Object.values(s.transitions).find(
        (t) => t.mapId === map.id && (t.level || lvl) === l && t.col === c.col && t.row === c.row);
      const existing = at(lvl, cell);
      const sel = s.ui.selectedTransitionId ? s.transitions[s.ui.selectedTransitionId] : null;
      if (existing) {
        A.selectTransition(existing.id);
      } else if (sel && sel.level !== lvl) {
        // forward exit on the selected field → here; paired return field here
        A.addTransitionExit(sel.id, { toLevel: lvl, col: cell.col, row: cell.row });
        A.addTransition({ mapId: map.id, level: lvl, col: cell.col, row: cell.row, kind: sel.kind, exits: [{ toLevel: sel.level, col: sel.col, row: sel.row }] });
        A.selectTransition(sel.id);
      } else {
        const id = A.addTransition({ mapId: map.id, level: lvl, col: cell.col, row: cell.row, kind: s.ui.transitionKind });
        A.selectTransition(id);
      }
    } else if (tool === 'select') {
      // Click a terrain object's cell to select it (DM); else marquee tokens.
      if (s.session.role === 'dm') {
        const cell = pointToCell(pos.x, pos.y, map.grid);
        const key = `${cell.col},${cell.row}`;
        const hit = (map.terrain || []).find((t) => Array.isArray(t.cells) && (t.level || (map.levels?.[0]?.id || null)) === level && t.cells.includes(key));
        if (hit) { A.selectTerrain(hit.id); return; }
      }
      // Marquee selection: drag a box over empty space to select tokens.
      // Shift adds to the existing selection. While a token context menu is open,
      // an empty-map click keeps the current selection (so the menu's token stays
      // the focus and the menu doesn't feel "orphaned").
      this.marquee = { from: pos, to: pos, add: this.keys.shift };
      if (!this.keys.shift && !(s.ui.contextTokenIds || []).length) A.selectToken(null);
    }
  }

  onStageMove(e) {
    if (this.pan) {
      const dx = e.global.x - this.pan.lastX;
      const dy = e.global.y - this.pan.lastY;
      this.viewport.panBy(dx, dy);
      this.pan.lastX = e.global.x; this.pan.lastY = e.global.y;
      return;
    }
    const pos = this.mapPos(e);
    this.drawFogBrush(pos); // brush cursor preview (no-op unless fog tool)
    this.drawDarkBrushHover(pos); // brush cursor preview (no-op unless dark tool)
    if (this.lightDrag) { A.updateLight(this.lightDrag.id, { x: pos.x + this.lightDrag.offX, y: pos.y + this.lightDrag.offY }); return; }
    if (this.drag) { this.onDragMove(pos); return; }
    if (this.handleDrag) { this.onHandleMove(pos); return; }
    if (this.wallHandleDrag) { this.onWallHandleMove(pos); return; }
    if (this.zoneDrag) { this.onZoneMove(pos); return; }
    if (this.terrainMarquee) { this.terrainMarquee.to = pos; this.drawTerrainMarquee(); return; }
    if (this.marquee) { this.marquee.to = pos; this.drawMarquee(); return; }
    if (this.wallChain) {
      const v = this.keys.shift ? pos : this.snapWallVertex(pos);
      this.walls.drawPreview(this.wallChain.last, v, getState().ui.wallKind);
      return;
    }
    if (this.doorDraft) {
      const v = this.keys.shift ? pos : this.snapWallVertex(pos);
      this.walls.drawPreview(this.doorDraft.start, v, 'door');
      return;
    }
    if (this.placing) this.onPlacingMove(pos);
  }

  finishWallChain() {
    this.wallChain = null;
    this.walls.drawPreview(null, null);
  }

  // Brief "loop closed" pulse at a map-space point.
  flashAt(x, y) { this.flash = { x, y, at: performance.now() }; }
  tickFlash(now) {
    if (!this.flash) return;
    const t = (now - this.flash.at) / 700;
    this.flashGfx.clear();
    if (t >= 1) { this.flash = null; return; }
    const r = 12 + t * 90;
    this.flashGfx.circle(this.flash.x, this.flash.y, r).stroke({ width: 4, color: 0x53e08a, alpha: (1 - t) * 0.95 });
    this.flashGfx.circle(this.flash.x, this.flash.y, r * 0.5).stroke({ width: 3, color: 0x53e08a, alpha: (1 - t) * 0.6 });
  }

  onStageUp() {
    if (this.pan) { this.pan = null; return; }
    if (this.lightDrag) { this.lightDrag = null; return; }
    if (this.terrainMarquee) { this.endTerrainMarquee(); return; }
    if (this.marquee) { this.endMarquee(); return; }
    if (this.drag) { this.onDragEnd(); return; }
    if (this.handleDrag) { this.commitZoneEdit(); this.handleDrag = null; return; }
    if (this.wallHandleDrag) {
      const d = this.wallHandleDrag;
      if (d.detach) {
        // Bridge the original junction to where the grabbed endpoint ended up,
        // so the detached door/wall stays connected via a fresh wall.
        const w = getState().walls[d.id];
        const nv = w && w[d.end];
        // Only bridge if the endpoint actually ended up away from the original
        // junction. Dragged back onto (≈) the start → no leftover wall.
        const grid = getState().maps[getState().activeMapId]?.grid?.size || 70;
        if (nv && Math.hypot(nv.x - d.detach.x, nv.y - d.detach.y) > grid * 0.25) {
          A.addWall({ mapId: d.detach.mapId, level: d.detach.level, a: { x: d.detach.x, y: d.detach.y }, b: { x: nv.x, y: nv.y }, kind: 'both' });
        }
      }
      this.reconcile(); this.wallHandleDrag = null; return;
    }
    if (this.zoneDrag) { this.commitZoneEdit(); this.zoneDrag = null; return; }
    if (this.placing) this.onPlacingEnd();
  }

  // ---- marquee multi-select ----
  drawMarquee() {
    const { from, to } = this.marquee;
    const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x), h = Math.abs(to.y - from.y);
    this.marqueeGfx.clear().rect(x, y, w, h)
      .fill({ color: 0x6c8cff, alpha: 0.12 }).stroke({ width: 1.5, color: 0x6c8cff, alpha: 0.9 });
  }

  endMarquee() {
    const s = getState();
    const { from, to, add } = this.marquee;
    const x1 = Math.min(from.x, to.x), y1 = Math.min(from.y, to.y);
    const x2 = Math.max(from.x, to.x), y2 = Math.max(from.y, to.y);
    const inside = Object.values(s.tokens)
      .filter((t) => t.x >= x1 && t.x <= x2 && t.y >= y1 && t.y <= y2)
      .map((t) => t.id);
    if (add) {
      const merged = new Set([...(s.ui.selectedTokenIds || []), ...inside]);
      A.setTokenSelection([...merged]);
    } else if (inside.length) {
      A.setTokenSelection(inside);
    }
    this.marqueeGfx.clear();
    this.marquee = null;
  }

  // ---- terrain cell selection (Gelände tool) ----
  drawTerrainMarquee() {
    const { from, to } = this.terrainMarquee;
    const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x), h = Math.abs(to.y - from.y);
    this.marqueeGfx.clear().rect(x, y, w, h)
      .fill({ color: 0x6c8cff, alpha: 0.1 }).stroke({ width: 1.5, color: 0x6c8cff, alpha: 0.9 });
  }

  endTerrainMarquee() {
    const s = getState();
    const grid = s.maps[s.activeMapId]?.grid;
    const { from, to, add } = this.terrainMarquee;
    this.terrainMarquee = null;
    this.marqueeGfx.clear();
    if (!grid) return;
    const a = pointToCell(Math.min(from.x, to.x), Math.min(from.y, to.y), grid);
    const b = pointToCell(Math.max(from.x, to.x), Math.max(from.y, to.y), grid);
    const cells = [];
    for (let c = a.col; c <= b.col; c++) for (let r = a.row; r <= b.row; r++) cells.push(`${c},${r}`);
    // Plain single click on an EXISTING terrain object → select it for editing
    // (don't start a new paint selection).
    if (!add && cells.length === 1) {
      const map = s.maps[s.activeMapId];
      const level = this.displayedLevel(s, map, map.levels?.[0]?.id || null);
      const hit = (map.terrain || []).find((t) => Array.isArray(t.cells) && (t.level || (map.levels?.[0]?.id || null)) === level && t.cells.includes(cells[0]));
      if (hit) { A.selectTerrain(hit.id); A.setTerrainSelection([]); return; }
    }
    const cur = s.ui.terrainSelection || [];
    let next;
    if (add) {
      // single Shift-click toggles that cell; a Shift-box unions
      if (cells.length === 1 && cur.includes(cells[0])) next = cur.filter((x) => x !== cells[0]);
      else next = [...new Set([...cur, ...cells])];
    } else {
      next = cells;
    }
    A.setTerrainSelection(next);
  }

  // Edge-edit: toggle the perimeter edge of the selected terrain object nearest
  // the click. Returns true if an edge was toggled.
  tryToggleTerrainEdge(pos, map, level) {
    const s = getState();
    const o = (map.terrain || []).find((t) => t.id === s.ui.selectedTerrainId && Array.isArray(t.cells) && (t.level || (map.levels?.[0]?.id || null)) === level);
    if (!o) return false;
    const grid = map.grid;
    const cell = pointToCell(pos.x, pos.y, grid);
    const key = `${cell.col},${cell.row}`;
    if (!o.cells.includes(key)) return false;
    // Which side of the cell is the click nearest?
    const lx = (pos.x - grid.offsetX) / grid.size - cell.col; // 0..1 within cell
    const ly = (pos.y - grid.offsetY) / grid.size - cell.row;
    const dist = { L: lx, R: 1 - lx, T: ly, B: 1 - ly };
    const side = Object.keys(dist).sort((a, b) => dist[a] - dist[b])[0];
    const inObj = new Set(o.cells);
    const nb = { T: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0] }[side];
    if (inObj.has(`${cell.col + nb[0]},${cell.row + nb[1]}`)) return false; // interior edge, not a perimeter
    A.toggleTerrainEdge(o.id, `${key}:${side}`);
    return true;
  }

  // ---- zone selection / move / resize / rotate ----
  onZoneDown(id, e) {
    const s = getState();
    // Selectable with the select tool OR the zone tool (click an existing shape
    // to edit it; clicking empty space in the zone tool still draws a new one).
    if (s.ui.tool !== 'select' && s.ui.tool !== 'zone') return;
    e.stopPropagation?.();
    A.selectZone(id);
    const pos = this.mapPos(e);
    const z = s.zones[id];
    this.zoneDrag = { id, offX: z.x - pos.x, offY: z.y - pos.y };
  }

  onZoneMove(pos) {
    const z = getState().zones[this.zoneDrag.id];
    if (!z) return;
    A.updateZone(this.zoneDrag.id, { x: pos.x + this.zoneDrag.offX, y: pos.y + this.zoneDrag.offY });
  }

  onZoneHandleStart(id, which, e) {
    const t = getState().ui.tool;
    if (t !== 'select' && t !== 'zone') return;
    e.stopPropagation?.();
    A.selectZone(id);
    this.handleDrag = { id, which };
  }

  onHandleMove(pos) {
    const s = getState();
    const z = s.zones[this.handleDrag.id];
    if (!z) return;
    const grid = s.maps[s.activeMapId].grid;
    const dx = pos.x - z.x, dy = pos.y - z.y;
    const distFt = round5((Math.hypot(dx, dy) / grid.size) * 5);
    const dirDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const p = { ...z.params };
    if (this.handleDrag.which === 'width') {
      p.widthFt = round5((Math.abs(perpDistance(dx, dy, p.directionDeg)) * 2 / grid.size) * 5);
    } else {
      switch (z.type) {
        case 'circle': p.radiusFt = distFt; break;
        case 'square': p.sideFt = round5(distFt * 2); break;
        case 'cone': p.lengthFt = distFt; p.directionDeg = dirDeg; break;
        case 'line': p.lengthFt = distFt; p.directionDeg = dirDeg; break;
        default: break;
      }
    }
    A.updateZone(this.handleDrag.id, { params: p });
  }

  commitZoneEdit() { this.reconcile(); }

  // ---- wall selection / endpoint editing ----
  onWallDown(id, e) {
    // Let middle/right/space reach the stage so you can PAN (or right-click to
    // end a chain) even with the cursor over a wall.
    if (e.button !== 0 || this.keys.space) return;
    const s = getState();
    // Door mode: clicking a NON-door wall must PLACE a door (handled by
    // onStageDown → placeDoorOnWall), so bail WITHOUT stopping propagation and
    // let the event bubble to the stage. Clicking an EXISTING door still falls
    // through to the normal select/edit logic below.
    if (s.ui.tool === 'walls' && s.ui.wallKind === 'door' && s.walls[id]?.kind !== 'door') return;
    // While drawing a wall chain, a click must place/close a vertex — never
    // select the wall (otherwise you can't snap the loop shut on the start).
    if (this.wallChain) return;
    // Selectable with the select tool OR the walls tool (walls only show while
    // the walls tool is active, so you must be able to pick them there to edit).
    if (s.ui.tool !== 'select' && s.ui.tool !== 'walls') return;
    e.stopPropagation?.();
    // Double-click selects the WHOLE connected wall component (loop/chain) so
    // its light/sight settings can be edited in one go.
    const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this._lastWallTap && this._lastWallTap.id === id && nowT - this._lastWallTap.t < 350) {
      this._lastWallTap = null;
      A.selectWalls(this.connectedWallIds(id));
      return;
    }
    this._lastWallTap = { id, t: nowT };
    const wall = s.walls[id];
    if (wall?.kind === 'door' || wall?.kind === 'window') {
      // Walls tool = edit (select → move/resize handles). Select tool = play:
      // toggle open/closed without changing the current selection.
      if (s.ui.tool === 'walls') { A.selectWall(id); return; }
      A.updateWall(id, { open: !wall.open });
      return;
    }
    if (s.session.role === 'dm') A.selectWall(id);
  }

  onWallHandleStart(id, end, e) {
    const s0 = getState();
    const t = s0.ui.tool;
    if (t !== 'select' && t !== 'walls') return;
    // Door mode: on a NON-door wall, let the click fall through to the stage so
    // a NEW door is placed instead of grabbing the endpoint handle. An existing
    // door's handles stay grabbable so placed doors remain editable.
    if (t === 'walls' && s0.ui.wallKind === 'door' && s0.walls[id]?.kind !== 'door') return;
    e.stopPropagation?.();
    A.selectWall(id);
    const s = getState();
    const w = s.walls[id];
    const base = s.maps[s.activeMapId]?.levels?.[0]?.id || null;
    const lvl = w.level || base;
    const v = w[end];
    // All wall endpoints sharing this vertex move together (stay connected).
    // Hold Ctrl while dragging to move only this one (break the connection).
    const welded = [];
    for (const ww of Object.values(s.walls)) {
      if (ww.mapId !== w.mapId || (ww.level || base) !== lvl) continue;
      for (const k of ['a', 'b']) {
        if (Math.hypot(ww[k].x - v.x, ww[k].y - v.y) < 0.5) welded.push({ id: ww.id, end: k });
      }
    }
    // Door↔wall junction: if this vertex mixes a door and a plain wall, dragging
    // DETACHES the grabbed segment (moves it alone) and a NEW wall is created on
    // drop to bridge the original junction point — the other segment stays put.
    const kinds = welded.map((wt) => s.walls[wt.id]?.kind);
    const detachJunction = welded.length >= 2 && kinds.includes('door') && kinds.some((k) => k && k !== 'door');
    this.wallHandleDrag = { id, end, welded, detach: detachJunction ? { x: v.x, y: v.y, mapId: w.mapId, level: w.level } : null };
  }

  // Player-switchable lights show a clickable light-switch icon on the map
  // (everyone). Black when the light is ON, white when OFF — same SVG, tinted —
  // with a soft contrasting halo so it reads on the bright lit ground.
  drawLightSwitches(map, level, base) {
    const c = this.lightSwitches;
    c.removeChildren().forEach((x) => x.destroy({ children: true }));
    const s = getState();
    // Personal display choice: a player can hide the on-map light switches.
    if (s.session.role !== 'dm' && !getShowLightSwitches()) return;
    const size = (map.grid.size || 70) * 0.5;
    for (const lt of Object.values(s.lights)) {
      if (lt.mapId !== map.id || (lt.level || base) !== level || !lt.playerSwitch) continue;
      const on = lt.enabled !== false;
      const node = new Container();
      node.position.set(lt.x, lt.y);
      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.addChild(new Graphics().circle(0, 0, size * 0.62).fill({ color: on ? 0xffffff : 0x000000, alpha: 0.35 }));
      const sp = new Sprite();
      sp.anchor.set(0.5);
      sp.tint = on ? 0x000000 : 0xffffff;
      loadIcon('/Assets/map/lightswitch.svg').then((tex) => {
        if (!tex || sp.destroyed) return;
        sp.texture = tex;
        sp.width = sp.height = size;
      });
      node.addChild(sp);
      node.on('pointerdown', (e) => { e.stopPropagation?.(); A.toggleLight(lt.id); });
      c.addChild(node);
    }
  }

  // Colored ft range circles attached to tokens (everyone sees them).
  drawAuras(tokens, grid) {
    this.auras.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const t of Object.values(tokens)) {
      for (const a of (t.auras || [])) {
        if (!a || !(a.radiusFt > 0)) continue;
        const r = feetToPx(a.radiusFt, grid.size);
        this.auras.addChild(new Graphics().circle(t.x, t.y, r)
          .fill({ color: a.color || '#6c8cff', alpha: 0.1 })
          .stroke({ width: 2, color: a.color || '#6c8cff', alpha: 0.6 }));
      }
    }
  }

  // Targeting visualization (P11): a range circle around the origin token and
  // red rings on chosen targets.
  drawTargeting(tokens, grid) {
    const t = getState().ui.targeting;
    const g = this.targetingGfx;
    g.clear();
    if (!t) return;
    const origin = tokens[t.originTokenId];
    if (origin && t.rangeFt > 0) {
      const r = feetToPx(t.rangeFt, grid.size) + ((origin.sizeCells || 1) * grid.size) / 2;
      g.circle(origin.x, origin.y, r).fill({ color: 0x6c8cff, alpha: 0.06 }).stroke({ width: 2, color: 0x6c8cff, alpha: 0.6 });
    }
    for (const id of t.targets) {
      const tok = tokens[id];
      if (!tok) continue;
      g.circle(tok.x, tok.y, ((tok.sizeCells || 1) * grid.size) / 2 + 5).stroke({ width: 3, color: 0xff5252, alpha: 0.95 });
    }
  }

  // ---- light placement / selection / move (DM, light tool) ----
  drawLightMarkers(map, level, base) {
    const s = getState();
    this.lightMarkers.visible = true;
    this.lightMarkers.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const lt of Object.values(s.lights)) {
      if (lt.mapId !== map.id || (lt.level || base) !== level) continue;
      const sel = s.ui.selectedLightId === lt.id;
      const m = new Container();
      m.position.set(lt.x, lt.y);
      m.eventMode = 'static';
      m.cursor = 'move';
      m.addChild(new Graphics().circle(0, 0, 12)
        .fill({ color: lt.color || '#ffd9a0', alpha: 0.5 })
        .stroke({ width: sel ? 3 : 2, color: sel ? '#6c8cff' : '#ffffff', alpha: 0.9 }));
      m.on('pointerdown', (e) => this.onLightDown(lt.id, e));
      this.lightMarkers.addChild(m);
    }
  }

  onLightDown(id, e) {
    if (e.button !== 0) return; // let middle/right pan
    e.stopPropagation?.();
    A.selectLight(id);
    const lt = getState().lights[id];
    const pos = this.mapPos(e);
    this.lightDrag = { id, offX: lt.x - pos.x, offY: lt.y - pos.y };
  }

  onWallHandleMove(pos) {
    const grid = getState().maps[getState().activeMapId].grid;
    const v = this.keys.shift ? pos : snapVertex(pos, grid);
    const d = this.wallHandleDrag;
    // Detach (door↔wall junction) or Ctrl → move only the grabbed endpoint.
    const targets = (this.keys.ctrl || d.detach) ? [{ id: d.id, end: d.end }] : (d.welded || [{ id: d.id, end: d.end }]);
    for (const t of targets) A.updateWall(t.id, { [t.end]: v });
  }

  // If `pos` lands on the interior of an existing wall (not near its ends),
  // split that wall at the projected point into two segments and return the
  // junction point — so the chain connects onto the wall. Returns null if not.
  maybeSplitWall(pos, snapped, map, level) {
    const s = getState();
    const grid = map.grid;
    const thresh = grid.size * 0.35;
    const endR = grid.size * 0.3;
    let best = null;
    for (const w of Object.values(s.walls)) {
      if (w.mapId !== map.id || (w.level || (map.levels?.[0]?.id || null)) !== level) continue;
      const p = projectOnSeg(pos, w.a, w.b);
      const d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d > thresh) continue;
      // ignore if the projection is basically an endpoint (snapWallVertex covers that)
      if (Math.hypot(p.x - w.a.x, p.y - w.a.y) < endR || Math.hypot(p.x - w.b.x, p.y - w.b.y) < endR) continue;
      if (!best || d < best.d) best = { w, p, d };
    }
    if (!best) return null;
    const { w, p } = best;
    A.removeWall(w.id);
    A.addWall({ mapId: w.mapId, level: w.level, a: { x: w.a.x, y: w.a.y }, b: { x: p.x, y: p.y }, kind: w.kind, heightFt: w.heightFt, noRoof: w.noRoof });
    A.addWall({ mapId: w.mapId, level: w.level, a: { x: p.x, y: p.y }, b: { x: w.b.x, y: w.b.y }, kind: w.kind, heightFt: w.heightFt, noRoof: w.noRoof });
    return { x: p.x, y: p.y };
  }

  // Walking speed (ft) for a token: NPC statblock speed, a bound character's
  // computed walk speed (cached by data reference), else 30.
  tokenSpeedFt(token) {
    if (token.statblock) {
      const sp = token.statblock.speed;
      if (typeof sp === 'number') return sp;
      if (sp && typeof sp.walk === 'number') return sp.walk;
    }
    if (token.characterId != null) {
      const ch = getState().ui.characters?.[token.characterId]?.data;
      if (ch) {
        if (!this._speedCache) this._speedCache = new Map();
        const cached = this._speedCache.get(token.characterId);
        if (cached && cached.ref === ch) return cached.speed;
        let speed = 30;
        try { const c = computeCharacter(ch); speed = c.speed?.walk ?? (typeof c.speed === 'number' ? c.speed : 30) ?? 30; } catch { /* default */ }
        this._speedCache.set(token.characterId, { ref: ch, speed });
        return speed;
      }
    }
    return 30;
  }

  // Is movement between two adjacent cells blocked by a movement-blocking wall?
  // (Role-agnostic — used by the reachable-cells preview, not the drag clamp.)
  cellBlockedBetween(aCol, aRow, bCol, bRow, map, level, base) {
    const ac = cellCenter(aCol, aRow, map.grid);
    const bc = cellCenter(bCol, bRow, map.grid);
    for (const w of Object.values(getState().walls)) {
      if (w.mapId !== map.id || (w.level || base) !== level) continue;
      if (!wallBlocksMovement(w)) continue;
      if (segmentsIntersect(ac, bc, w.a, w.b)) return true;
    }
    return false;
  }

  // Dijkstra over grid cells from a token within `budgetFt` of movement.
  // Difficult/climb terrain doubles a cell's entry cost; diagonals use the 5e
  // alternating 5/10 rule (tracked via a parity bit in the search state).
  // Returns Map "col,row" -> cheapest cost (excludes the start cell).
  reachableCells(token, map, level, base, budgetFt) {
    const grid = map.grid;
    const start = pointToCell(token.x, token.y, grid);
    const costly = new Set();
    for (const tr of (map.terrain || [])) {
      if (!Array.isArray(tr.cells) || (tr.level || base) !== level) continue;
      if (tr.kind === 'difficult' || tr.kind === 'climb') for (const cc of tr.cells) costly.add(cc);
    }
    const enterCost = (col, row) => (costly.has(`${col},${row}`) ? 10 : 5);
    const dist = new Map();
    const best = new Map();
    const sk = `${start.col},${start.row},0`;
    dist.set(sk, 0);
    const frontier = [{ col: start.col, row: start.row, par: 0, cost: 0 }];
    let guard = 0;
    while (frontier.length && guard++ < 20000) {
      let mi = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i].cost < frontier[mi].cost) mi = i;
      const cur = frontier.splice(mi, 1)[0];
      if (cur.cost > (dist.get(`${cur.col},${cur.row},${cur.par}`) ?? Infinity)) continue;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!dc && !dr) continue;
          const ncol = cur.col + dc, nrow = cur.row + dr;
          const diagonal = dc !== 0 && dr !== 0;
          if (this.cellBlockedBetween(cur.col, cur.row, ncol, nrow, map, level, base)) continue;
          // No corner-cutting through a wall: a diagonal needs an open orthogonal side.
          if (diagonal && this.cellBlockedBetween(cur.col, cur.row, cur.col + dc, cur.row, map, level, base)
            && this.cellBlockedBetween(cur.col, cur.row, cur.col, cur.row + dr, map, level, base)) continue;
          let step = enterCost(ncol, nrow);
          let npar = cur.par;
          if (diagonal) { if (cur.par === 1) step += 5; npar = cur.par ^ 1; }
          const ncost = cur.cost + step;
          if (ncost > budgetFt) continue;
          const nkey = `${ncol},${nrow},${npar}`;
          if (ncost < (dist.get(nkey) ?? Infinity)) {
            dist.set(nkey, ncost);
            frontier.push({ col: ncol, row: nrow, par: npar, cost: ncost });
            const bk = `${ncol},${nrow}`;
            if (ncost < (best.get(bk) ?? Infinity)) best.set(bk, ncost);
          }
        }
      }
    }
    best.delete(`${start.col},${start.row}`);
    return best;
  }

  // Draw the reachable-cells overlay for the active combatant on their turn.
  // Cells within the normal move budget are tinted accent; the additional cells
  // reachable WITH Dash (×2) are tinted amber, so the Dash range previews too.
  updateMovementPreview(s, map, level, base, isDM) {
    const g = this.moveLayer;
    g.clear();
    const init = s.initiative;
    if (!init?.active || !init.order?.length) return;
    const activeId = init.order[init.activeIndex]?.tokenId;
    const token = activeId ? s.tokens[activeId] : null;
    if (!token || token.mapId !== map.id || (token.level || base) !== level) return;
    // Only the controller (or the DM) sees the active token's movement preview.
    if (!isDM && !this.canControl(token)) return;
    const speed = this.tokenSpeedFt(token);
    if (!(speed > 0)) return;
    const reach = this.reachableCells(token, map, level, base, speed * 2);
    const sz = map.grid.size;
    for (const [key, cost] of reach) {
      const [col, row] = key.split(',').map(Number);
      const dash = cost > speed;
      g.rect(map.grid.offsetX + col * sz, map.grid.offsetY + row * sz, sz, sz)
        .fill({ color: dash ? 0xffa53d : 0x6c8cff, alpha: dash ? 0.12 : 0.2 });
    }
  }

  // Approximate movement cost (ft) along the ruler, doubling cells of difficult
  // terrain. Returns null if there's no difficult terrain on the path.
  rulerMoveFt(ruler, map, level, base) {
    if (!ruler) return null;
    const diff = new Set();
    for (const tr of (map.terrain || [])) {
      if (tr.kind !== 'difficult' || !Array.isArray(tr.cells) || (tr.level || base) !== level) continue;
      for (const c of tr.cells) diff.add(c);
    }
    if (!diff.size) return null;
    const { from, to } = ruler;
    const sz = map.grid.size || 70;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (sz * 0.25)));
    const cells = new Set();
    for (let i = 0; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * (i / steps);
      const y = from.y + (to.y - from.y) * (i / steps);
      const c = pointToCell(x, y, map.grid);
      cells.add(`${c.col},${c.row}`);
    }
    let d = 0;
    for (const c of cells) if (diff.has(c)) d++;
    return (cells.size - d) * 5 + d * 10;
  }

  // Snap a wall vertex to grid, or to a nearby existing wall endpoint / the
  // current chain's start — so connecting end→start closes a room exactly.
  // All wall ids connected to `startId` through shared endpoints (same map &
  // level) — a flood-fill over the wall graph. Used by double-click to grab a
  // whole loop/chain for batch editing.
  connectedWallIds(startId) {
    const s = getState();
    const start = s.walls[startId];
    if (!start) return [startId];
    const base = s.maps[s.activeMapId]?.levels?.[0]?.id || null;
    const lvl = start.level || base;
    const here = Object.values(s.walls).filter((w) => w.mapId === start.mapId && (w.level || base) === lvl);
    const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const out = new Set([startId]);
    const queue = [start];
    while (queue.length) {
      const w = queue.shift();
      const vk = new Set([key(w.a), key(w.b)]);
      for (const ww of here) {
        if (out.has(ww.id)) continue;
        if (vk.has(key(ww.a)) || vk.has(key(ww.b))) { out.add(ww.id); queue.push(ww); }
      }
    }
    return [...out];
  }

  // True if `v` coincides with an existing wall endpoint on the active map
  // (used to flash a "docked" confirmation when a new wall snaps onto another).
  snappedToExistingVertex(v) {
    const s = getState();
    for (const w of Object.values(s.walls)) {
      if (w.mapId !== s.activeMapId) continue;
      if ((Math.abs(w.a.x - v.x) < 0.5 && Math.abs(w.a.y - v.y) < 0.5) || (Math.abs(w.b.x - v.x) < 0.5 && Math.abs(w.b.y - v.y) < 0.5)) return true;
    }
    return false;
  }

  snapWallVertex(pos) {
    const s = getState();
    const grid = s.maps[s.activeMapId].grid;
    // The chain's start is "sticky" with a generous radius so closing a loop
    // doesn't need a pixel-perfect click.
    if (this.wallChain?.start) {
      const st = this.wallChain.start;
      if (Math.hypot(st.x - pos.x, st.y - pos.y) < grid.size * 0.9) return { x: st.x, y: st.y };
    }
    const thresh = grid.size * 0.5;
    let best = null, bestD = thresh;
    for (const w of Object.values(s.walls)) {
      if (w.mapId !== s.activeMapId) continue;
      for (const c of [w.a, w.b]) {
        const d = Math.hypot(c.x - pos.x, c.y - pos.y);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    return best ? { x: best.x, y: best.y } : snapVertex(pos, grid);
  }

  // ---- WASD: move the selected token one cell ----
  moveSelectedByCell(dCol, dRow) {
    const s = getState();
    const id = s.ui.selectedTokenId;
    if (!id || s.ui.tool !== 'select') return;
    const token = s.tokens[id];
    if (!token || !this.canDrag(token)) return;
    const grid = s.maps[s.activeMapId].grid;
    const to = { x: token.x + dCol * grid.size, y: token.y + dRow * grid.size };
    const base = grid && (s.maps[s.activeMapId].levels?.[0]?.id || null);
    if (this.moveBlocked({ x: token.x, y: token.y }, to, token.level || base)) return; // wall blocks the step
    // Smooth the step: glide the sprite from its current spot to the new cell
    // instead of teleporting (the store updates instantly; the tween overrides
    // the sprite's position until it catches up — see tickTween).
    const node = this.tokens.nodes.get(id);
    const fromX = node ? node.root.position.x : token.x;
    const fromY = node ? node.root.position.y : token.y;
    A.moveToken(id, to.x, to.y);
    this._tween = { id, fromX, fromY, toX: to.x, toY: to.y, start: performance.now(), dur: 130 };
    this.checkTransition(id);
  }

  // Animate the active WASD/step tween (ease-out); overrides reconcile snapping
  // for the tweening token until it reaches the target cell.
  tickTween(now) {
    const tw = this._tween;
    if (!tw) return;
    const node = this.tokens.nodes.get(tw.id);
    if (!node) { this._tween = null; return; }
    let p = (now - tw.start) / tw.dur;
    if (p >= 1) { node.root.position.set(tw.toX, tw.toY); this._tween = null; return; }
    p = 1 - (1 - p) * (1 - p);
    node.root.position.set(tw.fromX + (tw.toX - tw.fromX) * p, tw.fromY + (tw.toY - tw.fromY) * p);
  }

  // ---- token drag ----
  onTokenDown(id, e) {
    const s = getState();
    if (this.keys.alt) { // alt-click pings even over a token
      const map = s.maps[s.activeMapId];
      const pos = this.mapPos(e);
      if (map) A.ping(map.id, pos.x, pos.y);
      return;
    }
    if (e.button === 2) return; // handled by right-click
    const token = s.tokens[id];
    if (!token) return;
    e.stopPropagation?.();

    // Targeting mode: clicking a token (de)selects it as a target.
    if (s.ui.targeting) { A.toggleTarget(id); return; }

    // Players may only select/interact with tokens they control (their own or
    // DM-granted). Clicking a foreign token does nothing (no selection, no info).
    if (s.session.role !== 'dm' && !this.canControl(token)) { e.stopPropagation?.(); return; }

    // Shift = add/remove from the multi-selection (for combat), no drag.
    if (this.keys.shift && s.ui.tool === 'select') { A.toggleTokenSelection(id); return; }

    A.selectToken(id);
    if (s.ui.tool !== 'select' || !this.canDrag(token)) return;
    const pos = this.mapPos(e);
    this.drag = { id, offX: token.x - pos.x, offY: token.y - pos.y, lastX: token.x, lastY: token.y, startX: token.x, startY: token.y };
  }

  // Wheel adjustment of the current selection. dir ±1; rotate = Shift held.
  // Returns true if it consumed the wheel (so zoom is skipped).
  adjustSelectionWheel(dir, rotate) {
    const s = getState();
    if (s.ui.selectedLightId && s.lights[s.ui.selectedLightId]) {
      if (rotate) return true;
      const lt = s.lights[s.ui.selectedLightId];
      A.updateLight(lt.id, { dimFt: Math.max(0, (lt.dimFt || 0) + 5 * dir), brightFt: Math.max(0, (lt.brightFt || 0) + 5 * dir) });
      return true;
    }
    if (s.ui.selectedZoneId && s.zones[s.ui.selectedZoneId]) {
      const z = s.zones[s.ui.selectedZoneId];
      const p = { ...z.params };
      if (rotate && 'directionDeg' in p) p.directionDeg = (((p.directionDeg || 0) + 15 * dir) % 360 + 360) % 360;
      else for (const k of ['radiusFt', 'sideFt', 'lengthFt']) if (k in p) p[k] = Math.max(5, (p[k] || 0) + 5 * dir);
      A.updateZone(z.id, { params: p });
      return true;
    }
    // Tokens deliberately do NOT resize on wheel — scrolling over a selected
    // token should zoom the map like normal (token size is set via the context
    // menu). Only shapes (zones) and lights adjust on wheel.
    return false;
  }

  onDragMove(pos) {
    const s = getState();
    const token = s.tokens[this.drag.id];
    if (!token) return;
    let x = pos.x + this.drag.offX;
    let y = pos.y + this.drag.offY;
    if (!this.keys.ctrl) { // snap to grid by default; Ctrl = free move
      const snapped = snapToGrid(x, y, s.maps[s.activeMapId].grid, token.sizeCells);
      x = snapped.x; y = snapped.y;
    }
    // movement-blocking walls: reject a step that would cross one (keep last
    // valid position). Ctrl overrides snapping but NOT wall collision.
    const base = s.maps[s.activeMapId].levels?.[0]?.id || null;
    if (this.moveBlocked({ x: this.drag.lastX, y: this.drag.lastY }, { x, y }, token.level || base)) {
      x = this.drag.lastX; y = this.drag.lastY;
    } else {
      this.drag.lastX = x; this.drag.lastY = y;
    }
    // instant local display
    const node = this.tokens.nodes.get(this.drag.id);
    if (node) node.root.position.set(x, y);
    this.drag.x = x; this.drag.y = y;
    // live distance/movement-cost readout near the token
    const map = s.maps[s.activeMapId];
    if (map) {
      const base = map.levels?.[0]?.id || null;
      const level = this.displayedLevel(s, map, base);
      const ftRaw = fiveEDistanceFt(this.drag.startX, this.drag.startY, x, y, map.grid.size);
      const moveFt = this.rulerMoveFt({ from: { x: this.drag.startX, y: this.drag.startY }, to: { x, y } }, map, level, base);
      let txt = `${ftRaw} ft`;
      if (moveFt != null && Math.round(moveFt) > ftRaw) txt += ` · ${Math.round(moveFt)} ft Bew.`;
      this.dragLabel.text = txt;
      this.dragLabel.position.set(x, y - ((token.sizeCells || 1) * map.grid.size) / 2);
      this.dragLabel.visible = ftRaw > 0;
    }
    // throttled broadcast to peers
    const now = performance.now();
    if (now - this._lastBroadcast >= DRAG_BROADCAST_MS) {
      this._lastBroadcast = now;
      A.moveToken(this.drag.id, x, y);
    }
  }

  onDragEnd() {
    if (this.drag.x != null) A.moveToken(this.drag.id, this.drag.x, this.drag.y); // durable final
    const id = this.drag.id;
    this.drag = null;
    this.dragLabel.visible = false;
    this.checkTransition(id); // stepped on stairs/ladder?
    this.reconcile();
  }

  // ---- zone / fog / ruler placement ----
  onPlacingMove(pos) {
    const p = this.placing;
    p.to = pos;
    if (p.kind === 'ruler') A.setRuler({ from: p.from, to: pos });
    else if (p.kind === 'zone') this.previewZone();
    else if (p.kind === 'darkPaint' || p.kind === 'darkErase') {
      if (!p.last || Math.hypot(pos.x - p.last.x, pos.y - p.last.y) >= p.r * 0.5) this.stampDarkness(pos);
      this.drawDarkPreview(pos);
    }
    else if (p.kind === 'fog') {
      // Paint: stamp another disc once the brush has moved ~half its radius.
      const grid = getState().maps[getState().activeMapId]?.grid;
      const step = (grid?.size || 70) * 0.5;
      if (!p.last || Math.hypot(pos.x - p.last.x, pos.y - p.last.y) >= step) this.stampFog(pos);
    }
  }

  // Show the fog brush outline at the cursor (DM + fog tool), sized to the
  // current brush radius. Cleared whenever the fog tool isn't active.
  drawFogBrush(pos) {
    const s = getState();
    const g = this.brushGfx;
    if (s.ui.tool !== 'fog' || s.session.role !== 'dm') { g.clear(); return; }
    const map = s.maps[s.activeMapId];
    if (!map) { g.clear(); return; }
    const r = map.grid.size * (s.ui.fogBrushCells || 1);
    const erase = !!s.ui.fogErase;
    g.clear()
      .circle(pos.x, pos.y, r)
      .fill({ color: erase ? 0x000000 : 0xffffff, alpha: 0.12 })
      .stroke({ width: 2, color: erase ? 0xff5d5d : 0xffe066, alpha: 0.9 });
  }

  // Reveal/hide a disc of fog (circle brush) at a map-space point. Radius = the
  // DM's brush size (in grid cells); mode = reveal or hide (erase).
  stampFog(pos) {
    const s = getState();
    const map = s.maps[s.activeMapId];
    if (!map) return;
    const r = map.grid.size * (s.ui.fogBrushCells || 1);
    const segs = 20;
    const poly = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      poly.push({ x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r });
    }
    if (s.ui.fogErase) A.hideFog(map.id, poly);
    else A.revealFog(map.id, poly);
    if (this.placing) this.placing.last = pos;
  }

  // Darkness brush: accumulate circle stamps (paint) or points (erase) during
  // the stroke; committed once on pointer-up (onPlacingEnd).
  stampDarkness(pos) {
    const p = this.placing; if (!p) return;
    if (p.kind === 'darkPaint') p.stamps.push({ x: pos.x, y: pos.y, r: p.r });
    else if (p.kind === 'darkErase') p.points.push({ x: pos.x, y: pos.y });
    p.last = pos;
  }

  // Hover preview for the darkness brush (DM + light tool, darkness/erase mode),
  // shown even before painting starts — mirrors the fog brush cursor. While a
  // stroke is active, drawDarkPreview takes over (called from onPlacingMove).
  drawDarkBrushHover(pos) {
    if (this.placing) return; // active stroke draws its own preview
    const s = getState();
    const isDM = s.session.role === 'dm';
    const darkTool = s.ui.tool === 'light' && (s.ui.lightMode === 'darkness' || s.ui.lightMode === 'darkness-erase');
    if (!isDM || !darkTool) return;
    const map = s.maps[s.activeMapId];
    if (!map) return;
    const r = (map.grid.size || 70) * (s.ui.darkBrushCells || 2);
    const erase = s.ui.lightMode === 'darkness-erase';
    this.brushGfx.clear()
      .circle(pos.x, pos.y, r)
      .fill({ color: erase ? 0xff5d5d : 0x000000, alpha: 0.22 })
      .stroke({ width: 2, color: erase ? 0xff5d5d : 0x9db4ff, alpha: 0.9 });
  }

  drawDarkPreview(pos) {
    const p = this.placing; if (!p) return;
    const g = this.brushGfx; g.clear();
    const erase = p.kind === 'darkErase';
    if (p.kind === 'darkPaint') for (const s of p.stamps) g.circle(s.x, s.y, s.r).fill({ color: 0x000000, alpha: 0.5 });
    g.circle(pos.x, pos.y, p.r)
      .fill({ color: erase ? 0xff5d5d : 0x000000, alpha: 0.25 })
      .stroke({ width: 2, color: erase ? 0xff5d5d : 0x9db4ff, alpha: 0.9 });
  }

  previewZone() {
    const s = getState();
    const grid = s.maps[s.activeMapId]?.grid;
    const z = buildZoneFromDrag(s.ui, this.placing.from, this.placing.to, grid);
    if (!z) return;
    if (!this.placing.previewId) {
      this.placing.previewId = A.addZone({ ...z, createdBy: s.session.userId, preview: true });
    } else {
      A.updateZone(this.placing.previewId, z);
    }
  }

  onPlacingEnd() {
    const p = this.placing;
    if (p.kind === 'ruler') {
      A.setRuler(null);
    } else if (p.kind === 'zone') {
      // A pure click (no drag) never ran previewZone — build it now at the click
      // point so click-to-place works (zone size comes from the tool settings).
      if (!p.previewId) this.previewZone();
      if (p.previewId) A.updateZone(p.previewId, { preview: false }); // commit
    } else if (p.kind === 'darkPaint') {
      A.addDarknessStamps(p.stamps);
      this.brushGfx.clear();
    } else if (p.kind === 'darkErase') {
      A.eraseDarknessAt(p.points, p.r);
      this.brushGfx.clear();
    }
    // fog: discs are already stamped during down/move — nothing to commit here.
    this.placing = null;
  }

  onTokenContext(id, e) {
    e.preventDefault?.();
    const g = e.global;
    this.onContextMenu?.(id, g.x, g.y);
  }

  // Double-click a token → hand off to React, which decides: a character-bound
  // token opens its sheet; an NPC opens the statblock overlay.
  onTokenDoubleClick(id) {
    this.onTokenActivate?.(id);
  }
}

// Translate a center→edge drag into zone params for the active zone tool.
function buildZoneFromDrag(ui, from, to, grid) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dir = (Math.atan2(dy, dx) * 180) / Math.PI;
  const distPx = Math.hypot(dx, dy);
  const dragged = distPx > 6;
  const type = ui.zoneType || 'circle';
  const color = ui.zoneColor || '#ff5252';
  const p = ui.zoneParams || {};
  const base = { type, color, x: from.x, y: from.y };
  // Drag-to-size: the drag distance directly sets the radius / side / length in
  // ft (snapped to 5). A pure click (no drag) falls back to the tool-setting
  // size, so click-to-place still works.
  const sz = grid?.size || 70;
  const distFt = round5((distPx / sz) * 5);
  switch (type) {
    case 'circle': return { ...base, params: { radiusFt: dragged ? distFt : (p.radiusFt || 20) } };
    case 'square': return { ...base, params: { sideFt: dragged ? round5((distPx / sz) * 10) : (p.sideFt || 15) } };
    case 'cone':   return { ...base, params: { lengthFt: dragged ? distFt : (p.lengthFt || 30), directionDeg: dragged ? dir : (p.directionDeg || 0) } };
    default:       return null;
  }
}
const round5 = (v) => Math.max(5, Math.round(v / 5) * 5);

// 5e grid distance with the "alternating diagonal" variant (DMG): the 1st
// diagonal step costs 5 ft, the 2nd 10 ft, the 3rd 5 ft, … Straights are 5 ft.
// feet = (straights + diagonals)*5 + floor(diagonals/2)*5.
function fiveEDistanceFt(ax, ay, bx, by, gridSize) {
  const dc = Math.abs(Math.round((bx - ax) / gridSize));
  const dr = Math.abs(Math.round((by - ay) / gridSize));
  const diag = Math.min(dc, dr);
  const straight = Math.abs(dc - dr);
  return (straight + diag) * 5 + Math.floor(diag / 2) * 5;
}

// Multiply an #rrggbb colour's channels by `factor` (<1 darkens) → 0xRRGGBB.
function darkenColor(hex, factor) {
  const s = String(hex).replace('#', '');
  if (s.length < 6) return 0x888888;
  const r = Math.round(parseInt(s.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(s.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(s.slice(4, 6), 16) * factor);
  return (r << 16) | (g << 8) | b;
}

// Walls that are part of a closed loop = NON-bridge edges of the wall graph
// (vertices keyed by rounded coords). Such walls enclose an area (a "roofed"
// room); bridge walls (fences/open polylines) don't. Tarjan bridge finding.
function loopWallIds(walls) {
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const adj = new Map();
  for (const w of walls) {
    const ka = key(w.a); const kb = key(w.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ to: kb, id: w.id });
    adj.get(kb).push({ to: ka, id: w.id });
  }
  const disc = new Map(); const low = new Map(); const bridges = new Set();
  let t = 0;
  const stack = [];
  for (const start of adj.keys()) {
    if (disc.has(start)) continue;
    stack.push({ u: start, peid: null, i: 0 });
    while (stack.length) {
      const fr = stack[stack.length - 1];
      if (fr.i === 0) { disc.set(fr.u, t); low.set(fr.u, t); t++; }
      const edges = adj.get(fr.u) || [];
      if (fr.i < edges.length) {
        const e = edges[fr.i]; fr.i++;
        if (e.id === fr.peid) continue;
        if (!disc.has(e.to)) { fr.child = e.to; fr.cid = e.id; stack.push({ u: e.to, peid: e.id, i: 0 }); }
        else { low.set(fr.u, Math.min(low.get(fr.u), disc.get(e.to))); }
      } else {
        stack.pop();
        if (stack.length) {
          const par = stack[stack.length - 1];
          low.set(par.u, Math.min(low.get(par.u), low.get(fr.u)));
          if (low.get(fr.u) > disc.get(par.u)) bridges.add(fr.peid);
        }
      }
    }
  }
  const loop = new Set();
  for (const w of walls) if (!bridges.has(w.id)) loop.add(w.id);
  return loop;
}

// For each `seeThrough` wall, the centroid of its connected component (walls
// linked by shared endpoints). Used for one-sided occlusion: a see-through wall
// only blocks observers on the same side as this centroid (the loop interior),
// so from outside you look past the near wall into the loop.
function seeThroughCentroids(walls) {
  const st = walls.filter((w) => w.seeThrough);
  if (!st.length) return new Map();
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  // union-find over wall ids via shared vertices
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const w of st) parent.set(w.id, w.id);
  const byVert = new Map();
  for (const w of st) for (const k of [key(w.a), key(w.b)]) {
    if (byVert.has(k)) union(byVert.get(k), w.id); else byVert.set(k, w.id);
  }
  // accumulate centroid per component
  const acc = new Map(); // root -> {sx,sy,n}
  for (const w of st) {
    const r = find(w.id);
    const a = acc.get(r) || { sx: 0, sy: 0, n: 0 };
    a.sx += w.a.x + w.b.x; a.sy += w.a.y + w.b.y; a.n += 2;
    acc.set(r, a);
  }
  const out = new Map();
  for (const w of st) {
    const a = acc.get(find(w.id));
    out.set(w.id, { x: a.sx / a.n, y: a.sy / a.n });
  }
  return out;
}

// Are points p and q on the same side of the line through segment a→b?
function sameSideOfSeg(p, q, a, b) {
  const cross = (pt) => (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
  return cross(p) * cross(q) > 0;
}

// Climb-terrain height (ft) at a map point on a level (0 if none).
function terrainHeightAt(map, level, x, y) {
  const cell = pointToCell(x, y, map.grid);
  const k = `${cell.col},${cell.row}`;
  let h = 0;
  for (const tr of (map.terrain || [])) {
    if (tr.kind !== 'climb' || !Array.isArray(tr.cells)) continue;
    if ((tr.level || level) !== level) continue;
    if (tr.cells.includes(k)) h = Math.max(h, tr.ft || 0);
  }
  return h;
}

// Snap a point to the nearest grid-line intersection.
function snapPointToGrid(p, grid) {
  const sz = grid.size || 70;
  return {
    x: grid.offsetX + Math.round((p.x - grid.offsetX) / sz) * sz,
    y: grid.offsetY + Math.round((p.y - grid.offsetY) / sz) * sz,
  };
}

// Closest point on segment a→b to p.
function projectOnSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return { x: a.x + t * vx, y: a.y + t * vy };
}

// Shortest distance from a point to a line segment a→b (px).
function distPointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const cx = a.x + t * vx, cy = a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}

// Signed distance of (dx,dy) along the perpendicular of a direction (deg).
function perpDistance(dx, dy, dirDeg) {
  const d = ((dirDeg || 0) * Math.PI) / 180;
  return dx * -Math.sin(d) + dy * Math.cos(d);
}

const filterObj = (obj, pred) => { const o = {}; for (const k in obj) if (pred(obj[k])) o[k] = obj[k]; return o; };
const toObj = (arr) => { const o = {}; for (const e of arr) o[e.id] = e; return o; };

// Shortest distance from point p to segment a→b.
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Snap a map-space point to the nearest grid vertex (line intersection), so
// walls align cleanly to the grid. Hold Shift to place freely.
function snapVertex(pos, grid) {
  return {
    x: grid.offsetX + Math.round((pos.x - grid.offsetX) / grid.size) * grid.size,
    y: grid.offsetY + Math.round((pos.y - grid.offsetY) / grid.size) * grid.size,
  };
}
