// Token layer. Reconciles store tokens → Pixi display objects, keyed by id.
//
// Each token is a Container:
//   [ ring (Graphics) ][ portrait sprite, circular-masked | color disc + initial ]
//   [ HP bar (Graphics) ][ condition badges (Container) ][ selection ring ]
//
// Interaction (drag/select/right-click) is owned by VttRenderer; this layer
// just exposes `onTokenPointerDown` / `onTokenRightClick` callbacks and tags
// each container with `.tokenId`.
import { Container, Graphics, Sprite, Texture, Text } from 'pixi.js';
import { CONDITION_BY_ID } from '../../lib/constants';
import { loadTexture, loadSvgTinted } from '../textures';

export class TokenLayer {
  constructor() {
    this.container = new Container();
    this.nodes = new Map(); // tokenId -> { root, ring, portrait, mask, hp, badges, sel, initial, ac }
    this.onTokenPointerDown = null;  // (tokenId, event) => void
    this.onTokenRightClick = null;   // (tokenId, event) => void
    this.onTokenDoubleClick = null;  // (tokenId, event) => void
  }

  update(tokens, grid, selectedIds, draggingId, hiddenTokens, dmView = false, viewerId = null, bloody = false, elevations = null, turn = null) {
    this._dmView = dmView; this._viewerId = viewerId; this._bloody = bloody; this._elev = elevations || {};
    this._turnId = turn?.activeId || null; this._nextId = turn?.nextId || null; this._hoverId = turn?.hoverId || null;
    const selSet = Array.isArray(selectedIds) ? new Set(selectedIds) : new Set(selectedIds ? [selectedIds] : []);
    const seen = new Set();
    for (const t of Object.values(tokens)) {
      seen.add(t.id);
      let node = this.nodes.get(t.id);
      if (!node) node = this.create(t);
      // Hidden from a player by dynamic fog (token sits in unseen/occluded space).
      node.root.visible = !(hiddenTokens && hiddenTokens.has(t.id));
      this.draw(node, t, grid, selSet.has(t.id), dmView);
      // While dragging this token locally, the renderer drives its position
      // directly for zero-lag feel; skip store-driven repositioning then.
      if (draggingId !== t.id) node.root.position.set(t.x, t.y);
    }
    // remove stale
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.root.destroy({ children: true }); this.nodes.delete(id); }
    }
  }

  create(t) {
    const root = new Container();
    root.tokenId = t.id;
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const disc = new Graphics();   // colored background disc (no-image tokens)
    const ring = new Graphics();   // border outline
    const mask = new Graphics();
    const portrait = new Sprite();
    portrait.anchor.set(0.5);
    portrait.mask = mask;
    const blood = new Sprite(); // procedural damage overlay (HP-based)
    blood.anchor.set(0.5);
    blood.mask = mask;
    blood.visible = false;
    const initial = new Text({ text: '', style: { fill: '#fff', fontSize: 24, fontWeight: '700' } });
    initial.anchor.set(0.5);
    const hp = new Graphics();
    const badges = new Container();
    const sel = new Graphics();
    const ac = new Container(); // AC badge (DM-only, enemy tokens)
    const elev = new Container(); // elevation badge (token on climb terrain)

    // order: selection, disc, portrait, blood overlay, mask, initial, ring, hp, badges, ac, elev
    root.addChild(sel, disc, portrait, blood, mask, initial, ring, hp, badges, ac, elev);
    let lastTap = 0;
    root.on('pointerdown', (e) => {
      if (e.button === 2) { this.onTokenRightClick?.(t.id, e); return; }
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastTap < 300) { lastTap = 0; this.onTokenDoubleClick?.(t.id, e); return; }
      lastTap = now;
      this.onTokenPointerDown?.(t.id, e);
    });

    this.container.addChild(root);
    const node = { root, disc, ring, portrait, blood, mask, initial, hp, badges, sel, ac, elev, url: null, bloodKey: null };
    this.nodes.set(t.id, node);
    return node;
  }

  draw(node, t, grid, selected, dmView) {
    // The token must stay flush INSIDE its grid cell(s). A Pixi stroke is
    // centered on the path, so it extends ringW/2 beyond the radius — inset the
    // radius by that much so the outer edge lands exactly on the cell boundary.
    const cell = (t.sizeCells * grid.size) / 2;
    const ringW = Math.max(2, cell * 0.06);
    const r = cell - ringW / 2;

    // border ring + circular mask
    node.ring.clear().circle(0, 0, r).stroke({ width: ringW, color: t.color || '#888' });
    node.mask.clear().circle(0, 0, r).fill(0xffffff);

    // Colored disc is ALWAYS the base; a portrait covers it once loaded. So a
    // failed image (e.g. a 5etools token URL that 404s / CORS-blocks) falls
    // back to disc + initial instead of a blank token.
    node.disc.clear().circle(0, 0, r).fill({ color: t.color || '#556', alpha: 0.95 });
    if (t.imageUrl) {
      if (node.url !== t.imageUrl) {
        node.url = t.imageUrl;
        node._imgTries = (node.url === node._lastTriedUrl ? (node._imgTries || 0) : 0);
        node._lastTriedUrl = t.imageUrl;
        node.portrait.texture = Texture.EMPTY; // reset while (re)loading
        loadTexture(t.imageUrl).then((tex) => {
          if (node.url !== t.imageUrl) return;
          if (!tex) {
            // Transient load failure — retry on a later reconcile (bounded), so a
            // momentary network/CORS blip doesn't strand the token on its letter.
            if ((node._imgTries || 0) < 4) { node._imgTries = (node._imgTries || 0) + 1; node.url = null; }
            return;
          }
          node.portrait.texture = tex;
          fitCover(node.portrait, tex, r * 2);
          node.initial.visible = false;
        });
      } else if (node.portrait.texture && node.portrait.texture !== Texture.EMPTY) {
        fitCover(node.portrait, node.portrait.texture, r * 2);
      }
    } else {
      node.portrait.texture = Texture.EMPTY;
      node.url = null;
    }
    // Procedural blood overlay — intensity from missing HP (DM-toggled). Pattern
    // is seeded per token (stable, but different per token), bucketed by damage.
    if (this._bloody && t.hp != null && t.hpMax > 0) {
      const intensity = 1 - Math.max(0, Math.min(1, t.hp / t.hpMax));
      if (intensity <= 0.02) { node.blood.visible = false; node.bloodKey = null; }
      else {
        const key = `${t.id}:${Math.round(intensity * 4)}`;
        if (node.bloodKey !== key) { node.bloodKey = key; node.blood.texture = bloodTexture(t.id, intensity); }
        node.blood.visible = true;
        node.blood.width = node.blood.height = r * 2;
      }
    } else { node.blood.visible = false; node.bloodKey = null; }

    const hasTex = node.portrait.texture && node.portrait.texture !== Texture.EMPTY;
    node.initial.visible = !hasTex;
    node.initial.text = (t.name || '?').slice(0, 1).toUpperCase();
    node.initial.style.fontSize = r * 0.9;

    // selection ring — kept just inside the cell so nothing spills over the grid
    node.sel.clear();
    // Combat turn markers: a bold gold ring for the token whose turn it is, a
    // dashed amber ring for whoever is up next (drawn just OUTSIDE the cell so
    // it reads clearly on top of the normal border).
    if (this._turnId === t.id) {
      node.sel.circle(0, 0, cell + 3).stroke({ width: 4, color: '#ffcc44', alpha: 0.95 });
    } else if (this._nextId === t.id) {
      for (let a = 0; a < Math.PI * 2; a += 0.5) node.sel.arc(0, 0, cell + 2, a, a + 0.28).stroke({ width: 3, color: '#e0af68', alpha: 0.85 });
    }
    if (selected) node.sel.circle(0, 0, cell - 2).stroke({ width: 3, color: '#6c8cff', alpha: 0.9 });
    // Faint ring while this token's context menu is hovered (menu ↔ token link).
    if (this._hoverId === t.id && !selected) node.sel.circle(0, 0, cell - 2).stroke({ width: 2, color: '#9db4ff', alpha: 0.7 });

    // AC badge — enemy (NPC) tokens, DM only. Top-left, shield-tinted.
    this.drawAc(node.ac, (dmView && t.kind === 'npc' && t.ac != null) ? t.ac : null, r);

    // HP bar — DM sees all; a player sees only their OWN token's bar.
    node.hp.clear();
    const showHp = this._dmView || (t.ownerId && t.ownerId === this._viewerId);
    if (showHp && t.hp != null && t.hpMax) {
      const w = r * 1.8, h = Math.max(4, r * 0.12);
      const x = -w / 2, y = r + 4;
      const frac = Math.max(0, Math.min(1, t.hp / t.hpMax));
      const col = frac > 0.5 ? '#4caf50' : frac > 0.25 ? '#ffb300' : '#e53935';
      node.hp.rect(x, y, w, h).fill({ color: 0x000000, alpha: 0.5 });
      node.hp.rect(x, y, w * frac, h).fill({ color: col, alpha: 0.95 });
      node.hp.rect(x, y, w, h).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
    }

    // condition badges around the top arc
    this.drawBadges(node.badges, t, r);

    // elevation badge — token standing on climb terrain (e.g. "+5ft")
    node.elev.removeChildren().forEach((c) => c.destroy({ children: true }));
    const ele = this._elev[t.id];
    if (ele) {
      const br = Math.max(7, r * 0.22);
      node.elev.position.set(r - br * 0.4, r - br * 0.4); // bottom-right
      const col = ele < 0 ? 0xff7043 : 0x4aa3ff;
      node.elev.addChild(new Graphics().roundRect(-br * 1.6, -br, br * 3.2, br * 2, br * 0.5).fill({ color: 0x10141c, alpha: 0.9 }).stroke({ width: 1, color: col, alpha: 0.9 }));
      const label = new Text({ text: `${ele > 0 ? '+' : ''}${ele}ft`, style: { fill: '#fff', fontSize: br * 1.1, fontWeight: '800' } });
      label.anchor.set(0.5);
      node.elev.addChild(label);
    }
  }

  // AC badge: a small shield-tinted pill at the token's top-left. `ac` null →
  // hidden. Only the DM sees it (the renderer gates kind/role before calling).
  drawAc(container, ac, r) {
    container.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (ac == null) { container.visible = false; return; }
    container.visible = true;
    const br = Math.max(7, r * 0.2);
    // Top-center, so it doesn't sit on the first condition badge (a corner).
    container.position.set(0, -r + br * 0.7);
    container.addChild(
      new Graphics().circle(0, 0, br).fill({ color: 0x1f2733, alpha: 0.92 }).stroke({ width: 1, color: 0x9ab3d6, alpha: 0.9 }),
    );
    const label = new Text({ text: String(ac), style: { fill: '#cfe0ff', fontSize: br * 0.95, fontWeight: '800' } });
    label.anchor.set(0.5);
    container.addChild(label);
  }

  drawBadges(badges, t, r) {
    badges.removeChildren().forEach((c) => c.destroy({ children: true }));
    const ids = t.conditions || [];
    const br = Math.max(8, r * 0.24); // badge radius
    // place in corners, then mid-edges if more than four are active
    const slots = [
      { x: -r * 0.7, y: -r * 0.7 }, { x: r * 0.7, y: -r * 0.7 },
      { x: r * 0.7, y: r * 0.7 }, { x: -r * 0.7, y: r * 0.7 },
      { x: 0, y: -r }, { x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 },
    ];
    ids.slice(0, slots.length).forEach((cid, i) => {
      const c = CONDITION_BY_ID[cid];
      const slot = slots[i];
      const b = new Container();
      b.position.set(slot.x, slot.y);
      const disc = new Graphics().circle(0, 0, br).fill({ color: c?.color || '#444' }).stroke({ width: 1.5, color: '#000', alpha: 0.6 });
      b.addChild(disc);
      // condition icon (SVG asset), tinted white so it reads on the colored disc
      if (c?.icon) {
        const icon = new Sprite();
        icon.anchor.set(0.5);
        loadSvgTinted(c.icon, '#ffffff').then((tex) => {
          if (!tex || icon.destroyed) return;
          icon.texture = tex;
          const s = (br * 1.5) / Math.max(tex.width, tex.height);
          icon.scale.set(s);
        });
        b.addChild(icon);
      }
      badges.addChild(b);
    });
  }
}

