import { describe, it, expect } from 'vitest';
import { formatLabel, deckTargets, isCommanderFormat } from '../deckFormats';

describe('deck formats', () => {
  it('labels a stored value whatever its spelling', () => {
    // Decks saved years apart hold "Commander" and "commander"; both have
    // to land in the same group on the dashboard.
    expect(formatLabel('commander')).toBe('Commander');
    expect(formatLabel('Commander')).toBe('Commander');
    expect(formatLabel('  COMMANDER  ')).toBe('Commander');
    expect(formatLabel('')).toBe('');
    expect(formatLabel(null)).toBe('');
  });

  it('passes an unknown format through instead of dropping it', () => {
    expect(formatLabel('Cube')).toBe('Cube');
  });

  it('sizes a commander deck at 100 and gives it no sideboard', () => {
    expect(deckTargets('Commander')).toEqual({ main: 100, side: 0 });
    expect(deckTargets('commander')).toEqual({ main: 100, side: 0 });
    expect(deckTargets('modern')).toEqual({ main: 60, side: 15 });
    expect(deckTargets('')).toEqual({ main: 60, side: 15 });
  });

  it('recognises the commander format case-insensitively', () => {
    expect(isCommanderFormat('Commander')).toBe(true);
    expect(isCommanderFormat('commander')).toBe(true);
    expect(isCommanderFormat('modern')).toBe(false);
  });
});
