// Grid & coordinate math. Pure functions, renderer-agnostic.
//
// Coordinate spaces:
//   - MAP space: pixels in the map image's own coordinate system. Everything
//     persisted (token x/y, zone origin, fog polygons) lives here. Independent
//     of zoom/pan, so every client agrees regardless of their viewport.
//   - SCREEN space: pixels on the canvas. = MAP * scale + pan. The renderer's
//     viewport owns this transform; domain code never stores screen coords.

import { FEET_PER_CELL } from './constants';

/** ft → map-space pixels, given grid cell size in px. */
export function feetToPx(feet, gridSize) {
  return (feet / FEET_PER_CELL) * gridSize;
}

/** map-space pixels → ft. */
export function pxToFeet(px, gridSize) {
  return (px / gridSize) * FEET_PER_CELL;
}

// Zellgröße pro Achse: beim "auf volle Felder snappen" sind die Zellen minimal
// rechteckig (sizeX/sizeY), damit ein GANZZAHLIGES Feldraster die Karte EXAKT
// füllt (keine halben Felder am Rand). Ohne Snap = quadratisch (grid.size).
export const cellX = (grid) => grid.sizeX || grid.size;
export const cellY = (grid) => grid.sizeY || grid.size;

/** Cell (col,row) a map-space point falls in, honoring grid offset. */
export function pointToCell(x, y, grid) {
  return {
    col: Math.floor((x - grid.offsetX) / cellX(grid)),
    row: Math.floor((y - grid.offsetY) / cellY(grid)),
  };
}

/** Map-space center of a cell. */
export function cellCenter(col, row, grid) {
  return {
    x: grid.offsetX + (col + 0.5) * cellX(grid),
    y: grid.offsetY + (row + 0.5) * cellY(grid),
  };
}

/**
 * Snap a map-space point so a token of `sizeCells` (1 = Medium, 2 = Large…)
 * sits centered on whole cells. For even sizes the center lands on a grid
 * line; for odd sizes on a cell center — matching how minis occupy squares.
 */
export function snapToGrid(x, y, grid, sizeCells = 1) {
  const sx = cellX(grid); const sy = cellY(grid);
  const halfX = (sizeCells * sx) / 2; const halfY = (sizeCells * sy) / 2;
  // top-left corner snapped to grid, then re-center (pro Achse)
  const col = Math.round((x - grid.offsetX - halfX) / sx);
  const row = Math.round((y - grid.offsetY - halfY) / sy);
  return {
    x: grid.offsetX + col * sx + halfX,
    y: grid.offsetY + row * sy + halfY,
  };
}

/**
 * Distance between two map-space points in ft, 5e-style: diagonals count the
 * same as orthogonal (Chebyshev / "every square is 5ft"). Set `euclidean` for
 * true straight-line measurement instead.
 */
export function gridDistanceFt(a, b, grid, euclidean = false) {
  const dxPx = Math.abs(b.x - a.x);
  const dyPx = Math.abs(b.y - a.y);
  if (euclidean) {
    return pxToFeet(Math.hypot(dxPx, dyPx), grid.size);
  }
  const dCols = dxPx / grid.size;
  const dRows = dyPx / grid.size;
  return Math.max(dCols, dRows) * FEET_PER_CELL;
}

/**
 * "Fit map to whole cells": given the map's pixel dimensions and a desired
 * approximate cell size, return the adjusted size + offset so an integer
 * number of cells covers the map exactly with no partial cells at the edges.
 * We keep the requested size as close as possible by rounding the cell count.
 */
export function fitGridToMap(mapWidth, mapHeight, desiredSize) {
  const cols = Math.max(1, Math.round(mapWidth / desiredSize));
  const rows = Math.max(1, Math.round(mapHeight / desiredSize));
  // EXAKTE Passung ohne halbe Felder: pro Achse eine eigene Zellgröße, sodass
  // cols·sizeX == mapWidth UND rows·sizeY == mapHeight (Offset 0). Die Zellen
  // sind dadurch minimal rechteckig — bei realen Battlemaps kaum sichtbar, dafür
  // liegt das Raster pixelgenau auf dem Kartenrand. `size` (Durchschnitt) bleibt
  // für Distanz-/Radius-Mathe (feetToPx) erhalten.
  const sizeX = mapWidth / cols;
  const sizeY = mapHeight / rows;
  return {
    size: (sizeX + sizeY) / 2,
    sizeX,
    sizeY,
    offsetX: 0,
    offsetY: 0,
    cols,
    rows,
  };
}

/** Build the polygon (array of {x,y} in map-space) covered by a zone. */
export function zonePolygon(zone, grid) {
  const { x, y, type, params } = zone;
  switch (type) {
    case 'circle': {
      const r = feetToPx(params.radiusFt, grid.size);
      const pts = [];
      const STEPS = 48;
      for (let i = 0; i < STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      return pts;
    }
    case 'square': {
      const s = feetToPx(params.sideFt, grid.size);
      const h = s / 2;
      return [
        { x: x - h, y: y - h }, { x: x + h, y: y - h },
        { x: x + h, y: y + h }, { x: x - h, y: y + h },
      ];
    }
    case 'cone': {
      const len = feetToPx(params.lengthFt, grid.size);
      const dir = (params.directionDeg * Math.PI) / 180;
      const half = Math.atan(0.5); // 5e cone: width == length
      const pts = [{ x, y }];
      const STEPS = 16;
      for (let i = 0; i <= STEPS; i++) {
        const a = dir - half + (i / STEPS) * (half * 2);
        pts.push({ x: x + Math.cos(a) * len, y: y + Math.sin(a) * len });
      }
      return pts;
    }
    case 'line': {
      const len = feetToPx(params.lengthFt, grid.size);
      const w = feetToPx(params.widthFt ?? FEET_PER_CELL, grid.size);
      const dir = (params.directionDeg * Math.PI) / 180;
      const nx = Math.cos(dir), ny = Math.sin(dir);
      const px = -ny, py = nx; // perpendicular
      const h = w / 2;
      return [
        { x: x + px * h, y: y + py * h },
        { x: x + nx * len + px * h, y: y + ny * len + py * h },
        { x: x + nx * len - px * h, y: y + ny * len - py * h },
        { x: x - px * h, y: y - py * h },
      ];
    }
    default:
      return [];
  }
}
