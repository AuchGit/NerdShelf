// src/features/mtg/deck-builder/services/deckVisibility.js
//
// Whether a NEW deck starts out shared with every NerdShelf user. Set in
// the MTG settings; each deck can still be switched on its dashboard tile
// afterwards. This describes the person, not the screen, so it travels
// with the account (shared/settings/syncedSettings).

import { useSyncExternalStore } from 'react';
import { markSettingsDirty, onRemoteSettings } from '../../../../shared/settings/syncedSettings';

const STORAGE_KEY = 'mtg:decks-public-default';

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

let current = readStored();
const listeners = new Set();
const notify = () => { for (const l of listeners) l(); };

export function getPublicByDefault() {
  return current;
}

export function setPublicByDefault(value) {
  const next = !!value;
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  notify();
  markSettingsDirty();
}

// Changed on another device — adopt it without a reload.
onRemoteSettings(STORAGE_KEY, () => {
  current = readStored();
  notify();
});

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePublicByDefault() {
  return useSyncExternalStore(subscribe, getPublicByDefault, () => false);
}

/**
 * Extra columns for inserting a new deck. Only says something when the
 * default is ON — private is the database default anyway, and leaving the
 * column out keeps saving working on a database that hasn't got it yet
 * (scripts/mtg-public-decks.sql).
 */
export function newDeckVisibility() {
  return current ? { is_public: true } : {};
}
