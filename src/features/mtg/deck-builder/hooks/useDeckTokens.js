// src/features/mtg/deck-builder/hooks/useDeckTokens.js
//
// Tokens created by the cards of a deck (see services/deckTokens.js).
// Returns { list, zone, sources, loading }:
//   list    — [{ key, card, sources, count }]
//   zone    — { [key]: { key, card, count } }, shaped like a deck zone
//   sources — { [key]: [card names creating it] }
//
// Two tokens printed back to back on one card show up as ONE entry. Which
// two share a card isn't in the Scryfall data — it only follows from
// Cardmarket's product names, so the product map is loaded alongside.

import { useEffect, useMemo, useState } from 'react';
import {
  collectTokenRefs, cachedTokenCards, loadTokenCards, groupDeckTokens, mergeTokenPairs,
} from '../services/deckTokens';
import { loadCardmarketMap, cardmarketTokenPairs } from '../services/cardmarketMap';

export function useDeckTokens(mainboard, sideboard, commander, counts) {
  const refs = useMemo(
    () => collectTokenRefs([mainboard, sideboard], commander),
    [mainboard, sideboard, commander]
  );
  const idsKey = useMemo(() => [...refs.keys()].sort().join('|'), [refs]);
  const [loaded, setLoaded] = useState({ key: '', cards: null });

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    loadTokenCards(idsKey.split('|'))
      .then(cards => { if (!cancelled) setLoaded({ key: idsKey, cards }); })
      .catch(() => { /* tokens stay hidden; the deck works without them */ });
    return () => { cancelled = true; };
  }, [idsKey]);

  // Cached for the session after the first deck that needs it.
  const [productMap, setProductMap] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadCardmarketMap()
      .then(map => { if (!cancelled) setProductMap(map); })
      .catch(() => { /* no map — tokens stay listed one per side */ });
    return () => { cancelled = true; };
  }, []);

  const ready = loaded.key === idsKey && loaded.cards;
  const cards = ready ? loaded.cards : cachedTokenCards(refs.keys());

  return useMemo(() => {
    const rows = groupDeckTokens(refs, cards, counts || {});
    const pairs = productMap
      ? cardmarketTokenPairs(
        productMap,
        rows.map(r => ({ key: r.key, card: r.card, qty: r.count })),
      )
      : null;
    const list = mergeTokenPairs(rows, pairs);

    const zone = {};
    const sources = {};
    for (const t of list) {
      zone[t.key] = {
        key: t.key,
        card: t.card,
        count: t.count,
        // Present only on a merged row — the app writes the count to both.
        keys: t.keys,
        partnerCard: t.partnerCard,
        productName: t.productName,
      };
      sources[t.key] = t.sources;
    }
    return { list, zone, sources, loading: !!idsKey && !ready };
  }, [refs, cards, counts, idsKey, ready, productMap]);
}
