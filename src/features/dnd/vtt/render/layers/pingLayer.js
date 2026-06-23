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
  tick(now) {
    for (const { g, ping } of this.nodes.values()) {
      const t = Math.min(1, (now - ping.at) / PING_TTL_MS);
      const baseR = 30;
      g.clear();
      // two expanding rings, offset in phase
      for (const phase of [0, 0.5]) {
        const tt = (t + phase) % 1;
        g.circle(0, 0, baseR * (0.4 + tt)).stroke({ width: 4, color: ping.color, alpha: (1 - tt) * 0.9 });
      }
    }
  }
}
