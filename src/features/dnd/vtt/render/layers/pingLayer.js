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
  // Schlicht wie der "Loop-geschlossen"-Puls: EINE saubere expandierende
  // Ring-Welle (+ innerer Ring) in der Ping-Farbe, die ausblendet — nicht
  // die frühere laute Dauer-Animation. Die Expansion läuft in den ersten
  // ~800ms ab, danach nur noch dezent ausklingend.
  tick(now) {
    for (const { g, ping } of this.nodes.values()) {
      const age = now - ping.at;
      const t = Math.min(1, age / 800);       // Expansions-Fortschritt
      const life = Math.min(1, age / PING_TTL_MS); // Gesamt-Ausblenden
      g.clear();
      const r = 12 + t * 90;
      g.circle(0, 0, r).stroke({ width: 4, color: ping.color, alpha: (1 - t) * 0.95 });
      g.circle(0, 0, r * 0.5).stroke({ width: 3, color: ping.color, alpha: (1 - t) * 0.6 });
      // Kleiner Punkt bleibt bis zum Ende der TTL sichtbar (markiert die Stelle).
      g.circle(0, 0, 5).fill({ color: ping.color, alpha: (1 - life) * 0.9 });
    }
  }
}
