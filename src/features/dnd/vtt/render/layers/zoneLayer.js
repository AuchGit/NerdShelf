// Zone / AoE template layer. Each zone is selectable; the selected zone shows
// a dashed outline, a live size label (radius / length / width in ft), and drag
// handles to resize + rotate. The renderer wires selection / move / handle drag
// via callbacks. Affected grid cells are highlighted Foundry-style.
import { Container, Graphics, Text } from 'pixi.js';
import { zonePolygon, cellCenter, feetToPx } from '../../lib/geometry';

export class ZoneLayer {
  constructor() {
    this.container = new Container();
    this.nodes = new Map(); // zoneId -> { root, shape, sel, label, hSize, hWidth }
    this.onZonePointerDown = null;          // (zoneId, e)
    this.onZoneHandle = null;               // (zoneId, 'size'|'width', e)
  }

  update(zones, grid, selectedId, clipPolys = null) {
    const seen = new Set();
    for (const z of Object.values(zones)) {
      seen.add(z.id);
      let node = this.nodes.get(z.id);
      if (!node) node = this.create(z);
      this.draw(node, z, grid, selectedId === z.id, clipPolys ? clipPolys[z.id] : null);
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.root.destroy({ children: true }); this.nodes.delete(id); }
    }
  }

  create(z) {
    const root = new Container();
    const shape = new Graphics();
    shape.eventMode = 'static';
    shape.cursor = 'move';
    shape.zoneId = z.id;
    shape.on('pointerdown', (e) => this.onZonePointerDown?.(z.id, e));

    const sel = new Graphics();
    const losMask = new Graphics(); // clips the shape to line-of-sight when enabled
    const label = new Text({ text: '', style: { fill: '#fff', fontSize: 14, fontWeight: '700', stroke: { color: '#000', width: 4 } } });
    label.anchor.set(0.5);

    const hSize = makeHandle(() => {}, '#fff');
    const hWidth = makeHandle(() => {}, '#9ad');
    hSize.on('pointerdown', (e) => { e.stopPropagation(); this.onZoneHandle?.(z.id, 'size', e); });
    hWidth.on('pointerdown', (e) => { e.stopPropagation(); this.onZoneHandle?.(z.id, 'width', e); });

    root.addChild(shape, losMask, sel, label, hSize, hWidth);
    this.container.addChild(root);
    const node = { root, shape, sel, losMask, label, hSize, hWidth };
    this.nodes.set(z.id, node);
    return node;
  }

  draw(node, z, grid, selected, clipPoly) {
    const poly = zonePolygon(z, grid);
    const g = node.shape;
    g.clear();
    if (poly.length >= 2) {
      highlightCells(g, poly, grid, z.color);
      g.poly(poly.flatMap((p) => [p.x, p.y]))
        .fill({ color: z.color, alpha: z.opacity ?? 0.3 })
        .stroke({ width: 2, color: z.color, alpha: 0.9 });
    }
    // Clip the area to line-of-sight from the zone origin (default on; the DM can
    // turn it off per zone). clipPoly is the precomputed visibility polygon.
    node.losMask.clear();
    if (clipPoly && clipPoly.length >= 3) {
      node.losMask.poly(clipPoly.flatMap((p) => [p.x, p.y])).fill(0xffffff);
      node.shape.mask = node.losMask;
    } else {
      node.shape.mask = null;
    }

    // selection outline + handles + label
    node.sel.clear();
    node.hSize.visible = node.hWidth.visible = false;
    node.label.visible = selected || z.preview;

    if (selected || z.preview) {
      node.label.text = sizeLabel(z);
      node.label.position.set(z.x, z.y - 12);
    }
    if (selected && poly.length >= 2) {
      node.sel.poly(poly.flatMap((p) => [p.x, p.y])).stroke({ width: 2, color: '#fff', alpha: 0.9 });
      placeHandles(node, z, grid);
    }
  }
}

function sizeLabel(z) {
  const p = z.params || {};
  switch (z.type) {
    case 'circle': return `R ${p.radiusFt} ft`;
    case 'square': return `${p.sideFt} ft`;
    case 'cone':   return `${p.lengthFt} ft`;
    case 'line':   return `${p.lengthFt} × ${p.widthFt} ft`;
    default: return '';
  }
}

// Position the size handle (and width handle for lines) in map space.
function placeHandles(node, z, grid) {
  const p = z.params || {};
  const dir = ((p.directionDeg ?? 0) * Math.PI) / 180;
  const ux = Math.cos(dir), uy = Math.sin(dir);
  if (z.type === 'circle') {
    const r = feetToPx(p.radiusFt, grid.size);
    node.hSize.position.set(z.x + r, z.y); node.hSize.visible = true;
  } else if (z.type === 'square') {
    const h = feetToPx(p.sideFt, grid.size) / 2;
    node.hSize.position.set(z.x + h, z.y + h); node.hSize.visible = true;
  } else if (z.type === 'cone') {
    const len = feetToPx(p.lengthFt, grid.size);
    node.hSize.position.set(z.x + ux * len, z.y + uy * len); node.hSize.visible = true;
  } else if (z.type === 'line') {
    const len = feetToPx(p.lengthFt, grid.size);
    const w = feetToPx(p.widthFt, grid.size) / 2;
    node.hSize.position.set(z.x + ux * len, z.y + uy * len); node.hSize.visible = true;
    // width handle perpendicular at mid-length
    node.hWidth.position.set(z.x + ux * len * 0.5 - uy * w, z.y + uy * len * 0.5 + ux * w);
    node.hWidth.visible = true;
  }
}

function makeHandle(_, color) {
  const g = new Graphics().circle(0, 0, 7).fill(color).stroke({ width: 2, color: '#000', alpha: 0.7 });
  g.eventMode = 'static';
  g.cursor = 'pointer';
  return g;
}

function highlightCells(g, poly, grid, color) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minC = Math.floor((Math.min(...xs) - grid.offsetX) / grid.size);
  const maxC = Math.floor((Math.max(...xs) - grid.offsetX) / grid.size);
  const minR = Math.floor((Math.min(...ys) - grid.offsetY) / grid.size);
  const maxR = Math.floor((Math.max(...ys) - grid.offsetY) / grid.size);
  if ((maxC - minC) * (maxR - minR) > 4000) return;
  for (let c = minC; c <= maxC; c++) {
    for (let r = minR; r <= maxR; r++) {
      const center = cellCenter(c, r, grid);
      if (pointInPolygon(center.x, center.y, poly)) {
        g.rect(grid.offsetX + c * grid.size, grid.offsetY + r * grid.size, grid.size, grid.size)
          .fill({ color, alpha: 0.18 });
      }
    }
  }
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
