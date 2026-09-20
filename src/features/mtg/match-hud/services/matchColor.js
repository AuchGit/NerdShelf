// src/features/mtg/match-hud/services/matchColor.js
//
// The colour you start with in the Match HUD — when you open a match and
// when you join one. Each match can still be changed afterwards from your
// own tile; this is only the starting point.
//
// Belongs to the person, not the screen, so it travels with the account
// (shared/settings/syncedSettings).

import { useSyncExternalStore } from 'react';
import { markSettingsDirty, onRemoteSettings } from '../../../../shared/settings/syncedSettings';
import { isValidPlayerColor } from './playerColors';

const STORAGE_KEY = 'mtg:match-color';
const FALLBACK = 'red';

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isValidPlayerColor(value) ? value : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

let current = readStored();
const listeners = new Set();
const notify = () => { for (const l of listeners) l(); };

export function getMatchColor() {
  return current;
}

export function setMatchColor(value) {
  const next = isValidPlayerColor(value) ? value : FALLBACK;
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
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

export function useMatchColor() {
  return useSyncExternalStore(subscribe, getMatchColor, () => FALLBACK);
}
