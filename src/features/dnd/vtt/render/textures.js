// Texture loading helper.
//
// Pixi's Assets.load infers the loader from the URL extension, which fails for
// data:/blob: URLs (no extension) — exactly what we use for imported maps and
// token portraits. Loading through an HTMLImageElement and Texture.from(img)
// sidesteps the resolver entirely and works for any source.
import { Texture } from 'pixi.js';

const cache = new Map(); // url -> Promise<Texture|null>

// LRU cap for the caches below: long sessions with many monsters would grow
// them unboundedly. Eviction only drops OUR reference (no texture.destroy) —
// displayed textures stay alive via their sprites; truly unused ones get GC'd
// and Pixi's TextureGCSystem already unloads idle GPU textures.
function lruTouch(map, key, max) {
  if (map.has(key)) { const v = map.get(key); map.delete(key); map.set(key, v); return v; }
  if (map.size >= max) map.delete(map.keys().next().value);
  return undefined;
}

// Rasterize a loaded image onto a 2D canvas, then make the texture from the
// CANVAS. Pixi v8 frequently uploads SVG-sourced HTMLImageElements as solid
// black in WebGL; going through a canvas bitmap fixes that reliably. Used for
// all SVG icons (conditions, doors, stairs/ladder).
function rasterToTexture(img, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);
  return Texture.from(canvas);
}

function imageFrom(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Load an SVG icon (rasterized → crisp, non-black in WebGL).
const iconCache = new Map(); // url -> Promise<Texture|null>
export function loadIcon(url) {
  if (!url) return Promise.resolve(null);
  const hit = lruTouch(iconCache, url, 120);
  if (hit) return hit;
  const p = imageFrom(url).then((img) => (img ? rasterToTexture(img) : null));
  iconCache.set(url, p);
  return p;
}

// Load an SVG recolored to a solid `color` (condition badges: white on a tinted
// disc). Inject a root fill/stroke (inherited by paths without their own), then
// rasterize via canvas.
const svgCache = new Map(); // url|color -> Promise<Texture|null>
export function loadSvgTinted(url, color = '#ffffff') {
  const key = `${url}|${color}`;
  const hit = lruTouch(svgCache, key, 150);
  if (hit) return hit;
  const p = fetch(url)
    .then((r) => r.text())
    .then((txt) => {
      const tinted = txt.replace('<svg', `<svg fill="${color}" stroke="${color}"`);
      const blobUrl = URL.createObjectURL(new Blob([tinted], { type: 'image/svg+xml' }));
      return imageFrom(blobUrl).then((img) => { URL.revokeObjectURL(blobUrl); return img ? rasterToTexture(img) : null; });
    })
    .catch(() => null);
  svgCache.set(key, p);
  return p;
}

export function loadTexture(url) {
  if (!url) return Promise.resolve(null);
  const hit = lruTouch(cache, url, 300);
  if (hit) return hit;
  const p = (async () => {
    let tex = await fetchTexture(url);
    // A …/tokens/… URL can miss for several reasons: 5etools only hosts a
    // dedicated token when a creature `hasToken` (else only full art), and
    // homebrew/3pp sources (Flee Mortals etc.) live on the homebrew GitHub repo,
    // not 5e.tools. Try the known alternatives in turn. Keys off the stored URL
    // pattern, so it also rescues tokens imported before this existed.
    if (!tex) {
      const fbs = tokenFallbacks(url);
      for (const fb of fbs) {
        tex = await fetchTexture(fb);
        if (tex) break;
      }
      // Sichtbare Diagnose statt stiller Disc: welcher Token-Load scheitert
      // mit welchen probierten URLs (einmal pro URL dank Cache-Eviction).
      if (!tex && fbs.length) console.warn('[vtt] Token-Bild nicht ladbar:', url, '· Fallbacks:', fbs.join(' , '));
    }
    return tex;
  })();
  cache.set(url, p);
  // Do NOT cache failures: a transient network/CORS hiccup would otherwise stick
  // until the whole VTT is restarted. Evicting lets the next call retry.
  p.then((tex) => { if (!tex) cache.delete(url); }).catch(() => cache.delete(url));
  return p;
}

// Load one source: in Tauri fetch the bytes via Rust (no CORS) → same-origin
// blob FIRST (a cross-origin image can render once then drop out when WebGL
// re-uploads a "tainted" source; 5e.tools sends no ACAO). Else load directly.
async function fetchTexture(url) {
  if (/^https?:/i.test(url) && isTauri()) {
    const blobUrl = await tauriFetchBlobUrl(url);
    if (blobUrl) {
      const img = await imageFrom(blobUrl);
      if (img) return Texture.from(img);
    }
  }
  const img = await imageFrom(url);
  return img ? Texture.from(img) : null;
}

// Alternative image URLs for a 5etools bestiary TOKEN url that 404'd. Order:
// official full art, then the homebrew GitHub repo (3pp sources like Flee
// Mortals live there, not on 5e.tools), token then art.
const HB = 'https://raw.githubusercontent.com/TheGiddyLimit/homebrew/master/_img';
function tokenFallbacks(url) {
  const m = /\/img\/bestiary\/tokens\/([^/]+)\/(.+)\.(webp|png|jpg|jpeg)$/i.exec(url);
  if (!m) return [];
  const src = m[1]; const name = m[2]; // name is already URL-encoded
  return [
    `https://5e.tools/img/bestiary/tokens/${src}/${name}.png`, // älteres Token-Format
    `https://5e.tools/img/bestiary/${src}/${name}.webp`, // official full art
    `${HB}/${src}/token/${name}.png`,                    // homebrew token
    `${HB}/${src}/token/${name}.webp`,
    `${HB}/${src}/${name}.png`,                          // homebrew full art
  ];
}

function isTauri() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// Fetch a remote image via the Tauri HTTP plugin (bypasses webview CORS) and
// wrap it in a same-origin object URL the webview can texture from.
async function tauriFetchBlobUrl(url) {
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    const res = await tauriFetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return URL.createObjectURL(new Blob([buf]));
  } catch {
    return null;
  }
}
