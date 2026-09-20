// src/features/mtg/deck-builder/services/deckFormats.js
//
// The formats a deck can be in, and what each one expects of a deck.
// One place, because the builder and the dashboard both need it and had
// drifted apart: the dashboard grouped by the raw stored value while the
// builder saved lowercase slugs, so a deck saved as "Commander" years ago
// and one saved as "commander" today ended up in two separate groups.

export const MTG_FORMATS = [
  { value: '',            label: '(Kein Format)' },
  { value: 'standard',    label: 'Standard'      },
  { value: 'pioneer',     label: 'Pioneer'       },
  { value: 'modern',      label: 'Modern'        },
  { value: 'legacy',      label: 'Legacy'        },
  { value: 'vintage',     label: 'Vintage'       },
  { value: 'pauper',      label: 'Pauper'        },
  { value: 'commander',   label: 'Commander'     },
  { value: 'brawl',       label: 'Brawl'         },
  { value: 'historic',    label: 'Historic'      },
  { value: 'alchemy',     label: 'Alchemy'       },
  { value: 'penny',       label: 'Penny'         },
  { value: 'oathbreaker', label: 'Oathbreaker'   },
  { value: 'limited',     label: 'Limited'       },
];

// Formats that should NOT trigger a Scryfall legal:<x> filter.
export const FORMATS_WITHOUT_FILTER = new Set(['', 'limited']);

const normalize = (format) => String(format || '').toLowerCase().trim();

/** Does this format play with a commander? */
export function isCommanderFormat(format) {
  return normalize(format) === 'commander';
}

/**
 * Display name for a stored format value, whatever its spelling.
 * Unknown values come back as they are, so nothing disappears.
 */
export function formatLabel(format) {
  const value = normalize(format);
  if (!value) return '';
  return MTG_FORMATS.find(f => f.value === value)?.label || String(format);
}

/**
 * How big a deck of this format is meant to be. Commander counts its
 * commander toward the 100 and has no sideboard; `side: 0` means "don't
 * show a target for it".
 */
export function deckTargets(format) {
  return isCommanderFormat(format)
    ? { main: 100, side: 0 }
    : { main: 60, side: 15 };
}
