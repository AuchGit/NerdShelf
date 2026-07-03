// VTT direct-connection relay — run this on the GM's PC to host a session
// WITHOUT Supabase. It is a dumb WebSocket fan-out hub: every message from one
// peer is rebroadcast to all other peers. State is persisted to disk so it
// survives everyone disconnecting and is restored on restart.
//
//   npm i ws           (one-time; ws is in devDependencies)
//   node scripts/vtt-relay.mjs            # listens on ws://0.0.0.0:7373
//   PORT=9000 node scripts/vtt-relay.mjs  # custom port
//
// Players then set, in NerdShelf → Einstellungen → Virtual Tabletop:
//   Verbindung: "Direkt (Relay)"  ·  Relay-URL: ws://<GM-LAN-IP>:7373
// On the same LAN no port-forwarding is needed; over the internet the GM must
// forward the port or use a tunnel (e.g. `ngrok tcp 7373`).
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, createReadStream, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const PORT = Number(process.env.PORT) || 7373;
const STATE_FILE = process.env.STATE_FILE || join(dirname(fileURLToPath(import.meta.url)), '.vtt-relay-state.json');
// Full-resolution map originals live here (no Supabase, no compression). The
// app PUTs originals when uploading in relay mode, and players GET them. Drop
// files here manually too — they're served at /map/<filename>.
// Default = das Verzeichnis, in das die Desktop-App ihre Originale speichert
// (saveMapOriginalLocal → appLocalDataDir/vtt/campaigns) — so serviert das
// manuelle Node-Relay dieselben Dateien wie das eingebettete App-Relay.
// Fallback (kein App-Ordner vorhanden): <repo>/vtt/campaigns wie bisher.
function defaultMapsDir() {
  if (process.env.MAPS_DIR) return process.env.MAPS_DIR;
  const appDir = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'io.github.auchgit.nerdshelf', 'vtt', 'campaigns'))
    : process.platform === 'darwin'
      ? (process.env.HOME && join(process.env.HOME, 'Library', 'Application Support', 'io.github.auchgit.nerdshelf', 'vtt', 'campaigns'))
      : (process.env.HOME && join(process.env.HOME, '.local', 'share', 'io.github.auchgit.nerdshelf', 'vtt', 'campaigns'));
  try { if (appDir && statSync(appDir).isDirectory()) return appDir; } catch { /* App-Ordner existiert nicht */ }
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'vtt', 'campaigns');
}
const MAPS_DIR = defaultMapsDir();
try { mkdirSync(MAPS_DIR, { recursive: true }); } catch { /* ignore */ }
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', webm: 'video/webm', mp4: 'video/mp4' };
const safeName = (n) => basename(String(n)).replace(/[^\w.\-]/g, '_');

// Persisted state = the latest full snapshot, stored as the store's snapshot
// object. Served to every new peer as a __snapshot message.
let snapshot = null;
try { snapshot = JSON.parse(readFileSync(STATE_FILE, 'utf8')); console.log('[relay] restored state from', STATE_FILE); }
catch { /* no prior state */ }

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeFileSync(STATE_FILE, JSON.stringify(snapshot)); } catch (e) { console.warn('[relay] save failed', e.message); }
  }, 1000);
}
function snapshotMessage() {
  return JSON.stringify({ senderId: 'relay', op: { type: '__snapshot', snapshot } });
}

// HTTP server: serves/accepts full-res map files at /map/<name>, and hosts the
// WebSocket upgrade on the same port.
const http = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const m = (req.url || '').match(/^\/map\/([^/?#]+)/);
  if (!m) { res.writeHead(req.url === '/' ? 200 : 404); res.end(req.url === '/' ? 'VTT relay OK' : 'not found'); return; }
  const file = join(MAPS_DIR, safeName(decodeURIComponent(m[1])));
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { writeFileSync(file, Buffer.concat(chunks)); console.log('[relay] stored map', file); res.writeHead(200); res.end('ok'); } catch (e) { res.writeHead(500); res.end(String(e?.message || e)); } });
    req.on('error', () => { res.writeHead(500); res.end('err'); });
    return;
  }
  try {
    const st = statSync(file);
    const ext = file.split('.').pop().toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000' });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end('not found'); }
});
const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws, req) => {
  const who = req.socket.remoteAddress;
  console.log(`[relay] connect ${who} (peers: ${wss.clients.size})`);
  if (snapshot) { try { ws.send(snapshotMessage()); } catch { /* ignore */ } }

  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg = null;
    try { msg = JSON.parse(text); } catch { /* not JSON */ }
    const type = msg?.op?.type;
    // __persist: GM pushes the authoritative snapshot for durability. Cache +
    // save to disk; do NOT rebroadcast (it would clobber peers' live state).
    if (type === '__persist') { snapshot = msg.op.snapshot; saveSoon(); return; }
    // Keep the served snapshot fresh from the handshake replies too.
    if (type === '__snapshot' && msg.op.snapshot) { snapshot = msg.op.snapshot; saveSoon(); }
    // Fan out everything else to the other peers.
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) { try { client.send(text); } catch { /* ignore */ } }
    }
  });

  ws.on('close', () => console.log(`[relay] disconnect ${who} (peers: ${wss.clients.size})`));
  ws.on('error', () => {});
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`VTT relay listening on ws://0.0.0.0:${PORT}  (+ HTTP map files at /map/…)`);
  console.log('Players connect with Relay-URL  ws://<this-PC-LAN-IP>:' + PORT);
  console.log('Full-res map originals dir:', MAPS_DIR);
});
