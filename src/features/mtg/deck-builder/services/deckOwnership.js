// src/features/mtg/deck-builder/services/deckOwnership.js
//
// How much of a deck is already in the collection — and what is missing.
//
// Two numbers, because one copy can serve several decks:
//
//   shared    — the collection is shared between decks. A single Sol Ring
//               covers every deck that wants one. This is how the wishlist
//               and the Cardmarket export count by default.
//   exclusive — every deck keeps its own copies. The other decks are served
//               first, so this says: if nobody lends anything, how much of
//               this deck is covered?
//
// Cards are matched by NAME, because that is how the collection matches
// them (see ownedCopies.js): any printing of a card counts unless the deck
// fixed an artwork.

import { ownedCopiesOf, totalCopies } from './ownedCopies';

/** The zones that make up the deck proper. Ideas are a wishlist pool. */
function deckEntries(data) {
  const out = [];
  for (const zone of [data?.mainboard, data?.sideboard]) {
    for (const [id, entry] of Object.entries(zone || {})) {
      if (entry?.count > 0) out.push({ id, card: entry.card, count: entry.count });
    }
  }
  if (data?.commander?.id) {
    out.push({ id: data.commander.id, card: data.commander, count: 1 });
  }
  return out;
}

const keyOf = (card, fallbackId) =>
  (card?.name || '').trim().toLowerCase() || fallbackId;

/**
 * What one deck needs, keyed the way the collection matches.
 * @returns {Map<string, {name: string, anyId: string, count: number}>}
 */
export function deckDemand(data) {
  const demand = new Map();
  for (const entry of deckEntries(data)) {
    const key = keyOf(entry.card, entry.id);
    const row = demand.get(key);
    if (row) row.count += entry.count;
    else demand.set(key, { name: entry.card?.name || '', anyId: entry.id, count: entry.count });
  }
  return demand;
}

/** Everything every deck wants, so one deck can ask what's left for it. */
export function totalDemandAcross(decks) {
  const total = new Map();
  for (const deck of decks || []) {
    for (const [key, row] of deckDemand(deck?.data || {})) {
      total.set(key, (total.get(key) || 0) + row.count);
    }
  }
  return total;
}

/**
 * @param {object} data        one deck's `data`
 * @param {object} ownedIndex  from buildOwnedIndex
 * @param {Map} totalDemand    from totalDemandAcross (all decks, this one included)
 * @returns {{needed: number, shared: number, exclusive: number}}
 */
export function deckOwnershipCounts(data, ownedIndex, totalDemand) {
  let needed = 0;
  let shared = 0;
  let exclusive = 0;
  for (const [key, row] of deckDemand(data)) {
    const owned = totalCopies(ownedCopiesOf(ownedIndex, row.anyId, row.name));
    // What the other decks lay claim to first.
    const claimedElsewhere = Math.max(0, (totalDemand?.get(key) || row.count) - row.count);
    needed += row.count;
    shared += Math.min(row.count, owned);
    exclusive += Math.min(row.count, Math.max(0, owned - claimedElsewhere));
  }
  return { needed, shared, exclusive };
}

/**
 * The copies to add so the whole deck sits in the collection. A card with a
 * chosen artwork is added as exactly that printing; everything else goes in
 * under the printing the deck holds.
 * @returns {{id: string, name: string, add: number}[]}
 */
export function missingForCollection(data, ownedIndex) {
  const printings = data?.printings || {};
  const byKey = new Map();
  for (const entry of deckEntries(data)) {
    const key = keyOf(entry.card, entry.id);
    const target = printings[entry.id]?.id || entry.id;
    const row = byKey.get(key);
    if (row) {
      row.count += entry.count;
      // A fixed artwork wins as the row to top up.
      if (printings[entry.id]?.id) row.id = target;
    } else {
      byKey.set(key, { id: target, name: entry.card?.name || '', count: entry.count });
    }
  }

  const out = [];
  for (const [, row] of byKey) {
    const owned = totalCopies(ownedCopiesOf(ownedIndex, row.id, row.name));
    const add = row.count - owned;
    if (add > 0) out.push({ id: row.id, name: row.name, add });
  }
  return out;
}
