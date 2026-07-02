// Tests for the shadow caster + wall nudge. Encodes the two leak bugs we fixed:
// corner-gap leaks (wall extension) and sources sitting exactly ON a wall.
import { describe, it, expect } from 'vitest';
import { visibilityPolygon, pointInPolygon, pointInAnyPolygon, segmentsIntersect, nudgeOffWalls } from '../visibility';

const BOUNDS = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
const seesPoint = (poly, x, y) => pointInPolygon(x, y, poly);

describe('visibilityPolygon', () => {
  it('ohne Wände: sieht die ganze Map (Polygon ≈ Bounds)', () => {
    const poly = visibilityPolygon({ x: 500, y: 500 }, [], BOUNDS);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    expect(seesPoint(poly, 10, 10)).toBe(true);
    expect(seesPoint(poly, 990, 990)).toBe(true);
  });

  it('eine Wand wirft Schatten dahinter', () => {
    const walls = [{ a: { x: 400, y: 300 }, b: { x: 600, y: 300 } }];
    const poly = visibilityPolygon({ x: 500, y: 500 }, walls, BOUNDS);
    expect(seesPoint(poly, 500, 400)).toBe(true);   // vor der Wand
    expect(seesPoint(poly, 500, 200)).toBe(false);  // dahinter (Schatten)
    expect(seesPoint(poly, 100, 200)).toBe(true);   // seitlich vorbei
  });

  it('geschlossener Raum: von innen sieht man NICHT nach draußen', () => {
    const room = [
      { a: { x: 400, y: 400 }, b: { x: 600, y: 400 } },
      { a: { x: 600, y: 400 }, b: { x: 600, y: 600 } },
      { a: { x: 600, y: 600 }, b: { x: 400, y: 600 } },
      { a: { x: 400, y: 600 }, b: { x: 400, y: 400 } },
    ];
    const poly = visibilityPolygon({ x: 500, y: 500 }, room, BOUNDS);
    expect(seesPoint(poly, 500, 550)).toBe(true);   // im Raum
    expect(seesPoint(poly, 500, 700)).toBe(false);  // draußen
    expect(seesPoint(poly, 300, 500)).toBe(false);
    expect(seesPoint(poly, 500, 300)).toBe(false);
    expect(seesPoint(poly, 700, 700)).toBe(false);
  });

  it('Wandecken lecken nicht (Regression: ±EPS-Eckstrahlen)', () => {
    // L-Ecke; Beobachter schräg innen nahe der Ecke — früher schlüpften
    // Strahlen durch den haarfeinen Spalt am gemeinsamen Endpunkt.
    const corner = [
      { a: { x: 300, y: 500 }, b: { x: 500, y: 500 } },
      { a: { x: 500, y: 500 }, b: { x: 500, y: 300 } },
    ];
    const poly = visibilityPolygon({ x: 480, y: 520 }, corner, BOUNDS);
    // Punkt diagonal hinter der Ecke darf nicht sichtbar sein.
    expect(seesPoint(poly, 520, 480)).toBe(false);
  });
});

describe('nudgeOffWalls', () => {
  const wall = [{ a: { x: 0, y: 100 }, b: { x: 200, y: 100 } }];
  it('Punkt fern der Wand bleibt unverändert', () => {
    expect(nudgeOffWalls(100, 300, wall)).toEqual({ x: 100, y: 300 });
  });
  it('Punkt AUF der Wand wird zur Seite geschoben (nicht mehr auf dem Segment)', () => {
    const p = nudgeOffWalls(100, 100, wall);
    expect(Math.abs(p.y - 100)).toBeGreaterThan(5);
    expect(p.x).toBe(100);
  });
  it('Punkt knapp unterhalb wird nach unten (auf seine Seite) gedrückt', () => {
    const p = nudgeOffWalls(100, 103, wall);
    expect(p.y).toBeGreaterThan(105);
  });
});

describe('pointInPolygon / segmentsIntersect', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('innen true, außen false', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInAnyPolygon(5, 5, [square])).toBe(true);
  });
  it('kreuzende Segmente schneiden sich, parallele nicht', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
  });
});
