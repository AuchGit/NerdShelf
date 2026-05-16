// src/features/wh40k/combat/phaseContext.js
//
// Given a live CombatSession + the hydrated 40K dataset, compute everything
// the Combat HUD needs to show for the active phase — all derived, no
// hand-curated lists per faction. Three buckets come out:
//
//   stratagems:  the detachment's stratagems whose phase matches the
//                active phase (using both the structured phase field and
//                the parser fallback for the rare unstructured row).
//   abilities:   abilities of every still-alive unit in the army that
//                reference the active phase or fire on a trigger that
//                resolves in this phase.
//   reminders:   the existing rule-based reminders engine output.
//
// Each bucket entry is enriched with `parsed` (the structured tags from
// abilityParser) so the UI can render badges like "1× Schlacht", "Start",
// "Beim Schießen" without re-parsing on every render.

import { parseAbility, isRelevantInPhase } from './abilityParser.js';
import { buildContext as buildReminderContext, listRemindersForPhase } from './reminders.js';
import { detectOnceFlag } from './onceFlags.js';
import { getCorePhaseRules } from './coreRules.js';
import { getFactionPhaseRules } from './factionRules.js';

/**
 * Build the per-phase context.
 *
 * @param {object} session         — live CombatSession
 * @param {object} data            — hydrated dataset from useWh40kData
 * @returns {{
 *   coreRules:      object[],
 *   detachmentRule: { name: string, text: string, description?: string } | null,
 *   stratagems:     object[],
 *   abilities:      { unit: object, ability: object, parsed: object }[],
 *   reminders:      object[],
 *   onceFlags:      { unit: object, ability: object, parsed: object, flag: object }[],
 * }}
 */
export function buildPhaseContext(session, data) {
  if (!session || !data) {
    return {
      coreRules: [], detachmentRule: null,
      stratagems: [], abilities: [], reminders: [], onceFlags: [],
    };
  }
  const phaseId = session.currentPhase;

  // 0. Core rules of the active phase — the 10e rulebook procedure the
  //    player needs to walk through regardless of army or detachment.
  const coreRules = getCorePhaseRules(phaseId);

  // 0b. Detachment rule itself (e.g. "Oath of Moment", "Spirit Stones",
  //     "Hateful Assault"). Pulled from the canonical dataset so it works
  //     for any faction without per-faction logic here. The detachment
  //     can declare one or more ability rows in `abilityIds`; we surface
  //     them all under a single header.
  const detachment = (session.detachmentId && data.detachmentsById)
    ? data.detachmentsById[session.detachmentId]
    : null;
  let detachmentRules = [];
  if (detachment) {
    detachmentRules = (detachment.abilityIds || [])
      .map(id => data.abilitiesById?.[id])
      .filter(Boolean);
  }
  const detachmentRule = detachment ? {
    name: detachment.name,
    description: detachment.description || '',
    rules: detachmentRules,
  } : null;

  // 1. Stratagems of this detachment, filtered to the active phase.
  const detStrats = data.stratagemsByDetachment?.[session.detachmentId] || [];
  const stratagems = detStrats
    .map(s => ({ ...s, parsed: parseAbility(s) }))
    .filter(s => isRelevantInPhase(s.parsed, phaseId))
    .sort((a, b) => (a.cpCost ?? 99) - (b.cpCost ?? 99) || a.name.localeCompare(b.name));

  // 2. Abilities across all *still-on-the-table* units in the session.
  //    For each living unit instance we resolve its canonical unit, walk
  //    its abilityIds, parse, and keep the ones relevant to the phase.
  //    We dedupe by (unitName, abilityName) so a squad of 3 identical
  //    Intercessor squads doesn't print Oath of Moment three times.
  const seen = new Set();
  const abilities = [];
  const onceFlags = [];
  const aliveInstances = Object.values(session.units || {})
    .filter(u => u.status !== 'destroyed' && u.status !== 'fled');

  for (const inst of aliveInstances) {
    const canon = data.unitsById?.[inst.unitId];
    if (!canon) continue;
    // hydrateUnit attaches `{ name, text }` ability objects; the canonical
    // ability lookup gives us the richer record. Prefer the canonical one
    // so we have stable ids.
    const abilityRecords = (canon.abilityIds || [])
      .map(id => data.abilitiesById?.[id])
      .filter(Boolean);
    // Fallback for older code paths that only put inlined abilities on
    // the hydrated unit.
    const fallback = Array.isArray(canon.abilities) ? canon.abilities : [];
    const list = abilityRecords.length ? abilityRecords : fallback;

    for (const ab of list) {
      const parsed = parseAbility(ab);
      const dedupeKey = `${inst.unitId}|${ab.id || ab.name}`;
      if (seen.has(dedupeKey)) continue;

      // Once-flag detection (already existed; we keep it data-driven via
      // text scan). Surfaced as a separate bucket so the HUD can render
      // the tap-to-mark UI in one place.
      const flag = detectOnceFlag(ab);
      if (flag) {
        onceFlags.push({ unit: inst, ability: ab, parsed, flag });
      }

      if (isRelevantInPhase(parsed, phaseId)) {
        seen.add(dedupeKey);
        abilities.push({ unit: inst, ability: ab, parsed });
      }
    }
  }

  // Sort abilities by timing priority (start > end > untimed), then
  // alphabetically by unit name + ability name so the list stays stable
  // between renders.
  const TIMING_RANK = { start: 0, end: 1 };
  abilities.sort((a, b) => {
    const ra = TIMING_RANK[a.parsed.timing] ?? 2;
    const rb = TIMING_RANK[b.parsed.timing] ?? 2;
    if (ra !== rb) return ra - rb;
    const un = (a.unit.name || '').localeCompare(b.unit.name || '');
    if (un) return un;
    return (a.ability.name || '').localeCompare(b.ability.name || '');
  });

  // 3. Reminders engine — already phase-scoped.
  const reminderCtx = buildReminderContext(session, data.unitsById);
  const reminders = listRemindersForPhase(reminderCtx);

  return { coreRules, detachmentRule, stratagems, abilities, reminders, onceFlags };
}
