// Tiny pub/sub toast bus — callable from ANYWHERE (sync adapter, renderer,
// plain lib code), rendered by components/Toasts.jsx inside the VTT. Exists so
// failures that used to die in console.warn (persistence, relay uploads,
// snapshot loads) are actually visible at the table before they cost data.
let seq = 0;
const listeners = new Set();
const recent = new Map(); // message -> timestamp (dedupe storms)

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {string} message
 * @param {'error'|'warning'|'info'|'success'} tone
 */
export function toast(message, tone = 'error') {
  if (!message) return;
  // A failing persist can fire dozens of times in seconds — show each text once per 5s.
  const now = Date.now();
  if (now - (recent.get(message) || 0) < 5000) return;
  recent.set(message, now);
  if (recent.size > 50) recent.delete(recent.keys().next().value);
  const t = { id: ++seq, message, tone, at: now };
  listeners.forEach((fn) => fn(t));
}
