// Fog of War.
//   none    — overlay hidden.
//   manual  — DM paints an ORDERED list of brush stamps into a bitmap mask:
//             reveal stamps add to the "seen" area, hide stamps erase from it,
//             applied in order so the latest stroke wins. The dark overlay is
//             inverse-masked by that bitmap. DM sees it semi-transparent (map
//             stays recognizable); players see solid fog.
//   dynamic — line-of-sight: the visible region is the union of each observer
//             token's visibility polygon. Players see only that; DM sees all.
import { Container, Graphics, Sprite, RenderTexture } from 'pixi.js';

export class FogLayer {
  constructor(app) {
    this.app = app;
    this.container = new Container();
    this.container.eventMode = 'none';
    this.overlay = new Graphics();
    this.maskGfx = new Sprite();   // bitmap reveal-mask for manual fog (RT-backed)
    this.maskPoly = new Graphics(); // polygon reveal-mask for dynamic fog
    this.container.addChild(this.overlay, this.maskGfx, this.maskPoly);
    this._rt = null;
    this._rtMap = null;
    this._drawn = 0; // how many stamps have been rasterised into the RT
    this._key = null;
  }

  update(map, fog, isDM, mode, visiblePolys, editing = false) {
    if (!map || mode === 'none' || (mode === 'dynamic' && isDM)) {
      this.hide();
      return;
    }
    this.container.visible = true;
    if (mode === 'manual') this.drawManual(map, fog, isDM, editing);
    else if (mode === 'dynamic') this.drawDynamic(map, visiblePolys || []);
  }

  hide() {
    this.overlay.clear();
    this.overlay.setMask?.({ mask: null });
    this.container.visible = false;
    this._key = null;
  }

  ensureRT(map) {
    if (this._rtMap === map.id && this._rt) return;
    this._rt?.destroy(true);
    this._rt = RenderTexture.create({ width: map.width, height: map.height });
    this.maskGfx.texture = this._rt;
    this._rtMap = map.id;
    this._drawn = 0;
  }

  drawManual(map, fog, isDM, editing) {
    this.ensureRT(map);
    const stamps = fog?.stamps || [];
    // Fewer stamps than rasterised → undo/reset/clear: rebuild from scratch.
    if (stamps.length < this._drawn) {
      this.app.renderer.render({ container: this.buildStamps(stamps, 0), target: this._rt, clear: true });
      this._drawn = stamps.length;
    } else if (stamps.length > this._drawn) {
      // Only the new strokes need rasterising (incremental → fast while painting).
      this.app.renderer.render({ container: this.buildStamps(stamps, this._drawn), target: this._rt, clear: false });
      this._drawn = stamps.length;
    }
    const dark = { color: 0x05070c, alpha: isDM ? (editing ? 0.6 : 0.45) : 1 };
    this.overlay.clear().rect(0, 0, map.width, map.height).fill(dark);
    this.maskPoly.clear();
    this.overlay.setMask({ mask: this.maskGfx, inverse: true });
  }

  // A throwaway container of stamp graphics from index `from` onward; reveal =
  // white fill, hide = 'erase' blend (removes alpha) so order is respected.
  buildStamps(stamps, from) {
    const c = new Container();
    for (let i = from; i < stamps.length; i++) {
      const st = stamps[i];
      if (!st?.poly || st.poly.length < 3) continue;
      const g = new Graphics().poly(st.poly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
      if (st.mode === 'hide') g.blendMode = 'erase';
      c.addChild(g);
    }
    return c;
  }

  drawDynamic(map, visiblePolys) {
    const key = `d|${map.id}|${map.width}x${map.height}|`
      + visiblePolys.map((poly) => poly.length).join(',') + '|'
      + visiblePolys.map((poly) => poly.slice(0, 3).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';')).join('/');
    if (key === this._key) return;
    this._key = key;

    this.overlay.clear().rect(0, 0, map.width, map.height).fill({ color: 0x05070c, alpha: 1 });
    this.maskPoly.clear();
    let any = false;
    for (const poly of visiblePolys) {
      if (poly.length >= 3) { this.maskPoly.poly(poly.flatMap((p) => [p.x, p.y])).fill(0xffffff); any = true; }
    }
    if (any) this.overlay.setMask({ mask: this.maskPoly, inverse: true });
    else this.overlay.setMask?.({ mask: null }); // no vision → all dark
  }
}
