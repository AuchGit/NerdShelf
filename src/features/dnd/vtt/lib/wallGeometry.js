// Pure wall/movement geometry — extracted from VttRenderer so it is unit-
// testable (no Pixi/DOM imports) and the renderer stays focused on rendering.
// Everything here is deterministic: plain data in, plain data out.
import { pointToCell } from './geometry';

// 5e alternating-diagonal distance (5-10-5-10 ft) between two map points,
// measured in whole grid cells.
export function fiveEDistanceFt(ax, ay, bx, by, gridSize) {
  const dc = Math.abs(Math.round((bx - ax) / gridSize));
  const dr = Math.abs(Math.round((by - ay) / gridSize));
  const diag = Math.min(dc, dr);
  const straight = Math.abs(dc - dr);
  return (straight + diag) * 5 + Math.floor(diag / 2) * 5;
}

// Climb-terrain lookup for a level: per-cell height (ft) + the OPEN edges
// (green "Kanten bearbeiten" passages — ladders/stairs where crossing is free).
export function climbMapFor(map, level, base) {
  const heights = new Map(); // 'col,row' -> ft
  const open = new Set();    // 'col,row:SIDE'
  for (const tr of (map.terrain || [])) {
    if (tr.kind !== 'climb' || !Array.isArray(tr.cells) || (tr.level || base) !== level) continue;
    for (const c of tr.cells) heights.set(c, Math.max(heights.get(c) || 0, tr.ft || 0));
    for (const e of (tr.disabledEdges || [])) open.add(e);
  }
  return { heights, open };
}

// Extra movement cost (ft) for crossing between two adjacent cells with
// different climb heights — the RAW climb rule: each foot climbed costs 1 extra
// foot (so ΔH ft of ledge = 2·ΔH without a climb speed, 1·ΔH with one). An edge
// the DM marked OPEN (ladder/stairs) crosses for free. 0 when level ground.
export function climbStepFt(aCol, aRow, bCol, bRow, cm, climbMul = 2) {
  const dH = Math.abs((cm.heights.get(`${aCol},${aRow}`) || 0) - (cm.heights.get(`${bCol},${bRow}`) || 0));
  if (!dH) return 0;
  const dc = bCol - aCol; const dr = bRow - aRow;
  if (Math.abs(dc) + Math.abs(dr) === 1) { // orthogonal → an open passage skips the climb
    const sideA = dc === 1 ? 'R' : dc === -1 ? 'L' : dr === 1 ? 'B' : 'T';
    const sideB = dc === 1 ? 'L' : dc === -1 ? 'R' : dr === 1 ? 'T' : 'B';
    if (cm.open.has(`${aCol},${aRow}:${sideA}`) || cm.open.has(`${bCol},${bRow}:${sideB}`)) return 0;
  }
  return dH * climbMul;
}

// Approximate movement cost (ft) along a ruler line: difficult cells double,
// climbing a ledge adds the RAW climb cost (see climbStepFt; opts.climbMul = 1
// with a climb speed). Counts cells ENTERED (start cell excluded — counting it
// over-reported the first step by 5 ft). Returns null when the path crosses
// neither difficult nor climb terrain (callers fall back to plain distance).
export function rulerMoveFt(ruler, map, level, base, opts = {}) {
  if (!ruler) return null;
  const climbMul = opts.climbMul ?? 2;
  const diff = new Set();
  for (const tr of (map.terrain || [])) {
    if (tr.kind !== 'difficult' || !Array.isArray(tr.cells) || (tr.level || base) !== level) continue;
    for (const c of tr.cells) diff.add(c);
  }
  const cm = climbMapFor(map, level, base);
  if (!diff.size && !cm.heights.size) return null;
  const { from, to } = ruler;
  const sz = map.grid.size || 70;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (sz * 0.25)));
  // Ordered path cells (a drag line is straight → consecutive dedupe = unique).
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * (i / steps);
    const y = from.y + (to.y - from.y) * (i / steps);
    const c = pointToCell(x, y, map.grid);
    const key = `${c.col},${c.row}`;
    if (path[path.length - 1] !== key) path.push(key);
  }
  let ft = 0;
  for (let i = 1; i < path.length; i++) {
    ft += diff.has(path[i]) ? 10 : 5;
    const [ac, ar] = path[i - 1].split(',').map(Number);
    const [bc, br] = path[i].split(',').map(Number);
    ft += climbStepFt(ac, ar, bc, br, cm, climbMul);
  }
  return ft;
}

