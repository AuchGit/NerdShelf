// Terrain layer — climb-height / difficult-terrain OBJECTS (Gelände tool).
// DM sees filled cells (hatched difficult, "+5ft" climb label), the object's
// perimeter outline (disabled edges shown green = open passages) and the
// selection highlight. Players see only the (subtle) perimeter of visible
// objects, with disabled edges left open.
import { Container, Graphics, Text } from 'pixi.js';

function hexNum(hex) { const s = String(hex).replace('#', ''); return s.length >= 6 ? parseInt(s.slice(0, 6), 16) : 0xff9800; }

const SIDES = [
  ['T', 0, -1, (x, y, s) => [x, y, x + s, y]],
  ['B', 0, 1, (x, y, s) => [x, y + s, x + s, y + s]],
  ['L', -1, 0, (x, y, s) => [x, y, x, y + s]],
  ['R', 1, 0, (x, y, s) => [x + s, y, x + s, y + s]],
];

export class TerrainLayer {
  constructor() {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.gfx = new Graphics();
    this.labels = new Container();
    this.container.addChild(this.gfx, this.labels);
  }

  // objects: [{ id, kind, ft, cells:['c,r'], visible, disabledEdges }]
  // prefs (player only): { opacity, pattern:'fill'|'hatch'|'dots', color, climbHeightStyle:'loud'|'normal'|'minimal'|'off' }
  update(objects, grid, isDM, selectedId, selection = [], prefs = null) {
    const g = this.gfx;
    g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    const s = grid.size;
    const x0 = (c) => grid.offsetX + c * s;
    const y0 = (r) => grid.offsetY + r * s;
    const colorOf = (o) => (o.kind === 'difficult' ? 0xff9800 : (o.ft || 0) < 0 ? 0xff7043 : 0x4aa3ff);
    const prefColor = (!isDM && prefs?.color) ? hexNum(prefs.color) : null;
    const pOpacity = prefs?.opacity ?? 0.35;
    const pPattern = prefs?.pattern || 'fill';
    const climbStyle = prefs?.climbHeightStyle || 'normal';

    for (const o of objects) {
      if (!isDM && o.visible === false) continue;
      const color = prefColor ?? colorOf(o);
      const sel = o.id === selectedId;
      const inObj = new Set(o.cells);
      const disabled = new Set(o.disabledEdges || []);
      let labelDone = false; // for 'minimal' climb style: one label per object
      o.cells.forEach((c, ci) => {
        const [col, row] = c.split(',').map(Number);
        const x = x0(col);
        const y = y0(row);
        if (isDM) {
          g.rect(x, y, s, s).fill({ color, alpha: sel ? 0.26 : 0.15 });
          if (o.kind === 'difficult') {
            g.moveTo(x, y + s).lineTo(x + s, y).stroke({ width: 1, color, alpha: 0.4 });
            g.moveTo(x, y).lineTo(x + s, y + s).stroke({ width: 1, color, alpha: 0.4 });
          } else {
            const txt = new Text({ text: `${o.ft > 0 ? '+' : ''}${o.ft || 0}ft`, style: { fill: '#fff', fontSize: Math.max(9, s * 0.24), fontWeight: '700', stroke: { color: '#000', width: 3 } } });
            txt.anchor.set(0.5); txt.position.set(x + s / 2, y + s / 2); this.labels.addChild(txt);
          }
        } else {
          // ── Player display, driven by personal prefs ──
          if (pOpacity > 0) g.rect(x, y, s, s).fill({ color, alpha: pOpacity });
          if (pPattern === 'hatch') {
            g.moveTo(x, y + s).lineTo(x + s, y).stroke({ width: 1, color, alpha: Math.min(0.8, pOpacity + 0.2) });
          } else if (pPattern === 'dots') {
            g.circle(x + s / 2, y + s / 2, Math.max(1.5, s * 0.06)).fill({ color, alpha: Math.min(0.9, pOpacity + 0.3) });
          }
          // Climb height label prominence.
          if (o.kind !== 'difficult' && climbStyle !== 'off') {
            const showHere = climbStyle === 'minimal' ? (!labelDone && ci === 0) : true;
            if (showHere) {
              labelDone = true;
              const fs = climbStyle === 'loud' ? Math.max(12, s * 0.34) : climbStyle === 'minimal' ? Math.max(8, s * 0.2) : Math.max(9, s * 0.24);
              const txt = new Text({ text: `${o.ft > 0 ? '+' : ''}${o.ft || 0}ft`, style: { fill: '#fff', fontSize: fs, fontWeight: climbStyle === 'loud' ? '800' : '700', stroke: { color: '#000', width: climbStyle === 'minimal' ? 2 : 3 } } });
              txt.anchor.set(0.5); txt.alpha = climbStyle === 'minimal' ? 0.7 : 1;
              txt.position.set(x + s / 2, y + s / 2); this.labels.addChild(txt);
            }
          }
        }
        for (const [side, dc, dr, lineFn] of SIDES) {
          if (inObj.has(`${col + dc},${row + dr}`)) continue; // interior edge
          const [x1, y1, x2, y2] = lineFn(x, y, s);
          const off = disabled.has(`${col},${row}:${side}`);
          if (off) {
            // Open passage: DM sees a green hint; players see nothing (a gap).
            if (isDM) g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2, color: 0x4ade80, alpha: 0.7 });
            continue;
          }
          g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: sel ? 3 : 2, color, alpha: isDM ? 0.6 : Math.min(0.7, pOpacity + 0.25) });
        }
      });
    }

    if (isDM) {
      for (const c of selection) {
        const [col, row] = c.split(',').map(Number);
        g.rect(x0(col), y0(row), s, s).fill({ color: 0x6c8cff, alpha: 0.14 }).stroke({ width: 2, color: 0x6c8cff, alpha: 0.95 });
      }
    }
  }
}
