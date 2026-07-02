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
import { CONDITION_BY_ID, playerColor } from '../../lib/constants';
import { loadTexture, loadSvgTinted } from '../textures';

export class TokenLayer {
  constructor() {
    this.container = new Container();
    // Badges/HP/AC live in a SEPARATE overlay the renderer puts ABOVE walls (and
    // masks to vision for players) so they're never hidden behind a wall icon or
    // another token. Each token has a `badgeRoot` here, glued to the token.
    this.overlay = new Container();
    this.overlay.eventMode = 'none';
    this.nodes = new Map(); // tokenId -> { root, ring, portrait, mask, hp, badges, sel, initial, ac }
    this.onTokenPointerDown = null;  // (tokenId, event) => void
    this.onTokenRightClick = null;   // (tokenId, event) => void
    this.onTokenDoubleClick = null;  // (tokenId, event) => void
  }

  update(tokens, grid, selectedIds, draggingId, hiddenTokens, dmView = false, viewerId = null, bloody = false, elevations = null, turn = null, badgeScale = 1, bloodHp = null, acScale = 1) {
    this._dmView = dmView; this._viewerId = viewerId; this._bloody = bloody; this._elev = elevations || {}; this._bloodHp = bloodHp || null; this._acScale = acScale;
    this._turnId = turn?.activeId || null; this._nextId = turn?.nextId || null; this._hoverId = turn?.hoverId || null;
    this._markerScope = turn?.scope || 'all'; this._markerView = turn?.view || 'all'; this._markerStyle = turn?.style || 'ring';
    this._badgeScale = Math.max(0.5, Math.min(2, badgeScale || 1));
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
      // Otherwise we set the TARGET and ease toward it each frame (tickTokens)
      // so remote moves (20 Hz over the network) look smooth instead of steppy.
      // Snap immediately on first appearance or a big jump (teleport/level change).
      if (draggingId !== t.id) {
        const far = node._tx == null || Math.hypot(t.x - node._tx, t.y - node._ty) > grid.size * 3;
        node._tx = t.x; node._ty = t.y;
        if (far) node.root.position.set(t.x, t.y);
      }
    }
    // remove stale
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.root.destroy({ children: true }); node.badgeRoot.destroy({ children: true }); this.nodes.delete(id); }
    }
  }

  // Ease every token toward its target position (call each frame from the
  // ticker). Smooths remote/networked moves. `skipId` = the token the renderer
  // is driving directly (local drag / WASD tween) — left untouched.
  tickTokens(skipId) {
    for (const [id, node] of this.nodes) {
      const p = node.root.position;
      if (id !== skipId && node._tx != null) {
        const dx = node._tx - p.x, dy = node._ty - p.y;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) { if (dx || dy) p.set(node._tx, node._ty); }
        else p.set(p.x + dx * 0.3, p.y + dy * 0.3);
      }
      // Glue each token's badge overlay to its body every frame (covers the
      // WASD tween / drag / ease alike).
      node.badgeRoot.position.copyFrom(p);
      node.badgeRoot.visible = node.root.visible;
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
    // A mask belongs to exactly ONE display object in Pixi — sharing `mask`
    // between portrait AND blood made the portrait lag/flicker while moving a
    // bloodied token. Give the blood overlay its own mask.
    const bloodMask = new Graphics();
    blood.mask = bloodMask;
    blood.visible = false;
    const initial = new Text({ text: '', style: { fill: '#fff', fontSize: 24, fontWeight: '700' } });
    initial.anchor.set(0.5);
    const hp = new Graphics();
    const badges = new Container();
    const sel = new Graphics();
    const ac = new Container(); // AC badge (DM-only, enemy tokens)
    const elev = new Container(); // elevation badge (token on climb terrain)
    const lightBadge = new Container(); // candle/torch/lantern glyph when emitting light

    // Token BODY stays in `root` (this.container). Badges go in `badgeRoot`,
    // which the renderer keeps in the always-on-top overlay.
    root.addChild(sel, disc, portrait, blood, mask, bloodMask, initial, ring);
    const badgeRoot = new Container();
    badgeRoot.eventMode = 'none';
    badgeRoot.addChild(hp, badges, ac, elev, lightBadge);
    this.overlay.addChild(badgeRoot);
    let lastTap = 0;
    root.on('pointerdown', (e) => {
      if (e.button === 2) { this.onTokenRightClick?.(t.id, e); return; }
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastTap < 300) { lastTap = 0; this.onTokenDoubleClick?.(t.id, e); return; }
      lastTap = now;
      this.onTokenPointerDown?.(t.id, e);
    });

    this.container.addChild(root);
    const node = { root, badgeRoot, disc, ring, portrait, blood, mask, bloodMask, initial, hp, badges, sel, ac, elev, lightBadge, url: null, bloodKey: null };
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

    // Ring & disc colour by OWNERSHIP: a PLAYER token uses its owner's player
    // colour; an NPC controlled by player(s) uses the controller colour(s) —
    // multiple → a multi-segment ring (equal arcs, one per player). Otherwise the
    // token's own colour (hostile red, etc.).
    node.ring.clear();
    const owners = t.kind === 'npc' ? (t.controllers || []).filter((c) => c && c !== 'all') : [];
    const ownerColor = (t.kind === 'player' && t.ownerId) ? playerColor(t.ownerId)
      : owners.length === 1 ? playerColor(owners[0]) : null;
    if (owners.length >= 2) {
      const step = (Math.PI * 2) / owners.length;
      for (let i = 0; i < owners.length; i++) {
        const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
        node.ring.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1).stroke({ width: ringW, color: playerColor(owners[i]) });
      }
    } else {
      node.ring.circle(0, 0, r).stroke({ width: ringW, color: ownerColor || t.color || '#888' });
    }
    node.mask.clear().circle(0, 0, r).fill(0xffffff);
    node.bloodMask.clear().circle(0, 0, r).fill(0xffffff);

    // Colored disc is ALWAYS the base; a portrait covers it once loaded. So a
    // failed image (e.g. a 5etools token URL that 404s / CORS-blocks) falls
    // back to disc + initial instead of a blank token.
    node.disc.clear().circle(0, 0, r).fill({ color: ownerColor || t.color || '#556', alpha: 0.95 });
    if (t.imageUrl) {
      if (node.url !== t.imageUrl) {
        node.url = t.imageUrl;
        node._imgTries = (node.url === node._lastTriedUrl ? (node._imgTries || 0) : 0);
        node._lastTriedUrl = t.imageUrl;
        // Keep the last good portrait visible WHILE the (possibly slow, e.g. over
        // VPN) image (re)loads — only blank if we have nothing yet — so tokens
        // don't flash to their letter and "disappear" on a laggy connection.
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
    // Blood intensity from missing HP. For character-bound tokens the live HP
    // lives in the character sheet (not token.hp), so the renderer passes a
    // bloodHp override per token — use it when present.
    const bh = this._bloodHp && this._bloodHp[t.id];
    const bHp = bh ? bh.hp : t.hp;
    const bHpMax = bh ? bh.hpMax : t.hpMax;
    // Per-token override of the map's blood toggle: 'on'/'off' force it, else
    // it follows the map default (this._bloody).
    const effBloody = t.bloodied === 'on' ? true : t.bloodied === 'off' ? false : this._bloody;
    if (effBloody && bHp != null && bHpMax > 0) {
      const intensity = 1 - Math.max(0, Math.min(1, bHp / bHpMax));
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
    // Combat turn markers (now / next), DM-configurable: scope = which tokens
    // get them (all / players only), view = who sees them (all / DM only), style
    // = ring | glow | chevron. now = gold, next = amber.
    const markerAllowed = !(this._markerView === 'dm' && !this._dmView)
      && !(this._markerScope === 'players' && t.kind !== 'player');
    const drawMarker = (color, isNext) => {
      const st = this._markerStyle || 'ring';
      if (st === 'glow') {
        // Soft filled halo (clearly different from the thin ring).
        node.sel.circle(0, 0, cell + 9).fill({ color, alpha: 0.12 });
        node.sel.circle(0, 0, cell + 5).fill({ color, alpha: 0.18 });
        node.sel.circle(0, 0, cell + 1).fill({ color, alpha: 0.22 });
      } else if (st === 'chevron') {
        const cy = -cell - 7;
        node.sel.poly([-9, cy - 9, 9, cy - 9, 0, cy]).fill({ color, alpha: 0.95 });
        node.sel.circle(0, 0, cell + 2).stroke({ width: 2, color, alpha: 0.45 });
      } else if (isNext) {
        for (let a = 0; a < Math.PI * 2; a += 0.5) node.sel.arc(0, 0, cell + 2, a, a + 0.28).stroke({ width: 3, color, alpha: 0.85 });
      } else {
        node.sel.circle(0, 0, cell + 3).stroke({ width: 4, color, alpha: 0.95 });
      }
    };
    if (markerAllowed && this._turnId === t.id) drawMarker('#ffcc44', false);
    else if (markerAllowed && this._nextId === t.id) drawMarker('#e0af68', true);
    // Selection ring OUTSIDE the token — node.sel is the bottom layer, so a ring
    // inside the cell would hide behind the portrait. A dark halo under a bright
    // accent ring keeps it readable on any background.
    if (selected) {
      node.sel.circle(0, 0, cell + 4).stroke({ width: 6, color: 0x000000, alpha: 0.35 });
      node.sel.circle(0, 0, cell + 4).stroke({ width: 3, color: '#6c8cff', alpha: 0.95 });
    }
    // Faint ring while this token's context menu is hovered (menu ↔ token link).
    if (this._hoverId === t.id && !selected) node.sel.circle(0, 0, cell + 4).stroke({ width: 2, color: '#9db4ff', alpha: 0.75 });

    const sc = this._badgeScale || 1;
    // Badge SIZE is based on the cell, not the token radius, so a badge is the
    // same size on a 1-cell goblin and a 4-cell dragon. Positions still hug each
    // token's edge (r-based). `bb` = half a cell.
    const bb = (grid.size || 70) / 2;
    // AC badge — enemy (NPC) tokens, DM only. Has its own personal size scale.
    this.drawAc(node.ac, (dmView && t.kind === 'npc' && t.ac != null) ? t.ac : null, r, sc * (this._acScale ?? 1), bb);

    // HP bar — DM sees all; a player sees only their OWN token's bar.
    node.hp.clear();
    const showHp = this._dmView || (t.ownerId && t.ownerId === this._viewerId);
    if (showHp && t.hp != null && t.hpMax) {
      const w = r * 1.8, h = Math.max(4, bb * 0.12 * sc);
      const x = -w / 2, y = r + 4;
      const frac = Math.max(0, Math.min(1, t.hp / t.hpMax));
      const col = frac > 0.5 ? '#4caf50' : frac > 0.25 ? '#ffb300' : '#e53935';
      node.hp.rect(x, y, w, h).fill({ color: 0x000000, alpha: 0.5 });
      node.hp.rect(x, y, w * frac, h).fill({ color: col, alpha: 0.95 });
      node.hp.rect(x, y, w, h).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
    }

    // condition badges around the top arc
    this.drawBadges(node.badges, t, r, sc, bb);

    // elevation badge — token standing on climb terrain (e.g. "+5ft")
    node.elev.removeChildren().forEach((c) => c.destroy({ children: true }));
    const ele = this._elev[t.id];
    if (ele) {
      const br = Math.max(4, bb * 0.2 * sc);
      node.elev.position.set(r - br * 0.4, r - br * 0.4); // bottom-right
      const col = ele < 0 ? 0xff7043 : 0x4aa3ff;
      node.elev.addChild(new Graphics().roundRect(-br * 1.6, -br, br * 3.2, br * 2, br * 0.5).fill({ color: 0x10141c, alpha: 0.9 }).stroke({ width: 1, color: col, alpha: 0.9 }));
      node.elev.addChild(crispLabel(`${ele > 0 ? '+' : ''}${ele}ft`, br * 1.1, { fill: '#fff' }));
    }

    // light badge — a candle/torch/lantern glyph above the token when it emits
    // that light (set via the token context menu). `icon` rides on t.light.
    node.lightBadge.removeChildren().forEach((c) => c.destroy({ children: true }));
    const lightIcon = t.light?.icon;
    if (lightIcon) {
      const br = Math.max(7, bb * 0.22 * sc);
      node.lightBadge.position.set(0, -r - br * 0.8);
      node.lightBadge.addChild(new Graphics().circle(0, 0, br).fill({ color: 0x10141c, alpha: 0.85 }).stroke({ width: 1, color: 0xffd9a0, alpha: 0.9 }));
      const sp = new Sprite();
      sp.anchor.set(0.5);
      loadSvgTinted(lightIcon, '#ffe0a0').then((tex) => { if (tex && !sp.destroyed) { sp.texture = tex; sp.width = sp.height = br * 1.4; } });
      node.lightBadge.addChild(sp);
    }
  }

  // AC badge (DM-only, enemy tokens): a shield-tinted pill at the LEFT end of
  // the HP bar, just under the token. `ac` null → hidden.
  drawAc(container, ac, r, sc = 1, bb = r) {
    container.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (ac == null) { container.visible = false; return; }
    container.visible = true;
    // SIZE from the cell base (bb) so it's identical on every token size; the
    // position still hugs this token's edge.
    const br = Math.max(3, bb * 0.2 * sc);
    // Left of the HP bar (bar: x from -0.9r, y = r+4), vertically on the bar.
    container.position.set(-r * 0.9 - br, r + 4 + Math.max(2, r * 0.06 * sc));
    container.addChild(
      new Graphics().circle(0, 0, br).fill({ color: 0x1f2733, alpha: 0.92 }).stroke({ width: 1, color: 0x9ab3d6, alpha: 0.9 }),
    );
    // Rendered at a large base font then scaled down → stays crisp when the
    // viewport is zoomed in (a tiny native fontSize would pixelate).
    container.addChild(crispLabel(String(ac), br * 1.05, { fill: '#cfe0ff' }));
  }

  drawBadges(badges, t, r, sc = 1, bb = r) {
    badges.removeChildren().forEach((c) => c.destroy({ children: true }));
    const ids = t.conditions || [];
    const br = Math.max(4, bb * 0.22 * sc); // constant size (cell base); slots are token-relative
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

// Crisp on-token label: Pixi rasterises Text at its `fontSize`, so a tiny
// native font (3-6px) pixelates badly once the viewport is zoomed in. Render at
// a fixed large base font and scale the node down instead → the glyph texture
// stays high-res. `px` is the desired on-screen height.
function crispLabel(text, px, { fill = '#fff', fontWeight = '800' } = {}) {
  const BASE = 64;
  const t = new Text({ text, style: { fill, fontWeight, fontSize: BASE, stroke: { color: '#0b1020', width: 5 } } });
  t.anchor.set(0.5);
  t.scale.set(Math.max(0.01, px / BASE));
  return t;
}

// Procedural blood/damage texture: deterministic per `seed` (so a token's
// splatter is stable, but every token differs), with more & darker blobs the
// higher the `intensity` (0..1 = missing HP). Cached per seed+damage-bucket.
const _bloodCache = new Map();
function strHash(str) { let h = 2166136261; const s = String(str); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function bloodTexture(seed, intensity) {
  const key = `${seed}:${Math.round(intensity * 4)}`;
  const cached = _bloodCache.get(key);
  if (cached) { _bloodCache.delete(key); _bloodCache.set(key, cached); return cached; } // LRU touch
  // Cap the cache (tokens × damage buckets grows in long fights). Eviction only
  // drops our reference — a displayed blood sprite keeps its texture alive.
  if (_bloodCache.size >= 200) _bloodCache.delete(_bloodCache.keys().next().value);
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
  // Slight overscan (×1.1) so tokens with built-in transparent padding (many
  // homebrew/3pp token PNGs) still fill the disc instead of floating small in it.
  const scale = (diameter * 1.1) / Math.min(tw, th);
  sprite.scale.set(scale);
}
