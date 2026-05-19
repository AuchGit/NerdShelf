// src/features/mtg/deck-builder/services/landPriceCache.js
//
// Live Cardmarket EUR prices for every land the suggester knows about
// (LAND_CATALOG + FIXING_LANDS + basics + Wastes). Resolved once via
// Scryfall's /cards/collection batch endpoint and cached in a module-
// level Map keyed by the canonical land NAME. The suggester uses these
// prices for cost calculation, swap-chain €-saved ranking and the
// budget slider — so what you see in the suggest modal matches what
// you pay on Cardmarket and what the deck-builder shows for the same
// card.
//
// Why a separate cache and not just the per-card cache from
// `useMtgInventory` / `scryfallCollection`? Those caches store the
// FULL Scryfall card object inline in mainboard entries. Lands the
// user hasn't added yet aren't there. We need preemptive pricing for
// every catalog candidate so the suggester can score them before any
// of them touch the deck.
//
// Cache strategy:
//   - First call → batches the missing names to Scryfall (75-per-call)
//   - Subsequent calls → return from cache without any network
//   - TTL: 24 h (prices wobble daily; one-call-per-day is plenty)
//   - Concurrent calls share the in-flight Promise
//   - On Scryfall error, the cache stays empty and the suggester
//     falls back to the catalog's hardcoded `priceEur` (the previous
//     behaviour) so we never break the modal even if offline.

import { resolveCardNames } from './deckImport';
import { getCardPriceEur } from './scryfall';
import {
  LAND_CATALOG_EXPORT as LAND_CATALOG,
  FIXING_LANDS_EXPORT as FIXING_LANDS,
  COLOR_TO_BASIC_EXPORT as COLOR_TO_BASIC,
} from './landSuggestion';

const TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map();    // name → { eur: number|null, ts: number }
// Runtime correction map: catalog has a pair-key the land sits under,
// but Scryfall's color_identity is the source of truth. Any mismatch
// is recorded here so the suggester picks lands per their REAL pair.
// Built incrementally as prices load; survives across modal opens.
const pairCorrections = new Map();   // name → actualPairCode like 'BU'
let inflight = null;        // shared Promise to dedupe concurrent loads

/** All names the suggester might reference. Built lazily so importing
 *  this module doesn't itself walk the entire catalog at load time. */
function allCatalogLandNames() {
  const set = new Set();
  for (const opts of Object.values(LAND_CATALOG)) {
    for (const o of opts) set.add(o.name);
  }
  for (const o of FIXING_LANDS) set.add(o.name);
  for (const c of Object.values(COLOR_TO_BASIC)) set.add(c);
  set.add('Wastes');
  return [...set];
}

/** Build a lookup of every land's catalog pair-key so the validator
 *  can compare it to Scryfall's actual color_identity. */
function buildCatalogPairIndex() {
  const out = new Map();
  for (const [pairKey, opts] of Object.entries(LAND_CATALOG)) {
    for (const o of opts) out.set(o.name, pairKey);
  }
  return out;
}

/** Auto-correct: every catalog land's pair-key is validated against
 *  Scryfall's color_identity. If they disagree (typo in the catalog,
 *  wrong-cycle classification, etc.) the actual color_identity wins
 *  and the override is recorded in `pairCorrections` for the
 *  suggester to read. Logs a console.warn so the developer notices.
 *  Triomes / basic-fetchers (FIXING_LANDS) are ignored here — they're
 *  multi-color and don't have a pair-key. */
function recordPairFromCard(name, card) {
  const ci = Array.isArray(card?.color_identity) ? card.color_identity : null;
  if (!ci || ci.length !== 2) return;
  const actualPair = [...ci].sort().join('');
  const catalogIndex = buildCatalogPairIndex();
  const catalogPair = catalogIndex.get(name);
  if (!catalogPair) return;     // not in the 2-color catalog (probably a fixer/basic)
  if (catalogPair === actualPair) return;
  if (pairCorrections.get(name) === actualPair) return;  // already corrected
  pairCorrections.set(name, actualPair);
  // eslint-disable-next-line no-console
  console.warn(
    `[landPriceCache] catalog says ${name} is ${catalogPair}, Scryfall says ${actualPair}. Overriding.`
  );
}

function isStale(entry, now) {
  return !entry || (now - entry.ts) > TTL_MS;
}

/**
 * Ensure prices for every catalog land are fetched (or cached).
 * Returns a Map<name, eur|null> ready for the suggester to consume.
 * Resolves quickly when everything is warm.
 */
export async function loadLandPrices() {
  const names = allCatalogLandNames();
  const now = Date.now();
  const stale = names.filter(n => isStale(cache.get(n), now));

  if (stale.length === 0) {
    return new Map(names.map(n => [n, cache.get(n)?.eur ?? null]));
  }
  if (inflight) {
    await inflight;
    return new Map(names.map(n => [n, cache.get(n)?.eur ?? null]));
  }

  inflight = (async () => {
    try {
      const resolved = await resolveCardNames(stale);
      // resolveCardNames returns names lowercased — we need to walk the
      // `found` list and match by lower-case → canonical name.
      const lowerToCanonical = new Map(stale.map(n => [n.toLowerCase(), n]));
      for (const { name, card } of (resolved.found || [])) {
        const canonical = lowerToCanonical.get(name) || card.name;
        const eur = getCardPriceEur(card);
        cache.set(canonical, { eur: eur != null ? eur : null, ts: now });
        recordPairFromCard(canonical, card);
      }
      // Names Scryfall couldn't resolve → cache as null so we don't
      // retry every render. They'll fall back to the catalog price.
      for (const miss of (resolved.notFound || [])) {
        const canonical = lowerToCanonical.get(miss) || miss;
        if (!cache.has(canonical)) {
          cache.set(canonical, { eur: null, ts: now });
        }
      }
    } catch (e) {
      // Network error / Scryfall down — leave the cache as-is so the
      // suggester just keeps using catalog prices.
      // eslint-disable-next-line no-console
      console.warn('[landPriceCache] failed to load prices:', e?.message || e);
    }
  })();

  await inflight;
  inflight = null;
  return new Map(names.map(n => [n, cache.get(n)?.eur ?? null]));
}

/** Synchronous lookup — returns whatever's currently cached. The
 *  suggester uses this every render; the async loader runs once at
 *  modal-open to warm the cache. */
export function getLivePrice(name) {
  const entry = cache.get(name);
  return entry ? entry.eur : null;
}

/** Build a Map of {name → eur} for every cached land. Returns an
 *  empty Map if the cache hasn't been warmed yet (suggester then
 *  falls back to catalog prices). */
export function snapshotLivePrices() {
  const out = new Map();
  for (const [name, entry] of cache) {
    if (entry.eur != null) out.set(name, entry.eur);
  }
  return out;
}

/** Snapshot of the runtime pair-corrections (land name → actual pair
 *  code as derived from Scryfall's color_identity). The suggester
 *  uses this to override the catalog's nested keying — that way a
 *  miscategorised land in `LAND_CATALOG[BG]` gets picked for its
 *  real pair (e.g. BU/Dimir) instead of polluting BG's allocation. */
export function snapshotPairCorrections() {
  return new Map(pairCorrections);
}
