import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCards } from '../services/scryfall';

export function useScryfall({
  query, searchMode, colors, colorMode, cardType, sortOrder, sortDir, showLands,
  rarity, cmcMin, cmcMax, subtype, format, setCode,
  // When set, overrides the colors/colorMode UI and constrains results to
  // the commander's color identity via Scryfall's `id<=` operator.
  commanderIdentity = null,
}) {
  const [cards,       setCards]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [hasMore,     setHasMore]     = useState(false);
  const [nextPageUrl, setNextPageUrl] = useState(null);
  const [totalCards,  setTotalCards]  = useState(0);

  const timerRef  = useRef(null);
  const colorsKey = colors.join(',');
  const ciKey     = commanderIdentity ? commanderIdentity.join(',') : '';

  const fetchCards = useCallback(async (params, append = false) => {
    setLoading(true);
    if (!append) setError(null);

    try {
      const result = await searchCards(params);
      if (!result) {
        setCards([]);
        setHasMore(false);
        setNextPageUrl(null);
        setTotalCards(0);
        return;
      }
      const data = result.data || [];
      setCards(prev => append ? [...prev, ...data] : data);
      setHasMore(result.has_more || false);
      setNextPageUrl(result.next_page || null);
      setTotalCards(result.total_cards || 0);
    } catch (err) {
      setError(err.message);
      if (!append) {
        setCards([]);
        setHasMore(false);
        setNextPageUrl(null);
        setTotalCards(0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced re-fetch whenever any filter/sort param changes
  useEffect(() => {
    const hasInput =
      query || colors.length > 0 || cardType || showLands ||
      rarity || cmcMin || cmcMax || subtype || format || setCode ||
      commanderIdentity;

    if (!hasInput) {
      setCards([]);
      setHasMore(false);
      setNextPageUrl(null);
      setTotalCards(0);
      setError(null);
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchCards({
        query, searchMode, colors, colorMode, cardType, sortOrder, sortDir, showLands,
        rarity, cmcMin, cmcMax, subtype, format, setCode,
        commanderIdentity,
      });
    }, 420);

    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchMode, colorsKey, colorMode, cardType, sortOrder, sortDir, showLands,
      rarity, cmcMin, cmcMax, subtype, format, setCode, ciKey]);

  const loadMore = useCallback(() => {
    if (nextPageUrl && !loading) {
      fetchCards({ nextPageUrl }, true);
    }
  }, [nextPageUrl, loading, fetchCards]);

  return { cards, loading, error, hasMore, totalCards, loadMore };
}
