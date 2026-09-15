// src/features/mtg/deck-builder/services/ownedCopies.js
//
// Match a deck's demand against the collection.
//
// The collection stores one row per Scryfall printing id (plus the card
// name as label). A deck entry is keyed by the printing that was added,
// and may carry a chosen artwork (see deckPrintings.js). Rules:
//
//   - Fixed artwork  → only copies of exactly that printing count, so the
//                      wishlist / Cardmarket export asks for that artwork.
//   - No fixed art   → any printing of the same card counts (matched by
//                      name, or by the entry's own id for unlabeled rows).
//
// Copies of a fixed printing that aren't needed for it can still cover
// demand without a fixed artwork.

/**
 * @param {Map<string, number>} quantities printing id → qty
 * @param {Map<string, string>} [labels]   printing id → card name
 */
export function buildOwnedIndex(quantities, labels) {
  const byName = new Map(); // lowercased name → Map(printing id → qty)
  for (const [id, qty] of quantities || []) {
    const name = normalizeName(labels?.get(id));
    if (!name || !(qty > 0)) continue;
    let copies = byName.get(name);
    if (!copies) byName.set(name, (copies = new Map()));
    copies.set(id, qty);
  }
  return { quantities: quantities || new Map(), byName };
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

/** All owned copies of a card: Map(printing id → qty). */
export function ownedCopiesOf(index, cardId, name) {
  const out = new Map();
  const own = index?.quantities?.get(cardId);
  if (own > 0) out.set(cardId, own);
  const same = index?.byName?.get(normalizeName(name));
  if (same) for (const [id, qty] of same) out.set(id, qty);
  return out;
}

export function totalCopies(copies) {
  let n = 0;
  for (const qty of copies.values()) n += qty;
  return n;
}

/**
 * Take owned copies off the demand.
 * @param {{printing: object|null, count: number}[]} parts
 * @param {Map<string, number>} copies  from ownedCopiesOf
 * @returns {{printing: object|null, count: number}[]} still missing (> 0 only)
 */
export function allocateOwnedCopies(parts, copies) {
  const left = new Map(copies);
  const missing = [];
  for (const part of parts) {
    if (!part.printing) continue;
    const have = left.get(part.printing.id) || 0;
    const take = Math.min(have, part.count);
    if (take > 0) left.set(part.printing.id, have - take);
    if (part.count - take > 0) missing.push({ printing: part.printing, count: part.count - take });
  }
  let pool = totalCopies(left);
  for (const part of parts) {
    if (part.printing) continue;
    const take = Math.min(pool, part.count);
    pool -= take;
    if (part.count - take > 0) missing.push({ printing: null, count: part.count - take });
  }
  return missing;
}
