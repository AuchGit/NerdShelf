// Grid layer. Redraws only when the active map's grid params change.
import { Graphics } from 'pixi.js';
import { GRID_STYLES } from '../../lib/constants';

export class GridLayer {
  constructor() {
    this.container = new Graphics();
    this.container.eventMode = 'none'; // never intercept pointer events
    this._key = null; // dirty check
  }

  update(map) {
    if (!map) { this.container.clear(); this._key = null; return; }
    const g = map.grid;
    const key = `${map.width}x${map.height}|${g.size}|${g.offsetX}|${g.offsetY}|${g.color}|${g.opacity}|${g.thickness}|${g.style}`;
    if (key === this._key) return;
    this._key = key;
    this.draw(map);
  }

  draw(map) {
    const g = map.grid;
    const gfx = this.container;
    gfx.clear();
    if (g.opacity <= 0 || g.size <= 0) return;

    const dash = GRID_STYLES[g.style]?.dash || null;
    const cols = Math.ceil((map.width - g.offsetX) / g.size);
    const rows = Math.ceil((map.height - g.offsetY) / g.size);

    // Vertical lines
    for (let c = 0; c <= cols; c++) {
      const x = g.offsetX + c * g.size;
      if (x < 0 || x > map.width) continue;
      addLine(gfx, x, 0, x, map.height, dash);
    }
    // Horizontal lines
    for (let r = 0; r <= rows; r++) {
      const y = g.offsetY + r * g.size;
      if (y < 0 || y > map.height) continue;
      addLine(gfx, 0, y, map.width, y, dash);
    }

    gfx.stroke({ width: g.thickness, color: g.color, alpha: g.opacity, pixelLine: false });
  }
}

// Append a (possibly dashed) line's segments to a Graphics, to be stroked once.
function addLine(gfx, x1, y1, x2, y2, dash) {
  if (!dash) {
    gfx.moveTo(x1, y1).lineTo(x2, y2);
    return;
  }
  const [on, off] = dash;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  let pos = 0;
  while (pos < len) {
    const segEnd = Math.min(pos + on, len);
    gfx.moveTo(x1 + ux * pos, y1 + uy * pos).lineTo(x1 + ux * segEnd, y1 + uy * segEnd);
    pos = segEnd + off;
  }
}