// Procedural blood/damage texture: deterministic per `seed` (so a token's
// splatter is stable, but every token differs), with more & darker blobs the
// higher the `intensity` (0..1 = missing HP). Cached per seed+damage-bucket.
const _bloodCache = new Map();
function strHash(str) { let h = 2166136261; const s = String(str); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function bloodTexture(seed, intensity) {
  const key = `${seed}:${Math.round(intensity * 4)}`;
  const cached = _bloodCache.get(key);
  if (cached) return cached;
  const size = 192;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  let st = strHash(key);
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const blobs = Math.round(5 + intensity * 22);
  for (let i = 0; i < blobs; i++) {
    const x = rnd() * size, y = rnd() * size;
    const rad = (2 + rnd() * 9) * (0.5 + intensity);
    const a = (0.18 + rnd() * 0.45) * intensity;
    const dark = rnd() < 0.45;
    ctx.fillStyle = `rgba(${dark ? 110 : 165}, ${dark ? 4 : 14}, ${dark ? 8 : 14}, ${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    if (rnd() < 0.35 * intensity) { // occasional drip
      ctx.fillRect(x - rad * 0.18, y, rad * 0.36, rad * (1 + rnd() * 3));
    }
  }
  const tex = Texture.from(c);
  _bloodCache.set(key, tex);
  return tex;
}

// Scale a sprite so its texture covers a diameter (cover, centered).
function fitCover(sprite, tex, diameter) {
  const tw = tex.width || 1, th = tex.height || 1;
  const scale = diameter / Math.min(tw, th);
  sprite.scale.set(scale);
}
