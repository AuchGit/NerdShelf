// Walls layer — DM-only. Renders wall segments color-coded by kind (light+move,
// move-only, door). Each wall is selectable (a wide invisible hit-line makes the
// thin wall easy to click); the selected wall shows draggable endpoint handles.
// Players never see walls, only their effects.
import { Container, Graphics, Sprite, Texture, ColorMatrixFilter } from 'pixi.js';
import { WALL_TYPES, DOOR_ICONS } from '../../lib/constants';
import { loadIcon } from '../textures';

const WINDOW_ICON = '/Assets/map/window.svg';
// Default on-screen width (in grid cells) of a door/window icon; per-wall
// `widthCells` overrides it (narrow arrow-slit … wide gate).
const DEFAULT_OPENING_CELLS = 0.7;

export class WallsLayer {
  constructor() {
    this.container = new Container();
    this.preview = new Graphics();
    this.nodes = new Map(); // wallId -> { root, hit, line, hA, hB }
    this.container.addChild(this.preview);
    this.onWallPointerDown = null; // (id, e)
    this.onWallHandle = null;      // (id, 'a'|'b', e)
  }

  update(walls, mapId, isDM, selectedId, gridSize = 70, showWalls = false, seenDoorIds = null) {
    this.container.visible = true;
    const selSet = Array.isArray(selectedId) ? new Set(selectedId) : new Set(selectedId ? [selectedId] : []);
    const list = Object.values(walls).filter((w) => w.mapId === mapId);
    const seen = new Set();
    for (const w of list) {
      seen.add(w.id);
      let node = this.nodes.get(w.id);
      if (!node) node = this.create(w);
      // Doors are visible & clickable to everyone (anyone can open a door) — but
      // a player only sees a door once they've EXPLORED that spot (seenDoorIds).
      // Plain walls (LOS/movement blockers) only show to the DM while the walls
      // tool is active (showWalls) — otherwise they'd clutter the map.
      // Doors AND windows are physical features everyone can see once explored.
      const physical = w.kind === 'door' || w.kind === 'window';
      const physicalVisible = physical && (isDM || !seenDoorIds || seenDoorIds.has(w.id));
      node.root.visible = physicalVisible || showWalls;
      this.draw(node, w, selSet.has(w.id), gridSize);
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.root.destroy({ children: true }); this.nodes.delete(id); }
    }
  }

  create(w) {
    const root = new Container();
    // Robust hit-testing via a custom hitArea (distance-to-segment) — Pixi v8
    // Graphics containsPoint ignores strokes and was unreliable for thin lines.
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new SegmentHit(w.a, w.b, 14);
    root.on('pointerdown', (e) => this.onWallPointerDown?.(w.id, e));
    // Hover feedback so players discover clickable doors/windows: brighten the
    // icon + a soft glow line. Plain walls (DM editing) skip the glow.
    root.on('pointerover', () => {
      const cur = this.nodes.get(w.id);
      if (!cur) return;
      cur._hover = true;
      cur.icon.alpha = 1;
      if (cur._wall && (cur._wall.kind === 'door' || cur._wall.kind === 'window')) drawHoverGlow(cur.hover, cur._wall);
    });
    root.on('pointerout', () => {
      const cur = this.nodes.get(w.id);
      if (!cur) return;
      cur._hover = false;
      cur.icon.alpha = 0.75;
      cur.hover.clear();
    });
    const line = new Graphics();
    const hover = new Graphics(); // hover glow under the icon (doors/windows)
    const leaf = new Graphics(); // drawn door fallback, cleared once the SVG loads
    const icon = new Sprite(); icon.anchor.set(0.5); icon.visible = false; icon.alpha = 0.75; // single centered door icon
    const hA = makeHandle(); const hB = makeHandle();
    hA.on('pointerdown', (e) => { e.stopPropagation(); this.onWallHandle?.(w.id, 'a', e); });
    hB.on('pointerdown', (e) => { e.stopPropagation(); this.onWallHandle?.(w.id, 'b', e); });
    root.addChild(hover, line, leaf, icon, hA, hB);
    this.container.addChild(root);
    const node = { root, line, hover, leaf, icon, hA, hB, iconKey: null };
    this.nodes.set(w.id, node);
    return node;
  }

  draw(node, w, selected, gridSize) {
    const def = WALL_TYPES[w.kind] || WALL_TYPES.both;
    const isDoor = w.kind === 'door';
    const isWindow = w.kind === 'window';
    const open = (isDoor || isWindow) && w.open;
    const col = def.color;
    node._wall = w; // latest wall data for the hover handlers
    if (node._hover && (isDoor || isWindow)) drawHoverGlow(node.hover, w); else node.hover.clear();

    // refresh hit segment to current endpoints
    node.root.hitArea.set(w.a, w.b);

    node.line.clear();
    node.leaf.clear();
    if (isDoor || isWindow) {
      // The faint opening guide only shows while selected (editing); otherwise
      // just the icon marks it, so the map stays clean.
      if (selected) node.line.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y).stroke({ width: 2, color: col, alpha: 0.5 });
      // Door: separate open/closed SVGs. Window: ONE SVG, colour-inverted when
      // open (the user supplies a single window.svg).
      const key = isWindow ? (open ? 'win-open' : 'win-closed') : (open ? 'open' : 'closed');
      const haveTex = node.icon.texture && node.icon.texture !== Texture.EMPTY && node.icon.texture.width > 1 && node.iconKey === key;
      if (node.iconKey !== key) {
        node.iconKey = key;
        loadIcon(isWindow ? WINDOW_ICON : DOOR_ICONS[key]).then((tex) => {
          if (!tex || node.icon.destroyed || node.iconKey !== key) return;
          node.icon.texture = tex;
          node.icon.scale.set((gridSize * (w.widthCells || DEFAULT_OPENING_CELLS)) / Math.max(tex.width, tex.height));
          node.leaf.clear();
        });
      }
      // Window "open" = inverted colours of the same SVG.
      if (isWindow && open) {
        if (!node._invert) { node._invert = new ColorMatrixFilter(); node._invert.negative(true); }
        node.icon.filters = [node._invert];
      } else if (node.icon.filters?.length) {
        node.icon.filters = [];
      }
      node.icon.visible = true;
      node.icon.position.set((w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2);
      node.icon.rotation = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
      // Display width (in cells) of the door/window icon — per-wall override so
      // a narrow arrow-slit or a wide gate reads at the right size. Re-applied
      // every frame so a WallEditor change takes effect live.
      if (haveTex) node.icon.scale.set((gridSize * (w.widthCells || DEFAULT_OPENING_CELLS)) / Math.max(node.icon.texture.width, node.icon.texture.height));
      // Drawn fallback only for doors (windows just show the SVG / nothing).
      if (!haveTex && isDoor) drawDoorLeaf(node.leaf, w.a, w.b, open, col);
      else if (!haveTex && isWindow) drawWindowFallback(node.leaf, w.a, w.b, open, col);
      // Frosted-glass cue for a CLOSED milky window (dims light by a step) —
      // shown in both the SVG and fallback cases so the DM can tell them apart.
      if (isWindow && w.milky && !open) drawFrost(node.leaf, w.a, w.b);
    } else {
      node.icon.visible = false;
      node.leaf.clear();
      node.line.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y)
        .stroke({ width: selected ? 5 : 4, color: col, alpha: 0.9, cap: 'round' });
      node.line.circle(w.a.x, w.a.y, 4).fill(col);
      node.line.circle(w.b.x, w.b.y, 4).fill(col);
    }

    node.hA.visible = node.hB.visible = selected;
    if (selected) { node.hA.position.set(w.a.x, w.a.y); node.hB.position.set(w.b.x, w.b.y); }
  }

  drawPreview(a, b, kind) {
    const def = WALL_TYPES[kind] || WALL_TYPES.both;
    this.preview.clear();
    if (a && b) this.preview.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4, color: def.color, alpha: 0.6 });
  }
}

