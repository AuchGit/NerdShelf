// src/features/mtg/deck-builder/services/deckOrganize.js
//
// Group + sort deck entries for display. Shared by the desktop DeckPanel,
// the decklist view and the mobile deck viewer so all sort the same way.
//
// Modes: 'type' | 'color' | 'rarity' | 'cmc' group the deck; 'name' and
// 'price' are flat orders. An optional second mode refines the first:
//   - a grouping mode → sub-groups inside every group (Creatures → 2 CMC …)
//   - 'name' / 'price' → the order of the cards inside every group
//   - with a flat first mode it swaps in: group by the second, order by the
//     first (e.g. price, then type → type groups ordered by price)

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

// Ways to group a deck; `rank` orders the groups.
const GROUPINGS = {
  type: {
    keyOf: (card) => getTypeGroup(card),
    rank: (k) => GROUP_ORDER.indexOf(k),
    label: (k) => k,
  },
  color: {
    keyOf: colorGroup,
    rank: (k) => COLOR_GROUP_ORDER.indexOf(k),
    label: (k) => COLOR_GROUP_LABEL[k],
  },
  rarity: {
    keyOf: (card) => card.rarity || 'common',
    rank: (k) => RARITY_ORDER[k] ?? 99,
    label: (k) => RARITY_LABEL[k] || k,
  },
  cmc: {
    // Integer mana value; lands get their own bucket at the end
    keyOf: (card) => (card.type_line?.includes('Land') ? 'Land' : String(Math.floor(manaValue(card)))),
    rank: (k) => (k === 'Land' ? Number.MAX_SAFE_INTEGER : Number(k)),
    label: (k) => (k === 'Land' ? 'Land' : `${k} CMC`),
  },
};

const byName = (a, b) => a.card.name.localeCompare(b.card.name);
const priceOf = (e) => getCardPriceEur(e.card) ?? -1;

/** Comparator for the cards inside a group (or a flat list). */
function orderFor(mode) {
  if (mode === 'price') return (a, b) => priceOf(b) - priceOf(a) || byName(a, b);
  if (mode === 'cmc') return (a, b) => manaValue(a.card) - manaValue(b.card) || byName(a, b);
  const g = GROUPINGS[mode];
  if (g) return (a, b) => g.rank(g.keyOf(a.card)) - g.rank(g.keyOf(b.card)) || byName(a, b);
  return byName;
}

const countOf = (entries) => entries.reduce((s, e) => s + e.count, 0);

function groupBy(entries, mode) {
  const g = GROUPINGS[mode];
  const buckets = new Map();
  for (const e of entries) {
    const k = g.keyOf(e.card);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => g.rank(a) - g.rank(b))
    .map(([k, es]) => ({ key: k, label: g.label(k), entries: es }));
}

/**
 * Group + sort entries. Returns an array of
 * `{ groupLabel, groupCount, entries, subgroups? }` ready to render;
 * `entries` always holds the whole group in display order, `subgroups`
 * (`{ label, count, entries }`) is present only for a grouping second mode.
 */
export function organizeDeck(deck, sortMode, thenMode = null) {
  const entries = Object.values(deck);
  let groupMode = GROUPINGS[sortMode] ? sortMode : null;
  let inner = thenMode && thenMode !== sortMode ? thenMode : null;
  if (!groupMode && GROUPINGS[inner]) {
    groupMode = inner;
    inner = sortMode;
  }

  if (!groupMode) {
    return [{
      groupLabel: null,
      entries: entries.sort(orderFor(inner || sortMode)),
      groupCount: countOf(entries),
    }];
  }

  // Default order inside a group: mana value for CMC groups, else name.
  const innerMode = inner || (groupMode === 'cmc' ? 'cmc' : 'name');
  return groupBy(entries, groupMode).map(g => {
    if (GROUPINGS[innerMode] && innerMode !== groupMode) {
      const subgroups = groupBy(g.entries, innerMode).map(s => ({
        label: s.label,
        count: countOf(s.entries),
        entries: s.entries.sort(orderFor(innerMode === 'cmc' ? 'cmc' : 'name')),
      }));
      return {
        groupLabel: g.label,
        groupCount: countOf(g.entries),
        entries: subgroups.flatMap(s => s.entries),
        subgroups,
      };
    }
    return {
      groupLabel: g.label,
      groupCount: countOf(g.entries),
      entries: g.entries.sort(orderFor(innerMode)),
    };
  });
}
