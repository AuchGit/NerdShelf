// Ping layer. Renders transient location markers (Alt-click) as an animated
// expanding ring that fades out. Pings auto-expire from the store after a TTL.
import { Container, Graphics } from 'pixi.js';
import { PING_TTL_MS } from '../../lib/constants';

export class PingLayer {
  constructor() {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.nodes = new Map(); // pingId -> { g, ping }
  }

  update(pings) {
    const seen = new Set();
    for (const p of pings) {
      seen.add(p.id);
      if (!this.nodes.has(p.id)) {
        const g = new Graphics();
        g.position.set(p.x, p.y);
        this.container.addChild(g);
        this.nodes.set(p.id, { g, ping: p });
      }
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.g.destroy(); this.nodes.delete(id); }
    }
  }

  // Called every frame by the renderer ticker to animate active pings.
  // Deutlich sichtbar: größere, dickere Ringe mit dunkler Kontur-Unterlage
  // (liest sich auf hellem UND dunklem Grund), heller Mittelpunkt + Fadenkreuz.
  tick(now) {
    for (const { g, ping } of this.nodes.values()) {
      const t = Math.min(1, (now - ping.at) / PING_TTL_MS);
      const baseR = 46;
      const fade = 1 - t; // Gesamt-Ausblenden über die TTL
      g.clear();
      // Drei expandierende Ringe, phasenversetzt — je mit dunkler Unterlage.
      for (const phase of [0, 0.33, 0.66]) {
        const tt = (t + phase) % 1;
        const r = baseR * (0.35 + tt);
        const a = (1 - tt) * fade;
        g.circle(0, 0, r).stroke({ width: 7, color: 0x000000, alpha: a * 0.5 });
        g.circle(0, 0, r).stroke({ width: 4, color: ping.color, alpha: a });
      }
      // Fadenkreuz + heller Kern markieren den exakten Punkt.
      const cross = 16;
      for (const [x1, y1, x2, y2] of [[-cross, 0, cross, 0], [0, -cross, 0, cross]]) {
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 5, color: 0x000000, alpha: fade * 0.5 });
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2.5, color: ping.color, alpha: fade });
      }
      g.circle(0, 0, 5).fill({ color: 0xffffff, alpha: fade });
      g.circle(0, 0, 5).stroke({ width: 2, color: ping.color, alpha: fade });
    }
  }
}
