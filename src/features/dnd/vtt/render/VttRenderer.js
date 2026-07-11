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
import { getState, subscribe, undo, redo, versions } from '../state/store';
import * as A from '../state/actions';
import { snapToGrid, pointToCell, feetToPx, cellCenter } from '../lib/geometry';
import { segmentsIntersect, visibilityPolygon, pointInAnyPolygon } from '../lib/visibility';
import { WALL_TYPES, wallPeekFt, fogModeOf } from '../lib/constants';
import { getMemoryStyle, getMemoryBrightness, getShowLightSwitches, getTerrainOpacity, getTerrainPattern, getTerrainColor, getClimbHeightStyle, getDifficultStyle, getTokenBadgeScale, getAcBadgeScale, getDmCursorLight, getDmPingColor, getDarkvisionTint, getConnectionMode, getRelayUrl, VTT_PREFS_EVENT } from '../lib/vttPrefs';
import { relayFullUrl } from '../lib/mapStorage';
import { fiveEDistanceFt, rulerMoveFt, climbMapFor, climbStepFt, darkenColor, loopWallIds, planarFaces, seeThroughCentroids, sameSideOfSeg, terrainHeightAt, projectOnSeg, distPointToSeg, perpDistance, offsetSightWall } from '../lib/wallGeometry';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';

