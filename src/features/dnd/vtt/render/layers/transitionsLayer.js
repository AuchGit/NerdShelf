// Level-transition fields (stairs / ladder). Renders one icon per field on the
// currently shown level. A token entering a field switches to its target level
// (handled in the renderer). Players see them too, so they know where the
// stairs are. Uses the DM's stairs.svg / ladder.svg with a drawn fallback.
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { TRANSITION_ICONS } from '../../lib/constants';
import { cellCenter } from '../../lib/geometry';
import { loadIcon } from '../textures';

export class TransitionsLayer {
  constructor() {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.nodes = new Map(); // id -> { root, gfx, icon, label, key }
  }

  update(transitions, mapId, level, grid, isDM, selectedId, seenIds = null) {
    let list = Object.values(transitions).filter((t) => t.mapId === mapId && (t.level || level) === level);
    // Players only see a stairs/ladder field once they've explored its spot.
    if (!isDM && seenIds) list = list.filter((t) => seenIds.has(t.id));
    const seen = new Set();
    for (const t of list) {
      seen.add(t.id);
      let node = this.nodes.get(t.id);
      if (!node) node = this.create(t);
      this.draw(node, t, grid, isDM && t.id === selectedId, isDM);
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.root.destroy({ children: true }); this.nodes.delete(id); }
    }
  }

  create(t) {
    const root = new Container();
    const gfx = new Graphics();
    const icon = new Sprite(); icon.anchor.set(0.5);
    const label = new Text({ text: '', style: { fill: '#fff', fontSize: 10, fontWeight: '700', stroke: { color: '#000', width: 3 } } });
    label.anchor.set(0.5);
    root.addChild(gfx, icon, label);
    this.container.addChild(root);
    const node = { root, gfx, icon, label, key: null };
    this.nodes.set(t.id, node);
    return node;
  }

  draw(node, t, grid, selected, isDM) {
    const c = cellCenter(t.col, t.row, grid);
    node.root.position.set(c.x, c.y);
    const s = grid.size;
    const nExits = (t.exits || []).length || (t.toLevel ? 1 : 0);
    // Players see a plain travel marker; only the DM gets the orange
    // "unconnected" authoring warning.
    const strokeColor = (!nExits && isDM) ? 0xff9800 : 0x6c8cff;

    node.gfx.clear()
      .rect(-s / 2, -s / 2, s, s)
      .fill({ color: 0x6c8cff, alpha: selected ? 0.32 : 0.18 })
      .stroke({ width: selected ? 3 : 2, color: strokeColor, alpha: 0.9 });

    const key = t.kind;
    if (node.key !== key) {
      node.key = key;
      node.icon.texture = null;
      loadIcon(TRANSITION_ICONS[key]).then((tex) => {
        if (!tex || node.icon.destroyed || node.key !== key) return;
        node.icon.texture = tex;
        node.icon.scale.set((s * 0.8) / Math.max(tex.width, tex.height));
      });
    }
    // fallback glyph until the SVG is present
    node.label.text = node.icon.texture && node.icon.texture.width > 1 ? '' : (t.kind === 'ladder' ? '🪜' : '🪜↑');
    node.label.style.fontSize = s * 0.4;
  }
}
