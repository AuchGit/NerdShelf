// src/features/mtg/deck-builder/hooks/useLocalizedCard.js
//
// Returns the card as it should be SHOWN: the same card, with the images
// (and printed texts) of the chosen card language when that printing
// exists in it. English — the default — hands the card straight back, so
// nothing is fetched and nothing changes.
//
// Used where the user actually reads a card: the preview panel and the
// full-screen viewer. Grids keep the English thumbnails; translating a
// whole page of results would mean one request per card for no real gain.

import { useEffect, useState } from 'react';
import {
  useCardLanguage, cachedLocalized, fetchLocalized, mergeLocalized,
} from '../services/cardLanguage';

export default function useLocalizedCard(card) {
  const lang = useCardLanguage();
  const key = card && lang !== 'en' && card.set && card.collector_number
    ? `${card.set}/${card.collector_number}/${lang}`
    : null;

  const [loaded, setLoaded] = useState({ key: null, card: null });

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    fetchLocalized(card, lang).then(localized => {
      if (!cancelled) setLoaded({ key, card: localized });
    });
    return () => { cancelled = true; };
  }, [key, card, lang]);

  if (!key) return card;
  const localized = loaded.key === key ? loaded.card : cachedLocalized(card, lang);
  return localized ? mergeLocalized(card, localized) : card;
}
