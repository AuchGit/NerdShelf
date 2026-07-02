// Drives the app-embedded relay (Rust backend) so a GM hosting a session gets a
// direct/LAN connection — no separate `node scripts/vtt-relay.mjs`. Desktop
// (Tauri) only for HOSTING; the LAN reachability probe also runs on web so any
// client can try a direct connection. The relay binds 0.0.0.0, so it's reachable
// on every local interface; the DM chooses which IP(s) to advertise.
import { setRelayUrl } from './vttPrefs';
import { toast } from './toast';

function isTauri() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// All non-loopback IPv4 addresses of the GM's machine as [{ip, name}] — name is
// the OS interface name (Ethernet, WLAN, "Radmin VPN", …). [] on web.
// Normalises legacy string entries so callers can always read .ip/.name.
export async function listLocalIps() {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = (await invoke('list_local_ips')) || [];
    return raw.map((e) => (typeof e === 'string' ? { ip: e, name: '' } : e)).filter((e) => e && e.ip);
  } catch { return []; }
}

// Rough network class for an interface, shown next to its name so the DM knows
// what they're exposing. Standards-based ranges only; everything else falls back
// to the interface NAME (which carries "Radmin VPN" etc. on its own).
export function classifyIp(ip, name = '') {
  if (/vpn|tun|tap|wireguard|tailscale|zerotier|hamachi/i.test(name)) return 'VPN';
  if (/^(10\.|192\.168\.)/.test(ip)) return 'privates Netz (LAN)';
  const m172 = /^172\.(\d+)\./.exec(ip);
  if (m172 && +m172[1] >= 16 && +m172[1] <= 31) return 'privates Netz (LAN)';
  if (/^169\.254\./.test(ip)) return 'Link-lokal (meist unbrauchbar)';
  const m100 = /^100\.(\d+)\./.exec(ip);
  if (m100 && +m100[1] >= 64 && +m100[1] <= 127) return 'VPN / Carrier-NAT';
  return 'öffentlich?';
}

// Start (or restart) the embedded relay and ANNOUNCE the chosen ws:// URL(s) to
// the campaign (vtt_campaign_state.relay_url, comma-joined) so players can
// auto-join over LAN. `ips` = the interface IPs the DM ticked; empty → the OS's
// primary IP only. Returns the GM's own connect URL (first chosen), or null.
export async function startEmbeddedRelay({ supabase, campaignId, port = 7373, ips = null } = {}) {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { appLocalDataDir, join } = await import('@tauri-apps/api/path');
    const mapsDir = await join(await appLocalDataDir(), 'vtt', 'campaigns');
    const primary = await invoke('start_relay', { port, mapsDir }); // ws://<os-ip>:port
    if (!primary) return null;
    const urls = (Array.isArray(ips) && ips.length)
      ? ips.map((ip) => `ws://${ip}:${port}`)
      : [primary];
    setRelayUrl(urls[0]); // the GM connects to its own relay
    if (supabase && campaignId) {
      supabase.from('vtt_campaign_state').upsert({ campaign_id: campaignId, relay_url: urls.join(',') })
        .then(({ error }) => {
          if (error) { console.warn('[vtt] relay announce', error.message); toast('LAN-Freigabe konnte nicht veröffentlicht werden', 'warning'); }
        });
    }
    return urls[0];
  } catch (e) {
    console.warn('[vtt] embedded relay start failed', e?.message || e);
    toast('LAN-Relay konnte nicht gestartet werden — Session läuft nur online', 'warning');
    return null;
  }
}

export async function stopEmbeddedRelay({ supabase, campaignId } = {}) {
  if (supabase && campaignId) {
    supabase.from('vtt_campaign_state').upsert({ campaign_id: campaignId, relay_url: null })
      .then(({ error }) => error && console.warn('[vtt] relay deannounce', error.message));
  }
  if (!isTauri()) return;
  try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('stop_relay'); }
  catch { /* ignore */ }
}

// Split a comma-joined announce string into ws:// candidate URLs.
export function relayUrls(announced) {
  return String(announced || '').split(',').map((u) => u.trim()).filter(Boolean);
}

// Try to open each ws:// URL; resolve the FIRST that connects within `timeoutMs`
// (= "we're on the same LAN as the DM"). Resolves null if none reach → caller
// stays on the online (Supabase) transport. Works on web + desktop.
export function probeRelayUrls(urls, timeoutMs = 2500) {
  const list = Array.isArray(urls) ? urls : relayUrls(urls);
  if (!list.length || typeof WebSocket === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let pending = list.length;
    const finish = (url) => { if (!done) { done = true; resolve(url); } };
    for (const url of list) {
      let ws;
      const timer = setTimeout(() => { try { ws && ws.close(); } catch { /* ignore */ } settle(null); }, timeoutMs);
      const settle = (ok) => { clearTimeout(timer); if (ok) finish(url); else if (--pending === 0) finish(null); };
      try {
        ws = new WebSocket(url);
        ws.onopen = () => { try { ws.close(); } catch { /* ignore */ } settle(true); };
        ws.onerror = () => settle(false);
      } catch { settle(false); }
    }
  });
}
