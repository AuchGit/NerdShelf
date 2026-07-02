// Regression tests for the pure VTT geometry. Several of these encode bugs we
// actually shipped (first step +5 ft, corner light leak) so they can never
// silently come back.
import { describe, it, expect } from 'vitest';
import {
  fiveEDistanceFt, rulerMoveFt, darkenColor, loopWallIds, planarFaces,
  seeThroughCentroids, sameSideOfSeg, terrainHeightAt, projectOnSeg, distPointToSeg,
  climbMapFor, climbStepFt,
} from '../wallGeometry';

const GRID = { size: 70, offsetX: 0, offsetY: 0 };
const cellCenterPx = (col, row) => ({ x: (col + 0.5) * 70, y: (row + 0.5) * 70 });

// Square room 0,0 → 200,200 (4 walls sharing corners).
const squareRoom = (id0 = 1) => [
  { id: `w${id0}`, a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
  { id: `w${id0 + 1}`, a: { x: 200, y: 0 }, b: { x: 200, y: 200 } },
  { id: `w${id0 + 2}`, a: { x: 200, y: 200 }, b: { x: 0, y: 200 } },
  { id: `w${id0 + 3}`, a: { x: 0, y: 200 }, b: { x: 0, y: 0 } },
];

describe('fiveEDistanceFt (5-10-5 Diagonalen)', () => {
  it('gerade Strecken kosten 5 ft pro Zelle', () => {
    expect(fiveEDistanceFt(0, 0, 3 * 70, 0, 70)).toBe(15);
    expect(fiveEDistanceFt(0, 0, 0, 5 * 70, 70)).toBe(25);
  });
  it('Diagonalen alternieren 5/10: 1→5, 2→15, 3→20, 4→30', () => {
    expect(fiveEDistanceFt(0, 0, 70, 70, 70)).toBe(5);
    expect(fiveEDistanceFt(0, 0, 140, 140, 70)).toBe(15);
    expect(fiveEDistanceFt(0, 0, 210, 210, 70)).toBe(20);
    expect(fiveEDistanceFt(0, 0, 280, 280, 70)).toBe(30);
  });
  it('gemischt: 2 diagonal + 1 gerade = 20 ft', () => {
    expect(fiveEDistanceFt(0, 0, 3 * 70, 2 * 70, 70)).toBe(20);
  });
  it('Null-Distanz = 0 ft', () => {
    expect(fiveEDistanceFt(35, 35, 35, 35, 70)).toBe(0);
  });
});

describe('rulerMoveFt (schwieriges Gelände)', () => {
  const mapWith = (cells) => ({
    grid: GRID,
    terrain: [{ kind: 'difficult', cells, level: 'L1' }],
  });
  it('null ohne schwieriges Gelände auf dem Level', () => {
    expect(rulerMoveFt({ from: cellCenterPx(0, 0), to: cellCenterPx(3, 0) }, { grid: GRID, terrain: [] }, 'L1', 'L1')).toBeNull();
  });
  it('zählt betretene Zellen — NICHT die Startzelle (Regression: erster Schritt +5 ft)', () => {
    const map = mapWith(['9,9']); // difficult weit weg → Kosten rein normal
    const oneStep = rulerMoveFt({ from: cellCenterPx(0, 0), to: cellCenterPx(1, 0) }, map, 'L1', 'L1');
    expect(oneStep).toBe(5); // exakt EIN betretenes Feld
  });
  it('verdoppelt schwierige Zellen', () => {
    const map = mapWith(['1,0', '2,0']);
    // 3 Felder betreten: 2 schwierig (10) + 1 normal (5) = 25
    expect(rulerMoveFt({ from: cellCenterPx(0, 0), to: cellCenterPx(3, 0) }, map, 'L1', 'L1')).toBe(25);
  });
  it('ignoriert schwieriges Gelände anderer Ebenen', () => {
    const map = { grid: GRID, terrain: [{ kind: 'difficult', cells: ['1,0'], level: 'L2' }] };
    expect(rulerMoveFt({ from: cellCenterPx(0, 0), to: cellCenterPx(2, 0) }, map, 'L1', 'L1')).toBeNull();
  });
});

describe('planarFaces (Raum-Erkennung für „Räume dunkel")', () => {
  it('Quadrat → genau 1 begrenzter Raum mit korrekter Fläche', () => {
    const rooms = planarFaces(squareRoom()).filter((f) => f.area2 > 1);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area2 / 2).toBe(200 * 200);
  });
  it('zwei angrenzende Räume mit geteilter Wand → 2 Räume', () => {
    const two = [
      ...squareRoom(),
      { id: 'w5', a: { x: 200, y: 0 }, b: { x: 400, y: 0 } },
      { id: 'w6', a: { x: 400, y: 0 }, b: { x: 400, y: 200 } },
      { id: 'w7', a: { x: 400, y: 200 }, b: { x: 200, y: 200 } },
    ];
    const rooms = planarFaces(two).filter((f) => f.area2 > 1);
    expect(rooms).toHaveLength(2);
  });
  it('offener Zaun (keine Schleife) → 0 Räume', () => {
    const fence = [
      { id: 'f1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { id: 'f2', a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
    ];
    expect(planarFaces(fence).filter((f) => f.area2 > 1)).toHaveLength(0);
  });
});

describe('loopWallIds (Brücken vs. Schleifen)', () => {
  it('alle 4 Wände eines Quadrats liegen auf der Schleife', () => {
    const walls = squareRoom();
    const loop = loopWallIds(walls);
    for (const w of walls) expect(loop.has(w.id)).toBe(true);
  });
  it('ein angehängter Zaun-Stummel ist KEINE Schleife', () => {
    const walls = [...squareRoom(), { id: 'stub', a: { x: 200, y: 200 }, b: { x: 300, y: 300 } }];
    const loop = loopWallIds(walls);
    expect(loop.has('stub')).toBe(false);
    expect(loop.has('w1')).toBe(true);
  });
});

describe('seeThroughCentroids / sameSideOfSeg', () => {
  it('Centroid eines see-through-Quadrats liegt in der Mitte', () => {
    const walls = squareRoom().map((w) => ({ ...w, seeThrough: true }));
    const c = seeThroughCentroids(walls).get('w1');
    expect(c.x).toBeCloseTo(100);
    expect(c.y).toBeCloseTo(100);
  });
  it('sameSideOfSeg unterscheidet die Seiten korrekt', () => {
    const a = { x: 0, y: 0 }; const b = { x: 100, y: 0 };
    expect(sameSideOfSeg({ x: 50, y: 10 }, { x: 20, y: 30 }, a, b)).toBe(true);
    expect(sameSideOfSeg({ x: 50, y: 10 }, { x: 20, y: -30 }, a, b)).toBe(false);
  });
});

describe('terrainHeightAt', () => {
  const map = { grid: GRID, terrain: [{ kind: 'climb', cells: ['2,3'], ft: 10, level: 'L1' }] };
  it('liefert die Höhe auf der Zelle, 0 daneben', () => {
    const on = cellCenterPx(2, 3);
    const off = cellCenterPx(4, 4);
    expect(terrainHeightAt(map, 'L1', on.x, on.y)).toBe(10);
    expect(terrainHeightAt(map, 'L1', off.x, off.y)).toBe(0);
  });
  it('andere Ebene → 0', () => {
    const on = cellCenterPx(2, 3);
    expect(terrainHeightAt(map, 'L2', on.x, on.y)).toBe(0);
  });
});

describe('Segment-Helfer', () => {
  it('projectOnSeg klemmt auf die Endpunkte', () => {
    const a = { x: 0, y: 0 }; const b = { x: 100, y: 0 };
    expect(projectOnSeg({ x: -50, y: 20 }, a, b)).toEqual({ x: 0, y: 0 });
    expect(projectOnSeg({ x: 50, y: 20 }, a, b)).toEqual({ x: 50, y: 0 });
  });
  it('distPointToSeg misst senkrecht bzw. zum nächsten Endpunkt', () => {
    const a = { x: 0, y: 0 }; const b = { x: 100, y: 0 };
    expect(distPointToSeg({ x: 50, y: 30 }, a, b)).toBe(30);
    expect(distPointToSeg({ x: 130, y: 40 }, a, b)).toBe(50); // 3-4-5 zum Endpunkt
  });
});

describe('Klettern (RAW: +1 ft pro gekletterten ft; markierte Kanten frei)', () => {
  const climbMap = (disabledEdges = []) => ({
    grid: GRID,
    terrain: [{ kind: 'climb', cells: ['1,0'], ft: 10, level: 'L1', disabledEdges }],
  });
  it('Kante auf ein 10-ft-Plateau kostet +20 ohne Klettergeschwindigkeit, +10 mit', () => {
    const cm = climbMapFor(climbMap(), 'L1', 'L1');
    expect(climbStepFt(0, 0, 1, 0, cm, 2)).toBe(20);
    expect(climbStepFt(0, 0, 1, 0, cm, 1)).toBe(10);
    expect(climbStepFt(1, 0, 0, 0, cm, 2)).toBe(20); // runter kostet genauso (RAW klettern)
  });
  it('markierte (offene) Kante klettert frei — von beiden Seiten', () => {
    const cm = climbMapFor(climbMap(['1,0:L']), 'L1', 'L1');
    expect(climbStepFt(0, 0, 1, 0, cm, 2)).toBe(0);
    expect(climbStepFt(1, 0, 0, 0, cm, 2)).toBe(0);
    // andere Kante bleibt teuer
    expect(climbStepFt(2, 0, 1, 0, cm, 2)).toBe(20);
  });
  it('auf dem Plateau selbst kostet Bewegung normal (kein blanket doubling)', () => {
    const wide = { grid: GRID, terrain: [{ kind: 'climb', cells: ['1,0', '2,0'], ft: 10, level: 'L1' }] };
    const cm = climbMapFor(wide, 'L1', 'L1');
    expect(climbStepFt(1, 0, 2, 0, cm, 2)).toBe(0);
  });
  it('rulerMoveFt rechnet die Kletterkante mit ein', () => {
    // Schritt (0,0)→(1,0) auf ein 10-ft-Plateau: 5 (Feld) + 20 (Klettern) = 25
    const ft = rulerMoveFt({ from: cellCenterPx(0, 0), to: cellCenterPx(1, 0) }, climbMap(), 'L1', 'L1');
    expect(ft).toBe(25);
    const mitClimbSpeed = rulerMoveFt({ from: cellCenterPx(0, 0), to: cellCenterPx(1, 0) }, climbMap(), 'L1', 'L1', { climbMul: 1 });
    expect(mitClimbSpeed).toBe(15);
  });
});

describe('darkenColor', () => {
  it('halbiert Kanäle korrekt', () => {
    expect(darkenColor('#ff8000', 0.5)).toBe((128 << 16) | (64 << 8) | 0);
  });
  it('ungültige Eingabe → neutrales Grau', () => {
    expect(darkenColor('#abc', 0.5)).toBe(0x888888);
  });
});
