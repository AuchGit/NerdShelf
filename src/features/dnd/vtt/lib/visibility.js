// Line-of-sight visibility polygon (classic angular sweep / ray casting).
//
// Given an observer point, a set of light-blocking wall segments, and the map
// bounds, returns the polygon of everything the observer can see. Used to drive
// dynamic fog of war: the visible polygon is the "hole" cut in the dark overlay.
//
// Algorithm: cast 3 rays toward each segment endpoint (the endpoint angle and
// ±epsilon, so rays slip just past corners), find the nearest wall hit along
// each ray, then sort hits by angle and connect them. O(rays · segments) — fine
// for the handful of walls a hand-drawn map has.

const EPS = 0.0001;

/**
 * @param {{x,y}} origin
 * @param {{a:{x,y}, b:{x,y}}[]} walls  light-blocking segments (map-space)
 * @param {{minX,minY,maxX,maxY}} bounds
 * @returns {{x,y}[]} visibility polygon in map space
 */
export function visibilityPolygon(origin, walls, bounds) {
  // Bounds become four segments so the polygon is always closed by the map edge.
  // Each wall is EXTENDED ~1.5px at both ends so the ±EPS corner rays can't slip
  // through the hairline gap where two walls meet — that gap is what let light
  // (and sight) leak through a wall a token/light sits on.
  const EXT = 1.5;
  const segs = [
    ...walls.map((w) => {
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y; const len = Math.hypot(dx, dy) || 1;
      const ex = (dx / len) * EXT, ey = (dy / len) * EXT;
      return { ax: w.a.x - ex, ay: w.a.y - ey, bx: w.b.x + ex, by: w.b.y + ey };
    }),
    seg(bounds.minX, bounds.minY, bounds.maxX, bounds.minY),
    seg(bounds.maxX, bounds.minY, bounds.maxX, bounds.maxY),
    seg(bounds.maxX, bounds.maxY, bounds.minX, bounds.maxY),
    seg(bounds.minX, bounds.maxY, bounds.minX, bounds.minY),
  ];

  // unique endpoint angles
  const angles = [];
  for (const s of segs) {
    for (const [px, py] of [[s.ax, s.ay], [s.bx, s.by]]) {
      const a = Math.atan2(py - origin.y, px - origin.x);
      angles.push(a - EPS, a, a + EPS);
    }
  }

  const points = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let closest = null, closestT = Infinity;
    for (const s of segs) {
      const hit = raySegment(origin.x, origin.y, dx, dy, s);
      if (hit && hit.t < closestT) { closestT = hit.t; closest = hit; }
    }
    if (closest) points.push({ x: closest.x, y: closest.y, a });
  }

  points.sort((p, q) => p.a - q.a);
  return points.map((p) => ({ x: p.x, y: p.y }));
}

function seg(ax, ay, bx, by) { return { ax, ay, bx, by }; }

// Ray (origin + t·dir, t≥0) vs segment. Returns {x,y,t} of the hit or null.
function raySegment(ox, oy, dx, dy, s) {
  const sdx = s.bx - s.ax, sdy = s.by - s.ay;
  const denom = dx * sdy - dy * sdx;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const t2 = ((s.ax - ox) * dy - (s.ay - oy) * dx) / denom; // along segment [0,1]
  const t1 = (sdx * (oy - s.ay) - sdy * (ox - s.ax)) / denom; // along ray (≥0)
  if (t1 < 0 || t2 < 0 || t2 > 1) return null;
  return { x: ox + dx * t1, y: oy + dy * t1, t: t1 };
}

// Move a sample point a few px off any wall it sits on (a wall sconce placed ON
// the wall), toward the side it's already on, so the shadow caster blocks that
// wall instead of leaking light/sight through it. No-op away from walls.
export function nudgeOffWalls(x, y, walls) {
  const NUDGE = 9;
  let nx = x; let ny = y;
  for (const w of walls) {
    const ax = w.a.x; const ay = w.a.y; const bx = w.b.x; const by = w.b.y;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((nx - ax) * dx + (ny - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cxp = ax + t * dx; const cyp = ay + t * dy;
    const dist = Math.hypot(nx - cxp, ny - cyp);
    if (dist < NUDGE) {
      const px = -dy; const py = dx; const plen = Math.hypot(px, py) || 1;
      const ux = px / plen; const uy = py / plen;
      const side = (nx - cxp) * ux + (ny - cyp) * uy; // signed dist along the normal
      const sgn = side >= 0 ? 1 : -1;
      nx += ux * sgn * (NUDGE - dist + 0.5);
      ny += uy * sgn * (NUDGE - dist + 0.5);
    }
  }
  return { x: nx, y: ny };
}

// Is a point inside a polygon (ray-cast even-odd)?
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInAnyPolygon = (x, y, polys) => polys.some((p) => pointInPolygon(x, y, p));

// Do segments p1p2 and p3p4 intersect? Used for movement collision.
export function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
