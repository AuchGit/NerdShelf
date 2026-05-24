// src/features/dnd/character-builder/lib/conditions.js
//
// Catalog of standard 5e conditions. Used by the player sheet
// (OverviewTab) and the GM session view to render a uniform toggle
// strip, and by the combat-state RPC to validate that only known names
// land in `data.status.conditions`.
//
// This is a stable D&D 5e mechanic — 14 codified conditions in the SRD,
// none of which we can derive from existing data files. Listed here
// rather than fetched from the dataset because they're rules text the
// runtime needs (icons, short tooltips) on first paint.

export const CONDITIONS = [
  { id: 'blinded',       label: 'Blinded',       symbol: '◯',  hint: 'Auto-fail sight checks; attacks have disadvantage, attacks against have advantage.' },
  { id: 'charmed',       label: 'Charmed',       symbol: '♥',  hint: 'Cannot attack the charmer; charmer has advantage on social checks.' },
  { id: 'deafened',      label: 'Deafened',      symbol: '◌',  hint: 'Auto-fail hearing checks.' },
  { id: 'frightened',    label: 'Frightened',    symbol: '!',  hint: 'Disadvantage on checks/attacks while source is in sight; cannot willingly move closer.' },
  { id: 'grappled',      label: 'Grappled',      symbol: '⊓',  hint: 'Speed = 0; ends if grappler is incapacitated or moved away.' },
  { id: 'incapacitated', label: 'Incapacitated', symbol: '✗',  hint: 'Cannot take actions or reactions.' },
  { id: 'invisible',     label: 'Invisible',     symbol: '⊘',  hint: 'Heavily obscured; attacks against have disadvantage, attacks have advantage.' },
  { id: 'paralyzed',     label: 'Paralyzed',     symbol: '⌧',  hint: 'Incapacitated + cannot move/speak; auto-fail STR/DEX saves; attacks against have advantage; hits within 5 ft are crits.' },
  { id: 'petrified',     label: 'Petrified',     symbol: '▣',  hint: 'Transformed to stone; incapacitated; resistance to all damage; immunity to poison/disease.' },
  { id: 'poisoned',      label: 'Poisoned',      symbol: '☠',  hint: 'Disadvantage on attack rolls and ability checks.' },
  { id: 'prone',         label: 'Prone',         symbol: '↓',  hint: 'Only crawl; disadvantage on attacks; melee attacks against have advantage, ranged have disadvantage.' },
  { id: 'restrained',    label: 'Restrained',    symbol: '⛓',  hint: 'Speed = 0; disadvantage on attacks/DEX saves; attacks against have advantage.' },
  { id: 'stunned',       label: 'Stunned',       symbol: '★',  hint: 'Incapacitated, cannot move; speak only falteringly; auto-fail STR/DEX saves; attacks against have advantage.' },
  { id: 'unconscious',   label: 'Unconscious',   symbol: '☾',  hint: 'Incapacitated, prone, drops things; auto-fail STR/DEX saves; melee hits within 5 ft are crits.' },
]

export const EXHAUSTION_LEVELS = 6  // 0..6; 6 = dead in 5e

export function conditionLabel(id) {
  return CONDITIONS.find(c => c.id === id)?.label || id
}
