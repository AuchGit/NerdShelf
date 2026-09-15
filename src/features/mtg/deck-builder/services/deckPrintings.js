// src/features/mtg/deck-builder/services/deckPrintings.js
//
// Per-deck artwork choice. A deck stores its entries keyed by the Scryfall
// id of the card that was added (`mainboard[card.id] = { card, count }`).
// That key is what inventory, wishlist, favorites, the commander singleton
// rule and the cover picker all match on — so choosing a different artwork
// must NOT change it.
//
// Instead the deck carries a separate map next to the zones:
//
//   data.printings = { [entryCardId]: PrintingSummary }
//
// One choice per card per deck, shared by mainboard / sideboard / ideas /
// commander. Moving a card between zones therefore keeps its artwork
// without touching any of the move handlers. Display code overlays the
// summary onto the stored card via `applyPrinting`; the stored card itself
// stays untouched, so "Standard" (removing the choice) restores it exactly.

const SCRYFALL_SEARCH = 'https://api.scryfall.com/cards/search';

const IMAGE_KEYS = ['small', 'normal', 'large', 'art_crop'];

function pickImages(uris) {
  if (!uris) return undefined;
  const out = {};
  for (const k of IMAGE_KEYS) if (uris[k]) out[k] = uris[k];
  return Object.keys(out).length ? out : undefined;
}

/** Slim, storable description of one printing (what the deck JSON keeps). */
export function printingSummary(card) {
  if (!card?.id) return null;
  const faces = Array.isArray(card.card_faces) && card.card_faces.some(f => f?.image_uris)
    ? card.card_faces.map(f => ({ image_uris: pickImages(f?.image_uris) }))
    : undefined;
  return {
    id: card.id,
    set: card.set || '',
    set_name: card.set_name || '',
    collector_number: card.collector_number || '',
    released_at: card.released_at || '',
    rarity: card.rarity,
    prices: card.prices
      ? { eur: card.prices.eur ?? null, eur_foil: card.prices.eur_foil ?? null }
      : undefined,
    image_uris: pickImages(card.image_uris),
    card_faces: faces,
  };
}

/**
 * Overlay a printing onto a stored card for display. Keeps `id`, name,
 * oracle data etc. of the stored card; swaps images, set info, rarity and
 * price. Returns the card unchanged when there is no printing.
 */
export function applyPrinting(card, printing) {
  if (!card || !printing) return card;
  const merged = {
    ...card,
    set: printing.set || card.set,
    set_name: printing.set_name || card.set_name,
    collector_number: printing.collector_number || card.collector_number,
    released_at: printing.released_at || card.released_at,
    rarity: printing.rarity || card.rarity,
    prices: printing.prices || card.prices,
    _printingId: printing.id,
  };
  const faceImages = (printing.card_faces || []).map(f => f?.image_uris);
  if (Array.isArray(card.card_faces) && faceImages.some(Boolean)) {
    merged.card_faces = card.card_faces.map((f, i) => (
      faceImages[i] ? { ...f, image_uris: faceImages[i] } : f
    ));
  }
  if (printing.image_uris) {
    merged.image_uris = printing.image_uris;
  } else if (card.image_uris && faceImages[0]) {
    // Single-image card whose chosen printing is double-sided (e.g. a
    // reversible Secret Lair variant) — show the front.
    merged.image_uris = faceImages[0];
  }
  return merged;
}

/** Apply a deck's printing map to every entry of one zone. */
export function applyPrintingsToZone(zone, printings) {
  if (!zone || !printings || Object.keys(printings).length === 0) return zone || {};
  const out = {};
  for (const [id, entry] of Object.entries(zone)) {
    const p = printings[id];
    out[id] = p && entry?.card ? { ...entry, card: applyPrinting(entry.card, p) } : entry;
  }
  return out;
}

/** Drop choices for cards that are no longer anywhere in the deck. */
export function prunePrintings(printings, { mainboard, sideboard, ideas, commander }) {
  const out = {};
  for (const [id, p] of Object.entries(printings || {})) {
    if (mainboard?.[id] || sideboard?.[id] || ideas?.[id] || commander?.id === id) {
      out[id] = p;
    }
  }
  return out;
}

/** Human label for a printing: "Modern Masters · MMA #12". */
export function printingLabel(p) {
  if (!p) return '';
  const code = p.set ? p.set.toUpperCase() : '';
  const num = p.collector_number ? ` #${p.collector_number}` : '';
  return [p.set_name, `${code}${num}`.trim()].filter(Boolean).join(' · ');
}

/**
 * Cardmarket "Wants → Massenimport" line. Cardmarket accepts
 * `<Anzahl> <Name> (<Edition>)` with the full expansion name, which is
 * what Scryfall calls `set_name`. Without a chosen printing the line stays
 * the plain `<Anzahl> <Name>` so Cardmarket may offer any edition.
 */
export function cardmarketLine(qty, name, printing) {
  const base = `${qty} ${name}`;
  return printing?.set_name ? `${base} (${printing.set_name})` : base;
}

/**
 * Split a card's demand into per-printing parts and take owned copies off.
 * Owned copies are not tracked per artwork, so they first cover demand
 * without a fixed artwork, then the fixed ones in the given order.
 *
 * @param {{printing: object|null, count: number}[]} parts
 * @param {number} owned
 * @returns {{printing: object|null, count: number}[]} remaining (> 0 only)
 */
export function allocateOwned(parts, owned) {
  let left = Math.max(0, owned || 0);
  const ordered = [
    ...parts.filter(p => !p.printing),
    ...parts.filter(p => p.printing),
  ];
  const out = [];
  for (const part of ordered) {
    const take = Math.min(left, part.count);
    left -= take;
    const rest = part.count - take;
    if (rest > 0) out.push({ printing: part.printing, count: rest });
  }
  return out;
}

// Session cache: oracle key → { cards, nextPage }
const printsCache = new Map();

function printsQuery(card) {
  const oracleId = card?.oracle_id || card?.card_faces?.[0]?.oracle_id;
  // game:paper — Cardmarket sells paper cards, digital-only printings
  // (Arena / MTGO) can't be bought there.
  if (oracleId) return `oracleid:${oracleId} game:paper`;
  return `!"${(card?.name || '').replace(/"/g, '')}" game:paper`;
}

/**
 * Load the paper printings of a card, newest first. Returns
 * `{ cards, hasMore, loadMore }`; `loadMore()` resolves to the same shape
 * with the next Scryfall page appended (basics have hundreds of prints).
 */
export async function fetchPrintings(card) {
  const q = printsQuery(card);
  const cached = printsCache.get(q);
  if (cached) return withLoadMore(q, cached);
  const url = `${SCRYFALL_SEARCH}?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc&include_extras=true`;
  const page = await fetchPage(url);
  const entry = { cards: page.cards, nextPage: page.nextPage };
  printsCache.set(q, entry);
  return withLoadMore(q, entry);
}

async function fetchPage(url) {
  const res = await fetch(url);
  if (res.status === 404) return { cards: [], nextPage: null };
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.details || `Scryfall error ${res.status}`);
  }
  const json = await res.json();
  return {
    cards: json.data || [],
    nextPage: json.has_more ? json.next_page : null,
  };
}

function withLoadMore(q, entry) {
  return {
    cards: entry.cards,
    hasMore: !!entry.nextPage,
    loadMore: async () => {
      if (!entry.nextPage) return withLoadMore(q, entry);
      const page = await fetchPage(entry.nextPage);
      const next = { cards: [...entry.cards, ...page.cards], nextPage: page.nextPage };
      printsCache.set(q, next);
      return withLoadMore(q, next);
    },
  };
}
