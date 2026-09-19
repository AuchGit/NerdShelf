import { describe, it, expect } from 'vitest';
import { mergeSharedDecks } from '../sharedDecks';

describe('mergeSharedDecks', () => {
  const a = { id: 'a', name: 'Imported' };
  const b = { id: 'b', name: 'Public' };

  it('lists imported decks first, then public ones', () => {
    expect(mergeSharedDecks([a], [b]).map(d => d.id)).toEqual(['a', 'b']);
  });

  it('shows a deck that is both imported and public once', () => {
    expect(mergeSharedDecks([a], [b, { ...a }]).map(d => d.id)).toEqual(['a', 'b']);
  });

  it('copes with missing lists and rows without an id', () => {
    expect(mergeSharedDecks(undefined, null)).toEqual([]);
    expect(mergeSharedDecks([null, { name: 'x' }], [b])).toEqual([b]);
  });
});
