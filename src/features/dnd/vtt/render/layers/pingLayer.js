// Ping layer. Renders transient location markers (Alt-click) as an animated
// expanding ring that fades out. Pings auto-expire from the store after a TTL.
import { Container, Graphics } from 'pixi.js';
import { PING_TTL_MS } from '../../lib/constants';
import { getPingScale } from '../../lib/vttPrefs';

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
    const scale = getPingScale(); // pro Client einstellbar (VTT-Einstellungen)
    for (const { g, ping } of this.nodes.values()) {
      const age = now - ping.at;
      const life = Math.min(1, age / PING_TTL_MS); // Gesamt-Ausblenden
      g.clear();
      // Weiche Ripple: zwei phasenversetzte Wellen, die aufsteigen und sanft
      // ausklingen (schlicht wie der Loop-Puls). Größe/Deutlichkeit skaliert.
      const baseR = 46 * scale;
      for (const phase of [0, 0.5]) {
        const tt = ((age / 900) + phase) % 1;
        const r = baseR * (0.25 + tt * 0.85);
        const a = (1 - tt) * (1 - life) * 0.85;
        if (a <= 0.01) continue;
        g.circle(0, 0, r).stroke({ width: 3 * scale, color: ping.color, alpha: a });
      }
      // Kleiner Kern markiert die exakte Stelle bis zum TTL-Ende.
      g.circle(0, 0, 5 * scale).fill({ color: ping.color, alpha: (1 - life) * 0.85 });
    }
  }
}
