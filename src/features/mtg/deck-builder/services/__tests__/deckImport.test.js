import { describe, it, expect } from 'vitest';
import { parseDecklistText, buildDeckFromParsed } from '../deckImport';

describe('parseDecklistText', () => {
  it('reads editions and collector numbers', () => {
    const { main, side } = parseDecklistText([
      '4 Lightning Bolt',
      '4x Counterspell (MH2) 267',
      '1 Sol Ring (CMR) 472 *F*',
      '2 Opt [XLN]',
      '1 Delver of Secrets // Insectile Aberration (ISD) 51',
      '',
      'Sideboard',
      '2 Negate (RIX) 44',
    ].join('\n'));
    expect(main).toEqual([
      { name: 'Lightning Bolt', count: 4, set: null, collector: null },
      { name: 'Counterspell', count: 4, set: 'mh2', collector: '267' },
      { name: 'Sol Ring', count: 1, set: 'cmr', collector: '472' },
      { name: 'Opt', count: 2, set: 'xln', collector: null },
      { name: 'Delver of Secrets // Insectile Aberration', count: 1, set: 'isd', collector: '51' },
    ]);
    expect(side).toEqual([{ name: 'Negate', count: 2, set: 'rix', collector: '44' }]);
  });

  it('keeps names with non-edition parentheses clean', () => {
    const { main } = parseDecklistText('1 B.F.M. (Big Furry Monster)');
    expect(main[0]).toEqual({ name: 'B.F.M.', count: 1, set: null, collector: null });
  });
});

describe('buildDeckFromParsed', () => {
  const boltDefault = { id: 'bolt-2xm', name: 'Lightning Bolt', set: '2xm', collector_number: '129' };
  const boltLea = { id: 'bolt-lea', name: 'Lightning Bolt', set: 'lea', collector_number: '161', set_name: 'Limited Edition Alpha' };
  const opt = { id: 'opt', name: 'Opt', set: 'xln', collector_number: '65' };

  it('keys by the default printing and records the edition as artwork', () => {
    const parsed = parseDecklistText('2 Lightning Bolt (LEA) 161\n2 Lightning Bolt\n4 Opt (ZZZ) 1\n1 Unknown Card');
    const resolved = {
      found: [{ name: 'lightning bolt', card: boltDefault }, { name: 'opt', card: opt }],
      notFound: ['unknown card'],
      prints: new Map([['lea#161', boltLea]]),
    };
    const deck = buildDeckFromParsed(parsed, resolved);
    expect(Object.keys(deck.mainboard)).toEqual(['bolt-2xm', 'opt']);
    expect(deck.mainboard['bolt-2xm'].count).toBe(4);
    expect(deck.printings['bolt-2xm'].id).toBe('bolt-lea');
    expect(deck.printings.opt).toBeUndefined();
    expect(deck.fallbacks).toEqual(['Opt (ZZZ 1)']);
    expect(deck.notFound).toEqual(['Unknown Card']);
  });
});
