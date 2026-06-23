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
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT) || 7373;
const STATE_FILE = process.env.STATE_FILE || join(dirname(fileURLToPath(import.meta.url)), '.vtt-relay-state.json');

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

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

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

console.log(`VTT relay listening on ws://0.0.0.0:${PORT}`);
console.log('Players connect with Relay-URL  ws://<this-PC-LAN-IP>:' + PORT);
