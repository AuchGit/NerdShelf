// Dynamic lighting compositor.
//
// Everything is composited into ONE map-sized RenderTexture per reconcile and
// shown as a single sprite (so panning/zooming moves one sprite — no per-light
// stencil masks every frame → fixes the "light lags when panning" stutter).
//
// To make overlapping lights merge into ONE area with ONE outline (instead of
// visible crossing circles) we build the light reach as a FLAT UNION:
//   • covBright / covDim — each light's reach (clipped to its line-of-sight
//     polygon) drawn as OPAQUE white into its own texture. Overlaps stay white,
//     so the union is flat (no additive build-up, no internal arcs).
//   • the main texture is filled with the baseline/region darkness, then the
//     two coverage textures ERASE it at flat strengths (dim = partial, bright =
//     full) and add a flat warm tint. The edge of each flat union reads as a
//     single clean contour around all bright / all dim area.
//
// Sources are role-agnostic {id, x, y, brightFt, dimFt, color, enabled?}.
import { Container, Graphics, Sprite, Texture, RenderTexture, BlurFilter } from 'pixi.js';
import { feetToPx } from '../../lib/geometry';
import { visibilityPolygon, nudgeOffWalls } from '../../lib/visibility';

const BASELINE_ALPHA = { bright: 0, dim: 0.5, dark: 0.9 };
const DARKNESS_ALPHA = 0.9;   // a placed darkness region
const WARM = 0xffd9a0;        // flat warm tint colour for lit area (modern)

export class LightLayer {
  constructor() {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.sprite = new Sprite(Texture.EMPTY);
    this.container.addChild(this.sprite);
    this._rts = null;  // { main, covB, covD }
    this._rtKey = null;
    this._zoom = 1;      // aktuelle Viewport-Skalierung (für zoom-stabilen Blur)
    this._blurBase = 0;  // konfigurierter Blur in WELT-Pixeln
  }

  // Pixi-BlurFilter arbeitet in SCREEN-Pixeln: beim Rauszoomen frisst ein
  // fixer Blur ganze Schatten-/Dunkelflächen auf (sie wirken kleiner als sie
  // sind). Wir skalieren die Stärke mit dem Zoom, damit der Blur in
  // Welt-Einheiten konstant bleibt. Der Renderer ruft setZoom bei jedem
  // Zoom-Schritt + Reconcile auf.
  setZoom(z) {
    if (!(z > 0) || z === this._zoom) return;
    this._zoom = z;
    this._applyBlur();
  }

  _applyBlur() {
    const eff = this._blurBase * this._zoom;
    if (eff > 0.05) {
      if (!this._blur) this._blur = new BlurFilter({ strength: eff });
      else this._blur.strength = eff;
      if (!this.sprite.filters?.length) this.sprite.filters = [this._blur];
    } else if (this.sprite.filters?.length) {
      this.sprite.filters = [];
    }
  }

