// src/features/mtg/deck-builder/services/cardLanguage.js
//
// Card language for everything the user *looks at*. Scryfall prints most
// cards in ten other languages and serves the localised card under
// `/cards/:set/:collector_number/:lang`.
//
// Only the display swaps. Deck data, the collection, the wishlist and the
// Cardmarket mapping all stay on the English card — its Scryfall id is the
// key every one of those uses, and Cardmarket's product names are English
// too. A printing that doesn't exist in the chosen language simply keeps
// its English images, which is also what Cardmarket would ship.
//
// The setting belongs to the account and follows the user from device to
// device (see shared/settings/syncedSettings). It lives outside the deck
// builder's SettingsContext so the app-wide settings dialog can reach it.

import { useSyncExternalStore } from 'react';
import { markSettingsDirty, onRemoteSettings } from '../../../../shared/settings/syncedSettings';

const BASE = 'https://api.scryfall.com/cards';
const STORAGE_KEY = 'mtg:card-language';

/** Languages Scryfall prints cards in (`lang:` codes). */
export const CARD_LANGUAGES = [
  { value: 'en',  label: 'Englisch (Original)' },
  { value: 'de',  label: 'Deutsch' },
  { value: 'fr',  label: 'Französisch' },
  { value: 'it',  label: 'Italienisch' },
  { value: 'es',  label: 'Spanisch' },
  { value: 'pt',  label: 'Portugiesisch' },
  { value: 'ja',  label: 'Japanisch' },
  { value: 'ko',  label: 'Koreanisch' },
  { value: 'ru',  label: 'Russisch' },
  { value: 'zhs', label: 'Chinesisch (vereinfacht)' },
  { value: 'zht', label: 'Chinesisch (traditionell)' },
];

const isKnown = (lang) => CARD_LANGUAGES.some(l => l.value === lang);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isKnown(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

let current = readStored();
const listeners = new Set();

export function getCardLanguage() {
  return current;
}

export function setCardLanguage(lang) {
  const next = isKnown(lang) ? lang : 'en';
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  for (const l of listeners) l();
  markSettingsDirty();
}

// Changed on another device — adopt it without a reload.
onRemoteSettings(STORAGE_KEY, () => {
  current = readStored();
  for (const l of listeners) l();
});

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen language, re-rendering the caller when it changes. */
export function useCardLanguage() {
  return useSyncExternalStore(subscribe, getCardLanguage, () => 'en');
}

// ── Localised printings ───────────────────────────────────────────────
// Cached for the session; `null` is cached too, so a printing that has no
// translation is asked for exactly once.

const cache = new Map();    // "set/cn/lang" → card | null
const inflight = new Map();

function keyOf(card, lang) {
  if (!lang || lang === 'en') return null;
  const set = card?.set;
  const cn = card?.collector_number;
  if (!set || !cn) return null;
  return `${set}/${encodeURIComponent(cn)}/${lang}`;
}

/** Localised printing already in the session cache, or null. */
export function cachedLocalized(card, lang) {
  const key = keyOf(card, lang);
  return key ? (cache.get(key) || null) : null;
}

/** Fetch (once) the localised printing of a card. Resolves to null when
 *  the printing doesn't exist in that language. */
export function fetchLocalized(card, lang) {
  const key = keyOf(card, lang);
  if (!key) return Promise.resolve(null);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  const promise = fetch(`${BASE}/${key}`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(localized => {
      cache.set(key, localized);
      inflight.delete(key);
      return localized;
    });
  inflight.set(key, promise);
  return promise;
}

function mergeFaces(faces, localizedFaces) {
  if (!Array.isArray(faces) || !Array.isArray(localizedFaces)) return faces;
  return faces.map((face, i) => {
    const loc = localizedFaces[i];
    if (!loc) return face;
    return {
      ...face,
      image_uris: loc.image_uris || face.image_uris,
      printed_name: loc.printed_name || loc.name || null,
      printed_type_line: loc.printed_type_line || null,
      printed_text: loc.printed_text || null,
    };
  });
}

/**
 * Overlay a localised printing onto the English card: images and the
 * printed texts only. Id, name, oracle data, set and prices stay English,
 * so everything keyed on them keeps working.
 */
export function mergeLocalized(card, localized) {
  if (!card || !localized) return card;
  return {
    ...card,
    image_uris: localized.image_uris || card.image_uris,
    card_faces: mergeFaces(card.card_faces, localized.card_faces),
    printed_name: localized.printed_name || null,
    printed_type_line: localized.printed_type_line || null,
    printed_text: localized.printed_text || null,
    _lang: localized.lang,
  };
}
