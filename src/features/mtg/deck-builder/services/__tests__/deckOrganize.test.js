import { describe, it, expect } from 'vitest';
import { organizeDeck } from '../deckOrganize';

const card = (name, type_line, cmc, extra = {}) => ({ id: name, name, type_line, cmc, colors: [], rarity: 'common', ...extra });
const deck = {
  bolt:   { card: card('Lightning Bolt', 'Instant', 1, { colors: ['R'], prices: { eur: '1' } }), count: 4 },
  goblin: { card: card('Goblin Guide', 'Creature — Goblin', 1, { colors: ['R'], rarity: 'rare', prices: { eur: '3' } }), count: 4 },
  ogre:   { card: card('Ogre', 'Creature — Ogre', 3, { colors: ['R'], prices: { eur: '0.1' } }), count: 2 },
  helix:  { card: card('Lightning Helix', 'Instant', 2, { colors: ['R', 'W'] }), count: 1 },
  mount:  { card: card('Mountain', 'Basic Land — Mountain', 0), count: 20 },
};
const names = (entries) => entries.map(e => e.card.name);

describe('organizeDeck — one level (unchanged behaviour)', () => {
  it('groups by type in the fixed order, names inside', () => {
    const groups = organizeDeck(deck, 'type');
    expect(groups.map(g => g.groupLabel)).toEqual(['Creatures', 'Instants', 'Lands']);
    expect(names(groups[0].entries)).toEqual(['Goblin Guide', 'Ogre']);
    expect(groups[0].groupCount).toBe(6);
    expect(groups[0].subgroups).toBeUndefined();
  });

  it('groups by CMC with lands last, ordered by mana value', () => {
    const groups = organizeDeck(deck, 'cmc');
    expect(groups.map(g => g.groupLabel)).toEqual(['1 CMC', '2 CMC', '3 CMC', 'Land']);
  });

  it('keeps name and price as flat orders', () => {
    expect(names(organizeDeck(deck, 'price')[0].entries).slice(0, 3))
      .toEqual(['Goblin Guide', 'Lightning Bolt', 'Ogre']);
    expect(organizeDeck(deck, 'name')).toHaveLength(1);
  });
});

describe('organizeDeck — two levels', () => {
  it('builds sub-groups for a grouping second mode', () => {
    const groups = organizeDeck(deck, 'type', 'cmc');
    const creatures = groups[0];
    expect(creatures.subgroups.map(s => s.label)).toEqual(['1 CMC', '3 CMC']);
    expect(names(creatures.entries)).toEqual(['Goblin Guide', 'Ogre']);
  });

  it('works the other way round', () => {
    const groups = organizeDeck(deck, 'cmc', 'type');
    expect(groups[0].groupLabel).toBe('1 CMC');
    expect(groups[0].subgroups.map(s => s.label)).toEqual(['Creatures', 'Instants']);
  });

  it('orders inside groups for a flat second mode', () => {
    const groups = organizeDeck(deck, 'type', 'price');
    expect(names(groups[1].entries)).toEqual(['Lightning Bolt', 'Lightning Helix']);
    expect(groups[1].subgroups).toBeUndefined();
  });

  it('swaps a flat first mode with a grouping second mode', () => {
    const groups = organizeDeck(deck, 'price', 'type');
    expect(groups.map(g => g.groupLabel)).toEqual(['Creatures', 'Instants', 'Lands']);
    expect(names(groups[0].entries)).toEqual(['Goblin Guide', 'Ogre']);
  });

  it('ignores a second mode equal to the first', () => {
    expect(organizeDeck(deck, 'type', 'type')).toEqual(organizeDeck(deck, 'type'));
  });
});
