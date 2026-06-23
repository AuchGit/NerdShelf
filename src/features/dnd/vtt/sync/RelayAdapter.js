// RelayAdapter — VTT sync over a plain WebSocket relay instead of Supabase.
//
// Same contract as SupabaseAdapter (onMessage / connect / send / disconnect),
// so the store/renderer don't care which transport is used. The relay is a
// dumb fan-out hub (e.g. the GM runs `node scripts/vtt-relay.mjs` on their PC):
// every message is rebroadcast to the OTHER peers. State for late joiners comes
// from the existing snapshot handshake (__reqState → a peer replies __snapshot;
// the relay also caches the last snapshot and replays it on connect).
//
// NOTE: this transports the VTT battlemap state only. Character sheets still
// load from Supabase (dnd_characters); a fully offline session would also need
// to relay those. The heavy realtime traffic (token drags, fog, etc.) is what
// this offloads from Supabase.

// Transient/client-only ops are never sent. Unlike Supabase, the snapshot
// handshake (__reqState/__snapshot) MUST travel over the wire here (no DB).
const LOCAL_ONLY = (t) => !t || t.startsWith('ui/') || t === 'session/set' || t === 'ruler/set' || t.startsWith('ping/');

export class RelayAdapter {
  constructor({ url, userId }) {
    this.url = url;
    this.userId = userId;
    this.senderId = `${userId}:${Math.random().toString(36).slice(2)}`;
    this.handler = null;
    this.ws = null;
    this._queue = [];
    this._closed = false;
    this._retry = 0;
  }

  onMessage(fn) { this.handler = fn; }

  connect() { this._open(); }

  _open() {
    try { this.ws = new WebSocket(this.url); } catch { this._scheduleRetry(); return; }
    this.ws.onopen = () => {
      this._retry = 0;
      const q = this._queue; this._queue = [];
      for (const m of q) { try { this.ws.send(m); } catch { /* requeue on next open */ this._queue.push(m); } }
    };
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || msg.senderId === this.senderId) return; // ignore our own echo
      if (msg.op) this.handler?.(msg.op);
    };
    this.ws.onclose = () => { if (!this._closed) this._scheduleRetry(); };
    this.ws.onerror = () => { try { this.ws?.close(); } catch { /* ignore */ } };
  }

  _scheduleRetry() {
    this._retry = Math.min(this._retry + 1, 6);
    setTimeout(() => { if (!this._closed) this._open(); }, 500 * this._retry);
  }

  send(op) {
    if (LOCAL_ONLY(op.type)) return;
    const data = JSON.stringify({ senderId: this.senderId, op });
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
    else this._queue.push(data);
  }

  disconnect() {
    this._closed = true;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
