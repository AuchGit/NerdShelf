// Texture loading helper.
//
// Pixi's Assets.load infers the loader from the URL extension, which fails for
// data:/blob: URLs (no extension) — exactly what we use for imported maps and
// token portraits. Loading through an HTMLImageElement and Texture.from(img)
// sidesteps the resolver entirely and works for any source.
import { Texture } from 'pixi.js';

const cache = new Map(); // url -> Promise<Texture|null>

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
  if (iconCache.has(url)) return iconCache.get(url);
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
  if (svgCache.has(key)) return svgCache.get(key);
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
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    // Remote URL in Tauri: fetch the bytes via Rust (no CORS) → same-origin
    // blob FIRST. Loading a cross-origin image directly (even with
    // crossOrigin) can yield a texture that renders once and then drops out
    // when WebGL re-uploads a "tainted" source (5e.tools sends no ACAO).
    if (/^https?:/i.test(url) && isTauri()) {
      const blobUrl = await tauriFetchBlobUrl(url);
      if (blobUrl) {
        const img = await imageFrom(blobUrl);
        if (img) return Texture.from(img);
      }
    }
    // data:/blob:/same-origin or CORS-enabled remote (e.g. Supabase maps), and
    // the browser (non-Tauri) fallback.
    const img = await imageFrom(url);
    return img ? Texture.from(img) : null;
  })();
  cache.set(url, p);
  // Do NOT cache failures: a transient network/CORS hiccup would otherwise stick
  // until the whole VTT is restarted. Evicting lets the next call retry.
  p.then((tex) => { if (!tex) cache.delete(url); }).catch(() => cache.delete(url));
  return p;
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