// Wall blocking. Die Wand-KINDS sind nur PRESETS: explizite per-Wand-Overrides
// (blockMove/blockLight/blockSight, null = Preset-Default) gewinnen. Türen/
// Fenster behalten ihre Offen-Logik obendrauf: eine offene Tür blockt nie;
// ein geschlossenes Fenster lässt Licht durch, wenn es milchig/farbig ist
// (gedimmt/getönt — handhabt der Licht-Compositor über brightWalls).
const wallBlocksLight = (w) => {
  const base = w.blockLight ?? (
    w.kind === 'door' ? true
      : w.kind === 'window' ? (!w.milky && !w.color)
        : (WALL_TYPES[w.kind] || WALL_TYPES.both).blocksLight);
  if (w.kind === 'door' || w.kind === 'window') return !w.open && base;
  return base;
};
const wallBlocksMovement = (w) => {
  const base = w.blockMove ?? (
    (w.kind === 'door' || w.kind === 'window') ? true
      : (WALL_TYPES[w.kind] || WALL_TYPES.both).blocksMovement);
  // Nur eine offene TÜR gibt den Weg frei — ein offenes Fenster blockt Bewegung
  // weiterhin (wie bisher; niemand klettert automatisch durch).
  if (w.kind === 'door') return !w.open && base;
  return base;
};
// Sight ≠ light: a "shadow" wall blocks light but you can still SEE past it, so
// player vision uses this (not the light-blocking set).
// Fenster: GESCHLOSSEN blockt die Sicht (trübe/dunkle Scheibe), OFFEN lässt sie
// durch — analog zu Türen und intuitiv (zum Durchsehen Fenster öffnen).
const wallBlocksSight = (w) => {
  const base = w.blockSight ?? (
    (w.kind === 'door' || w.kind === 'window') ? true
      : (WALL_TYPES[w.kind] || WALL_TYPES.both).blocksSight);
  if (w.kind === 'door' || w.kind === 'window') return !w.open && base;
  return base;
};

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
    // Zonen (AoE-Templates) liegen ÜBER den Tokens — man soll immer sehen,
    // welche Tokens in einer Fläche stehen (halbtransparente Füllung).
    this.liveGroup.addChild(this.bg, this.grid.container, this.terrain.container, this.moveLayer, this.lights.container, this.auras, this.transitions.container, this.tokens.container, this.zones.container, this.currentMaskGfx);

    // DM-„Mauslicht" (Alt): KEIN additiver Lichtschein mehr — ein weicher
    // Kreis, in dem die Licht-/Dunkel-Überlagerung lokal ausgeblendet wird,
    // d.h. die Map erscheint dort in voller Helligkeit (inverse Maske auf dem
    // Licht-Compositor). Rein lokal, Spieler sehen nichts davon.
    this.cursorGlow = new Sprite(makeCursorRevealTexture());
    this.cursorGlow.anchor.set(0.5);
    this.cursorGlow.eventMode = 'none';
    this.cursorGlow.visible = false;
    this.liveGroup.addChild(this.cursorGlow);

    this.lightSwitches = new Container(); // player-clickable light switches (everyone)
    this.lightSwitches.eventMode = 'static';
    // Token badges/HP/AC overlay sits ABOVE walls & fog so they're never hidden
    // behind a wall icon or another token; masked to vision for players (below).
    this.badgeMaskGfx = new Graphics();
    this.tokens.overlay.addChild(this.badgeMaskGfx);
    this.world.addChild(
      this.bgGray, this.ghostLayer, this.liveGroup,
      this.fog.container, this.walls.container, this.lightMarkers, this.lightSwitches,
      this.tokens.overlay,
      this.pings.container, this.ruler.container,
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
    app.ticker.add(() => { const now = performance.now(); this.pings.tick(now); this.tickFlash(now); this.tickTween(now); this.tokens.tickTokens(this.drag?.id || this._tween?.id); this.tickAuras(); this.tickLuminousMotion(); });
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
    const baseMap = viewId ? s.maps[viewId] : null;
    // Ebenen/Stockwerke: eine Ebene kann ihr EIGENES Kartenbild + Grid tragen
    // (Ebene 1 = Basiskarte). Ist die angezeigte Ebene eine "Bild-Ebene", wird
    // für Hintergrund, Grid und Maße diese Ebene verwendet — Tokens/Wände/
    // Lichter filtern ohnehin schon nach `level`, teilen sich also die Karte.
    let map = baseMap;
    if (baseMap) {
      const base0 = baseMap.levels?.[0]?.id || null;
      const dispLvl = this.displayedLevel(s, baseMap, base0);
      const lvlObj = (baseMap.levels || []).find((l) => l.id === dispLvl);
      if (lvlObj && lvlObj.imageUrl) {
        map = { ...baseMap,
          imageUrl: lvlObj.imageUrl, imageFullName: lvlObj.imageFullName || null,
          imageUrlFull: lvlObj.imageUrlFull || null, imagePath: lvlObj.imagePath || null,
          grid: lvlObj.grid || baseMap.grid,
          width: lvlObj.width || baseMap.width, height: lvlObj.height || baseMap.height };
      }
    }

    // End an in-progress wall chain if the DM switched tools.
    if (this.wallChain && s.ui.tool !== 'walls') this.finishWallChain();

    // background — prefer the full-res ORIGINAL served by the relay (P2P,
    // uncompressed); fall back to the Supabase image if it's unreachable (relay
    // offline / local file lost) or fails; bounded retry on transient errors.
    // On a direct connection, prefer the untouched full-res original served by
    // the GM's relay (URL built from the LIVE relay address, so it survives a new
    // IP/port); else the legacy baked URL; else the Supabase (compressed) image.
    const onRelay = getConnectionMode() === 'relay' && getRelayUrl();
    const bgFull = onRelay ? (relayFullUrl(getRelayUrl(), map?.imageFullName) || map?.imageUrlFull || null) : null;
    const bgPrimary = bgFull || map?.imageUrl || null;
    const bgFallback = map?.imageUrl || null;
    if (bgPrimary !== this._bgUrl) {
      this._bgUrl = bgPrimary;
      this._bgTries = 0;
      this.bg.texture = Texture.EMPTY;
      if (bgPrimary) {
        const want = bgPrimary;
        // Map-Koordinaten-Größe JETZT einfangen: das Texture (v.a. das große
        // Relay-Original) kommt asynchron an und MUSS sofort auf die Map-Maße
        // skaliert werden — sonst rendert es bis zum nächsten Reconcile in
        // nativer Pixelgröße und alles Platzierte säße scheinbar falsch.
        const sizeW = map.width; const sizeH = map.height;
        const tryLoad = (url, isFallback) => loadTexture(url).then((tex) => {
          if (this._bgUrl !== want) return;
          if (tex) {
            this.bg.texture = tex;
            this.bg.width = sizeW; this.bg.height = sizeH;
            this.scheduleReconcile(); // Memory-Layer etc. übernehmen das Texture
            return;
          }
          if (!isFallback && bgFallback && bgFallback !== url) { tryLoad(bgFallback, true); return; } // relay original failed → Supabase
          if ((this._bgTries || 0) < 5) {
            this._bgTries = (this._bgTries || 0) + 1;
            setTimeout(() => { if (this._bgUrl === want) { this._bgUrl = null; this.scheduleReconcile?.(); } }, 700);
          }
        });
        tryLoad(bgPrimary, bgPrimary === bgFallback);
      }
    }
    this.bg.visible = !!map;
    // The background sprite must render at MAP coordinates regardless of the
    // texture's native pixels — the full-res relay original is larger than the
    // stored map size and would otherwise misalign grid/tokens/walls.
    if (map && this.bg.texture && this.bg.texture !== Texture.EMPTY) { this.bg.width = map.width; this.bg.height = map.height; }

    if (map) {
      const isDM = s.session.role === 'dm';
      const mode = fogModeOf(map);
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
      // Milky/frosted CLOSED windows pass dim light but block the bright band, so
      // light beyond them is dimmed one step. They block bright only, not dim.
      // Geschlossene milchige ODER farbige Fenster: Licht passiert, aber nur
      // die Dim-Stufe (Buntglas tönt zusätzlich die Fenster-Lichtquelle).
      const milkyWindows = mapWalls.filter((w) => w.kind === 'window' && (w.milky || w.color) && !w.open);
      const sightWalls = mapWalls.filter((w) => wallBlocksSight(w)); // block vision
      const observers = this.fogObservers(s, map, level, base);

      const bounds = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
      const playerDynamic = mode === 'dynamic' && !isDM;
      // Wall-graph derivations (loop edges + see-through centroids) only change
      // when a WALL changes — cache them on the store's walls version instead of
      // recomputing the graphs on every reconcile (e.g. each WASD step).
      const wallsKey = `${map.id}|${level}|${versions.walls}`;
      if (this._wallDerivedKey !== wallsKey) {
        this._wallDerivedKey = wallsKey;
        this._loopIds = loopWallIds(sightWalls);
        this._stCentroids = seeThroughCentroids(sightWalls);
      }
      const loopIds = this._loopIds;
      const stCentroids = this._stCentroids;
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
        const out = [];
        for (const w of sightWalls) {
          // Durchguck-Nähe (jede sicht-blockende Wand, nicht nur Busch): steht
          // der Beobachter näher als peekFt an der Wand, sieht er hindurch.
          // Optional begrenzt seeFarFt, WIE WEIT er dahinter sieht (0 = frei):
          // dann ersetzt eine parallel verschobene virtuelle Wand das Original.
          const peekFt = wallPeekFt(w);
          if (peekFt > 0 && distPointToSeg(o, w.a, w.b) <= feetToPx(peekFt, map.grid.size)) {
            const farFt = w.seeFarFt || 0;
            if (farFt > 0) out.push(offsetSightWall(w, o, feetToPx(farFt, map.grid.size)));
            continue;
          }
          if (w.heightFt > 0 && H >= w.heightFt && (w.noRoof || !loopIds.has(w.id))) continue;
          // one-sided see-through loop: drop the near wall (observer & loop centre
          // on opposite sides) so you look INTO the loop — unless this observer is
          // flagged as inside the loop (then it bounds them normally).
          if (w.seeThrough && stCentroids.has(w.id) && o.inside !== true && !sameSideOfSeg(o, stCentroids.get(w.id), w.a, w.b)) continue;
          out.push(w);
        }
        return out;
      };
      // Per-observer vision polygons, memoized per TOKEN: only the observer that
      // actually moved recomputes; everyone else reuses their cached polygon.
      // Key covers everything the polygon depends on: position, inside-flag,
      // walls, map fields (terrain heights / cover reach), map + level.
      this._visCache ||= new Map(); // token id -> { key, poly }
      const polyFor = (o) => {
        const key = `${Math.round(o.x)},${Math.round(o.y)},${o.inside ? 1 : 0},${versions.walls},${versions.maps},${map.id},${level}`;
        const hit = this._visCache.get(o.id);
        if (hit && hit.key === key) return hit.poly;
        const poly = visibilityPolygon(o, sightWallsFor(o), bounds);
        this._visCache.set(o.id, { key, poly });
        if (this._visCache.size > 200) this._visCache.delete(this._visCache.keys().next().value);
        return poly;
      };
      const visiblePolys = playerDynamic ? observers.map(polyFor) : null;
      // DM "preview a token's sight": with dynamic fog and a selected token on
      // this level, the DM sees everything in grayscale except what that token
      // currently sees (in colour). Without a selection, the DM sees all colour.
      const previewTok = (isDM && mode === 'dynamic' && s.ui.selectedTokenId)
        ? levelTokens[s.ui.selectedTokenId] : null;
      const dmPreviewPolys = previewTok
        ? [polyFor({ id: previewTok.id, x: previewTok.x, y: previewTok.y, inside: previewTok.inside })] : null;

      // Darkvision: ONLY the relevant viewer's own token(s) see one step better
      // (dark→dim) within range, clipped to line of sight, local to this client.
      //  • A player: each of their OWN controlled tokens that has darkvision.
      //    A player whose character has none gets nothing (never others' DV).
      //  • The DM: only the SELECTED token, and only if it has darkvision.
      // `id` = Token-Id des Beobachters: der Licht-Live-Pfad lässt die
      // DV-Scheibe damit der GERENDERTEN Token-Position folgen (Drag/Glide).
      let darkvision = [];
      if (playerDynamic) {
        darkvision = observers.map((o, i) => {
          const ft = this.tokenDarkvisionFt(s.tokens[o.id]);
          return ft > 0 ? { id: o.id, x: o.x, y: o.y, radiusPx: feetToPx(ft, map.grid.size), poly: visiblePolys[i] } : null;
        }).filter(Boolean);
      } else if (isDM && s.ui.selectedTokenId) {
        const tok = levelTokens[s.ui.selectedTokenId];
        const ft = tok ? this.tokenDarkvisionFt(tok) : 0;
        if (ft > 0) {
          const poly = (dmPreviewPolys && dmPreviewPolys[0]) || polyFor({ id: tok.id, x: tok.x, y: tok.y, inside: tok.inside });
          darkvision = [{ id: tok.id, x: tok.x, y: tok.y, radiusPx: feetToPx(ft, map.grid.size), poly }];
        }
      }

      // Light sources on this level: standalone lights + "luminous tokens"
      // (a token with a .light, positioned at the token). Glow + wall shadows.
      // The DM can switch dynamic light off per map (map.lightingEnabled).
      // Bewegtes Licht folgt der GERENDERTEN Token-Position (Drag/Glide) —
      // sonst springt der Schein aufs Zielfeld, während das Token gleitet.
      // liveLightKey fließt in die Licht-Revision ein, damit der Compositor
      // die Zwischenpositionen auch wirklich sieht (rev basiert sonst nur
      // auf Store-Versionen).
      // lumKey = Positionen der RUHENDEN leuchtenden Tokens (Teil der Licht-
      // Revision — ersetzt den versions.lights-Bump pro token/move). BEWEGTE
      // leuchtende Tokens (Drag/Tween/Peer-Ease) laufen getrennt (movingRev +
      // liveMovingIds): der Compositor stempelt sie pro Compose direkt, statt
      // die gecachten Coverage-Unionen aller Lichter neu zu bauen.
      let lumKey = '';
      let movingLightKey = '';
      const movingLightIds = new Set();
      const lightSources = map.lightingEnabled === false ? [] : [
        ...Object.values(s.lights).filter((l) => l.mapId === map.id && onLevel(l)),
        ...Object.values(levelTokens)
          .filter((t) => t.light)
          .map((t) => {
            // Light radius is measured from the token's edge (its space), not
            // its center — add the token's half-footprint in feet.
            const halfFt = ((t.sizeCells || 1) * 5) / 2;
            const moving = this._isTokenMoving(t.id);
            const live = moving ? this.tokens.nodes.get(t.id)?.root?.position : null;
            const lx = live ? live.x : t.x;
            const ly = live ? live.y : t.y;
            if (moving) { movingLightIds.add('tl_' + t.id); movingLightKey += `${t.id}:${Math.round(lx)},${Math.round(ly)};`; }
            else lumKey += `${t.id}:${Math.round(lx)},${Math.round(ly)};`;
            // A luminous token's light sits at the token's elevation (climb
            // terrain) so it shines over lower walls when the token is raised.
            return { id: 'tl_' + t.id, x: lx, y: ly, ...t.light, brightFt: (t.light.brightFt || 0) + halfFt, dimFt: (t.light.dimFt || 0) + halfFt, heightFt: t.light.heightFt ?? terrainHeightAt(map, level, lx, ly) };
          }),
      ];
      // Baseline darkness + placed darkness regions only apply while dynamic
      // lighting is on; disabling lighting leaves the map fully lit.
      const lightingOn = map.lightingEnabled !== false;
      const baseline = lightingOn ? (map.lightBaseline || 'bright') : 'bright';
      // "Geschlossene Räume immer dunkel": roofed wall-loops (incl. with a door /
      // window in them) get a dark interior even outdoors. Windows + open doors
      // then leak the OUTDOOR ambient (bright/dim) a short way inside, so a lit
      // exterior still spills through openings.
      let darkPolys = [];
      let ambientSources = [];
      if (lightingOn && map.enclosedDark) {
        darkPolys = this.enclosedRoomPolys(mapWalls, map.id, level);
        ambientSources = this.ambientOpeningSources(mapWalls, baseline, map.grid.size, darkPolys, { dir: map.worldShadowDir ?? 135, strength: map.worldShadowStrength ?? 0 });
      }
      this.lights.setZoom?.(this.viewport.scale); // programmatische Zooms (Fit etc.)
      const lightOpts = {
        renderer: this.app.renderer,
        // Cheap recompute gate: bumped by every wall/light/map change; die
        // Positionen ruhender leuchtender Tokens stehen explizit in lumKey.
        rev: `${versions.walls}|${versions.lights}|${versions.maps}|${map.id}|${level}|${lumKey}`,
        liveMovingIds: movingLightIds,
        movingRev: movingLightKey,
        // Wand-stabile Revision: Polygon-Cache + Welt-Schatten-RT müssen nur
        // bei Wand-/Map-Änderungen invalidieren, nicht bei jedem Licht-Move.
        wallsRev: `${versions.walls}|${versions.maps}|${map.id}|${level}`,
        sources: ambientSources.length ? lightSources.concat(ambientSources) : lightSources,
        grid: map.grid,
        walls: lightWalls,
        brightWalls: milkyWindows.length ? lightWalls.concat(milkyWindows) : lightWalls,
        shadowWalls: sightWalls, // Welt-Schatten nur von Sicht-blockenden Wänden
        bounds,
        style: 'classic', // immer klassische, klare Hell/Dämmer-Stufen
        baseline,
        darkness: lightingOn ? (map.darkness || []).filter((d) => (d.level || base) === level) : [],
        darkPolys,
        worldShadow: lightingOn ? { dir: map.worldShadowDir ?? 135, strength: map.worldShadowStrength ?? 0 } : null,
        darkvision: lightingOn ? darkvision : [],
        dvTint: getDarkvisionTint(), // clientseitige Dunkelsicht-Färbung
        contrast: map.lightContrast ?? 0.5,
        blur: map.lightBlur ?? 0,
      };
      // Solange ein leuchtendes Token ODER ein Dunkelsicht-Beobachter in
      // Bewegung ist, komponieren auch die Op-Reconciles (50ms-Broadcasts)
      // über den SICHTBAREN Ausschnitt — exakt wie der Live-Pfad. Vorher
      // wechselten sich volle Map und Ausschnitt ab, und jeder Wechsel
      // zerstörte den Low-Res-RT-Satz samt Coverage-Cache (Realloc +
      // Neuaufbau ALLER Lichter bis zu 40×/s → der Drag-Lag).
      // _lightEnv behält die vollen Bounds: Final-Pass + Live-Fallback
      // komponieren nach der Bewegung wieder die ganze Map.
      const lightsInMotion = movingLightIds.size > 0
        || darkvision.some((d) => d.id != null && this._isTokenMoving(d.id));
      this.lights.update(lightsInMotion
        ? { ...lightOpts, bounds: this.visibleMapBounds(map) || bounds, fullBounds: bounds }
        : lightOpts);
      // Umgebung für den leichten Licht-only-Refresh (refreshLightsLive):
      // beim Drag/Glide eines leuchtenden Tokens ändern sich NUR die
      // Quellpositionen — alles andere (Wände, Ambients, Darkness, …)
      // bleibt exakt der Stand dieses Reconciles.
      this._lightEnv = {
        mapId: map.id, level, base,
        ambientSources,
        opts: lightOpts,
        revPrefix: `${versions.walls}|${versions.lights}|${versions.maps}|${map.id}|${level}|`,
      };

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
      if (!this._seenLights) this._seenLights = new Set(); // Lichtschalter wie Türen: erst nach Sicht-Kontakt
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
        for (const lt of Object.values(s.lights)) {
          if (lt.mapId !== map.id || (lt.level || base) !== level || !lt.playerSwitch) continue;
          if (pointInAnyPolygon(lt.x, lt.y, polys)) this._seenLights.add(lt.id);
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
      // Display prefs are PER-CLIENT (local vttPrefs) — each player/DM chooses
      // how terrain looks for their own view. They apply in BOTH the DM and
      // player views (so the DM's own view matches what they configure); the
      // DM-only editing overlays are added on top inside the layer.
      this.terrain.update(terrObjs, map.grid, isDM, s.ui.selectedTerrainId, isDM && tool === 'terrain' ? (s.ui.terrainSelection || []) : [],
        { opacity: getTerrainOpacity(), pattern: getTerrainPattern(), color: getTerrainColor(), climbHeightStyle: getClimbHeightStyle(), difficultStyle: getDifficultStyle() });
      this.drawAuras(levelTokens, map.grid);
      const elevations = {};
      if ((map.terrain || []).some((t) => t.kind === 'climb')) {
        for (const tk of Object.values(levelTokens)) { const h = terrainHeightAt(map, level, tk.x, tk.y); if (h) elevations[tk.id] = h; }
      }
      // Both the marquee set AND the single click-selected token get the ring.
      const selectedTokenSet = [...(s.ui.selectedTokenIds || []), ...(s.ui.selectedTokenId ? [s.ui.selectedTokenId] : [])];
      // Combat turn markers (active + next-up token) + hovered-menu coupling.
      const init = s.initiative;
      const markers = {
        activeId: null, nextId: null, hoverId: s.ui.hoverTokenId || null,
        scope: map.turnMarkerScope || 'all', view: map.turnMarkerView || 'all', isDM,
        style: map.turnMarkerStyle || 'ring',
      };
      if (init?.active && init.order?.length) {
        markers.activeId = init.order[init.activeIndex]?.tokenId || null;
        markers.nextId = init.order[(init.activeIndex + 1) % init.order.length]?.tokenId || null;
      }
      // Live HP for the blood overlay: character-bound tokens keep their HP in
      // the character sheet (status.currentHp), not token.hp — resolve it so a
      // player's own token bleeds correctly and in sync, not just NPCs.
      let bloodHp = null;
      if (map.bloodyTokens === true || Object.values(levelTokens).some((tk) => tk.bloodied === 'on')) {
        bloodHp = {};
        for (const tk of Object.values(levelTokens)) {
          if (tk.characterId == null) continue;
          const ch = s.ui.characters?.[tk.characterId]?.data;
          if (!ch) continue;
          if (!this._maxHpCache) this._maxHpCache = new Map();
          let cached = this._maxHpCache.get(tk.characterId);
          if (!cached || cached.ref !== ch) {
            let max = tk.hpMax;
            try { max = computeCharacter(ch).hp?.max ?? tk.hpMax; } catch { /* keep token max */ }
            cached = { ref: ch, max };
            this._maxHpCache.set(tk.characterId, cached);
          }
          const hp = ch.status?.currentHp ?? cached.max;
          if (hp != null && cached.max) bloodHp[tk.id] = { hp, hpMax: cached.max };
        }
      }
      this.tokens.update(levelTokens, map.grid, selectedTokenSet, this.drag?.id || this._tween?.id, invisibleHidden, isDM, myId, map.bloodyTokens === true, elevations, markers, (map.tokenBadgeScale ?? 1) * getTokenBadgeScale(), bloodHp, getAcBadgeScale());
      // DM-only local cursor reveal — armed via pref, SHOWN only while Alt is
      // held (players never see it either way).
      this._glowArmed = isDM && getDmCursorLight();
      this._setReveal(this._glowArmed && this.keys.alt);
      if (this._glowArmed) { const gs = map.grid.size * 4.2; this.cursorGlow.width = gs; this.cursorGlow.height = gs; }
      this.updateMovementPreview();
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
      const mapPings = s.pings.filter((p) => p.mapId === map.id);
      this.pings.update(mapPings);
      // A DM focus ping pans this client's camera to it — once per ping.
      for (const p of mapPings) {
        if (p.focus && !(this._focusedPings ||= new Set()).has(p.id)) {
          this._focusedPings.add(p.id);
          this.viewport.centerOn(p.x, p.y);
        }
      }
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
        this.updateMemoryVision(map, visiblePolys, invisibleHidden ? filterObj(levelTokens, (t) => !invisibleHidden.has(t.id)) : levelTokens, level);
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
      // Auf Karten-/Stockwerks-Maße einpassen — Key enthält die Maße, damit ein
      // Wechsel auf eine Bild-Ebene mit ANDERER Größe neu einpasst.
      const fitKey = `${map.id}|${map.width}x${map.height}`;
      if (this._fittedMapId !== fitKey && map.width) {
        this.viewport.fit(map.width, map.height);
        this._fittedMapId = fitKey;
      }
    }
  }

  // ---- explored-memory compositor (player + dynamic fog) ----
  updateMemoryVision(map, polys, tokens, level) {
    // DM "Sicht zurücksetzen": when one of THIS client's own tokens has a newer
    // sightResetAt, wipe the accumulated explored memory (forces a fresh RT).
    const myId = getState().session.userId;
    const myReset = Math.max(0, ...Object.values(tokens).filter((t) => t.ownerId === myId).map((t) => t.sightResetAt || 0));
    if (myReset > (this._sightEpoch || 0)) {
      this._sightEpoch = myReset;
      this._exploredFor = null; // invalidate → recreated empty below
      this.tokenMemory = {};
    }
    // Explored-Memory + gesehene Objekte/Ghosts sind PRO EBENE (Stockwerk) —
    // sonst blutet der erkundete Bereich / gesehene Tokens von Ebene 1 auf
    // Ebene 2 durch. Key = map.id|level; ein Ebenenwechsel baut frisch auf.
    const levelKey = `${map.id}|${level ?? ''}`;
    // (re)create the explored-accumulation RenderTexture per map+level
    if (this._exploredFor !== levelKey || !this._exploredRT) {
      this._exploredRT?.destroy(true);
      this._exploredSprite?.destroy();
      this._exploredRT = RenderTexture.create({ width: map.width, height: map.height });
      this._exploredSprite = new Sprite(this._exploredRT);
      this.bgGray.addChild(this._exploredSprite); // mask lives under the masked sprite
      this._exploredFor = levelKey;
      this.tokenMemory = {};
      // Forget explored doors/transitions/light switches too (sight-reset or new map).
      this._seenWalls?.clear();
      this._seenTransitions?.clear();
      this._seenLights?.clear();
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
    if (this.bg.texture && this.bg.texture !== Texture.EMPTY) {
      this.bgGrayMap.texture = this.bg.texture;
      // Wie das Live-bg IMMER auf Map-Koordinaten skalieren — das Relay-
      // Original ist größer als die gespeicherte Map-Größe.
      this.bgGrayMap.width = map.width; this.bgGrayMap.height = map.height;
    }
    this.drawGrayGrid(map);
    this.bgGray.mask = this._exploredSprite;

    // live colour world only within current vision (empty mask → nothing live)
    this.currentMaskGfx.clear();
    for (const poly of polys) if (poly.length >= 3) this.currentMaskGfx.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    this.liveGroup.mask = this.currentMaskGfx;
    this.setBadgeMask(polys); // badges-on-top overlay clipped to the same vision

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
    if (this.bg.texture && this.bg.texture !== Texture.EMPTY) {
      this.bgGrayMap.texture = this.bg.texture;
      this.bgGrayMap.width = map.width; this.bgGrayMap.height = map.height;
    }
    this.drawGrayGrid(map);
    this.bgGray.mask = null; // whole map is gray (DM sees all)

    this.currentMaskGfx.clear();
    for (const poly of polys) if (poly.length >= 3) this.currentMaskGfx.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    this.liveGroup.mask = this.currentMaskGfx;
    this.setBadgeMask(polys);

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
    this.clearBadgeMask(); // DM sees all → badges unmasked
    this.bgGray.visible = false;
    this.bgGray.mask = null;
    if (this.ghostLayer.visible) {
      this.ghostLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.ghostLayer.visible = false;
    }
  }

  // Clip the always-on-top token-badge overlay to the given vision polygons (a
  // SEPARATE mask graphic — a Pixi mask can only belong to one object).
  setBadgeMask(polys) {
    const g = this.badgeMaskGfx;
    g.clear();
    for (const poly of polys) if (poly.length >= 3) g.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
    this.tokens.overlay.mask = g;
  }
  clearBadgeMask() {
    this.badgeMaskGfx.clear();
    this.tokens.overlay.mask = null;
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
    if (s.ui.spectator) return false; // Zuschauer (keine Session): nur ansehen
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
    if (fogModeOf(map) !== 'dynamic') return [];
    if (s.session.role === 'dm') return [];
    const onMap = Object.values(s.tokens).filter((t) => t.mapId === map.id && (t.level || base) === level);
    let controlled = onMap.filter((t) => this.canControl(t));
    if (!controlled.length) controlled = onMap.filter((t) => t.kind === 'player'); // demo fallback
    // Selecting one of your tokens focuses vision on it (so a player who controls
    // several — e.g. a companion NPC — can switch whose eyes they look through).
    const sel = s.ui.selectedTokenId;
    if (sel && controlled.some((t) => t.id === sel)) controlled = controlled.filter((t) => t.id === sel);
    const obs = controlled.map((t) => ({ x: t.x, y: t.y, inside: t.inside, id: t.id }));
    // Einmalige Phantom-Beobachter an den Schritt-Mittelpunkten der EIGENEN
    // Bewegung (moveSelectedByCell): schließt Explored-Lücken, die nur auf dem
    // Weg zwischen zwei Feldern sichtbar waren (z.B. durch einen Türspalt).
    if (this._visTrail?.length) {
      for (const tr of this._visTrail) {
        if (controlled.some((t) => 'trail_' + t.id === tr.id)) obs.push(tr);
      }
      this._visTrail = null;
    }
    return obs;
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

  // (placeDoorOnWall wurde entfernt — Türen/Fenster werden immer per
  // Zwei-Klick-Zeichnung platziert, auch direkt in bestehende Wände.)

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
      // Licht-Blur ist screen-space — beim Zoomen sofort nachziehen, sonst
      // frisst er beim Rauszoomen die Schatten-/Dunkelflächen auf.
      this.lights?.setZoom?.(this.viewport.scale);
    };
    const onCtx = (e) => e.preventDefault(); // suppress native menu; we use our own
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);

    const onKey = (down) => (e) => {
      if (e.key === 'Shift') this.keys.shift = down;
      if (e.code === 'Space') this.keys.space = down;
      if (e.key === 'Alt') { this.keys.alt = down; this._setReveal(!!(this._glowArmed && down)); if (down) e.preventDefault(); }
      if (e.key === 'Control') this.keys.ctrl = down;
    };
    const kd = onKey(true), ku = onKey(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    // WASD = move selected token cell-by-cell; Delete = remove selected zone.
    const onAction = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // contentEditable-Flächen (Handout-/Journal-RichTextEditor) sind
      // Tippen, kein Map-Shortcut — sonst frisst WASD die Buchstaben.
      if (e.target?.isContentEditable) return;
      // Ctrl/Cmd+Z = undo the last change (anywhere on the map).
      // Ctrl+Z = undo; Ctrl+Y / Ctrl+Shift+Z = redo.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (e.shiftKey) redo(); else undo(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { redo(); e.preventDefault(); return; }
      if (e.key === 'Escape' && getState().ui.pendingTokenPlace) { A.cancelTokenPlacement(); return; }
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
    // Bottom bar → "center on my token" (double-click the AC badge).
    const onCenter = (ev) => {
      const cid = ev.detail?.characterId;
      if (cid == null) return;
      const s2 = getState();
      const tok = Object.values(s2.tokens).find((t) => t.mapId === s2.activeMapId && String(t.characterId) === String(cid));
      if (tok) this.viewport.centerOn(tok.x, tok.y);
    };
    window.addEventListener('vtt:center-token', onCenter);

    this.removeInput = () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('keydown', onAction);
      canvas.removeEventListener('dblclick', onDbl);
      window.removeEventListener('vtt:center-token', onCenter);
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

    // Alt-click = ping, in any tool. DM + Ctrl dazu = FOKUS-Ping: alle Kameras
    // schwenken auf die Stelle (Aufmerksamkeit der ganzen Runde).
    if (this.keys.alt) { A.ping(map.id, pos.x, pos.y, this.myPingColor(s, map), this.keys.ctrl && s.session.role === 'dm'); return; }

    // Click-to-place: an armed token (Bestiary/TokenPanel) spawns on the
    // clicked grid cell. Left click only; Esc cancels (see onAction).
    // Klick-zu-Platzieren: DM für alles; ein Spieler darf sein EIGENES
    // Token platzieren (kind 'player' + eigene ownerId).
    if (s.ui.pendingTokenPlace && e.button === 0
      && (s.session.role === 'dm' || (s.ui.pendingTokenPlace.kind === 'player' && s.ui.pendingTokenPlace.ownerId === s.session.userId))) {
      const { __queue, ...def } = s.ui.pendingTokenPlace;
      const spot = snapToGrid(pos.x, pos.y, map.grid, def.sizeCells || 1);
      A.addToken({ ...def, x: spot.x, y: spot.y });
      // "+ Alle Spieler": die restlichen Tokens der Reihe nach platzieren.
      if (__queue?.length) {
        const [next, ...rest] = __queue;
        A.armTokenPlacement(rest.length ? { ...next, __queue: rest } : next);
      } else {
        A.cancelTokenPlacement();
      }
      return;
    }

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
    } else if ((tool === 'light' || tool === 'walls') && s.session.role === 'dm' && this.keys.shift) {
      // Shift-Kasten: Wände bzw. Lichter im Rahmen mehrfach auswählen (Batch-
      // Editing). Der Kasten-Typ richtet sich nach dem aktiven Werkzeug.
      this.marquee = { from: pos, to: pos, add: true, kind: tool };
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
    } else if (tool === 'walls' && (s.ui.wallKind === 'door' || s.ui.wallKind === 'window') && s.session.role === 'dm') {
      // Doors AND windows are placed the same way: click a start vertex (grid-
      // snapped), then an end vertex → a resizable door/window segment. Clicking
      // ON an existing wall passes through (the click bails in onWallDown), so you
      // can drop one straight into a wall. Shift = free placement.
      const kind = s.ui.wallKind;
      const v = this.keys.ctrl ? pos : this.snapWallVertex(pos); // Strg = frei (ohne Snap)
      if (!this.doorDraft) {
        this.doorDraft = { start: v, kind };
        this.walls.drawPreview(v, v, kind);
      } else {
        if (Math.hypot(v.x - this.doorDraft.start.x, v.y - this.doorDraft.start.y) > 2) {
          A.selectWall(A.addWall({ mapId: map.id, a: this.doorDraft.start, b: v, kind: this.doorDraft.kind || kind }));
        }
        this.doorDraft = null;
        this.walls.drawPreview(null, null);
      }
    } else if (tool === 'walls' && s.session.role === 'dm') {
      // Chained walls: each click connects to the previous vertex so segments
      // share exact endpoints (no gaps). Right-click / Esc / Enter / dbl-click
      // ends the chain.
      let v = this.keys.ctrl ? pos : this.snapWallVertex(pos); // Strg = frei (ohne Snap)
      // Clicking the MIDDLE of an existing wall splits it there, creating a
      // junction you can then connect to / drag (Strg = ignore, place freely).
      if (!this.keys.ctrl) {
        const sp = this.maybeSplitWall(pos, v, map, level);
        if (sp) { v = sp; this.flashAt(v.x, v.y); } // confirm the dock
        else if (this.snappedToExistingVertex(v)) this.flashAt(v.x, v.y);
      }
      if (!this.wallChain) {
        this.wallChain = { start: v, last: v };
      } else {
        // Eigene Presets (VTT-Einstellungen) liefern Block-Overrides mit —
        // kind ist dann 'both', das Verhalten steckt in den Overrides.
        A.addWall({ mapId: map.id, a: this.wallChain.last, b: v, kind: s.ui.wallKind, ...(s.ui.wallOverrides || {}) });
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
      if (s.ui.spectator) return; // Zuschauer: keine Flächen platzieren
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
      // Vorhandenes Feld anklicken → auswählen (Editor zum Benennen/Verbinden).
      // Leeres Feld → neues Feld platzieren + auswählen. Das VERBINDEN passiert
      // im Editor (oben) — auch mehrere Ziele, auch gleicher Layer (Portale).
      const cell = pointToCell(pos.x, pos.y, map.grid);
      const lvl = s.ui.activeLevel || map.levels?.[0]?.id;
      const existing = Object.values(s.transitions).find(
        (t) => t.mapId === map.id && (t.level || lvl) === lvl && t.col === cell.col && t.row === cell.row);
      if (existing) {
        A.selectTransition(existing.id);
      } else {
        const id = A.addTransition({ mapId: map.id, level: lvl, col: cell.col, row: cell.row, kind: s.ui.transitionKind });
        A.selectTransition(id);
      }
    } else if (tool === 'select') {
      // Click a terrain object's cell OR a transition field (stairs/ladder/
      // portal) to select it (DM); else marquee tokens.
      if (s.session.role === 'dm') {
        const cell = pointToCell(pos.x, pos.y, map.grid);
        const key = `${cell.col},${cell.row}`;
        // Transition zuerst (Treppe/Leiter/Portal): auf ihrem Feld auswählbar,
        // damit man den Editor auch mit dem Auswahl-Werkzeug öffnen kann.
        const trHit = Object.values(s.transitions).find(
          (t) => t.mapId === map.id && (t.level || (map.levels?.[0]?.id || null)) === level && t.col === cell.col && t.row === cell.row);
        if (trHit) { A.selectTransition(trHit.id); return; }
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
    if (this._glowArmed) { this.cursorGlow.position.set(pos.x, pos.y); this._setReveal(this.keys.alt); }
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
      const v = this.keys.ctrl ? pos : this.snapWallVertex(pos);
      this.walls.drawPreview(this.wallChain.last, v, getState().ui.wallKind);
      return;
    }
    if (this.doorDraft) {
      const v = this.keys.ctrl ? pos : this.snapWallVertex(pos);
      this.walls.drawPreview(this.doorDraft.start, v, this.doorDraft.kind || 'door');
      return;
    }
    if (this.placing) this.onPlacingMove(pos);
  }

  finishWallChain() {
    this.wallChain = null;
    this.walls.drawPreview(null, null);
  }

  // Ping-Farbe = eigene Spielerfarbe (Token dieses Users auf der Map), beim
  // DM das DM-Gelb. Fällt auf ein Spieler-Blau zurück, falls kein Token da ist.
  myPingColor(s, map) {
    if (s.session.role === 'dm') return getDmPingColor();
    const mine = Object.values(s.tokens).find((t) => t.mapId === map.id
      && (t.ownerId === s.session.userId || (t.characterId != null && String(t.characterId) === String(s.ui.myCharacterId))));
    return mine?.color || '#42a5f5';
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
    const { from, to, add, kind } = this.marquee;
    const x1 = Math.min(from.x, to.x), y1 = Math.min(from.y, to.y);
    const x2 = Math.max(from.x, to.x), y2 = Math.max(from.y, to.y);
    // Werkzeug-Kasten: Wände bzw. Lichter im Rahmen mehrfach auswählen.
    if (kind === 'walls' || kind === 'light') {
      const map = s.maps[s.activeMapId];
      const lvl = map?.levels?.[0]?.id || null;
      const level = this.displayedLevel(s, map, lvl);
      const inBox = (px, py) => px >= x1 && px <= x2 && py >= y1 && py <= y2;
      if (kind === 'walls') {
        const ids = Object.values(s.walls).filter((w) => w.mapId === s.activeMapId
          && inBox((w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2)).map((w) => w.id);
        if (ids.length) A.selectWalls(add && s.ui.selectedWallIds?.length ? [...new Set([...s.ui.selectedWallIds, ...ids])] : ids);
      } else {
        const ids = Object.values(s.lights).filter((l) => l.mapId === s.activeMapId
          && (l.level || lvl) === level && inBox(l.x, l.y)).map((l) => l.id);
        if (ids.length) A.selectLights(add && s.ui.selectedLightIds?.length ? [...new Set([...s.ui.selectedLightIds, ...ids])] : ids);
      }
      this.marqueeGfx.clear();
      this.marquee = null;
      return;
    }
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
    // While a door/window DRAFT is in progress the click must fall through to
    // the stage (it places the next vertex). Otherwise ANY wall-tool element is
    // selectable/editable regardless of which sub-kind is armed.
    if (s.ui.tool === 'walls' && this.doorDraft) return;
    // While drawing a wall chain, a click must place/close a vertex — never
    // select the wall (otherwise you can't snap the loop shut on the start).
    if (this.wallChain) return;
    // Selectable with the select tool OR the walls tool (walls only show while
    // the walls tool is active, so you must be able to pick them there to edit).
    if (s.ui.tool !== 'select' && s.ui.tool !== 'walls') return;
    e.stopPropagation?.();
    // Wand-Tool: Klick NAHE einem Endpunkt = von dort eine neue, verbundene Wand
    // ziehen (Abzweigung); Klick auf die MITTE = Segment auswählen/bearbeiten.
    // BEIDES direkt beim ersten Klick — nicht erst selektieren.
    if (s.ui.tool === 'walls' && s.session.role === 'dm' && !this.keys.shift) {
      const wall0 = s.walls[id];
      if (wall0 && wall0.kind !== 'door' && wall0.kind !== 'window') {
        const p = this.mapPos(e);
        const grid = s.maps[s.activeMapId]?.grid?.size || 70;
        const dA = Math.hypot(wall0.a.x - p.x, wall0.a.y - p.y);
        const dB = Math.hypot(wall0.b.x - p.x, wall0.b.y - p.y);
        if (Math.min(dA, dB) < grid * 0.35) {
          const end = dA < dB ? wall0.a : wall0.b;
          A.selectWall(null);
          const v = { x: end.x, y: end.y };
          this.wallChain = { start: v, last: v };
          this.walls.drawPreview(v, v, s.ui.wallKind);
          this.flashAt(v.x, v.y);
          return;
        }
      }
    }
    // Shift-Klick (DM): Wand zur Mehrfachauswahl hinzufügen/entfernen —
    // danach im Editor alle gemeinsam ändern.
    if (this.keys.shift && s.session.role === 'dm') {
      const cur = s.ui.selectedWallIds?.length ? s.ui.selectedWallIds : (s.ui.selectedWallId ? [s.ui.selectedWallId] : []);
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      A.selectWalls(next);
      return;
    }
    // Double-click selects the WHOLE connected wall component (loop/chain) so
    // its light/sight settings can be edited in one go.
    const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this._lastWallTap && this._lastWallTap.id === id && nowT - this._lastWallTap.t < 350) {
      this._lastWallTap = null;
      // Editier-Selektion (ganze Wand-Kette) ist DM-only — Spieler konnten
      // sich per Schnell-Doppelklick sonst die Endpunkt-Handles holen.
      if (s.session.role === 'dm') { A.selectWalls(this.connectedWallIds(id)); return; }
    } else {
      this._lastWallTap = { id, t: nowT };
    }
    const wall = s.walls[id];
    if (wall?.kind === 'door' || wall?.kind === 'window') {
      // Walls tool = edit (select → move/resize handles). Select tool = play:
      // toggle open/closed without changing the current selection.
      if (s.ui.tool === 'walls' && s.session.role === 'dm') { A.selectWall(id); return; }
      A.toggleDoor(id); // optimistic + RPC (persists for players) + echo-guarded + cooldown
      return;
    }
    if (s.session.role === 'dm') A.selectWall(id);
  }

  onWallHandleStart(id, end, e) {
    const s0 = getState();
    if (s0.session.role !== 'dm') return; // Wand-Editing ist DM-only
    const t = s0.ui.tool;
    if (t !== 'select' && t !== 'walls') return;
    // Door mode: on a NON-door wall, let the click fall through to the stage so
    // a NEW door is placed instead of grabbing the endpoint handle. An existing
    // door's handles stay grabbable so placed doors remain editable.
    if (t === 'walls' && this.doorDraft) return; // mid-draft: click places the vertex
    e.stopPropagation?.();
    const s = getState();
    const w = s.walls[id];
    const base = s.maps[s.activeMapId]?.levels?.[0]?.id || null;
    const lvl = w.level || base;
    const v = w[end];
    // Wand-Tool: Klick auf einen ECKPUNKT zieht von GENAU diesem Punkt eine neue,
    // verbundene Wand weiter (Abzweigung) — kein Strg nötig. Endpunkte VERSCHIEBEN
    // macht man mit dem Auswahl-Tool. So kann man im Wand-Tool ein Segment (Mitte)
    // bearbeiten ODER an einem Endpunkt weiterbauen.
    if (t === 'walls' && !this.wallChain) {
      A.selectWall(null);
      this.wallChain = { start: { x: v.x, y: v.y }, last: { x: v.x, y: v.y } };
      this.walls.drawPreview(v, v, s.ui.wallKind);
      this.flashAt(v.x, v.y);
      return; // KEIN Endpunkt-Drag im Wand-Tool
    }
    A.selectWall(id);
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
  // INKREMENTELL: bestehende Nodes werden aktualisiert statt neu gebaut —
  // ein Toggle wechselt nur Tint/Halo (synchron, kein Icon-Neuladen, kein
  // Flackern), Position folgt Licht-Drags live.
  drawLightSwitches(map, level, base) {
    const c = this.lightSwitches;
    const s = getState();
    if (!this._switchNodes) this._switchNodes = new Map();
    const size = (map.grid.size || 70) * 0.38;
    const fogMode = fogModeOf(map);
    const gateUnseen = s.session.role !== 'dm' && fogMode === 'dynamic';
    const show = !(s.session.role !== 'dm' && !getShowLightSwitches());
    const wanted = new Map();
    if (show) {
      for (const lt of Object.values(s.lights)) {
        if (lt.mapId !== map.id || (lt.level || base) !== level || !lt.playerSwitch) continue;
        // Wie Türen: bei dynamischem Fog erst sichtbar, nachdem die Position
        // einmal wirklich in der Sicht lag.
        if (gateUnseen && !this._seenLights?.has(lt.id)) continue;
        wanted.set(lt.id, lt);
      }
    }
    for (const [id, e] of this._switchNodes) {
      if (!wanted.has(id)) { e.node.destroy({ children: true }); this._switchNodes.delete(id); }
    }
    for (const [id, lt] of wanted) {
      const on = lt.enabled !== false;
      let e = this._switchNodes.get(id);
      if (!e) {
        const node = new Container();
        node.eventMode = 'static';
        node.cursor = 'pointer';
        const halo = new Graphics();
        const sp = new Sprite();
        sp.anchor.set(0.5);
        node.addChild(halo, sp);
        node.on('pointerdown', (ev) => { ev.stopPropagation?.(); node.scale.set(0.9); A.toggleLight(id); });
        node.on('pointerup', () => node.scale.set(1.18));
        node.on('pointerupoutside', () => node.scale.set(1));
        node.on('pointerover', () => node.scale.set(1.18));
        node.on('pointerout', () => node.scale.set(1));
        c.addChild(node);
        e = { node, sp, halo, icon: null, on: null, size: 0 };
        this._switchNodes.set(id, e);
      }
      e.node.position.set(lt.x, lt.y);
      const iconUrl = lt.icon || '/Assets/map/lightswitch.svg';
      if (e.icon !== iconUrl || e.size !== size) {
        e.icon = iconUrl; e.size = size;
        loadIcon(iconUrl).then((tex) => {
          if (!tex || e.sp.destroyed) return;
          e.sp.texture = tex;
          e.sp.width = e.sp.height = e.size;
        });
      }
      if (e.on !== on || e.haloSize !== size) {
        e.on = on; e.haloSize = size;
        e.sp.tint = on ? 0x000000 : 0xffffff;
        e.halo.clear().circle(0, 0, size * 0.62).fill({ color: on ? 0xffffff : 0x000000, alpha: 0.35 });
      }
    }
  }

  // Leichter Licht-only-Refresh für Drag/Glide leuchtender Tokens: statt der
  // kompletten Reconcile-Pipeline (Token-Diff, Wände, Terrain, Fog, Auren, …)
  // wird NUR der Licht-Compositor mit den Parametern des letzten Reconciles
  // und frischen Live-Positionen gefüttert. Volle Reconciles laufen weiter
  // über die Ops (Broadcast/Store) — hier geht es nur um die Zwischenframes.
  refreshLightsLive() {
    // rAF-Koaleszenz: Pointer-Events feuern mit bis zu 1000Hz (Gaming-Maus) —
    // ohne Bündelung ersäuft der Main-Thread im Quellen-Neubau, und genau das
    // fühlt sich als Lag an. Max. ein Refresh pro Frame.
    if (this._lightLiveRaf) return;
    this._lightLiveRaf = requestAnimationFrame(() => {
      this._lightLiveRaf = 0;
      this._refreshLightsLiveNow();
    });
  }

  // Sichtbarer Karten-Ausschnitt in MAP-Koordinaten (für viewport-begrenztes
  // Live-Compositing): der Licht-Compose muss beim Bewegen NUR das komponieren,
  // was auf dem Schirm ist — die Kosten hängen dann an der Bildschirm- statt an
  // der Map-Größe (auf 8192px-Maps der entscheidende Gewinn). Mit etwas Rand.
  visibleMapBounds(map, padPx) {
    try {
      const W = this.app.renderer.width; const H = this.app.renderer.height;
      const a = this.viewport.toMap(0, 0); const b = this.viewport.toMap(W, H);
      const pad = padPx ?? (map.grid?.size || 70) * 1.5;
      const minX = Math.max(0, Math.min(a.x, b.x) - pad);
      const minY = Math.max(0, Math.min(a.y, b.y) - pad);
      const maxX = Math.min(map.width, Math.max(a.x, b.x) + pad);
      const maxY = Math.min(map.height, Math.max(a.y, b.y) + pad);
      if (maxX - minX < 8 || maxY - minY < 8) return null;
      return { minX, minY, maxX, maxY };
    } catch { return null; }
  }

  // Bewegt sich dieses Token GERADE auf dem Schirm? Lokaler Drag/WASD-Tween
  // oder Peer-Ease (Sprite noch nicht am Ziel _tx/_ty). Gemeinsames Prädikat
  // für Licht-Split (Reconcile + Live-Pfad) und Glide-Erkennung.
  _isTokenMoving(id) {
    if (this.drag?.id === id || this._tween?.id === id) return true;
    const node = this.tokens.nodes.get(id);
    return !!(node && node._tx != null
      && (Math.abs(node.root.position.x - node._tx) > 0.5 || Math.abs(node.root.position.y - node._ty) > 0.5));
  }

  // Pro Frame: gleitet gerade ein leuchtendes Token (lokal ODER per Peer-Ease),
  // folgt das Licht per leichtem Live-Refresh — für jeden Client, nicht nur den
  // Ziehenden.
  tickLuminousMotion() {
    if (!this._lightEnv) return;
    const s = getState();
    const map = s.maps[s.activeMapId];
    if (!map || map.lightingEnabled === false) return;
    let moving = false;
    for (const t of Object.values(s.tokens)) {
      if (!t.light || t.mapId !== map.id) continue;
      if (this._isTokenMoving(t.id)) { moving = true; break; }
    }
    // Auch reine Dunkelsicht-Beobachter (ohne eigenes Licht) triggern den
    // Live-Refresh — die DV-Scheibe folgt sonst nur im 50ms-Op-Takt.
    if (!moving) {
      for (const d of (this._lightEnv.opts.darkvision || [])) {
        if (d.id != null && this._isTokenMoving(d.id)) { moving = true; break; }
      }
    }
    if (moving) this.refreshLightsLive();
  }

  _refreshLightsLiveNow() {
    const env = this._lightEnv;
    if (!env) return;
    const s = getState();
    if (s.activeMapId !== env.mapId) return;
    const map = s.maps[env.mapId];
    if (!map || map.lightingEnabled === false) return;
    const { level, base } = env;
    let liveKey = '';
    let movingKey = '';
    const movingIds = new Set();
    const sources = [
      ...Object.values(s.lights).filter((l) => l.mapId === map.id && (l.level || base) === level),
      ...Object.values(s.tokens)
        .filter((t) => t.mapId === map.id && (t.level || base) === level && t.light)
        .map((t) => {
          const halfFt = ((t.sizeCells || 1) * 5) / 2;
          // IMMER die GERENDERTE Sprite-Position nutzen (nicht nur bei lokalem
          // Drag/Tween): so folgt das Licht auch bei PEER-Bewegungen dem weich
          // gleitenden Token — für jeden Client, nicht nur den Ziehenden.
          const rp = this.tokens.nodes.get(t.id)?.root?.position;
          const lx = rp ? rp.x : t.x;
          const ly = rp ? rp.y : t.y;
          // Bewegte leuchtende Tokens gehen in movingRev/liveMovingIds: der
          // Compositor stempelt sie pro Frame direkt, die statischen Coverage-
          // Unionen (rev aus liveKey) bleiben über die ganze Bewegung gültig.
          if (this._isTokenMoving(t.id)) { movingIds.add('tl_' + t.id); movingKey += `${t.id}:${Math.round(lx)},${Math.round(ly)};`; }
          else liveKey += `${t.id}:${Math.round(lx)},${Math.round(ly)};`;
          return { id: 'tl_' + t.id, x: lx, y: ly, ...t.light, brightFt: (t.light.brightFt || 0) + halfFt, dimFt: (t.light.dimFt || 0) + halfFt, heightFt: t.light.heightFt ?? terrainHeightAt(map, level, lx, ly) };
        }),
      ...env.ambientSources,
    ];
    // Live: nur den sichtbaren Ausschnitt komponieren; fullBounds trägt die
    // volle Map-Größe, damit der Final-Pass (in Ruhe) wieder alles komponiert.
    // KEIN bounds-Salz im rev: das Compose-Fenster steckt im Compositor selbst
    // in der Signatur (winSig) — so ergeben Live-Frames und Op-Reconciles
    // während der Bewegung IDENTISCHE Coverage-Signaturen und teilen sich den
    // gecachten statischen Licht-Aufbau, statt ihn sich gegenseitig zu nullen.
    // Dunkelsicht folgt der gerenderten Token-Position live (die Scheibe
    // wandert mit; ihr LOS-Polygon bleibt bis zum nächsten Reconcile stehen).
    const dvLive = (env.opts.darkvision || []).map((d) => {
      const rp = d.id != null ? this.tokens.nodes.get(d.id)?.root?.position : null;
      return rp && (Math.abs(rp.x - d.x) > 0.5 || Math.abs(rp.y - d.y) > 0.5) ? { ...d, x: rp.x, y: rp.y } : d;
    });
    const vb = this.visibleMapBounds(map);
    this.lights.update({ ...env.opts, sources, darkvision: dvLive, bounds: vb || env.opts.bounds, fullBounds: env.opts.bounds, rev: env.revPrefix + liveKey, liveMovingIds: movingIds, movingRev: movingKey, __live: true });
  }

  // Alt-„Vollhelligkeits-Kreis" des DM an/aus: inverse Maske auf dem Licht-
  // Compositor — innerhalb des weichen Kreises verschwindet die Dunkel-/
  // Licht-Überlagerung, die Map erscheint dort in voller Helligkeit. Kein
  // Recompose nötig; die Maske folgt dem Cursor pro Frame (billig).
  _setReveal(on) {
    on = !!on;
    if (this._revealOn === on) return;
    this._revealOn = on;
    this.cursorGlow.visible = on;
    const lc = this.lights?.container;
    if (!lc) return;
    if (on && typeof lc.setMask === 'function') lc.setMask({ mask: this.cursorGlow, inverse: true });
    else lc.mask = null;
  }

  // Colored ft range circles attached to tokens (everyone sees them).
  // Pro Token EIN Aura-Container (Kreise um 0,0), positioniert auf dem Token —
  // tickAuras() lässt ihn der GERENDERTEN Sprite-Position folgen, damit die
  // Umkreise beim Drag/Glide am Token kleben statt nur pro Reconcile (20Hz
  // Store-Position) nachzuziehen.
  drawAuras(tokens, grid) {
    this.auras.removeChildren().forEach((c) => c.destroy({ children: true }));
    this._auraNodes = new Map();
    for (const t of Object.values(tokens)) {
      const list = (t.auras || []).filter((a) => a && a.radiusFt > 0);
      if (!list.length) continue;
      const node = new Container();
      for (const a of list) {
        const r = feetToPx(a.radiusFt, grid.size);
        node.addChild(new Graphics().circle(0, 0, r)
          .fill({ color: a.color || '#6c8cff', alpha: 0.1 })
          .stroke({ width: 2, color: a.color || '#6c8cff', alpha: 0.6 }));
      }
      node.position.set(t.x, t.y);
      this.auras.addChild(node);
      this._auraNodes.set(t.id, node);
    }
  }

  // Jeden Ticker-Frame: Auren auf die gerenderte Token-Position setzen.
  tickAuras() {
    const nodes = this._auraNodes;
    if (!nodes || !nodes.size) return;
    for (const [id, c] of nodes) {
      const p = this.tokens.nodes.get(id)?.root?.position;
      if (p && (c.position.x !== p.x || c.position.y !== p.y)) c.position.set(p.x, p.y);
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
      const sel = s.ui.selectedLightId === lt.id || (s.ui.selectedLightIds || []).includes(lt.id);
      const m = new Container();
      m.position.set(lt.x, lt.y);
      m.eventMode = 'static';
      m.cursor = 'move';
      m.addChild(new Graphics().circle(0, 0, 12)
        .fill({ color: lt.color || '#ffd9a0', alpha: 0.5 })
        .stroke({ width: sel ? 3 : 2, color: sel ? '#6c8cff' : '#ffffff', alpha: 0.9 }));
      if (lt.icon) {
        const ic = new Sprite();
        ic.anchor.set(0.5);
        ic.tint = 0x000000;
        loadIcon(lt.icon).then((tex) => { if (tex && !ic.destroyed) { ic.texture = tex; ic.width = ic.height = 16; } });
        m.addChild(ic);
      }
      m.on('pointerdown', (e) => this.onLightDown(lt.id, e));
      this.lightMarkers.addChild(m);
    }
  }

  onLightDown(id, e) {
    if (e.button !== 0) return; // let middle/right pan
    e.stopPropagation?.();
    const s = getState();
    // Shift-Klick: Licht zur Mehrfachauswahl togglen (Batch-Editing im Editor).
    if (this.keys.shift) {
      const cur = s.ui.selectedLightIds?.length ? s.ui.selectedLightIds : (s.ui.selectedLightId ? [s.ui.selectedLightId] : []);
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      A.selectLights(next);
      return; // kein Drag beim Mehrfachauswählen
    }
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

  // Climb speed (ft) of a token: statblock speed.climb, else the bound
  // character's computed climb speed. 0 = no climb speed (RAW: climbing costs
  // double movement). Cached per character object like tokenSpeedFt.
  tokenClimbSpeedFt(token) {
    if (token.statblock) {
      const sp = token.statblock.speed;
      if (sp && typeof sp.climb === 'number') return sp.climb;
      if (sp && sp.climb === true) return typeof sp.walk === 'number' ? sp.walk : 30;
      return 0;
    }
    if (token.characterId != null) {
      const ch = getState().ui.characters?.[token.characterId]?.data;
      if (ch) {
        if (!this._climbCache) this._climbCache = new Map();
        const cached = this._climbCache.get(token.characterId);
        if (cached && cached.ref === ch) return cached.climb;
        let climb = 0;
        try { const c = computeCharacter(ch); const v = c.speed?.climb; climb = typeof v === 'number' ? v : 0; } catch { /* keep 0 */ }
        this._climbCache.set(token.characterId, { ref: ch, climb });
        return climb;
      }
    }
    return 0;
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
    // Only DIFFICULT terrain doubles the cell cost (walking on top of a plateau
    // is normal ground). Climbing is charged at the EDGE between two heights —
    // RAW: +1 ft per ft climbed (halved away by a climb speed); DM-marked open
    // edges (ladders/stairs) cross free. See climbStepFt.
    const costly = new Set();
    for (const tr of (map.terrain || [])) {
      if (!Array.isArray(tr.cells) || (tr.level || base) !== level) continue;
      if (tr.kind === 'difficult') for (const cc of tr.cells) costly.add(cc);
    }
    const cm = climbMapFor(map, level, base);
    const climbMul = this.tokenClimbSpeedFt(token) > 0 ? 1 : 2;
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
          let step = enterCost(ncol, nrow) + climbStepFt(cur.col, cur.row, ncol, nrow, cm, climbMul);
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
  // Bewegungs-Vorschau (Reichweiten-Felder) auf Wunsch entfernt — die Ebene
  // bleibt leer. Distanz/Bewegungskosten zeigt weiterhin das Lineal + der
  // Live-Wert beim Token-Ziehen.
  updateMovementPreview() {
    this.moveLayer.clear();
  }

  // Movement cost (ft) along the ruler — pure impl lives in lib/wallGeometry.
  // opts.climbMul: 1 when the mover has a climb speed, else 2 (RAW climbing).
  rulerMoveFt(ruler, map, level, base, opts) {
    return rulerMoveFt(ruler, map, level, base, opts);
  }

  // Darkvision range (ft) of a token: from its bound character's race/subrace
  // (`species.darkvision`), else parsed from a 5etools statblock ("darkvision
  // 60 ft."). Cheap — no computeCharacter needed.
  tokenDarkvisionFt(t) {
    if (!t) return 0;
    if (t.characterId != null) {
      const ch = getState().ui.characters?.[t.characterId]?.data;
      if (ch) return +(ch.species?.darkvision || 0) || 0;
    }
    const sb = t.statblock;
    if (sb?.senses) {
      const arr = Array.isArray(sb.senses) ? sb.senses : [sb.senses];
      for (const sv of arr) { const m = /darkvision\s+(\d+)/i.exec(String(sv)); if (m) return +m[1]; }
    }
    return 0;
  }

  // Interior polygons of roofed wall-loops (for "enclosed rooms always dark").
  // Every wall kind counts as an enclosing edge (a door/window closes a room
  // too). A face is skipped if any of its edges is flagged `noRoof` (open sky).
  // Cached on a wall-geometry signature so it only recomputes when walls change.
  enclosedRoomPolys(walls, mapId, level) {
    // Keyed off the store's walls version (bumped on every wall op) — cheaper
    // than hashing wall geometry per reconcile. `walls` is pre-filtered to the
    // DISPLAYED map+level by the caller, so both belong in the key.
    const sig = `${mapId}|${level || ''}|${versions.walls}`;
    if (this._roomCache && this._roomCache.sig === sig) return this._roomCache.polys;
    const polys = planarFaces(walls)
      .filter((f) => f.area2 > 1 && !f.face.some((he) => he.wall.noRoof))
      .map((f) => f.pts);
    this._roomCache = { sig, polys };
    return polys;
  }

  // Ambient daylight (the map's sun/sky) leaking in through WINDOWS when
  // interiors are dark: a soft neutral source per window, reach set by the
  // outdoor baseline (bright → bright+dim spill, dim → dim spill, dark → none).
  // A milky window drops the spill one step. The source is offset onto the ROOM
  // side of the window (found via the dark room polys) so the wall itself can't
  // swallow it. With a directional sun (worldShadowStrength > 0), only windows
  // the sunlight actually travels INTO get the spill, scaled by incidence —
  // sun-facing windows glow, shadow-side windows stay dark. Doors are NOT light
  // sources — an open door is just a gap, a glow around it would read as a lamp.
  ambientOpeningSources(walls, baseline, gridSz, rooms = [], sun = null) {
    const step = baseline === 'bright' ? 2 : baseline === 'dim' ? 1 : 0;
    if (step <= 0) return [];
    const cellFt = 5; // one grid cell ≈ 5 ft
    const OFF = 12; // px onto the room side (> nudgeOffWalls reach, so it stays put)
    // Sun direction always gates the windows while ambient light is on (the
    // slider chooses which side of a building the light comes from); the shadow
    // STRENGTH only controls the world-shadow overlay, not this.
    const sunD = sun
      ? { x: Math.cos(((sun.dir ?? 135) * Math.PI) / 180), y: Math.sin(((sun.dir ?? 135) * Math.PI) / 180) }
      : null;
    const out = [];
    for (const w of walls) {
      if (w.kind !== 'window') continue;
      // Geschlossenes KLARES Fenster lässt kein Licht mehr durch (Fensterladen-
      // Semantik) — nur offen, milchig oder farbig (Buntglas) spillt.
      if (!w.open && !w.milky && !w.color) continue;
      // Milchig/farbig geschlossen dimmt das einfallende Licht eine Stufe.
      const s = !w.open && (w.milky || w.color) ? step - 1 : step;
      if (s <= 0) continue;
      const mx = (w.a.x + w.b.x) / 2; const my = (w.a.y + w.b.y) / 2;
      // Which side of the window is the room interior?
      const dx = w.b.x - w.a.x; const dy = w.b.y - w.a.y; const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len; let ny = dx / len; // one of the two normals
      const inA = pointInAnyPolygon(mx + nx * (OFF + 2), my + ny * (OFF + 2), rooms);
      const inB = pointInAnyPolygon(mx - nx * (OFF + 2), my - ny * (OFF + 2), rooms);
      let side = null;
      if (inA && !inB) side = { x: nx, y: ny };
      else if (inB && !inA) side = { x: -nx, y: -ny };
      // Directional sun: light only enters if it travels INTO the room; scale by
      // incidence so grazing windows spill less than sun-facing ones.
      let mul = 1;
      if (sunD && side) {
        const t = sunD.x * side.x + sunD.y * side.y;
        if (t <= 0.05) continue; // window on the shadow side of the building
        mul = 0.4 + 0.6 * t;
      }
      const brightFt = (s >= 2 ? cellFt : 0) * mul;
      const dimFt = (s >= 2 ? 4 : 3) * cellFt * mul;
      out.push({ id: 'amb_' + w.id,
        x: mx + (side ? side.x * OFF : 0), y: my + (side ? side.y * OFF : 0),
        // Buntglas: das durchfallende Licht trägt die Fensterfarbe.
        brightFt, dimFt, color: (!w.open && w.color) ? w.color : '#e8edf5', enabled: true });
    }
    void gridSz;
    return out;
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
    // Throttle to ~the glide duration: a held key auto-repeats at ~30 Hz, and
    // each step is a synced move + full reconcile — firing 30×/s saturated the
    // loop and made movement lag / snap back. One step per ~130 ms stays smooth.
    const now = performance.now();
    if (now - (this._lastWasd || 0) < 95) return;
    this._lastWasd = now;
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
    // Explored-Memory-Lücken schließen: die Sicht wird nur an Zellzentren
    // berechnet — ein schmaler Durchblick (Türspalt), den man nur AUF DEM WEG
    // zwischen zwei Feldern sieht, bliebe sonst für immer unexplored. Der
    // Mittelpunkt des Schritts wird beim nächsten Reconcile einmalig als
    // Phantom-Beobachter mitgesehen (nur lokal, nur Memory/Sicht für 1 Frame).
    this._visTrail = [...(this._visTrail || []), { x: (token.x + to.x) / 2, y: (token.y + to.y) / 2, inside: token.inside, id: 'trail_' + id }].slice(-6);
    // Point the ease-target at the destination NOW. The token is excluded from
    // tokens.update while it glides, so `_tx/_ty` would otherwise stay on the OLD
    // cell — when the glide ends, tickTokens would ease it BACK there until the
    // next reconcile (the "snap to target, jump back, then settle" the user saw).
    if (node) { node._tx = to.x; node._ty = to.y; }
    // Glide a touch shorter than the step throttle so the token REACHES each cell
    // before the next step — otherwise it perpetually trails the input ("hängt
    // hinterher").
    this._tween = { id, fromX, fromY, toX: to.x, toY: to.y, start: performance.now(), dur: 90 };
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
    const done = p >= 1;
    if (done) { node.root.position.set(tw.toX, tw.toY); this._tween = null; }
    else {
      p = 1 - (1 - p) * (1 - p);
      node.root.position.set(tw.fromX + (tw.toX - tw.fromX) * p, tw.fromY + (tw.toY - tw.fromY) * p);
    }
    // Leuchtende Tokens: NUR der Licht-Compositor refresht pro Glide-Frame
    // (Low-Res + 30fps-Deckel dort) — keine volle Reconcile-Pipeline mehr.
    if (getState().tokens[tw.id]?.light) this.refreshLightsLive();
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
      const moveFt = this.rulerMoveFt({ from: { x: this.drag.startX, y: this.drag.startY }, to: { x, y } }, map, level, base, { climbMul: this.tokenClimbSpeedFt(token) > 0 ? 1 : 2 });
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
    // Leuchtendes Token: NUR der Licht-Compositor refresht pro Drag-Frame
    // (Low-Res + 30fps-Deckel dort) — keine volle Reconcile-Pipeline mehr.
    if (token.light) this.refreshLightsLive();
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

// (fiveEDistanceFt, rulerMoveFt, darkenColor & friends now live in
// lib/wallGeometry.js — pure, unit-tested, imported at the top of this file.)
// Weiche Kreis-Maske für den Alt-„Vollhelligkeits-Kreis" des DM: Mitte voll
// deckend (Licht-Überlagerung dort komplett ausgeblendet → Map voll hell),
// weicher Rand. Als INVERSE Maske auf den Licht-Compositor gelegt.
function makeCursorRevealTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.92)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return Texture.from(c);
}

const filterObj = (obj, pred) => { const o = {}; for (const k in obj) if (pred(obj[k])) o[k] = obj[k]; return o; };
const toObj = (arr) => { const o = {}; for (const e of arr) o[e.id] = e; return o; };

// Snap a point to the nearest grid-line intersection.
function snapPointToGrid(p, grid) {
  const sz = grid.size || 70;
  return {
    x: grid.offsetX + Math.round((p.x - grid.offsetX) / sz) * sz,
    y: grid.offsetY + Math.round((p.y - grid.offsetY) / sz) * sz,
  };
}

// Snap a map-space point to the nearest grid vertex (line intersection), so
// walls align cleanly to the grid. Hold Shift to place freely.
function snapVertex(pos, grid) {
  return {
    x: grid.offsetX + Math.round((pos.x - grid.offsetX) / grid.size) * grid.size,
    y: grid.offsetY + Math.round((pos.y - grid.offsetY) / grid.size) * grid.size,
  };
}
