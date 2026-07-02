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
  // prefs: { opacity, pattern:'fill'|'hatch'|'dots', color, climbHeightStyle:'loud'|'normal'|'minimal'|'off' }
  // The base display (fill / pattern / climb labels / outline) is driven by the
  // prefs for BOTH the DM and players, so the DM sees the look they configure
  // for the table. The DM gets editing-only overlays on top: hidden-object
  // fading, green "open passage" edge hints and the marquee selection.
  update(objects, grid, isDM, selectedId, selection = [], prefs = null) {
    const g = this.gfx;
    g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    const s = grid.size;
    const x0 = (c) => grid.offsetX + c * s;
    const y0 = (r) => grid.offsetY + r * s;
    const colorOf = (o) => (o.kind === 'difficult' ? 0xff9800 : (o.ft || 0) < 0 ? 0xff7043 : 0x4aa3ff);
    const prefColor = prefs?.color ? hexNum(prefs.color) : null;
    const pOpacity = prefs?.opacity ?? 0.35;
    const pPattern = prefs?.pattern || 'fill';
    const climbStyle = prefs?.climbHeightStyle || 'normal';
    const difficultStyle = prefs?.difficultStyle || 'normal'; // loud|normal|minimal|off

    for (const o of objects) {
      if (!isDM && o.visible === false) continue;
      const isDifficult = o.kind === 'difficult';
      // Difficult terrain has its own prominence pref (mirrors the climb style).
      // The DM keeps at least 'minimal' so it stays editable; a player can hide it.
      const effDiff = isDM && difficultStyle === 'off' ? 'minimal' : difficultStyle;
      if (isDifficult && effDiff === 'off') continue;
      const diffMul = isDifficult ? (effDiff === 'loud' ? 1.5 : effDiff === 'minimal' ? 0.5 : 1) : 1;
      const color = prefColor ?? colorOf(o);
      const sel = o.id === selectedId;
      const inObj = new Set(o.cells);
      const disabled = new Set(o.disabledEdges || []);
      // DM-only: a terrain object hidden from players is drawn faded so it's
      // obvious it won't show at the table.
      const hiddenDM = isDM && o.visible === false;
      // The DM always keeps at least a minimal climb label (editing needs the
      // value); players honour the chosen style, incl. 'off'.
      const effClimb = isDM && climbStyle === 'off' ? 'minimal' : climbStyle;
      let labelDone = false; // for 'minimal' climb style: one label per object
      o.cells.forEach((c, ci) => {
        const [col, row] = c.split(',').map(Number);
        const x = x0(col);
        const y = y0(row);
        // ── Base display (shared) ── (difficult terrain scaled by its prominence pref)
        const fillA = (hiddenDM ? Math.min(0.16, pOpacity) : (sel ? Math.min(0.9, pOpacity + 0.12) : pOpacity)) * diffMul;
        if (fillA > 0) g.rect(x, y, s, s).fill({ color, alpha: Math.min(0.95, fillA) });
        // Difficult terrain always reads as hatched (so it's distinct from
        // climb) even when the pattern pref is a plain fill.
        if (pPattern === 'hatch' || (isDifficult && pPattern !== 'dots')) {
          g.moveTo(x, y + s).lineTo(x + s, y).stroke({ width: 1, color, alpha: Math.min(0.85, (pOpacity + 0.2) * diffMul) });
        } else if (pPattern === 'dots') {
          g.circle(x + s / 2, y + s / 2, Math.max(1.5, s * 0.06)).fill({ color, alpha: Math.min(0.9, (pOpacity + 0.3) * diffMul) });
        }
        // Climb height label.
        if (o.kind !== 'difficult' && effClimb !== 'off') {
          const showHere = effClimb === 'minimal' ? (!labelDone && ci === 0) : true;
          if (showHere) {
            labelDone = true;
            const fs = effClimb === 'loud' ? Math.max(12, s * 0.34) : effClimb === 'minimal' ? Math.max(8, s * 0.2) : Math.max(9, s * 0.24);
            const txt = new Text({ text: `${o.ft > 0 ? '+' : ''}${o.ft || 0}ft`, style: { fill: '#fff', fontSize: fs, fontWeight: effClimb === 'loud' ? '800' : '700', stroke: { color: '#000', width: effClimb === 'minimal' ? 2 : 3 } } });
            txt.anchor.set(0.5); txt.alpha = effClimb === 'minimal' ? 0.8 : 1;
            txt.position.set(x + s / 2, y + s / 2); this.labels.addChild(txt);
          }
        }
        // ── Perimeter edges ──
        for (const [side, dc, dr, lineFn] of SIDES) {
          if (inObj.has(`${col + dc},${row + dr}`)) continue; // interior edge
          const [x1, y1, x2, y2] = lineFn(x, y, s);
          const off = disabled.has(`${col},${row}:${side}`);
          if (off) {
            // Open passage: DM sees a green hint; players see nothing (a gap).
            if (isDM) g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2, color: 0x4ade80, alpha: 0.7 });
            continue;
          }
          g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: sel ? 3 : 2, color, alpha: Math.min(0.7, pOpacity + 0.25) });
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
