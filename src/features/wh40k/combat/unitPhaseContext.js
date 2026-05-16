// src/features/wh40k/combat/unitPhaseContext.js
//
// Per-unit phase context. Given one combat-session unit instance + the
// canonical 40K unit record + the active phase id, returns everything
// the in-session card needs to render:
//
//   • relevantAbilities — parsed abilities of THIS unit that fire in
//                          the active phase (or are tagged "any phase"
//                          or have a trigger that resolves there).
//   • relevantWeapons   — weapons that get used in this phase. Empty
//                          for non-attack phases (Command / Movement /
//                          Charge / End); ranged for Shooting; melee
//                          for Fight.
//   • statHighlights    — canonical stat keys to badge in the card's
//                          stat strip ('m' for Movement, 'bs' for
//                          Shooting, 'ws'/'t'/'sv' for Fight, …).
//   • onceFlags         — abilities tagged "once per battle / turn /
//                          phase" so the card can render a tap-to-mark
//                          checkbox row.
//   • allAbilities, allWeapons — full lists for the "Mehr Details"
//                          expansion. Parsed once so the expanded
//                          datasheet doesn't repeat the work.
//
// Pure function, no React. All data-driven from the 40K dataset
// (units / model-profiles / weapons / abilities JSONs) so adding new
// content never requires a code change here.

import { parseAbility, isRelevantInPhase } from './abilityParser.js';
import { detectOnceFlag } from './onceFlags.js';

const PHASE_STAT_KEYS = {
  command:  ['ld', 'oc'],
  movement: ['m'],
  shooting: ['bs'],
  charge:   ['m'],
  fight:    ['ws', 't', 'sv'],
  end:      ['oc'],
};

const PHASE_LABELS = {
  command:  'Kommando',
  movement: 'Bewegung',
  shooting: 'Schießen',
  charge:   'Sturmangriff',
  fight:    'Kampf',
  end:      'Ende',
};

export function getUnitPhaseContext(canonUnit, phaseId, abilitiesById) {
  const stats = PHASE_STAT_KEYS[phaseId] || [];
  const phaseLabel = PHASE_LABELS[phaseId] || phaseId;
  if (!canonUnit) {
    return {
      allAbilities: [],
      relevantAbilities: [],
      allWeapons: [],
      relevantWeapons: [],
      onceFlags: [],
      statHighlights: stats,
      phaseLabel,
    };
  }

  // Prefer canonical ability records (richer metadata) over the inlined
  // ones on the hydrated unit. The hydrated unit holds `{name, text}`;
  // the canonical record additionally carries the id we need to dedupe
  // and the source attribution.
  const abilityRecords = (canonUnit.abilityIds || [])
    .map(id => abilitiesById?.[id])
    .filter(Boolean);
  const inlineFallback = Array.isArray(canonUnit.abilities) ? canonUnit.abilities : [];
  const sourceList = abilityRecords.length ? abilityRecords : inlineFallback;

  const allAbilities = sourceList.map(a => {
    const parsed = parseAbility(a);
    return {
      ability: a,
      parsed,
      onceFlag: detectOnceFlag(a),
      isPhaseRelevant: isRelevantInPhase(parsed, phaseId),
    };
  });

  const relevantAbilities = allAbilities.filter(e => e.isPhaseRelevant);
  const onceFlags = allAbilities.filter(e => e.onceFlag);

  const allWeapons = Array.isArray(canonUnit.wargear) ? canonUnit.wargear : [];
  const relevantWeapons = filterWeaponsForPhase(allWeapons, phaseId);

  return {
    allAbilities,
    relevantAbilities,
    allWeapons,
    relevantWeapons,
    onceFlags,
    statHighlights: stats,
    phaseLabel,
  };
}

function filterWeaponsForPhase(weapons, phaseId) {
  if (phaseId === 'shooting') {
    return weapons.filter(w => !isMelee(w) && hasRange(w));
  }
  if (phaseId === 'fight') {
    return weapons.filter(w => isMelee(w));
  }
  // Movement / Command / Charge / End: no specific weapons to surface.
  return [];
}

function isMelee(weapon) {
  const range = String(weapon?.range || '').toLowerCase().trim();
  return range === 'melee' || range === '-' || range === '';
}

function hasRange(weapon) {
  const range = String(weapon?.range || '').trim();
  return !!range && range !== '-';
}

/** Pull the unit's stat row(s) into a flat key→value map for the head
 *  badge strip. Falls back to dashes when a key is missing. */
export function flattenLeadStats(canonUnit) {
  const first = canonUnit?.stats?.[0];
  if (!first) return {};
  return {
    m:    first.m  ?? null,
    t:    first.t  ?? null,
    sv:   first.sv ?? null,
    w:    first.w  ?? null,
    ld:   first.ld ?? null,
    oc:   first.oc ?? null,
    invSv: first.invSv ?? null,
  };
}