// Custom Pixi hitArea: true when a (local-space) point is within `pad` of the
// segment. Local space == map space here (the wall root has no transform).
class SegmentHit {
  constructor(a, b, pad) { this.a = a; this.b = b; this.pad = pad; }
  set(a, b) { this.a = a; this.b = b; }
  contains(x, y) {
    const { a, b } = this;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(x - cx, y - cy) <= this.pad;
  }
}

// Drawn door leaf (fallback when no SVG): closed = panel filling the opening;
// open = panel swung 90° at the `a` hinge.
function drawDoorLeaf(g, a, b, open, col) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const thick = Math.max(6, len * 0.22);
  let ex, ey; // leaf far end
  if (open) { ex = a.x - uy * len; ey = a.y + ux * len; } // perpendicular from hinge a
  else { ex = b.x; ey = b.y; }
  const px = -(ey - a.y) / len, py = (ex - a.x) / len; // perpendicular unit of the leaf
  const h = thick / 2;
  g.poly([
    a.x + px * h, a.y + py * h, ex + px * h, ey + py * h,
    ex - px * h, ey - py * h, a.x - px * h, a.y - py * h,
  ]).fill({ color: col, alpha: 0.85 }).stroke({ width: 1.5, color: 0x000000, alpha: 0.5 });
}

