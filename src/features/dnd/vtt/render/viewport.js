// Viewport: owns the pan/zoom transform of the `world` container that holds
// all map-space content. Converts between screen (canvas px) and map space.
//
// We keep the transform here rather than on each layer so a single source
// drives every layer consistently and coordinate conversion is centralised.
import { Point } from 'pixi.js';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

export class Viewport {
  constructor(world, app) {
    this.world = world; // Pixi Container
    this.app = app;
  }

  get scale() { return this.world.scale.x; }

  /** Screen (canvas px) → map space. */
  toMap(screenX, screenY) {
    const p = this.world.toLocal(new Point(screenX, screenY));
    return { x: p.x, y: p.y };
  }

  /** Map space → screen (canvas px). */
  toScreen(mapX, mapY) {
    const p = this.world.toGlobal(new Point(mapX, mapY));
    return { x: p.x, y: p.y };
  }

  panBy(dxScreen, dyScreen) {
    this.world.position.x += dxScreen;
    this.world.position.y += dyScreen;
  }

  /** Zoom keeping the map point under the cursor fixed (screen px focus). */
  zoomAt(screenX, screenY, factor) {
    const before = this.toMap(screenX, screenY);
    const next = clamp(this.world.scale.x * factor, MIN_SCALE, MAX_SCALE);
    this.world.scale.set(next);
    const after = this.toMap(screenX, screenY);
    // shift world so `before` stays under the cursor
    this.world.position.x += (after.x - before.x) * next;
    this.world.position.y += (after.y - before.y) * next;
  }

  /** Fit a map of given map-space size into the canvas with padding. */
  fit(mapWidth, mapHeight, padding = 40) {
    const sw = this.app.renderer.width;
    const sh = this.app.renderer.height;
    if (!mapWidth || !mapHeight) return;
    const scale = clamp(
      Math.min((sw - padding * 2) / mapWidth, (sh - padding * 2) / mapHeight),
      MIN_SCALE, MAX_SCALE,
    );
    this.world.scale.set(scale);
    this.world.position.set(
      (sw - mapWidth * scale) / 2,
      (sh - mapHeight * scale) / 2,
    );
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
