// src/features/mtg/deck-builder/services/sharedDecks.js
//
// "Mit mir geteilt" brings two sources together: decks the user imported
// by token or link, and decks their owners shared with everybody. A deck
// can be both — imported earlier, made public later — and then shows once.
//
// Pure, so it can be tested without a database.

/**
 * @param {object[]} imported     decks reached through an import
 * @param {object[]} publicDecks  decks their owners made public
 * @returns {object[]} imported first (the user asked for those), then the
 *   public ones not already in the list
 */
export function mergeSharedDecks(imported = [], publicDecks = []) {
  const seen = new Set();
  const out = [];
  for (const deck of [...(imported || []), ...(publicDecks || [])]) {
    if (!deck?.id || seen.has(deck.id)) continue;
    seen.add(deck.id);
    out.push(deck);
  }
  return out;
}