// Drawn window fallback (until/without an SVG): a glassy bar across the opening
// with a pane divider; open = lighter/translucent.
function drawWindowFallback(g, a, b, open, col) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const h = Math.max(4, len * 0.14);
  g.poly([
    a.x + px * h, a.y + py * h, b.x + px * h, b.y + py * h,
    b.x - px * h, b.y - py * h, a.x - px * h, a.y - py * h,
  ]).fill({ color: col, alpha: open ? 0.25 : 0.6 }).stroke({ width: 1.5, color: 0x06283a, alpha: 0.6 });
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  g.moveTo(mx + px * h, my + py * h).lineTo(mx - px * h, my - py * h).stroke({ width: 1.5, color: 0x06283a, alpha: 0.6 });
}

// Frosted overlay for a milky (closed) window: a soft white translucent bar
// with a couple of diagonal frost ticks across the opening.
function drawFrost(g, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const h = Math.max(4, len * 0.16);
  g.poly([
    a.x + px * h, a.y + py * h, b.x + px * h, b.y + py * h,
    b.x - px * h, b.y - py * h, a.x - px * h, a.y - py * h,
  ]).fill({ color: 0xffffff, alpha: 0.32 });
  for (const t of [0.3, 0.55, 0.8]) {
    const cx = a.x + dx * t, cy = a.y + dy * t;
    g.moveTo(cx - ux * h * 0.5 + px * h * 0.7, cy - uy * h * 0.5 + py * h * 0.7)
      .lineTo(cx + ux * h * 0.5 - px * h * 0.7, cy + uy * h * 0.5 - py * h * 0.7)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  }
}

// Hover glow for a clickable door/window: a soft wide line along the opening.
function drawHoverGlow(g, w) {
  g.clear();
  g.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y).stroke({ width: 14, color: 0xffffff, alpha: 0.18, cap: 'round' });
  g.moveTo(w.a.x, w.a.y).lineTo(w.b.x, w.b.y).stroke({ width: 6, color: 0xffe9b0, alpha: 0.35, cap: 'round' });
}

function makeHandle() {
  const g = new Graphics().circle(0, 0, 7).fill('#fff').stroke({ width: 2, color: '#000', alpha: 0.7 });
  g.eventMode = 'static';
  g.cursor = 'pointer';
  g.visible = false;
  return g;
}
