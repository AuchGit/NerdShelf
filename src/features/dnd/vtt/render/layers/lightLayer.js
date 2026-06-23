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
import { visibilityPolygon } from '../../lib/visibility';

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
  }

  // opts: { renderer, sources, grid, walls, bounds, style, baseline, darkness, contrast, blur }
  update(opts) {
    const { renderer, sources = [], grid, walls = [], bounds, style = 'modern', baseline = 'bright', darkness = [], contrast = 0.5, blur = 0 } = opts || {};
    if (!renderer || !grid || !bounds) { this.sprite.visible = false; return; }

    // Blur softens the whole composited lighting (safe: post-process on the
    // display sprite, not on a mask). Cached so we don't recreate per frame.
    if (blur > 0) {
      if (!this._blur) this._blur = new BlurFilter({ strength: blur });
      else this._blur.strength = blur;
      this.sprite.filters = [this._blur];
    } else if (this.sprite.filters?.length) {
      this.sprite.filters = [];
    }

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
    const hasDark = baseA > 0 || (darkness && darkness.length > 0);

    const valid = sources.filter((s) => s && s.enabled !== false
      && Math.max(feetToPx(s.dimFt || 0, grid.size), feetToPx(s.brightFt || 0, grid.size)) > 0);

    if (!hasDark && valid.length === 0) { this.sprite.visible = false; this._sig = null; return; }
    this.sprite.visible = true;

    // Skip the expensive 3-RenderTexture recomposition when nothing
    // lighting-relevant changed (e.g. a peer dragging a non-luminous token, or
    // a pure-UI reconcile). Cheap signature over the actual inputs.
    const sig = JSON.stringify([
      w, h, baseline, style, contrast,
      valid.map((s) => [s.id, Math.round(s.x), Math.round(s.y), s.brightFt, s.dimFt, s.color, s.heightFt || 0]),
      walls.map((wl) => [wl.a.x, wl.a.y, wl.b.x, wl.b.y, wl.kind, wl.open, wl.heightFt || 0]),
      darkness.map((d) => [d.x, d.y, d.r, d.w, d.h]),
    ]);
    if (sig === this._sig) return;
    this._sig = sig;

    // (re)create the three textures when the map size changes.
    const key = `${w}x${h}`;
    if (this._rtKey !== key) {
      if (this._rts) for (const rt of Object.values(this._rts)) rt.destroy(true);
      this._rts = {
        main: RenderTexture.create({ width: w, height: h }),
        covB: RenderTexture.create({ width: w, height: h }),
        covD: RenderTexture.create({ width: w, height: h }),
      };
      this._rtKey = key;
      this.sprite.texture = this._rts.main;
    }
    this.sprite.position.set(ox, oy);
    const { main, covB, covD } = this._rts;

    // ── 1. Flat-union coverage textures (opaque white reach per light) ──
    const cbContainer = new Container();
    const cdContainer = new Container();
    const tintSrcs = []; // per-light data for the coloured glow pass
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
      const poly = visibilityPolygon({ x: s.x, y: s.y }, lightWallsForSrc, bounds);
      const mkMask = () => {
        if (poly.length < 3) return null;
        return new Graphics().poly(poly.flatMap((p) => [p.x - ox, p.y - oy])).fill(0xffffff);
      };
      if (brightPx > 0) cbContainer.addChild(reach(cx, cy, brightPx, mkMask()));
      if (dimPx > 0) cdContainer.addChild(reach(cx, cy, dimPx, mkMask()));
      tintSrcs.push({ cx, cy, brightPx, dimPx, poly, color: s.color || WARM });
    }
    renderer.render({ container: cbContainer, target: covB, clear: true });
    renderer.render({ container: cdContainer, target: covD, clear: true });
    cbContainer.destroy({ children: true });
    cdContainer.destroy({ children: true });

    // ── 2. Composite the visible lighting texture ──
    const scene = new Container();
    // darkness (baseline + placed regions)
    if (baseA > 0) scene.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: baseA }));
    for (const d of darkness) {
      if (!d) continue;
      const g = new Graphics();
      if (d.r > 0) g.circle((d.x || 0) - ox, (d.y || 0) - oy, d.r);
      else if (d.w > 0 && d.h > 0) g.rect((d.x || 0) - ox, (d.y || 0) - oy, d.w, d.h);
      else continue;
      scene.addChild(g.fill({ color: 0x000000, alpha: darkA }));
    }
    // erase darkness: dim union (partial) then bright union (full) — flat, so
    // overlaps don't create internal rings. 'classic' keeps the dim band darker
    // for a crisper dark→dim→bright STEP ("Abstufungen"); 'modern' lifts the dim
    // band and adds a warm tint for a softer glow.
    // Contrast (0..1) controls how dark the dim band is: higher contrast erases
    // less → darker dim → sharper dark/dim/bright separation.
    const dimErase = Math.max(0.2, Math.min(0.8, (style === 'classic' ? 0.7 : 0.75) - c * 0.45));
    if (hasDark) {
      scene.addChild(stamp(covD, 'erase', dimErase));
      scene.addChild(stamp(covB, 'erase', 1));
    }
    // Coloured glow: each light tints its OWN reach with its colour (additive,
    // clipped to its line-of-sight polygon) so coloured lights actually read as
    // their colour on the map — in BOTH styles (so the chosen colour is always
    // visible). 'classic' tints a touch lighter to keep its crisp ring look.
    {
      // Subtle so coloured light tints the area without washing it out (additive
      // blends brighten, so keep these low).
      const dimA = style === 'classic' ? 0.10 : 0.14;
      const brightA = style === 'classic' ? 0.16 : 0.22;
      for (const td of tintSrcs) {
        if (td.poly.length < 3) continue;
        if (td.dimPx > 0) scene.addChild(tintReach(td.cx, td.cy, td.dimPx, td.poly, ox, oy, td.color, dimA));
        if (td.brightPx > 0) scene.addChild(tintReach(td.cx, td.cy, td.brightPx, td.poly, ox, oy, td.color, brightA));
      }
    }
    renderer.render({ container: scene, target: main, clear: true });
    scene.destroy({ children: true });
  }
}

// A light's coloured glow: an additive disc tinted with the light's colour,
// clipped to its line-of-sight polygon.
function tintReach(x, y, r, poly, ox, oy, color, alpha) {
  const c = new Container();
  const disc = new Graphics().circle(x, y, r).fill(color);
  disc.blendMode = 'add';
  disc.alpha = alpha;
  const mask = new Graphics().poly(poly.flatMap((p) => [p.x - ox, p.y - oy])).fill(0xffffff);
  c.addChild(disc, mask);
  disc.mask = mask;
  return c;
}

// One light's reach: an opaque disc, clipped to its line-of-sight polygon.
function reach(x, y, r, mask) {
  const c = new Container();
  const disc = new Graphics().circle(x, y, r).fill({ color: 0xffffff, alpha: 1 });
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
