import { describe, it, expect } from 'vitest';
import {
  printingSummary, applyPrinting, applyPrintingsToZone, prunePrintings,
  cardmarketLine, allocateOwned,
} from '../deckPrintings';

const bolt = {
  id: 'base', oracle_id: 'o1', name: 'Lightning Bolt', layout: 'normal',
  set: 'm10', set_name: 'Magic 2010', collector_number: '146', rarity: 'common',
  prices: { eur: '1.00', eur_foil: null },
  image_uris: { small: 's-base', normal: 'n-base', large: 'l-base', art_crop: 'a-base', png: 'p' },
};
const boltMma = {
  id: 'mma', oracle_id: 'o1', name: 'Lightning Bolt', layout: 'normal',
  set: 'mm2', set_name: 'Modern Masters 2015', collector_number: '117', rarity: 'uncommon',
  prices: { eur: '2.50', eur_foil: '9.00' },
  image_uris: { small: 's-mma', normal: 'n-mma', large: 'l-mma', art_crop: 'a-mma' },
};

describe('printingSummary', () => {
  it('keeps only the fields the deck needs', () => {
    const s = printingSummary(bolt);
    expect(s.id).toBe('base');
    expect(s.set_name).toBe('Magic 2010');
    expect(s.image_uris).toEqual({ small: 's-base', normal: 'n-base', large: 'l-base', art_crop: 'a-base' });
    expect(s.card_faces).toBeUndefined();
  });
});

describe('applyPrinting', () => {
  it('swaps images, set and price but keeps the id', () => {
    const m = applyPrinting(bolt, printingSummary(boltMma));
    expect(m.id).toBe('base');
    expect(m.image_uris.normal).toBe('n-mma');
    expect(m.set_name).toBe('Modern Masters 2015');
    expect(m.prices.eur).toBe('2.50');
    expect(m._printingId).toBe('mma');
    expect(bolt.image_uris.normal).toBe('n-base'); // stored card untouched
  });

  it('returns the card unchanged without a printing', () => {
    expect(applyPrinting(bolt, null)).toBe(bolt);
  });

  it('swaps per-face images of double-faced cards', () => {
    const dfc = {
      id: 'd1', name: 'A // B', layout: 'transform',
      card_faces: [{ name: 'A', image_uris: { normal: 'a1' } }, { name: 'B', image_uris: { normal: 'b1' } }],
    };
    const other = {
      id: 'd2', set: 'x', set_name: 'X',
      card_faces: [{ image_uris: { normal: 'a2' } }, { image_uris: { normal: 'b2' } }],
    };
    const m = applyPrinting(dfc, printingSummary(other));
    expect(m.card_faces.map(f => f.image_uris.normal)).toEqual(['a2', 'b2']);
    expect(m.card_faces[0].name).toBe('A');
    expect(m.image_uris).toBeUndefined();
  });
});

describe('zones', () => {
  it('applies choices per entry and prunes removed cards', () => {
    const zone = { base: { card: bolt, count: 4 }, other: { card: { id: 'other', name: 'X' }, count: 1 } };
    const printings = { base: printingSummary(boltMma), gone: printingSummary(boltMma) };
    const applied = applyPrintingsToZone(zone, printings);
    expect(applied.base.card.image_uris.normal).toBe('n-mma');
    expect(applied.other).toBe(zone.other);
    expect(Object.keys(prunePrintings(printings, { mainboard: zone }))).toEqual(['base']);
  });

  it('keeps a commander choice when pruning', () => {
    const printings = { cmd: printingSummary(boltMma) };
    expect(prunePrintings(printings, { commander: { id: 'cmd' } })).toEqual(printings);
  });
});

describe('cardmarketLine', () => {
  it('adds the expansion only for a chosen printing', () => {
    expect(cardmarketLine(4, 'Lightning Bolt', null)).toBe('4 Lightning Bolt');
    expect(cardmarketLine(4, 'Lightning Bolt', printingSummary(boltMma)))
      .toBe('4 Lightning Bolt (Modern Masters 2015)');
  });
});

describe('allocateOwned', () => {
  const p = printingSummary(boltMma);
  it('covers demand without a fixed artwork first', () => {
    expect(allocateOwned([{ printing: p, count: 2 }, { printing: null, count: 2 }], 3))
      .toEqual([{ printing: p, count: 1 }]);
  });
  it('returns everything when nothing is owned', () => {
    expect(allocateOwned([{ printing: null, count: 2 }, { printing: p, count: 1 }], 0))
      .toEqual([{ printing: null, count: 2 }, { printing: p, count: 1 }]);
  });
  it('drops fully owned parts', () => {
    expect(allocateOwned([{ printing: p, count: 2 }], 5)).toEqual([]);
  });
});
