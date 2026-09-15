import { describe, it, expect } from 'vitest';
import { collectTokenRefs, groupDeckTokens } from '../deckTokens';
import { tokenCardmarketName, cardmarketTokenTarget } from '../cardmarketMap';

const krenko = {
  id: 'krenko', name: 'Krenko, Mob Boss',
  all_parts: [
    { component: 'combo_piece', id: 'krenko', name: 'Krenko, Mob Boss' },
    { component: 'token', id: 'goblin-a', name: 'Goblin', type_line: 'Token Creature — Goblin' },
  ],
};
const warren = {
  id: 'warren', name: 'Goblin Warrens',
  all_parts: [{ component: 'token', id: 'goblin-b', name: 'Goblin', type_line: 'Token Creature — Goblin' }],
};
const tithe = {
  id: 'tithe', name: 'Smothering Tithe',
  all_parts: [{ component: 'token', id: 'treasure', name: 'Treasure', type_line: 'Token Artifact — Treasure' }],
};

const goblinA = { id: 'goblin-a', oracle_id: 'o-goblin', name: 'Goblin', type_line: 'Token Creature — Goblin', colors: ['R'], power: '1', toughness: '1', set: 'twoe' };
const goblinB = { ...goblinA, id: 'goblin-b' };
const treasure = { id: 'treasure', oracle_id: 'o-treasure', name: 'Treasure', type_line: 'Token Artifact — Treasure', colors: [], set: 'twoe' };

describe('deck tokens', () => {
  it('collects tokens with the cards creating them', () => {
    const refs = collectTokenRefs([{ krenko: { card: krenko, count: 1 } }, { warren: { card: warren, count: 2 } }], tithe);
    expect([...refs.keys()]).toEqual(['goblin-a', 'goblin-b', 'treasure']);
    expect([...refs.get('goblin-a').sources]).toEqual(['Krenko, Mob Boss']);
  });

  it('respects an entry filter', () => {
    const refs = collectTokenRefs([{ krenko: { card: krenko, count: 1 }, warren: { card: warren, count: 1 } }], null, id => id === 'warren');
    expect([...refs.keys()]).toEqual(['goblin-b']);
  });

  it('merges identical tokens by oracle id and applies counts', () => {
    const refs = collectTokenRefs([{ krenko: { card: krenko, count: 1 }, warren: { card: warren, count: 1 } }], tithe);
    const cards = new Map([['goblin-a', goblinA], ['goblin-b', goblinB], ['treasure', treasure]]);
    const list = groupDeckTokens(refs, cards, { 'o-goblin': 5 });
    expect(list.map(t => [t.key, t.count])).toEqual([['o-goblin', 5], ['o-treasure', 1]]);
    expect(list[0].sources).toEqual(['Goblin Warrens', 'Krenko, Mob Boss']);
  });
});

describe('Cardmarket token names', () => {
  it('builds the usual Cardmarket spelling', () => {
    expect(tokenCardmarketName(goblinA)).toBe('Goblin Token (Red 1/1)');
    expect(tokenCardmarketName(treasure)).toBe('Treasure Token');
    expect(tokenCardmarketName({ name: 'Spirit', colors: ['B', 'W'], power: '1', toughness: '1' }))
      .toBe('Spirit Token (White and Black 1/1)');
    expect(tokenCardmarketName({ name: 'Thopter', colors: [], type_line: 'Token Artifact Creature — Thopter', power: '1', toughness: '1' }))
      .toBe('Thopter Token (Artifact 1/1)');
  });

  it('finds the exact product in the parent set expansions', () => {
    const map = {
      e: { 5428: 'Wilds of Eldraine: Extras' },
      ts: { twoe: [5428] },
      tk: { 5428: ['Goblin Token (Red 1/1 Haste)', 'Goblin Token (R 1/1)', 'Goblin Token (Black 1/1)', 'Treasure Token', 'Beast Token (Green 3/3)'] },
    };
    expect(cardmarketTokenTarget(map, goblinA)).toEqual({ name: 'Goblin Token (R 1/1)', expansion: 'Wilds of Eldraine: Extras' });
    expect(cardmarketTokenTarget(map, treasure)).toEqual({ name: 'Treasure Token', expansion: 'Wilds of Eldraine: Extras' });
    expect(cardmarketTokenTarget(map, { ...goblinA, power: '2', toughness: '2' })).toBeNull();
    expect(cardmarketTokenTarget(map, { ...goblinA, set: 'tfdn' })).toBeNull();
  });
});
