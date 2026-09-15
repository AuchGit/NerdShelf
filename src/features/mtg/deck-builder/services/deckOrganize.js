// src/features/mtg/deck-builder/services/deckOrganize.js
//
// Group + sort deck entries for display. Shared by the desktop DeckPanel
// and the mobile deck viewer so both sort the same way.

import { getTypeGroup, getCardPriceEur } from './scryfall';

export const GROUP_ORDER = [
  'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Lands', 'Other',
];

const RARITY_ORDER = { mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5 };
const RARITY_LABEL = {
  mythic: 'Mythic', rare: 'Rare', uncommon: 'Uncommon',
  common: 'Common', special: 'Special', bonus: 'Bonus',
};

// Map a card to a primary color group for the 'color' sort
function colorGroup(card) {
  const cs = card.colors || [];
  if (cs.length === 0) return 'C';
  if (cs.length > 1)   return 'M';   // multicolor
  return cs[0];                       // 'W' | 'U' | 'B' | 'R' | 'G'
}
const COLOR_GROUP_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
const COLOR_GROUP_LABEL = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
  M: 'Multicolor', C: 'Colorless',
};

function manaValue(card) {
  const v = card.cmc;
  return typeof v === 'number' ? v : (Number(v) || 0);
}

/** Group + sort entries based on active sort mode. Returns an array of
 *  `{ groupLabel, groupCount, entries }` ready to render. */
export function organizeDeck(deck, sortMode) {
  const entries = Object.values(deck);

  if (sortMode === 'type') {
    const groups = {};
    for (const e of entries) {
      const g = getTypeGroup(e.card);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }
    return GROUP_ORDER
      .filter(g => groups[g])
      .map(g => ({
        groupLabel: g,
        entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: groups[g].reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'color') {
    const groups = {};
    for (const e of entries) {
      const g = colorGroup(e.card);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }
    return COLOR_GROUP_ORDER
      .filter(g => groups[g])
      .map(g => ({
        groupLabel: COLOR_GROUP_LABEL[g],
        entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: groups[g].reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'rarity') {
    const groups = {};
    for (const e of entries) {
      const r = e.card.rarity || 'common';
      if (!groups[r]) groups[r] = [];
      groups[r].push(e);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => (RARITY_ORDER[a] ?? 99) - (RARITY_ORDER[b] ?? 99))
      .map(([r, es]) => ({
        groupLabel: RARITY_LABEL[r] || r,
        entries: es.sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: es.reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'cmc') {
    // Group by integer mana value; lands get their own bucket at the end
    const groups = {};
    for (const e of entries) {
      const isLand = e.card.type_line?.includes('Land');
      const key = isLand ? 'Land' : String(Math.floor(manaValue(e.card)));
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    const numericKeys = Object.keys(groups)
      .filter(k => k !== 'Land')
      .sort((a, b) => Number(a) - Number(b));
    const ordered = numericKeys.map(k => [k, groups[k]]);
    if (groups['Land']) ordered.push(['Land', groups['Land']]);
    return ordered.map(([k, es]) => ({
      groupLabel: k === 'Land' ? 'Land' : `${k} CMC`,
      entries: es.sort((a, b) =>
        manaValue(a.card) - manaValue(b.card) || a.card.name.localeCompare(b.card.name)
      ),
      groupCount: es.reduce((s, e) => s + e.count, 0),
    }));
  }

  if (sortMode === 'price') {
    // Single flat list, most expensive first; unknown prices at the end
    const price = (e) => getCardPriceEur(e.card) ?? -1;
    return [{
      groupLabel: null,
      entries: entries.sort((a, b) => price(b) - price(a) || a.card.name.localeCompare(b.card.name)),
      groupCount: entries.reduce((s, e) => s + e.count, 0),
    }];
  }

  // sortMode === 'name' → single flat list
  return [{
    groupLabel: null,
    entries: entries.sort((a, b) => a.card.name.localeCompare(b.card.name)),
    groupCount: entries.reduce((s, e) => s + e.count, 0),
  }];
}
