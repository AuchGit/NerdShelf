// src/features/mtg/deck-builder/hooks/useMtgInventory.js
//
// MTG-flavoured inventory hook. Composes the shared `useInventory` core
// (Supabase persistence keyed by mtg_inventory + kind='collection') with
// an MTG-specific addition: a lazy bulk-fetch of full Scryfall card data
// for every owned card.
//
// `loadOwnedCards()` mirrors the corresponding flow in useFavorites — it's
// what powers the deck-builder's "Karten aus Sammlung" toggle, so the user
// sees their entire collection regardless of the current Scryfall search.
//
// See scripts/split-nerdshelf-tables.sql for the table shape.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInventory } from '../../../../shared/inventory';
import { fetchCardsByIds } from '../services/scryfallCollection';

export function useMtgInventory() {
  const core = useInventory({ table: 'mtg_inventory', kind: 'collection' });

  // Full-card cache and the resolved list used by the deck-builder when
  // showing "owned cards only". `null` means "not loaded yet" — flipping
  // to an array (even an empty one) means the bulk fetch is done.
  const [ownedCards, setOwnedCards] = useState(null);
  const [ownedCardsLoading, setOwnedCardsLoading] = useState(false);
  const [ownedCardsError, setOwnedCardsError] = useState(null);
  const cacheRef = useRef(new Map()); // id -> card

  // Whenever the owned-id set changes (add/remove from collection),
  // invalidate the resolved list so the next consumer triggers a refresh.
  const ownedIdsKey = useMemo(
    () => [...core.quantities.keys()].sort().join('|'),
    [core.quantities]
  );
  useEffect(() => { setOwnedCards(null); }, [ownedIdsKey]);

  /**
   * Resolve every owned id to its full Scryfall card object. Idempotent —
   * uses an internal cache so re-toggling the deck-builder filter doesn't
   * re-hit the Scryfall API.
   */
  const loadOwnedCards = useCallback(async () => {
    const ids = [...core.quantities.keys()];
    const missing = ids.filter(id => !cacheRef.current.has(id));
    if (missing.length === 0) {
      const arr = ids.map(id => cacheRef.current.get(id)).filter(Boolean);
      setOwnedCards(arr);
      return;
    }
    setOwnedCardsLoading(true);
    setOwnedCardsError(null);
    try {
      const fetched = await fetchCardsByIds(missing);
      for (const c of fetched) cacheRef.current.set(c.id, c);
      const arr = ids.map(id => cacheRef.current.get(id)).filter(Boolean);
      setOwnedCards(arr);
    } catch (e) {
      setOwnedCardsError(e.message);
    } finally {
      setOwnedCardsLoading(false);
    }
  }, [core.quantities]);

  return {
    ...core,
    ownedCards,
    ownedCardsLoading,
    ownedCardsError,
    loadOwnedCards,
  };
}
