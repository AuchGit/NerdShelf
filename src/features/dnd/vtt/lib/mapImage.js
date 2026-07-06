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

/**
 * @param {File|Blob} file
 * @param {{ maxDim?: number, quality?: number }} [opts]
 *   maxDim: longer-edge cap (default 8192 — large battlemaps stay crisp when
 *           zoomed in; WebP keeps the file well within the Storage budget).
 *           Raise per-import for an exceptionally detailed map.
 *   quality: WebP quality 0..1 (default 0.92 — visually near-lossless for maps)
 */
// Online-Kompressgröße: die Direktverbindung serviert das UNANGETASTETE
// Original in VOLLER Auflösung (Tisch + gleiches Netz) — die Online-WebP-Kopie
// ist nur das Fallback für entfernte Spieler und darf deshalb klein sein.
// 4096px Kante reicht online locker und encodiert ~4× schneller als 8192
// (der WebP-Encode ist DER langsame Schritt — bei 115-MB-Maps entscheidend).
export async function importMapImage(file, { maxDim = 4096, quality = 0.85 } = {}) {
  if (!file) throw new Error('Keine Datei ausgewählt.');
  // KEIN Byte-Limit: das Original wird lokal in voller Größe gespeichert
  // (Direktverbindung serviert es unkomprimiert), online geht ohnehin nur
  // die komprimierte WebP-Version raus. Die echte Grenze ist, was der
  // Browser dekodieren kann — scheitert das, kommt eine klare Meldung.

  // Bevorzugt: kompletter Import (Decode + Skalieren + Encode + Hash) in
  // einem WORKER mit OffscreenCanvas — die App bleibt währenddessen voll
  // bedienbar. Fallback: Main-Thread-Pfad unten.
  const viaWorker = await importInWorker(file, maxDim, quality).catch(() => null);
  if (viaWorker) {
    return { ...viaWorker, objectUrl: URL.createObjectURL(viaWorker.blob) };
  }

  // Dekodieren: createImageBitmap ist deutlich schneller als der <img>-Umweg
  // und arbeitet direkt vom File-Blob; <img> bleibt als Fallback.
  let src; let sw; let sh;
  try {
    src = await createImageBitmap(file);
    sw = src.width; sh = src.height;
  } catch {
    const srcUrl = URL.createObjectURL(file);
    try {
      src = await loadImage(srcUrl);
      sw = src.naturalWidth; sh = src.naturalHeight;
    } catch {
      const mb = (file.size / 1024 / 1024).toFixed(0);
      throw new Error(`Bild (${mb} MB) konnte nicht dekodiert werden — vermutlich zu groß für den Browser. Bild etwas verkleinern und erneut importieren.`);
    } finally {
      URL.revokeObjectURL(srcUrl);
    }
  }

  try {
    // Encode-Schleife: Supabase Storage (free tier) nimmt ~50 MB pro Datei —
    // fällt das WebP größer aus, Kante um 15% verkleinern und neu encoden.
    // Das ORIGINAL bleibt davon unberührt (liegt lokal in voller Größe).
    let dim = maxDim;
    let blob; let width; let height;
    for (let attempt = 0; attempt < 4; attempt++) {
      ({ width, height } = scaleToFit(sw, sh, dim));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, width, height);
      blob = await canvasToBlob(canvas, 'image/webp', quality);
      if (blob.size <= 45 * 1024 * 1024) break;
      dim = Math.round(dim * 0.85);
    }
    const hash = await sha256(blob);
    const objectUrl = URL.createObjectURL(blob);
    return { blob, objectUrl, width, height, origWidth: sw, origHeight: sh, hash, bytes: blob.size };
  } finally {
    src.close?.(); // ImageBitmap-Speicher sofort freigeben
  }
}

// Worker-Import: gibt null bei Fehlern zurück (Caller fällt auf den
// Main-Thread-Pfad zurück — z.B. wenn OffscreenCanvas/WebP dort fehlt).
function importInWorker(file, maxDim, quality) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./mapImageWorker.js', import.meta.url), { type: 'module' });
    } catch { resolve(null); return; }
    const done = (v) => { worker.terminate(); resolve(v); };
    worker.onmessage = (e) => {
      const d = e.data;
      // Bei jedem Worker-Fehler auf den Main-Thread-Pfad zurückfallen —
      // der liefert bei einem echten Dekodier-Problem die klare Meldung.
      done(d?.ok && d.blob ? d : null);
    };
    worker.onerror = () => done(null);
    worker.postMessage({ file, maxDim, quality });
  });
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
