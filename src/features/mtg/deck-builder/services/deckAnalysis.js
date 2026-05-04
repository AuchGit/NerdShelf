// src/features/mtg/deck-builder/services/deckAnalysis.js
//
// Pure deck-analysis helpers used by the land suggester and consistency
// simulator. No UI, no I/O — feed it a mainboard map keyed by card.id and
// you get back pip counts, color distribution, average CMC, and ramp count.

import { getManaCost, parseManaCost } from './scryfall';

export const COLORS = ['W', 'U', 'B', 'R', 'G'];

export function isLand(card) {
  return /Land/.test(card?.type_line || '');
}

export function isBasicLand(card) {
  const t = card?.type_line || '';
  return t.includes('Basic') && t.includes('Land');
}

/** Count colored mana symbols in a single card's mana cost. Hybrid pips
 *  contribute 1/n to each constituent color. Generic, X, and {C} are ignored. */
function parseCardPips(card) {
  const cost = getManaCost(card);
  const syms = parseManaCost(cost);
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const raw of syms) {
    const s = raw.toUpperCase();
    if (s.includes('/')) {
      const parts = s.split('/').filter(p => COLORS.includes(p));
      if (parts.length === 0) continue;
      const w = 1 / parts.length;
      for (const p of parts) pips[p] += w;
      continue;
    }
    if (COLORS.includes(s)) pips[s] += 1;
  }
  return pips;
}

/** Heuristic: a non-land card that adds mana or fetches a basic land. */
export function isRampCard(card) {
  if (isLand(card)) return false;
  const text = (card?.oracle_text || '').toLowerCase();
  if (/add \{[^}]+\}/i.test(text)) return true;
  if (/search your library for (?:up to \w+ )?(?:basic )?(?:land|forest|plains|island|swamp|mountain)/i.test(text)) return true;
  return false;
}

/** Build a flat analysis snapshot of the mainboard. Commander (if provided)
 *  contributes its color identity to the pip totals so a commander deck never
 *  reports zero demand for the commander's colors. */
export function analyzeDeck(mainboard, commander = null) {
  const entries = Object.values(mainboard || {});
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let nonLandCount = 0;
  let landCount = 0;
  let totalCount = 0;
  let cmcSum = 0;
  let rampCount = 0;

  for (const { card, count } of entries) {
    totalCount += count;
    if (isLand(card)) {
      landCount += count;
      continue;
    }
    nonLandCount += count;
    cmcSum += (card.cmc || 0) * count;
    if (isRampCard(card)) rampCount += count;
    const cardPips = parseCardPips(card);
    for (const c of COLORS) pips[c] += cardPips[c] * count;
  }

  if (commander) {
    const cardPips = parseCardPips(commander);
    for (const c of COLORS) pips[c] += cardPips[c];
    // Force every commander-color-identity color to appear at least once so
    // a low-pip splash doesn't accidentally drop out of the mana base.
    for (const c of (commander.color_identity || [])) {
      if (COLORS.includes(c) && pips[c] === 0) pips[c] = 0.5;
    }
  }

  const avgCmc = nonLandCount > 0 ? cmcSum / nonLandCount : 0;
  const totalPips = COLORS.reduce((s, c) => s + pips[c], 0);
  const colorsUsed = COLORS.filter(c => pips[c] > 0);
  const colorShare = {};
  for (const c of COLORS) {
    colorShare[c] = totalPips > 0 ? pips[c] / totalPips : 0;
  }

  return {
    totalCount,
    nonLandCount,
    landCount,
    avgCmc,
    rampCount,
    pips,
    totalPips,
    colorsUsed,
    colorShare,
  };
}