// Multiply an #rrggbb colour's channels by `factor` (<1 darkens) → 0xRRGGBB.
export function darkenColor(hex, factor) {
  const s = String(hex).replace('#', '');
  if (s.length < 6) return 0x888888;
  const r = Math.round(parseInt(s.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(s.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(s.slice(4, 6), 16) * factor);
  return (r << 16) | (g << 8) | b;
}

// Walls that are part of a closed loop = NON-bridge edges of the wall graph
// (vertices keyed by rounded coords). Such walls enclose an area (a "roofed"
// room); bridge walls (fences/open polylines) don't. Tarjan bridge finding.
export function loopWallIds(walls) {
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const adj = new Map();
  for (const w of walls) {
    const ka = key(w.a); const kb = key(w.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ to: kb, id: w.id });
    adj.get(kb).push({ to: ka, id: w.id });
  }
  const disc = new Map(); const low = new Map(); const bridges = new Set();
  let t = 0;
  const stack = [];
  for (const start of adj.keys()) {
    if (disc.has(start)) continue;
    stack.push({ u: start, peid: null, i: 0 });
    while (stack.length) {
      const fr = stack[stack.length - 1];
      if (fr.i === 0) { disc.set(fr.u, t); low.set(fr.u, t); t++; }
      const edges = adj.get(fr.u) || [];
      if (fr.i < edges.length) {
        const e = edges[fr.i]; fr.i++;
        if (e.id === fr.peid) continue;
        if (!disc.has(e.to)) { fr.child = e.to; fr.cid = e.id; stack.push({ u: e.to, peid: e.id, i: 0 }); }
        else { low.set(fr.u, Math.min(low.get(fr.u), disc.get(e.to))); }
      } else {
        stack.pop();
        if (stack.length) {
          const par = stack[stack.length - 1];
          low.set(par.u, Math.min(low.get(par.u), low.get(fr.u)));
          if (low.get(fr.u) > disc.get(par.u)) bridges.add(fr.peid);
        }
      }
    }
  }
  const loop = new Set();
  for (const w of walls) if (!bridges.has(w.id)) loop.add(w.id);
  return loop;
}

// Planar face traversal over the wall graph: returns every bounded face as
// { pts:[{x,y}…], area2, face:[halfEdge…] }. Half-edges are traversed with the
// face kept to the RIGHT (next = the edge just clockwise of the reverse), so
// bounded interior rooms come out clockwise on-screen (shoelace area2 > 0) and
// the unbounded outer face(s) come out CCW (area2 < 0) — callers keep area2 > 0.
export function planarFaces(walls) {
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const verts = new Map();
  const adj = new Map();
  const addV = (p) => { const k = key(p); if (!verts.has(k)) verts.set(k, { x: p.x, y: p.y }); return k; };
  const halfEdges = [];
  for (const w of walls) {
    const ka = addV(w.a); const kb = addV(w.b);
    if (ka === kb) continue;
    const va = verts.get(ka); const vb = verts.get(kb);
    const h1 = { from: ka, to: kb, ang: Math.atan2(vb.y - va.y, vb.x - va.x), wall: w, used: false };
    const h2 = { from: kb, to: ka, ang: Math.atan2(va.y - vb.y, va.x - vb.x), wall: w, used: false };
    h1.twin = h2; h2.twin = h1;
    halfEdges.push(h1, h2);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(h1);
    adj.get(kb).push(h2);
  }
  for (const arr of adj.values()) arr.sort((p, q) => p.ang - q.ang);
  const faces = [];
  for (const start of halfEdges) {
    if (start.used) continue;
    const face = [];
    let cur = start;
    let guard = 0;
    do {
      cur.used = true;
      face.push(cur);
      const out = adj.get(cur.to);
      const idx = out.indexOf(cur.twin);          // reverse edge at the arrival vertex
      cur = out[(idx - 1 + out.length) % out.length]; // one step clockwise
      if (++guard > 100000) break;
    } while (cur !== start && !cur.used);
    if (face.length < 3) continue;
    const pts = face.map((he) => verts.get(he.from));
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    faces.push({ pts, area2, face });
  }
  return faces;
}

// For each `seeThrough` wall, the centroid of its connected component (walls
// linked by shared endpoints). Used for one-sided occlusion: a see-through wall
// only blocks observers on the same side as this centroid (the loop interior),
// so from outside you look past the near wall into the loop.
export function seeThroughCentroids(walls) {
  const st = walls.filter((w) => w.seeThrough);
  if (!st.length) return new Map();
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  // union-find over wall ids via shared vertices
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (const w of st) parent.set(w.id, w.id);
  const byVert = new Map();
  for (const w of st) for (const k of [key(w.a), key(w.b)]) {
    if (byVert.has(k)) union(byVert.get(k), w.id); else byVert.set(k, w.id);
  }
  // accumulate centroid per component
  const acc = new Map(); // root -> {sx,sy,n}
  for (const w of st) {
    const r = find(w.id);
    const a = acc.get(r) || { sx: 0, sy: 0, n: 0 };
    a.sx += w.a.x + w.b.x; a.sy += w.a.y + w.b.y; a.n += 2;
    acc.set(r, a);
  }
  const out = new Map();
  for (const w of st) {
    const a = acc.get(find(w.id));
    out.set(w.id, { x: a.sx / a.n, y: a.sy / a.n });
  }
  return out;
}

// Are points p and q on the same side of the line through segment a→b?
export function sameSideOfSeg(p, q, a, b) {
  const cross = (pt) => (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
  return cross(p) * cross(q) > 0;
}

// Climb-terrain height (ft) at a map point on a level (0 if none).
export function terrainHeightAt(map, level, x, y) {
  const cell = pointToCell(x, y, map.grid);
  const k = `${cell.col},${cell.row}`;
  let h = 0;
  for (const tr of (map.terrain || [])) {
    if (tr.kind !== 'climb' || !Array.isArray(tr.cells)) continue;
    if ((tr.level || level) !== level) continue;
    if (tr.cells.includes(k)) h = Math.max(h, tr.ft || 0);
  }
  return h;
}

// Closest point on segment a→b to p.
export function projectOnSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return { x: a.x + t * vx, y: a.y + t * vy };
}

// Shortest distance from a point to a line segment a→b (px).
export function distPointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const cx = a.x + t * vx, cy = a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}

// Signed distance of (dx,dy) along the perpendicular of a direction (deg).
export function perpDistance(dx, dy, dirDeg) {
  const d = ((dirDeg || 0) * Math.PI) / 180;
  return dx * -Math.sin(d) + dy * Math.cos(d);
}

// Begrenzte Durchsicht: sieht ein Beobachter DURCH eine Wand (Durchguck-Nähe
// erfüllt), aber nur `distPx` weit dahinter, ersetzt diese virtuelle Wand das
// Original — parallel um distPx auf die vom Beobachter ABGEWANDTE Seite
// verschoben und an beiden Enden um distPx verlängert (gegen Eck-Leaks).
export function offsetSightWall(w, o, distPx) {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let nx = -uy, ny = ux;
  const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2;
  if ((o.x - mx) * nx + (o.y - my) * ny > 0) { nx = -nx; ny = -ny; } // weg vom Beobachter
  return {
    ...w,
    id: w.id + '~far',
    a: { x: w.a.x + nx * distPx - ux * distPx, y: w.a.y + ny * distPx - uy * distPx },
    b: { x: w.b.x + nx * distPx + ux * distPx, y: w.b.y + ny * distPx + uy * distPx },
  };
}
