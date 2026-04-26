import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import { useAuth } from '../../../../core/auth/AuthContext';

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const COLLECTION_BATCH_SIZE = 75;

async function fetchCardsByIds(ids) {
  if (ids.length === 0) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += COLLECTION_BATCH_SIZE) {
    const slice = ids.slice(i, i + COLLECTION_BATCH_SIZE);
    const res = await fetch(SCRYFALL_COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifiers: slice.map(id => ({ id })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Scryfall collection error ${res.status}`);
    }
    const json = await res.json();
    if (Array.isArray(json.data)) out.push(...json.data);
  }
  return out;
}

/**
 * Manages a user's favorite cards.
 * - `favorites` is a Set<scryfall_id> for O(1) lookup
 * - `favoriteCards` is the full Scryfall card data, fetched lazily on first need
 * - `toggleFavorite(card)` does an optimistic update; on error, the change is rolled back
 */
export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(() => new Set());
  const [favoriteCards, setFavoriteCards] = useState(null); // null = not yet fetched
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const cardCacheRef = useRef(new Map()); // scryfall_id -> full card

  // Load favorites from Supabase on user change
  useEffect(() => {
    if (!user) {
      setFavorites(new Set());
      setFavoriteCards(null);
      cardCacheRef.current = new Map();
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('mtg_favorites')
        .select('scryfall_id')
        .eq('user_id', user.id);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setFavorites(new Set((data || []).map(r => r.scryfall_id)));
      setFavoriteCards(null); // invalidate, will refetch on demand
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const isFavorite = useCallback(
    (scryfallId) => favorites.has(scryfallId),
    [favorites]
  );

  const toggleFavorite = useCallback(async (card) => {
    if (!user || !card?.id) return;
    const scryfallId = card.id;
    const wasFavorite = favorites.has(scryfallId);

    // Optimistic update
    setFavorites(prev => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(scryfallId);
      else next.add(scryfallId);
      return next;
    });
    if (wasFavorite) {
      cardCacheRef.current.delete(scryfallId);
      setFavoriteCards(prev => prev ? prev.filter(c => c.id !== scryfallId) : prev);
    } else {
      cardCacheRef.current.set(scryfallId, card);
      setFavoriteCards(prev => prev ? [...prev, card] : prev);
    }

    let result;
    if (wasFavorite) {
      result = await supabase
        .from('mtg_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('scryfall_id', scryfallId);
    } else {
      result = await supabase
        .from('mtg_favorites')
        .insert({
          user_id: user.id,
          scryfall_id: scryfallId,
          card_name: card.name || '',
        });
    }

    if (result.error) {
      // Rollback
      setFavorites(prev => {
        const next = new Set(prev);
        if (wasFavorite) next.add(scryfallId);
        else next.delete(scryfallId);
        return next;
      });
      if (wasFavorite) {
        cardCacheRef.current.set(scryfallId, card);
        setFavoriteCards(prev => prev ? [...prev, card] : prev);
      } else {
        cardCacheRef.current.delete(scryfallId);
        setFavoriteCards(prev => prev ? prev.filter(c => c.id !== scryfallId) : prev);
      }
      setError(result.error.message);
    }
  }, [user, favorites]);

  /** Fetch full card data for all favorites. Idempotent — caches results. */
  const loadFavoriteCards = useCallback(async () => {
    if (!user) return;
    const ids = [...favorites];
    const missing = ids.filter(id => !cardCacheRef.current.has(id));
    if (missing.length === 0) {
      // Already fully cached — rebuild array from cache in case ids changed
      const arr = ids.map(id => cardCacheRef.current.get(id)).filter(Boolean);
      setFavoriteCards(arr);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchCardsByIds(missing);
      for (const c of fetched) cardCacheRef.current.set(c.id, c);
      const arr = ids.map(id => cardCacheRef.current.get(id)).filter(Boolean);
      setFavoriteCards(arr);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, favorites]);

  return {
    favorites,
    favoriteCards,
    isFavorite,
    toggleFavorite,
    loadFavoriteCards,
    loading,
    error,
  };
}
