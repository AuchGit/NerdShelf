import { describe, it, expect } from 'vitest';
import { formatDecklist } from '../deckExport';

const ATRAXA = "Atraxa, Praetors' Voice";

describe('formatDecklist', () => {
  const main = { sol: { card: { id: 'sol', name: 'Sol Ring' }, count: 1 } };

  it('writes a plain list when there is no commander', () => {
    expect(formatDecklist(main, {}, {})).toBe('1 Sol Ring');
  });

  it('gives the commander its own section and re-opens the deck below', () => {
    const commander = { id: 'atx', name: ATRAXA };
    expect(formatDecklist(main, {}, {}, commander).split('\n')).toEqual([
      'Commander',
      `1 ${ATRAXA}`,
      '',
      'Deck',
      '1 Sol Ring',
    ]);
  });

  it('keeps the chosen edition on the commander', () => {
    const commander = { id: 'atx', name: ATRAXA };
    const printings = { atx: { set: 'cmr', collector_number: '1' } };
    expect(formatDecklist({}, {}, printings, commander))
      .toContain(`1 ${ATRAXA} (CMR) 1`);
  });

  it('still writes the sideboard after the deck', () => {
    const side = { neg: { card: { id: 'neg', name: 'Negate' }, count: 2 } };
    expect(formatDecklist(main, side, {}, { id: 'atx', name: ATRAXA }).split('\n')).toEqual([
      'Commander',
      `1 ${ATRAXA}`,
      '',
      'Deck',
      '1 Sol Ring',
      '',
      'Sideboard',
      '2 Negate',
    ]);
  });
});
