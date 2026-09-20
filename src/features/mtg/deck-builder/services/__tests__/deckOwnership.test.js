import { describe, it, expect } from 'vitest';
import {
  deckDemand, totalDemandAcross, deckOwnershipCounts, missingForCollection,
} from '../deckOwnership';
import { buildOwnedIndex } from '../ownedCopies';

const card = (id, name) => ({ id, name });

// A deck with 4 Bolts, 1 Sol Ring and a commander.
const deckA = {
  data: {
    mainboard: {
      bolt: { card: card('bolt', 'Lightning Bolt'), count: 4 },
      sol: { card: card('sol', 'Sol Ring'), count: 1 },
    },
    commander: card('atx', 'Atraxa'),
  },
};
// Another deck that also wants a Sol Ring.
const deckB = {
  data: { mainboard: { sol2: { card: card('sol2', 'Sol Ring'), count: 1 } } },
};

const owned = (rows) => buildOwnedIndex(
  new Map(rows.map(([id, qty]) => [id, qty])),
  new Map(rows.map(([id, , name]) => [id, name])),
);

describe('deckDemand', () => {
  it('counts mainboard, sideboard and the commander, keyed by name', () => {
    const demand = deckDemand({
      mainboard: { bolt: { card: card('bolt', 'Lightning Bolt'), count: 4 } },
      sideboard: { neg: { card: card('neg', 'Negate'), count: 2 } },
      commander: card('atx', 'Atraxa'),
    });
    expect([...demand.keys()].sort()).toEqual(['atraxa', 'lightning bolt', 'negate']);
    expect(demand.get('lightning bolt').count).toBe(4);
    expect(demand.get('atraxa').count).toBe(1);
  });

  it('leaves the ideas pool out — it is not part of the deck', () => {
    const demand = deckDemand({ ideas: { x: { card: card('x', 'Opt'), count: 3 } } });
    expect(demand.size).toBe(0);
  });

  it('adds up the same card held under two printings', () => {
    const demand = deckDemand({
      mainboard: {
        a: { card: card('a', 'Sol Ring'), count: 1 },
        b: { card: card('b', 'Sol Ring'), count: 1 },
      },
    });
    expect(demand.get('sol ring').count).toBe(2);
  });
});

describe('deckOwnershipCounts', () => {
  const totals = totalDemandAcross([deckA, deckB]);

  it('counts nothing when the collection is empty', () => {
    const counts = deckOwnershipCounts(deckA.data, owned([]), totals);
    expect(counts).toEqual({ needed: 6, shared: 0, exclusive: 0 });
  });

  it('counts a shared copy for this deck but not an exclusive one', () => {
    // One Sol Ring, and the other deck wants one too.
    const index = owned([['sol', 1, 'Sol Ring']]);
    const counts = deckOwnershipCounts(deckA.data, index, totals);
    expect(counts.needed).toBe(6);
    expect(counts.shared).toBe(1);      // it covers this deck …
    expect(counts.exclusive).toBe(0);   // … but the other deck claims it first
  });

  it('counts both once there are enough copies to go round', () => {
    const index = owned([['sol', 2, 'Sol Ring']]);
    const counts = deckOwnershipCounts(deckA.data, index, totals);
    expect(counts.shared).toBe(1);
    expect(counts.exclusive).toBe(1);
  });

  it('never counts more copies than the deck needs', () => {
    const index = owned([['bolt', 10, 'Lightning Bolt']]);
    const counts = deckOwnershipCounts(deckA.data, index, totals);
    expect(counts.shared).toBe(4);
    expect(counts.exclusive).toBe(4);
  });

  it('matches any printing of the same card', () => {
    // Owned under a different printing id than the deck holds.
    const index = owned([['bolt-2xm', 4, 'Lightning Bolt']]);
    expect(deckOwnershipCounts(deckA.data, index, totals).shared).toBe(4);
  });
});

describe('missingForCollection', () => {
  it('asks only for what is missing', () => {
    const index = owned([['bolt', 1, 'Lightning Bolt']]);
    const missing = missingForCollection(deckA.data, index);
    expect(missing).toEqual([
      { id: 'bolt', name: 'Lightning Bolt', add: 3 },
      { id: 'sol', name: 'Sol Ring', add: 1 },
      { id: 'atx', name: 'Atraxa', add: 1 },
    ]);
  });

  it('returns nothing when the deck is fully owned', () => {
    const index = owned([
      ['bolt', 4, 'Lightning Bolt'],
      ['sol', 1, 'Sol Ring'],
      ['atx', 1, 'Atraxa'],
    ]);
    expect(missingForCollection(deckA.data, index)).toEqual([]);
  });

  it('tops up the chosen artwork when the deck fixed one', () => {
    const data = {
      mainboard: { bolt: { card: card('bolt', 'Lightning Bolt'), count: 2 } },
      printings: { bolt: { id: 'bolt-lea' } },
    };
    expect(missingForCollection(data, owned([]))).toEqual([
      { id: 'bolt-lea', name: 'Lightning Bolt', add: 2 },
    ]);
  });
});
