// Map image import pipeline — built for Supabase free-tier budgets.
//
// Unlike NerdShelf's compressImage (which targets tiny base64 portraits stored
// IN a JSONB row), maps are large and must live in Storage as a Blob, never in
// the DB. This util downscales + re-encodes to WebP and returns:
//   { blob, objectUrl, width, height, hash }
//
//   - blob:      what the SupabaseAdapter uploads to the `vtt-maps` bucket.
//   - objectUrl: for immediate local display (revoke when the map is dropped).
//   - width/height: the COMPRESSED dimensions — these become the map's
//     map-space size, so grid math is consistent for everyone.
//   - hash:      content hash → cache key + dedupe (don't re-upload identical
//     maps; players fetch each map once and cache in IndexedDB).
//
// Budget rationale: a 6 MB PNG battlemap → ~400-700 KB WebP. At 1 GB Storage
// that's ~1500 maps; at 5 GB/mo egress with per-client caching, re-downloads
// approach zero.

const MAX_INPUT_BYTES = 60 * 1024 * 1024; // reject absurd uploads before canvas OOM

/**
 * @param {File|Blob} file
 * @param {{ maxDim?: number, quality?: number }} [opts]
 *   maxDim: longer-edge cap (default 8192 — large battlemaps stay crisp when
 *           zoomed in; WebP keeps the file well within the Storage budget).
 *           Raise per-import for an exceptionally detailed map.
 *   quality: WebP quality 0..1 (default 0.92 — visually near-lossless for maps)
 */
export async function importMapImage(file, { maxDim = 12288, quality = 0.95 } = {}) {
  if (!file) throw new Error('Keine Datei ausgewählt.');
  if (file.size > MAX_INPUT_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Bild ist zu groß (${mb} MB). Maximal ${MAX_INPUT_BYTES / 1024 / 1024} MB.`);
  }

  const srcUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImage(srcUrl);
  } finally {
    URL.revokeObjectURL(srcUrl);
  }

  const { width, height } = scaleToFit(img.naturalWidth, img.naturalHeight, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, 'image/webp', quality);
  const hash = await sha256(blob);
  const objectUrl = URL.createObjectURL(blob);

  return { blob, objectUrl, width, height, hash, bytes: blob.size };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
    img.src = src;
  });
}

function scaleToFit(w, h, maxDim) {
  const longer = Math.max(w, h);
  if (longer <= maxDim) return { width: w, height: h };
  const r = maxDim / longer;
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding fehlgeschlagen.'))), type, quality);
  });
}

async function sha256(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
