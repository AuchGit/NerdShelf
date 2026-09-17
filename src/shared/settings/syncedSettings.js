// src/shared/settings/syncedSettings.js
//
// Settings that belong to the ACCOUNT and should follow the user from the
// desktop app to the phone: the MTG price warnings, the card language, the
// DnD pill colours, the cross-edition marker.
//
// Display and layout preferences are deliberately NOT synced — card size,
// column count, sort orders, sidebar width, the mobile viewer's grid and
// every VTT view setting describe one screen in one pair of hands. A phone
// wants two columns where a monitor wants six. Those stay in localStorage.
//
// How it works: every synced setting already lives under its own
// localStorage key, and its RAW string is what travels. That keeps this
// module free of any knowledge about the shape of each setting — a new one
// is a single line in SYNCED_KEYS.
//
// Conflict handling is last-writer-wins, which is what people expect from
// settings: signing in pulls the account's values onto this device, and
// every change from then on pushes. The very first device to sign in seeds
// the account from what it already had locally, so nobody loses the
// settings they had before this existed.

import { supabase } from '../../core/supabase/client';

const TABLE = 'user_settings';
const PUSH_DELAY_MS = 800;

/** localStorage keys that travel with the account. */
export const SYNCED_KEYS = [
  'mtg-price-thresholds',            // price warning thresholds
  'mtg:card-language',               // language of the card images
  'nerdshelf:pillColors',            // DnD pill colour overrides
  'nerdshelf:hideCrossEditionMarker',// DnD cross-edition marker
];

// A store with an in-memory cache registers here so it can refresh itself
// when the account's value arrives from another device.
const refreshers = new Map();

/** @param {string} key @param {() => void} fn */
export function onRemoteSettings(key, fn) {
  refreshers.set(key, fn);
  return () => refreshers.delete(key);
}

function readLocalBundle() {
  const out = {};
  for (const key of SYNCED_KEYS) {
    try {
      const value = localStorage.getItem(key);
      if (value != null) out[key] = value;
    } catch { /* storage unavailable — skip this key */ }
  }
  return out;
}

/** Write the account's values over the local ones. Returns true if anything moved. */
function applyBundle(bundle) {
  let changed = false;
  for (const key of SYNCED_KEYS) {
    const incoming = Object.prototype.hasOwnProperty.call(bundle || {}, key)
      ? bundle[key]
      : null;
    let local;
    try { local = localStorage.getItem(key); } catch { continue; }
    if (incoming === local) continue;
    try {
      if (incoming == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(incoming));
    } catch { continue; }
    changed = true;
    // Let the owning store drop its cache and re-render.
    try { refreshers.get(key)?.(); } catch { /* a broken store must not stop the rest */ }
  }
  return changed;
}

let userId = null;
let pushTimer = null;

async function pushNow() {
  if (!userId) return;
  try {
    await supabase.from(TABLE).upsert(
      { user_id: userId, data: readLocalBundle(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  } catch { /* offline — the next change pushes again */ }
}

/**
 * Called by a synced store right after it wrote to localStorage.
 * Debounced, so dragging a colour picker doesn't write a row per frame.
 */
export function markSettingsDirty() {
  if (!userId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
}

/** Pull the account's settings onto this device, or seed them from it. */
export async function startSettingsSync(nextUserId) {
  userId = nextUserId || null;
  if (!userId) return;
  let row;
  try {
    const res = await supabase
      .from(TABLE)
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) return;   // table missing or offline — stay local-only
    row = res.data;
  } catch {
    return;
  }
  // No row yet: this device's settings become the account's.
  if (!row) { await pushNow(); return; }
  applyBundle(row.data || {});
}

export function stopSettingsSync() {
  clearTimeout(pushTimer);
  pushTimer = null;
  userId = null;
}
