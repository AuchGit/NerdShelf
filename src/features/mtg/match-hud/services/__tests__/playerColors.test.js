import { describe, it, expect } from 'vitest';
import { isValidPlayerColor, getColor, PLAYER_COLORS } from '../playerColors';

describe('isValidPlayerColor', () => {
  it('accepts every preset', () => {
    for (const c of PLAYER_COLORS) expect(isValidPlayerColor(c.id)).toBe(true);
  });

  it('accepts a custom hex, with or without the hash', () => {
    expect(isValidPlayerColor('#a1b2c3')).toBe(true);
    expect(isValidPlayerColor('a1b2c3')).toBe(true);
  });

  it('rejects anything the HUD could not render', () => {
    expect(isValidPlayerColor('')).toBe(false);
    expect(isValidPlayerColor(null)).toBe(false);
    expect(isValidPlayerColor('chartreuse')).toBe(false);
    expect(isValidPlayerColor('#12345')).toBe(false);
  });

  it('agrees with what getColor can resolve', () => {
    // A stored setting only counts as valid if the tile can show it.
    expect(getColor('teal').id).toBe('teal');
    expect(getColor('#a1b2c3').bg).toBe('#a1b2c3');
  });
});
