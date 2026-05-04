// src/features/mtg/deck-builder/services/applyLandSuggestion.js
//
// Resolves suggested land names (e.g. "Plains", "Azorius Guildgate") to real
// Scryfall card objects via the same /cards/collection endpoint used by the
// importer, then merges them into a mainboard map.

import { resolveCardNames } from './deckImport';
import { isLand } from './deckAnalysis';

/** Scryfall's /cards/collection requires the FULL card name. For double-faced
 *  cards (e.g. Pathway lands) that's the combined "Front // Back" name, so a
 *  front-face lookup ("Brightclimb Pathway") fails there. /cards/named with
 *  ?exact= and ?fuzzy= resolves the front face correctly, so we use it as a
 *  per-name fallback for anything the batch lookup missed. */
async function resolveByFrontFaceName(name) {
  const tryFetch = async (param) => {
    const url = `https://api.scryfall.com/cards/named?${param}=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  };
  // Exact first (cheap, deterministic), fuzzy as a last resort for typos.
  return (await tryFetch('exact')) || (await tryFetch('fuzzy'));
}

/**
 * Build a fresh mainboard with non-land cards preserved and the suggested
 * land breakdown materialised into real Scryfall card entries.
 *
 * @param {Object} mainboard           Current mainboard.
 * @param {Object} breakdown           { "Plains": 10, "Azorius Guildgate": 4, ... }
 * @returns {Promise<{ mainboard, missing }>}
 */
export async function applyLandBreakdown(mainboard, breakdown) {
  const names = Object.keys(breakdown).filter(n => (breakdown[n] || 0) > 0);
  if (names.length === 0) {
    return { mainboard, missing: [] };
  }

  const resolved = await resolveCardNames(names);
  const byName = new Map();
  for (const { name, card } of resolved.found) byName.set(name, card);

  // Per-name fallback for anything the batch lookup missed (DFCs, etc).
  const stillMissing = names.filter(n => !byName.has(n.toLowerCase()));
  for (const name of stillMissing) {
    try {
      const card = await resolveByFrontFaceName(name);
      if (card && card.id) byName.set(name.toLowerCase(), card);
    } catch { /* keep in missing list */ }
    // gentle throttle for Scryfall
    if (stillMissing.length > 1) await new Promise(r => setTimeout(r, 80));
  }

  // Strip existing lands so we don't double up.
  const next = {};
  for (const [id, entry] of Object.entries(mainboard || {})) {
    if (!isLand(entry.card)) next[id] = entry;
  }

  const missing = [];
  for (const name of names) {
    const card = byName.get(name.toLowerCase());
    const count = breakdown[name];
    if (!card) {
      missing.push(name);
      continue;
    }
    const existing = next[card.id];
    next[card.id] = existing
      ? { card, count: existing.count + count }
      : { card, count };
  }

  return { mainboard: next, missing };
}
