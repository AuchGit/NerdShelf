// src/features/mtg/deck-builder/services/deckTokens.js
//
// Tokens a deck needs. Scryfall links every card to the tokens it creates
// through `all_parts` (component 'token', pointing at one token printing).
// The full token cards are fetched once per session; identical tokens
// referenced by different cards (same oracle id, other printing) are merged.
//
// A deck stores only the wanted count per token (`data.tokens`, keyed by
// the token's oracle id); tokens without a stored count default to 1.
//
// Besides real tokens a deck often needs helper cards: the "Day // Night"
// indicator for werewolves, "Energy Reserve" for energy counters, dungeon
// cards. Scryfall files those as `combo_piece`, not `token` — but unlike
// the other combo pieces (the card itself, meld partners) they carry a
// bare "Card" / "Emblem" / "Dungeon" type line, which is what we match on.

import { fetchCardsByIds } from './scryfallCollection';

const cache = new Map(); // token printing id → full Scryfall card

// "Card", "Card // Card", "Emblem — Jace Beleren", "Dungeon" — never a
// real card's type line ("Legendary Artifact", "Creature — Human …").
const HELPER_TYPE = /^(card|emblem|dungeon)\b/i;

/** Does this `all_parts` entry describe something the deck needs alongside? */
function isNeededPart(part, card) {
  if (!part?.id || part.id === card?.id) return false;
  if (part.component === 'token') return true;
  if (part.component !== 'combo_piece') return false;
  // The card's own entry — same name, different printing id.
  if (part.name && card?.name && part.name === card.name) return false;
  const type = part.type_line || '';
  if (!type) return false;
  return type.split('//').every(t => HELPER_TYPE.test(t.trim()));
}

/**
 * @param {object[]} zones      deck zones ({ [id]: { card, count } })
 * @param {object}   [commander]
 * @param {(id: string) => boolean} [include]  filter on entry ids
 * @returns {Map<string, { name, type_line, sources: Set<string> }>} by token printing id
 */
export function collectTokenRefs(zones, commander, include = null) {
  const refs = new Map();
  const add = (card) => {
    for (const part of card?.all_parts || []) {
      if (!isNeededPart(part, card)) continue;
      let ref = refs.get(part.id);
      if (!ref) refs.set(part.id, (ref = { name: part.name, type_line: part.type_line, sources: new Set() }));
      if (card.name) ref.sources.add(card.name);
    }
  };
  for (const zone of zones) {
    for (const [id, entry] of Object.entries(zone || {})) {
      if (include && !include(id)) continue;
      add(entry?.card);
    }
  }
  if (commander && (!include || include(commander.id))) add(commander);
  return refs;
}

/** Token cards already fetched this session. */
export function cachedTokenCards(ids) {
  const out = new Map();
  for (const id of ids) if (cache.has(id)) out.set(id, cache.get(id));
  return out;
}

export async function loadTokenCards(ids) {
  const missing = [...new Set(ids)].filter(id => !cache.has(id));
  if (missing.length > 0) {
    const cards = await fetchCardsByIds(missing);
    for (const c of cards) cache.set(c.id, c);
  }
  return cachedTokenCards(ids);
}

export function tokenKeyOf(card, fallbackId) {
  return card?.oracle_id || card?.card_faces?.[0]?.oracle_id || fallbackId;
}

/**
 * Merge refs into one row per token.
 * @returns {{ key, card, sources: string[], count }[]} sorted by name
 */
export function groupDeckTokens(refs, tokenCards, counts = {}) {
  const byKey = new Map();
  for (const [id, ref] of refs) {
    const card = tokenCards.get(id);
    if (!card) continue;
    const key = tokenKeyOf(card, id);
    let row = byKey.get(key);
    if (!row) byKey.set(key, (row = { key, card, sources: new Set() }));
    for (const s of ref.sources) row.sources.add(s);
  }
  return [...byKey.values()]
    .map(r => ({ key: r.key, card: r.card, sources: [...r.sources].sort(), count: counts[r.key] ?? 1 }))
    .sort((a, b) => a.card.name.localeCompare(b.card.name));
}
