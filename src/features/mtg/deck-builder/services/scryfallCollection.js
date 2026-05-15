// src/features/mtg/deck-builder/services/scryfallCollection.js
//
// Thin client over Scryfall's bulk `/cards/collection` endpoint. Used by
// the inventory + wishlist pages to hydrate Scryfall card detail given
// only the user's stored ids. Mirrors the pattern in useFavorites.js
// (which has its own copy for historical reasons — kept un-changed to
// avoid touching the favorites flow).

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH = 75;

/** Resolve a set of scryfall ids to full card objects. Returns [] on empty input. */
export async function fetchCardsByIds(ids) {
  const list = (ids || []).filter(Boolean);
  if (list.length === 0) return [];
  const out = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const res = await fetch(SCRYFALL_COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: slice.map(id => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall collection: HTTP ${res.status}`);
    const json = await res.json();
    if (Array.isArray(json.data)) out.push(...json.data);
  }
  return out;
}

/**
 * Resolve a list of {name, set?, quantity?} entries to Scryfall cards
 * via the named-identifier path. Used by InventoryImportModal so the
 * user can paste a decklist and have it round-trip to canonical ids.
 *
 * Returns [{ name, set, quantity, card }] preserving the request order
 * and the original quantity. `card` is null if Scryfall couldn't match.
 */
export async function fetchCardsByNames(entries) {
  const list = (entries || []).filter(e => e?.name);
  if (list.length === 0) return [];
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const identifiers = slice.map(e => e.set
      ? { name: e.name, set: e.set.toLowerCase() }
      : { name: e.name });
    const res = await fetch(SCRYFALL_COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) throw new Error(`Scryfall name lookup: HTTP ${res.status}`);
    const json = await res.json();
    const byName = new Map();
    for (const c of json.data || []) byName.set(c.name.toLowerCase(), c);
    for (let k = 0; k < slice.length; k++) {
      const e = slice[k];
      const card = byName.get(e.name.toLowerCase()) || null;
      out[i + k] = { ...e, card };
    }
  }
  return out;
}
