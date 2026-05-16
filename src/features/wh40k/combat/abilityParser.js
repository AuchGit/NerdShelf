// src/features/wh40k/combat/abilityParser.js
//
// Heuristic text parser that extracts structured tags from a 10e ability or
// stratagem description. The Combat Helper PWA uses these tags to surface
// the right abilities at the right moment without anyone having to hand-
// curate per-faction or per-detachment lists — the whole catalogue
// (7000+ abilities, 1400+ stratagems) flows through this one pass.
//
// What gets extracted:
//
//   phases:    Set of canonical phase ids the text references
//              ('command', 'movement', 'shooting', 'charge', 'fight', 'end')
//   timing:    'start' | 'end' | null     — fires at the boundary of a phase
//   frequency: 'battle' | 'turn' | 'phase' | null
//   triggers:  array of reactive moments — "select to shoot", "ends charge", …
//   passive:   boolean — true when the ability has no time / phase / trigger
//              hooks at all (so the HUD knows to file it under "always on"
//              instead of phase-bound)
//
// Notes:
//   - We deliberately avoid building a full rules parser. The goal is a
//     fast, useful filter so a player on their phone sees roughly the
//     right things during the right phase. False positives are cheap (an
//     extra card visible in a phase) and false negatives are recoverable
//     (the user can flip to "all" or open the unit detail).
//   - For stratagems we ALSO honour the structured `phase` and `kind`
//     fields the importer captured from Wahapedia, which already cover
//     ~95% of stratagems.

// Canonical phase ids — matches src/features/wh40k/combat/schema.js
export const PHASE_IDS = ['command', 'movement', 'shooting', 'charge', 'fight', 'end'];

const PHASE_PATTERNS = [
  { phase: 'command',  re: /\bcommand phase\b/i },
  { phase: 'movement', re: /\bmovement phase\b/i },
  { phase: 'shooting', re: /\bshooting phase\b/i },
  { phase: 'charge',   re: /\bcharge phase\b/i },
  { phase: 'fight',    re: /\bfight phase\b/i },
  // The 10e rulebook uses "end of battle round" and "end of your turn" for
  // the bookkeeping phase; both map to our 'end' phase id.
  { phase: 'end',      re: /\bend of (your |the )?(turn|battle round)\b/i },
];

const ANY_PHASE_RE = /\bany phase\b/i;

const TIMING_PATTERNS = [
  { timing: 'start', re: /\b(at the )?(start|beginning) of\b/i },
  { timing: 'end',   re: /\b(at the )?end of\b/i },
];

const FREQUENCY_PATTERNS = [
  { freq: 'battle', re: /\bonce per (battle|game)\b/i },
  { freq: 'turn',   re: /\bonce per turn\b/i },
  { freq: 'phase',  re: /\bonce per phase\b/i },
];

// Reactive trigger phrases the player needs to be reminded of mid-phase.
// Stored as a flat list keyed by tag — the UI just shows the tags as
// labels next to the ability so the player knows "this ability fires
// when X happens", not when a phase starts.
const TRIGGER_PATTERNS = [
  { tag: 'select-to-shoot', re: /each time this unit is selected to shoot/i,
    label: 'Beim Schießen' },
  { tag: 'select-to-fight', re: /each time this unit is selected to fight/i,
    label: 'Beim Kämpfen' },
  { tag: 'makes-charge',   re: /each time this unit (makes|ends) a charge move|each time this unit declares a charge/i,
    label: 'Beim Sturmangriff' },
  { tag: 'leads-unit',     re: /while this unit is leading a unit/i,
    label: 'Während Anführer' },
  { tag: 'unit-destroyed', re: /(each|every) time (an?|this) (enemy )?unit is destroyed/i,
    label: 'Wenn Einheit zerstört' },
  { tag: 'model-destroyed',re: /(each|every) time (a )?model.*destroyed/i,
    label: 'Wenn Modell zerstört' },
  { tag: 'half-strength',  re: /(below|under) half[- ]strength|below half its starting strength/i,
    label: 'Unter halber Stärke' },
  { tag: 'objective',      re: /controls an objective marker|on an objective marker/i,
    label: 'Auf Ziel' },
  { tag: 'deep-strike',    re: /deep strike|deepstrike|reserves/i,
    label: 'Tiefschlag / Reserven' },
];

/**
 * Parse a single ability/stratagem text into structured tags.
 *
 * @param {{name?: string, text?: string, phase?: string}} entry
 * @returns {{
 *   phases:     string[],
 *   anyPhase:   boolean,
 *   timing:     'start'|'end'|null,
 *   frequency:  'battle'|'turn'|'phase'|null,
 *   triggers:   {tag:string,label:string}[],
 *   passive:    boolean,
 * }}
 */
export function parseAbility(entry) {
  const text = String(entry?.text || '');
  const phases = new Set();
  let anyPhase = false;

  // Explicit "Any phase" — show the ability everywhere.
  if (ANY_PHASE_RE.test(text)) anyPhase = true;
  for (const p of PHASE_PATTERNS) if (p.re.test(text)) phases.add(p.phase);

  // Stratagems carry a structured `phase` string — trust that over the
  // text scan and translate to canonical ids.
  if (entry?.phase) {
    const raw = String(entry.phase).toLowerCase();
    if (raw.includes('any')) anyPhase = true;
    for (const p of PHASE_IDS) {
      if (raw.includes(p)) phases.add(p);
    }
  }

  const timing = TIMING_PATTERNS.find(p => p.re.test(text))?.timing || null;
  const frequency = FREQUENCY_PATTERNS.find(p => p.re.test(text))?.freq || null;
  const triggers = TRIGGER_PATTERNS
    .filter(p => p.re.test(text))
    .map(p => ({ tag: p.tag, label: p.label }));

  const passive = !anyPhase
    && phases.size === 0
    && !timing
    && !frequency
    && triggers.length === 0;

  return {
    phases: [...phases],
    anyPhase,
    timing,
    frequency,
    triggers,
    passive,
  };
}

/**
 * Check whether a parsed entry is relevant for a given phase id. An
 * entry is relevant when it explicitly references that phase, or when
 * it's marked "any phase", or when it has a reactive trigger that could
 * fire in any phase (so the player still sees it in the contextual list).
 */
export function isRelevantInPhase(parsed, phaseId) {
  if (!parsed) return false;
  if (parsed.anyPhase) return true;
  if (parsed.phases.includes(phaseId)) return true;
  // Trigger-only abilities (e.g. "each time this unit shoots") map to
  // their natural phase via the trigger tag.
  for (const t of parsed.triggers) {
    if (t.tag === 'select-to-shoot' && phaseId === 'shooting') return true;
    if (t.tag === 'select-to-fight' && phaseId === 'fight') return true;
    if (t.tag === 'makes-charge'    && phaseId === 'charge') return true;
  }
  return false;
}
