// src/features/mtg/deck-builder/hooks/useDeckTokens.js
//
// Tokens created by the cards of a deck (see services/deckTokens.js).
// Returns { list, zone, sources, loading }:
//   list    — [{ key, card, sources, count }]
//   zone    — { [key]: { key, card, count } }, shaped like a deck zone
//   sources — { [key]: [card names creating it] }

import { useEffect, useMemo, useState } from 'react';
import {
  collectTokenRefs, cachedTokenCards, loadTokenCards, groupDeckTokens,
} from '../services/deckTokens';

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

  const ready = loaded.key === idsKey && loaded.cards;
  const cards = ready ? loaded.cards : cachedTokenCards(refs.keys());

  return useMemo(() => {
    const list = groupDeckTokens(refs, cards, counts || {});
    const zone = {};
    const sources = {};
    for (const t of list) {
      zone[t.key] = { key: t.key, card: t.card, count: t.count };
      sources[t.key] = t.sources;
    }
    return { list, zone, sources, loading: !!idsKey && !ready };
  }, [refs, cards, counts, idsKey, ready]);
}
