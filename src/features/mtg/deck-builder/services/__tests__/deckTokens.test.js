import { describe, it, expect } from 'vitest';
import { collectTokenRefs, groupDeckTokens } from '../deckTokens';
import {
  tokenCardmarketName, cardmarketTokenTarget, cardmarketTokenPairs,
} from '../cardmarketMap';

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

describe('helper cards a deck also needs', () => {
  // Scryfall files these as combo_piece, not token — recognisable by the
  // bare "Card" type line the real combo pieces never have.
  const marvel = {
    id: 'marvel', name: 'Aetherworks Marvel',
    all_parts: [
      { component: 'combo_piece', id: 'marvel-kld', name: 'Aetherworks Marvel', type_line: 'Legendary Artifact' },
      { component: 'combo_piece', id: 'energy', name: 'Energy Reserve', type_line: 'Card' },
    ],
  };
  const tovolar = {
    id: 'tovolar', name: "Tovolar's Huntmaster // Tovolar's Packleader",
    all_parts: [
      { component: 'combo_piece', id: 'tovolar-mid', name: "Tovolar's Huntmaster // Tovolar's Packleader", type_line: 'Creature — Human Werewolf // Creature — Werewolf' },
      { component: 'combo_piece', id: 'daynight', name: 'Day // Night', type_line: 'Card // Card' },
      { component: 'token', id: 'wolf', name: 'Wolf', type_line: 'Token Creature — Wolf' },
    ],
  };

  it('picks up energy and the day/night indicator, not the card itself', () => {
    const refs = collectTokenRefs([{ marvel: { card: marvel, count: 1 }, tovolar: { card: tovolar, count: 1 } }], null);
    expect([...refs.keys()]).toEqual(['energy', 'daynight', 'wolf']);
  });

  it('ignores the checklist and filler cards that ride along', () => {
    // Every double-faced card of the Innistrad era links its set checklist.
    const garruk = {
      id: 'garruk', name: 'Garruk Relentless // Garruk, the Veil-Cursed',
      all_parts: [
        { component: 'token', id: 'wolf-b', name: 'Wolf', type_line: 'Token Creature — Wolf' },
        { component: 'combo_piece', id: 'checklist', name: 'Innistrad Checklist', type_line: 'Card' },
        { component: 'combo_piece', id: 'garruk-inr', name: 'Garruk Relentless // Garruk, the Veil-Cursed', type_line: 'Legendary Planeswalker — Garruk // Legendary Planeswalker — Garruk' },
        { component: 'token', id: 'wolf-g', name: 'Wolf', type_line: 'Token Creature — Wolf' },
      ],
    };
    const refs = collectTokenRefs([{ garruk: { card: garruk, count: 1 } }], null);
    expect([...refs.keys()]).toEqual(['wolf-b', 'wolf-g']);
  });

  it('keeps helper cards under their plain name — there is no "… Token" product', () => {
    expect(tokenCardmarketName({ name: 'Energy Reserve', type_line: 'Card' })).toBe('Energy Reserve');
    expect(tokenCardmarketName({ name: 'Day // Night', type_line: 'Card // Card' })).toBe('Day // Night');
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

  it('names both halves of a double-faced token', () => {
    const wolves = {
      name: 'Wolf // Wolf', set: 'tmid',
      card_faces: [
        { name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['G'], power: '2', toughness: '2' },
        { name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['B'], power: '1', toughness: '1' },
      ],
    };
    expect(tokenCardmarketName(wolves)).toBe('Wolf Token (Green 2/2) // Wolf Token (Black 1/1)');
  });

  it('finds the one two-sided product over a same-named single-faced one', () => {
    const map = {
      e: { 4711: 'Innistrad: Midnight Hunt: Extras' },
      ts: { tmid: [4711] },
      tk: { 4711: ['Wolf Token (Green 2/2)', 'Wolf (G 2/2) //Wolf (B 1/1 Deathtouch) Token'] },
    };
    const wolves = {
      name: 'Wolf // Wolf', set: 'tmid',
      card_faces: [
        { name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['G'], power: '2', toughness: '2' },
        { name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['B'], power: '1', toughness: '1' },
      ],
    };
    expect(cardmarketTokenTarget(map, wolves)).toEqual({
      name: 'Wolf (G 2/2) //Wolf (B 1/1 Deathtouch) Token',
      expansion: 'Innistrad: Midnight Hunt: Extras',
    });
  });

  it('buys one card when the deck needs both tokens printed on it', () => {
    // Garruk Relentless makes both: a 2/2 green Wolf on the front face of
    // the token card, a 1/1 black deathtouch Wolf on its back.
    const map = {
      e: { 6007: 'Innistrad Remastered: Tokens' },
      ts: { tinr: [6007] },
      tk: { 6007: ['Wolf Token (B 1/1) // Wolf Token (G 2/2)', 'Blood Token // Clue Token'] },
    };
    const wolfB = { id: 'wb', name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['B'], power: '1', toughness: '1', set: 'tinr' };
    const wolfG = { id: 'wg', name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['G'], power: '2', toughness: '2', set: 'tinr' };
    const pairs = cardmarketTokenPairs(map, [
      { key: 'token:wb', card: wolfB, qty: 1 },
      { key: 'token:wg', card: wolfG, qty: 3 },
    ]);
    expect(pairs.get('token:wb')).toEqual({
      name: 'Wolf Token (B 1/1) // Wolf Token (G 2/2)',
      expansion: 'Innistrad Remastered: Tokens',
      qty: 3, primary: true,
    });
    expect(pairs.get('token:wg').primary).toBe(false);
    expect(pairs.get('token:wg').qty).toBe(3);
  });

  it('leaves a token alone when only one half is needed', () => {
    const map = {
      e: { 6007: 'Innistrad Remastered: Tokens' },
      ts: { tinr: [6007] },
      tk: { 6007: ['Wolf Token (B 1/1) // Wolf Token (G 2/2)'] },
    };
    const wolfG = { id: 'wg', name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['G'], power: '2', toughness: '2', set: 'tinr' };
    expect(cardmarketTokenPairs(map, [{ key: 'token:wg', card: wolfG, qty: 1 }]).size).toBe(0);
    // …but it still resolves to the card it is printed on — either half,
    // not just whichever one the name happens to start with.
    const target = { name: 'Wolf Token (B 1/1) // Wolf Token (G 2/2)', expansion: 'Innistrad Remastered: Tokens' };
    expect(cardmarketTokenTarget(map, wolfG)).toEqual(target);
    const wolfB = { ...wolfG, colors: ['B'], power: '1', toughness: '1' };
    expect(cardmarketTokenTarget(map, wolfB)).toEqual(target);
  });

  it('prefers the product that sells the token on its own', () => {
    const map = {
      e: { 6007: 'Innistrad Remastered: Tokens' },
      ts: { tinr: [6007] },
      tk: { 6007: ['Wolf Token (B 1/1) // Clue Token', 'Wolf Token (Black 1/1)'] },
    };
    const wolfB = { id: 'wb', name: 'Wolf', type_line: 'Token Creature — Wolf', colors: ['B'], power: '1', toughness: '1', set: 'tinr' };
    expect(cardmarketTokenTarget(map, wolfB)).toEqual({
      name: 'Wolf Token (Black 1/1)', expansion: 'Innistrad Remastered: Tokens',
    });
  });

  it('names the separate token expansion of newer sets', () => {
    const map = { e: { 5658: 'Bloomburrow' }, ts: { tblb: [5658, 5659] }, tk: {} };
    const otter = { name: 'Otter', type_line: 'Token Creature — Otter', colors: ['U', 'R'], power: '1', toughness: '1', set: 'tblb' };
    expect(cardmarketTokenTarget(map, otter)).toEqual({
      name: 'Otter Token (Blue and Red 1/1)', expansion: 'Bloomburrow: Tokens', guessed: true,
    });
  });
});
