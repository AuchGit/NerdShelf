// Upload a compressed map image (WebP blob) to the vtt-maps Storage bucket.
// Dedupes by content hash → each identical map is stored once; players fetch
// the public URL (cached by the browser/IndexedDB), keeping egress low.
import { supabase } from '../../../../core/supabase/client';

const BUCKET = 'vtt-maps';

export async function uploadMapImage(campaignId, blob, hash) {
  const path = `${campaignId}/${hash}.webp`;
  // upsert: re-uploading the same content is a no-op overwrite (idempotent).
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp', upsert: true,
  });
  if (error && !/exists/i.test(error.message)) throw error;
  const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return { imagePath: path, imageUrl };
}

// Relay (P2P) full-res maps: the relay runs an HTTP file server on the same
// host/port as its WebSocket. Convert ws://host:port → http(s)://host:port.
export function relayHttpBase(wsUrl) {
  if (!wsUrl) return null;
  try { const u = new URL(wsUrl); return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`; } catch { return null; }
}

// PUT a full-resolution original to the relay so players fetch it directly from
// the GM's PC (no Supabase compression). Returns the GET URL, or null on failure.
export async function uploadMapToRelay(relayWsUrl, name, file) {
  const base = relayHttpBase(relayWsUrl);
  if (!base) return null;
  const url = `${base}/map/${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'PUT', body: file });
  if (!res.ok) throw new Error(`Relay-Upload fehlgeschlagen (${res.status})`);
  return url;
}

function isTauri() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// Desktop only: write the UNTOUCHED original into the relay's maps dir at upload
// time — independent of whether the relay is running. Then whenever the GM hosts
// a direct connection it's served full-res at /map/<name>, regardless of the
// session's relay IP/port (the URL is built from the live relay address at render
// time). Returns the relative name (the key) to store on the map, or null.
export async function saveMapOriginalLocal(name, file) {
  if (!isTauri()) return null;
  try {
    const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
    const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const dir = await join(await appLocalDataDir(), 'vtt', 'campaigns');
    try { await mkdir(dir, { recursive: true }); } catch { /* exists */ }
    const path = await join(dir, name);
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    console.log('[vtt] Original gespeichert:', path);
    return name;
  } catch (e) { console.warn('[vtt] save original failed', e?.message || e); return null; }
}

// Build the live full-res GET URL for a stored original, from the GM's CURRENT
// relay address. null if not on a direct connection or no original was saved.
export function relayFullUrl(relayWsUrl, name) {
  const base = relayHttpBase(relayWsUrl);
  return base && name ? `${base}/map/${encodeURIComponent(name)}` : null;
}

// Upload a journal/handout image (kept in its original format) to the same
// bucket under a /handouts/ prefix. Returns the public URL + storage path.
export async function uploadHandoutImage(campaignId, file) {
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const id = Math.random().toString(36).slice(2, 10);
  const path = `${campaignId}/handouts/${id}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'image/png', upsert: true,
  });
  if (error && !/exists/i.test(error.message)) throw error;
  const imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return { imagePath: path, imageUrl };
}
