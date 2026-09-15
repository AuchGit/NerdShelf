import { describe, it, expect } from 'vitest';
import {
  buildOwnedIndex, ownedCopiesOf, totalCopies, allocateOwnedCopies,
} from '../ownedCopies';

const index = buildOwnedIndex(
  new Map([['m10', 2], ['mma', 1], ['nolabel', 3], ['other', 4]]),
  new Map([['m10', 'Lightning Bolt'], ['mma', 'lightning bolt '], ['other', 'Counterspell']]),
);
const mma = { id: 'mma', set_name: 'Modern Masters' };
const lea = { id: 'lea', set_name: 'Alpha' };

describe('ownedCopiesOf', () => {
  it('collects every printing of the card by name', () => {
    const copies = ownedCopiesOf(index, 'base', 'Lightning Bolt');
    expect(Object.fromEntries(copies)).toEqual({ m10: 2, mma: 1 });
    expect(totalCopies(copies)).toBe(3);
  });

  it('includes the entry id itself even without a label', () => {
    expect(Object.fromEntries(ownedCopiesOf(index, 'nolabel', 'Something'))).toEqual({ nolabel: 3 });
  });
});

describe('allocateOwnedCopies', () => {
  const copies = ownedCopiesOf(index, 'base', 'Lightning Bolt'); // m10:2, mma:1

  it('lets any printing cover demand without a fixed artwork', () => {
    expect(allocateOwnedCopies([{ printing: null, count: 4 }], copies))
      .toEqual([{ printing: null, count: 1 }]);
  });

  it('only counts the exact printing for a fixed artwork', () => {
    expect(allocateOwnedCopies([{ printing: lea, count: 2 }], copies))
      .toEqual([{ printing: lea, count: 2 }]);
    expect(allocateOwnedCopies([{ printing: mma, count: 2 }], copies))
      .toEqual([{ printing: mma, count: 1 }]);
  });

  it('uses leftovers of fixed printings for free demand', () => {
    expect(allocateOwnedCopies(
      [{ printing: mma, count: 1 }, { printing: null, count: 3 }],
      copies,
    )).toEqual([{ printing: null, count: 1 }]);
  });

  it('returns nothing when everything is owned', () => {
    expect(allocateOwnedCopies([{ printing: null, count: 3 }], copies)).toEqual([]);
  });
});
