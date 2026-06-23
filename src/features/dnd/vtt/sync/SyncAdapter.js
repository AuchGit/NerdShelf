// SyncAdapter contract.
//
// The store talks to exactly one adapter. An adapter must:
//   - send(op):          deliver a local op to peers (durably if it can).
//   - onMessage(fn):     register the handler the store uses for inbound ops.
//   - connect():         optional async setup; returns a Promise or void.
//   - disconnect():      optional teardown.
//
// Phase 1 ships LocalAdapter (this file). Phase 2 swaps in SupabaseAdapter
// with the SAME interface — no store/UI changes. See sync/SupabaseAdapter.js
// for the stub and the data-model/RLS notes.

/**
 * LocalAdapter — zero-backend multiplayer for prototyping.
 *
 * Uses BroadcastChannel so two browser tabs on the same machine sync live and
 * instantly (open one as DM, one as a player to feel the realtime path). Falls
 * back to a no-op single-tab mode where BroadcastChannel is unavailable.
 *
 * It also tags every op with a per-tab senderId so we ignore our own echoes,
 * mirroring how the Supabase broadcast path will behave.
 */
export class LocalAdapter {
  constructor(channelName = 'vtt-local') {
    this.senderId = Math.random().toString(36).slice(2);
    this.handler = null;
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
    if (this.bc) {
      this.bc.onmessage = (e) => {
        const { senderId, op } = e.data || {};
        if (senderId === this.senderId) return; // ignore our own echo
        this.handler?.(op);
      };
    }
  }

  connect() { /* nothing to do */ }

  onMessage(fn) { this.handler = fn; }

  send(op) {
    // UI-only ops never leave this client.
    if (op.type?.startsWith('ui/')) return;
    this.bc?.postMessage({ senderId: this.senderId, op });
  }

  disconnect() { this.bc?.close(); }
}
