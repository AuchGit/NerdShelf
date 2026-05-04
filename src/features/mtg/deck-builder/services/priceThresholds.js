// src/features/mtg/deck-builder/services/priceThresholds.js
//
// User-configurable price thresholds (single card / whole deck) shared
// between the global Settings modal, the deck dashboard, and the deck
// builder. Stored in localStorage; React consumers subscribe via the
// `useMtgPriceSettings` hook so updates propagate within the same window.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'mtg-price-thresholds';
const EVENT_NAME = 'mtg-price-thresholds-change';

const DEFAULTS = {
  cardEnabled: false,
  cardThresholdEur: 20,
  deckEnabled: false,
  deckThresholdEur: 100,
};

function readRaw() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {
    return { ...DEFAULTS };
  }
}

let cached = null;

export function getMtgPriceSettings() {
  if (cached) return cached;
  cached = readRaw();
  return cached;
}

export function setMtgPriceSettings(patch) {
  const next = { ...getMtgPriceSettings(), ...patch };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  return next;
}

function subscribe(cb) {
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  // also sync across tabs via the standard storage event
  const storageHandler = (e) => {
    if (e.key === STORAGE_KEY) {
      cached = readRaw();
      cb();
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

function getSnapshot() {
  return getMtgPriceSettings();
}

export function useMtgPriceSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Imperative invalidate (used by tests / hot-reload). */
export function _resetMtgPriceCache() {
  cached = null;
}

/** Compute the EUR price total for a deck object stored in supabase
 *  (i.e. with `data.mainboard`, `data.sideboard`, `data.commander`). */
export function computeDeckEur(deckRow) {
  const data = deckRow?.data || {};
  const eurOf = (card) => {
    const raw = card?.prices?.eur ?? card?.prices?.eur_foil;
    const n = raw == null ? null : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const sumEur = (entries) =>
    Object.values(entries || {}).reduce((s, e) => {
      const p = eurOf(e?.card);
      return p != null ? s + p * (e.count || 0) : s;
    }, 0);
  return (
    sumEur(data.mainboard) +
    sumEur(data.sideboard) +
    (data.commander ? (eurOf(data.commander) || 0) : 0)
  );
}