  // opts: { renderer, sources, grid, walls, bounds, style, baseline, darkness, contrast, blur }
  update(opts) {
    const { renderer, sources = [], grid, walls = [], brightWalls = walls, shadowWalls = walls, bounds, style = 'modern', baseline = 'bright', darkness = [], darkPolys = [], worldShadow = null, darkvision = [], contrast = 0.5, blur = 0, rev = null } = opts || {};
    if (!renderer || !grid || !bounds) { this.sprite.visible = false; return; }

    // Blur softens the whole composited lighting (safe: post-process on the
    // display sprite, not on a mask). Stärke zoom-skaliert (siehe setZoom).
    this._blurBase = blur;
    this._applyBlur();

    const w = Math.max(1, Math.round(bounds.maxX - bounds.minX));
    const h = Math.max(1, Math.round(bounds.maxY - bounds.minY));
    const ox = bounds.minX;
    const oy = bounds.minY;
    // Contrast (0..1) scales how dark the UNLIT areas are too, not just the
    // dim-band erase: higher contrast → darker baseline & darkness regions →
    // stronger separation between lit and unlit ("Kontrast zwischen allem").
    // Capped below 1 so even max-contrast darkness stays faintly readable.
    const c = Math.min(1, Math.max(0, contrast));
    const darkScale = Math.min(0.97 / 0.9, 0.55 + c * 0.55); // factor on the alphas
    const baseA = Math.min(0.97, (BASELINE_ALPHA[baseline] ?? 0) * darkScale);
    // Painted darkness regions stay a touch translucent (≤0.82) so the DM/players
    // can still make out what's underneath instead of a pure-black blob.
    const darkA = Math.min(0.82, DARKNESS_ALPHA * darkScale);
    // Directional "world shadow" (sun): light-blocking walls cast a shadow in a
    // map-wide direction. Strength 0 = off. Placed lights still cast their own
    // radial shadows (handled per-source above) and can erase this one.
    const wantDV = !!(darkvision && darkvision.length > 0);
    // Baseline light LEVEL (dark 0 < dim 1 < bright 2). A light only shows where
    // it RAISES the level above the baseline: on a bright map bright light is
    // invisible (no difference), on a dim map the dim band is invisible — only
    // the bright core shows. Drives both the erase and the colour-tint gating.
    const BL = baseline === 'bright' ? 2 : baseline === 'dim' ? 1 : 0;
    // Directional "world shadow" (sun): light-blocking walls cast a shadow that
    // is exactly ONE light step below the ambient (bright map → dim shadows,
    // dim map → dark shadows; dark map → nothing left to darken). `strength > 0`
    // is just the on/off gate; the depth is derived, not user-tuned. Placed
    // lights still cast their own radial shadows and light this one up.
    const wantShadow = !!(worldShadow && worldShadow.strength > 0 && shadowWalls.length > 0 && BL > 0);
    const shadowTargetA = Math.min(0.97, (BL === 2 ? BASELINE_ALPHA.dim : BASELINE_ALPHA.dark) * darkScale);
    // Alphas stack (1-(1-a)(1-b)) — solve for the extra alpha that lands the
    // shadowed area exactly on the next-darker level over the baseline overlay.
    const shadowA = wantShadow ? Math.max(0, (shadowTargetA - baseA) / (1 - baseA || 1)) : 0;
    // Enclosed-room interiors painted at the dark level (roofed loops always
    // dark, regardless of the outdoor baseline) — also counts as "dark present".
    const hasDark = baseA > 0 || (darkness && darkness.length > 0) || (darkPolys && darkPolys.length > 0) || wantShadow;

    const valid = sources.filter((s) => s && s.enabled !== false
      && Math.max(feetToPx(s.dimFt || 0, grid.size), feetToPx(s.brightFt || 0, grid.size)) > 0);

    if (!hasDark && valid.length === 0) { this.sprite.visible = false; this._sig = null; return; }
    this.sprite.visible = true;

    // Skip the expensive 3-RenderTexture recomposition when nothing
    // lighting-relevant changed (e.g. a peer dragging a non-luminous token, or
    // a pure-UI reconcile). Cheap signature over the actual inputs.
    // `baseSig` covers everything CPU-expensive (per-light visibility polygons +
    // coverage textures). Darkvision is split out (`dvSig`) because it follows a
    // moving token — recomputing the whole light field every WASD step caused the
    // reconcile to lag and the token to stutter back-and-forth. When only
    // darkvision changes we reuse the cached coverage and just recomposite.
    // With a caller-provided `rev` (store version counters — bumped by every
    // wall/light/map change incl. luminous-token moves) the gate is one string
    // compare; the per-wall/per-light hashing below is only the standalone
    // fallback for callers without version tracking.
    const baseSig = rev != null ? `${w}x${h}|${baseline}|${style}|${contrast}|${rev}` : JSON.stringify([
      w, h, baseline, style, contrast,
      valid.map((s) => [s.id, Math.round(s.x), Math.round(s.y), s.brightFt, s.dimFt, s.color, s.heightFt || 0]),
      walls.map((wl) => [wl.a.x, wl.a.y, wl.b.x, wl.b.y, wl.kind, wl.open, wl.heightFt || 0]),
      brightWalls.map((wl) => [wl.a.x, wl.a.y, wl.b.x, wl.b.y, wl.kind, wl.open, wl.heightFt || 0]),
      darkness.map((d) => [d.x, d.y, d.r, d.w, d.h]),
      darkPolys.map((p) => p.length),
      wantShadow ? [Math.round(worldShadow.dir ?? 135), Math.round(shadowA * 100)] : 0,
    ]);
    const dvSig = JSON.stringify(darkvision.map((d) => [Math.round(d.x), Math.round(d.y), Math.round(d.radiusPx)]));
    const sig = `${baseSig}|${dvSig}`;
    if (sig === this._sig) return;
    this._sig = sig;

    // (re)create the three textures when the map size changes.
    const key = `${w}x${h}`;
    if (this._rtKey !== key) {
      if (this._rts) for (const rt of Object.values(this._rts)) rt.destroy(true);
      this._rts = {
        // main wird stark minifiziert angezeigt (weit rausgezoomt) — Mipmaps
        // verhindern, dass dünne Schattenstreifen beim Rauszoomen wegaliassen.
        main: RenderTexture.create({ width: w, height: h, autoGenerateMipmaps: true }),
        covB: RenderTexture.create({ width: w, height: h }),
        covD: RenderTexture.create({ width: w, height: h }),
        covShadow: RenderTexture.create({ width: w, height: h }),
        covCB: RenderTexture.create({ width: w, height: h }),
        covCD: RenderTexture.create({ width: w, height: h }),
        covDV: RenderTexture.create({ width: w, height: h }),
        covDVD: RenderTexture.create({ width: w, height: h }),
        dark: RenderTexture.create({ width: w, height: h }),
      };
      this._rtKey = key;
      this._baseSig = null; // fresh blank RTs → force a coverage rebuild
      this.sprite.texture = this._rts.main;
    }
    this.sprite.position.set(ox, oy);
    const { main, covB, covD, covShadow, covCB, covCD, covDV, covDVD } = this._rts;

    // Only the CPU-heavy coverage (visibility polys + light/shadow RTs) is gated
    // on baseSig; when just darkvision moved we keep the cached RTs and skip
    // straight to the cheap recomposite below.
    const coverageChanged = baseSig !== this._baseSig;
    if (coverageChanged) {
    this._baseSig = baseSig;

    // ── 1. Flat-union coverage textures (opaque white reach per light) ──
    // White unions (covB/covD) drive the darkness erase; coloured unions
    // (covCB/covCD) carry the per-light glow colour. Colours are drawn OPAQUE so
    // overlapping lights merge (last-wins) instead of additively stacking — then
    // each union is stamped ONCE, so overlaps don't show brighter lens/rims.
    const cbContainer = new Container();
    const cdContainer = new Container();
    const ccbContainer = new Container();
    const ccdContainer = new Container();
    for (const s of valid) {
      const dimPx = feetToPx(s.dimFt || 0, grid.size);
      const brightPx = feetToPx(s.brightFt || 0, grid.size);
      const cx = s.x - ox;
      const cy = s.y - oy;
      // Height-aware shadows: a wall only blocks this light if it's at least as
      // tall as the light's height (full-height walls = heightFt 0/null always
      // block). A light raised above a low wall shines over it.
      const lh = s.heightFt || 0;
      const lightWallsForSrc = walls.filter((wl) => !(wl.heightFt > 0 && lh >= wl.heightFt));
      // A light placed ON a wall sits exactly on the blocking segment, so the
      // shadow caster can't tell which side it's on → light leaks through. Nudge
      // the sample point a few px off any wall it's touching (toward the side it's
      // already on) so the wall blocks properly.
      const origin = nudgeOffWalls(s.x, s.y, lightWallsForSrc);
      // Dim reach is clipped to `walls`; bright reach to `brightWalls` (which
      // adds milky/frosted windows). So a milky window passes DIM light but stops
      // the BRIGHT band — light beyond it is dimmed by one step.
      const poly = visibilityPolygon(origin, lightWallsForSrc, bounds);
      const brightPoly = brightWalls === walls
        ? poly
        : visibilityPolygon(origin, brightWalls.filter((wl) => !(wl.heightFt > 0 && lh >= wl.heightFt)), bounds);
      const mkMaskFrom = (p) => {
        if (p.length < 3) return null;
        return new Graphics().poly(p.flatMap((q) => [q.x - ox, q.y - oy])).fill(0xffffff);
      };
      const col = s.color || WARM;
      if (brightPx > 0) cbContainer.addChild(reach(cx, cy, brightPx, mkMaskFrom(brightPoly)));
      if (dimPx > 0) cdContainer.addChild(reach(cx, cy, dimPx, mkMaskFrom(poly)));
      // Colour unions, only for the bands that actually differ from the baseline.
      if (BL < 2 && brightPx > 0) ccbContainer.addChild(reach(cx, cy, brightPx, mkMaskFrom(brightPoly), col));
      if (BL < 1 && dimPx > 0) ccdContainer.addChild(reach(cx, cy, dimPx, mkMaskFrom(poly), col));
    }
    renderer.render({ container: cbContainer, target: covB, clear: true });
    renderer.render({ container: cdContainer, target: covD, clear: true });
    if (BL < 2) renderer.render({ container: ccbContainer, target: covCB, clear: true });
    if (BL < 1) renderer.render({ container: ccdContainer, target: covCD, clear: true });
    cbContainer.destroy({ children: true });
    cdContainer.destroy({ children: true });
    ccbContainer.destroy({ children: true });
    ccdContainer.destroy({ children: true });

    // World-shadow coverage: each light-blocking wall sweeps a shadow quad in the
    // sun-away direction (a wall parallel to the sun naturally casts a sliver).
    if (wantShadow) {
      const ang = ((worldShadow.dir ?? 135) * Math.PI) / 180;
      const dx = Math.cos(ang); const dy = Math.sin(ang);
      const L = Math.hypot(w, h) * 1.5;
      const sc = new Container();
      // Only SIGHT-blocking walls cast the sun shadow (a see-through fence or
      // movement-only barrier does not darken the world behind it).
      for (const wl of shadowWalls) {
        const ax = wl.a.x - ox; const ay = wl.a.y - oy; const bx = wl.b.x - ox; const by = wl.b.y - oy;
        sc.addChild(new Graphics().poly([ax, ay, bx, by, bx + dx * L, by + dy * L, ax + dx * L, ay + dy * L]).fill(0xffffff));
      }
      renderer.render({ container: sc, target: covShadow, clear: true });
      sc.destroy({ children: true });
    }
    } // end coverageChanged

    // Darkvision coverage: union of each viewer-token's reach disc, clipped to
    // its line of sight (so it can't see through walls). Rebuilt every time (it
    // follows a moving token) but it's cheap — a few masked discs.
    if (wantDV) {
      const dv = new Container();
      for (const d of darkvision) {
        if (!d || !(d.radiusPx > 0)) continue;
        const mask = (d.poly && d.poly.length >= 3) ? new Graphics().poly(d.poly.flatMap((p) => [p.x - ox, p.y - oy])).fill(0xffffff) : null;
        dv.addChild(reach(d.x - ox, d.y - oy, d.radiusPx, mask));
      }
      renderer.render({ container: dv, target: covDV, clear: true });
      dv.destroy({ children: true });
      // "World-dark within darkvision" = the DV reach MINUS everything actually
      // lit (bright or dim by real lights). That area gets a cool desaturating
      // wash below so a darkvision user still SEES that it's dark there (wo man
      // schleichen kann) even though they can see.
      const dvd = new Container();
      dvd.addChild(stamp(covDV, 'normal', 1));
      dvd.addChild(stamp(covB, 'erase', 1));
      dvd.addChild(stamp(covD, 'erase', 1));
      renderer.render({ container: dvd, target: covDVD, clear: true });
      dvd.destroy({ children: true });
    }

    // ── 2. Composite the visible lighting texture ──
    // TWO passes so light interacts correctly with BOTH kinds of darkness:
    //   • baseline pass (scene): the map-wide ambient overlay. Dim light must
    //     NOT lighten a dim/bright baseline (it matches the ambient), so its
    //     erase is gated by BL there.
    //   • deep-dark pass (rtDark): rooms ("Räume dunkel"), painted darkness and
    //     the world shadow — these are DARK regardless of the baseline, so a
    //     light's dim band ALWAYS lifts them (to the dim level) and the bright
    //     band clears them. This is what lets a lantern's dim glow spill through
    //     a window/door into a dark house on a bright map.
    const darkLevelA = Math.min(0.97, BASELINE_ALPHA.dark * darkScale);
    const dimTargetA = Math.min(0.97, BASELINE_ALPHA.dim * darkScale);
    const liftToDim = Math.max(0, 1 - dimTargetA / Math.max(0.01, darkLevelA));
    const dark = new Container();
    for (const d of darkness) {
      if (!d) continue;
      const g = new Graphics();
      if (d.r > 0) g.circle((d.x || 0) - ox, (d.y || 0) - oy, d.r);
      else if (d.w > 0 && d.h > 0) g.rect((d.x || 0) - ox, (d.y || 0) - oy, d.w, d.h);
      else continue;
      dark.addChild(g.fill({ color: 0x000000, alpha: darkA }));
    }
    for (const poly of darkPolys) {
      if (!poly || poly.length < 3) continue;
      dark.addChild(new Graphics().poly(poly.flatMap((p) => [p.x - ox, p.y - oy])).fill({ color: 0x000000, alpha: darkLevelA }));
    }
    if (wantShadow && shadowA > 0) dark.addChild(stamp(covShadow, 'normal', shadowA, 0x000000));
    // Lights carve the deep dark: dim reach down to ~the dim level, bright fully;
    // darkvision likewise lifts one step within its range.
    dark.addChild(stamp(covD, 'erase', liftToDim));
    dark.addChild(stamp(covB, 'erase', 1));
    if (wantDV) dark.addChild(stamp(covDV, 'erase', liftToDim));
    renderer.render({ container: dark, target: this._rts.dark, clear: true });
    dark.destroy({ children: true });

    const scene = new Container();
    // baseline ambient overlay
    if (baseA > 0) scene.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: baseA }));
    // rooms replace the baseline inside (their own constant dark lives in rtDark)
    for (const poly of darkPolys) {
      if (!poly || poly.length < 3) continue;
      const er = new Graphics().poly(poly.flatMap((p) => [p.x - ox, p.y - oy])).fill({ color: 0x000000, alpha: 1 });
      er.blendMode = 'erase';
      scene.addChild(er);
    }
    // erase the BASELINE darkness: dim union only when the baseline is dark
    // ('classic' keeps the dim band darker for a crisper step; contrast tunes it),
    // bright union always (a torch lifts a dim/dark baseline to bright).
    const dimErase = Math.max(0.2, Math.min(0.8, (style === 'classic' ? 0.7 : 0.75) - c * 0.45));
    if (baseA > 0) {
      if (BL < 1) scene.addChild(stamp(covD, 'erase', dimErase));
      scene.addChild(stamp(covB, 'erase', 1));
      if (wantDV && BL < 1) scene.addChild(stamp(covDV, 'erase', liftToDim));
    }
    // deep-dark layer (already carved by the lights) composites on top
    scene.addChild(stamp(this._rts.dark, 'normal', 1));
    // world-dark marking inside darkvision: cool desaturating wash where the
    // viewer sees only thanks to darkvision (Schleichen!). Deutlich sichtbar,
    // damit Spieler sofort erkennen "hier ist es eigentlich dunkel".
    if (wantDV) scene.addChild(stamp(covDVD, 'normal', 0.42, 0x2e4370));
    // Coloured glow: stamp the merged colour unions ONCE (overlaps already merged
    // in the RT, so no brighter lens/rims where lights overlap). Gated by the
    // baseline level so a bright light on a bright map (or dim on dim) adds
    // nothing — it doesn't differ from the ambient.
    {
      const dimA = style === 'classic' ? 0.10 : 0.14;
      const brightA = style === 'classic' ? 0.16 : 0.22;
      if (BL < 1) scene.addChild(stamp(covCD, 'add', dimA));
      if (BL < 2) scene.addChild(stamp(covCB, 'add', brightA));
    }
    renderer.render({ container: scene, target: main, clear: true });
    scene.destroy({ children: true });
  }
}

// One light's reach: an opaque disc (white for the erase unions, or the light's
// colour for the colour unions), clipped to its line-of-sight polygon.
function reach(x, y, r, mask, color = 0xffffff) {
  const c = new Container();
  const disc = new Graphics().circle(x, y, r).fill({ color, alpha: 1 });
  c.addChild(disc);
  if (mask) { c.addChild(mask); c.mask = mask; }
  return c;
}

// A full-texture sprite of a coverage RT, used to erase/tint at a flat strength.
function stamp(texture, blend, alpha, tint) {
  const sp = new Sprite(texture);
  sp.blendMode = blend;
  sp.alpha = alpha;
  if (tint != null) sp.tint = tint;
  return sp;
}
