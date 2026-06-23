// Universal VTT importer (.uvtt / .dd2vtt / .df2vtt — Dungeondraft etc.).
//
// A UVTT file is JSON bundling:
//   resolution.pixels_per_grid  — px per grid cell in the ORIGINAL image
//   resolution.map_size {x,y}   — map size in grid cells
//   line_of_sight / objects_line_of_sight — wall polylines (coords in CELLS)
//   portals                     — doors (bounds = 2 points, in CELLS)
//   lights                      — light sources (kept for later)
//   image                       — base64 PNG of the map
//
// We compress the image to WebP (budget) and SCALE the grid + all geometry by
// the compression ratio so everything stays aligned. Output feeds addMap +
// addWalls directly — the wall/door/grid model matches UVTT 1:1.
import { importMapImage } from './mapImage';

export async function parseUvtt(file) {
  const data = JSON.parse(await file.text());
  const res = data.resolution || {};
  const ppg = res.pixels_per_grid || 70;
  const cells = res.map_size || { x: 0, y: 0 };

  // base64 image → Blob → compressed WebP (returns the compressed dimensions)
  const b64 = String(data.image || '').replace(/^data:[^,]+,/, '');
  if (!b64) throw new Error('UVTT enthält kein Bild.');
  const blob = base64ToBlob(b64, 'image/png');
  const img = await importMapImage(blob);

  // original px size (cells × ppg) → scale factor after compression
  const origW = (cells.x || 1) * ppg;
  const scale = img.width / origW || 1;
  const gridSize = ppg * scale;
  const toPx = (p) => ({ x: p.x * gridSize, y: p.y * gridSize });

  // walls: every consecutive pair in each LoS polyline blocks light + movement
  const walls = [];
  const los = [...(data.line_of_sight || []), ...(data.objects_line_of_sight || [])];
  for (const poly of los) {
    for (let i = 0; i < poly.length - 1; i++) {
      walls.push({ a: toPx(poly[i]), b: toPx(poly[i + 1]), kind: 'both' });
    }
  }

  // portals → doors (closed=false means it's standing open)
  for (const portal of (data.portals || [])) {
    const b = portal.bounds;
    if (b && b.length >= 2) {
      walls.push({ a: toPx(b[0]), b: toPx(b[b.length - 1]), kind: 'door', open: portal.closed === false });
    }
  }

  // lights: UVTT stores position in CELLS and range in grid units; scale the
  // same way as walls and convert range → feet (1 cell = 5 ft). Color is an
  // ARGB hex string ("ffffd9a0") — drop the alpha byte.
  const lights = (data.lights || []).map((l) => {
    const pos = l.position || {};
    const dimFt = Math.round((l.range || 0) * 5);
    return {
      x: (pos.x || 0) * gridSize,
      y: (pos.y || 0) * gridSize,
      brightFt: Math.round(dimFt / 2),
      dimFt,
      color: uvttColor(l.color),
      enabled: true,
    };
  }).filter((l) => l.dimFt > 0);

  return {
    name: file.name.replace(/\.[^.]+$/, ''),
    imageUrl: img.objectUrl,
    blob: img.blob,
    hash: img.hash,
    width: img.width,
    height: img.height,
    gridSize,
    walls,
    lights,
  };
}

// UVTT colors are ARGB hex without a leading "#" (e.g. "ffffd9a0"). Return an
// "#rrggbb" string, falling back to a warm default for missing / odd values.
function uvttColor(c) {
  const hex = String(c || '').replace(/^#/, '');
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return '#ffd9a0';
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
