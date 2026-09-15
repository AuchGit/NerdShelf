import { describe, it, expect } from 'vitest';
import {
  createTagIndexBuilder, tagsForCard, cardHasTag, searchTags, oracleIdOf,
} from '../scryfallTags';

function buildIndex() {
  const b = createTagIndexBuilder();
  b.add({ id: 'ramp', label: 'ramp', slug: 'ramp', type: 'oracle', parent_ids: [], aliases: [], taggings: [] });
  b.add({ id: 'prod', label: 'mana producer', slug: 'mana-producer', type: 'oracle', parent_ids: ['ramp'], taggings: [{ oracle_id: 'o-elf' }] });
  b.add({ id: 'rock', label: 'mana rock', slug: 'mana-rock', type: 'oracle', parent_ids: ['prod'], taggings: [{ oracle_id: 'o-sol' }, { oracle_id: 'o-sig' }] });
  b.add({ id: 'draw', label: 'card draw', slug: 'card-draw', type: 'oracle', aliases: ['draw'], parent_ids: [], taggings: [{ oracle_id: 'o-sig' }] });
  b.add({ id: 'art', label: 'dragon', slug: 'dragon', type: 'illustration', taggings: [{ oracle_id: 'o-sol' }] });
  // Cycle guard: a ↔ b
  b.add({ id: 'a', label: 'loop a', slug: 'loop-a', type: 'oracle', parent_ids: ['b'], taggings: [{ oracle_id: 'o-loop' }] });
  b.add({ id: 'b', label: 'loop b', slug: 'loop-b', type: 'oracle', parent_ids: ['a'], taggings: [] });
  return b.finish();
}

describe('createTagIndexBuilder', () => {
  const index = buildIndex();

  it('ignores non-oracle tags', () => {
    expect(index.tags.map(t => t.slug)).not.toContain('dragon');
  });

  it('counts descendants into parent tags', () => {
    const count = (slug) => index.tags.find(t => t.slug === slug).count;
    expect(count('mana-rock')).toBe(2);
    expect(count('mana-producer')).toBe(3);
    expect(count('ramp')).toBe(3);
    expect(count('loop-b')).toBe(1);
  });
});

describe('index helpers', () => {
  const index = buildIndex();
  const sol = { oracle_id: 'o-sol' };
  const signet = { card_faces: [{ oracle_id: 'o-sig' }] };

  it('reads the oracle id from faces as a fallback', () => {
    expect(oracleIdOf(signet)).toBe('o-sig');
  });

  it('lists direct tags, broadest first', () => {
    expect(tagsForCard(index, signet).map(t => t.slug)).toEqual(['mana-rock', 'card-draw']);
    expect(tagsForCard(null, sol)).toEqual([]);
  });

  it('matches a tag through its descendants', () => {
    expect(cardHasTag(index, sol, 'mana-rock')).toBe(true);
    expect(cardHasTag(index, sol, 'ramp')).toBe(true);
    expect(cardHasTag(index, sol, 'card-draw')).toBe(false);
    expect(cardHasTag(index, sol, 'unknown')).toBe(false);
  });

  it('searches labels and aliases, best match first', () => {
    expect(searchTags(index, 'draw').map(t => t.slug)).toEqual(['card-draw']);
    expect(searchTags(index, 'mana').map(t => t.slug)).toEqual(['mana-producer', 'mana-rock']);
    expect(searchTags(index, 'rock').map(t => t.slug)).toEqual(['mana-rock']);
    expect(searchTags(index, 'mana', { exclude: ['mana-producer'] }).map(t => t.slug)).toEqual(['mana-rock']);
  });

  it('skips tags without cards', () => {
    const b = createTagIndexBuilder();
    b.add({ id: 'x', label: 'empty', slug: 'empty', type: 'oracle', taggings: [] });
    expect(searchTags(b.finish(), 'empty')).toEqual([]);
  });
});
