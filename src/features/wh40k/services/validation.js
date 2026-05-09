// src/features/wh40k/services/validation.js
//
// Tournament-grade validation is intentionally out of scope for the initial
// release. This file is the seam where future rules will plug in:
//
//   - Battleline minimum (2 for ≤1000 pts, 3 above) and Character cap.
//   - Detachment-specific role limits (e.g. Gladius required units).
//   - Army-rule restrictions (faction-specific keywords).
//   - Point-budget enforcement (1000 / 2000 / Crusade tracks).
//
// The army builder already calls `validateArmy()` and surfaces warnings, so
// adding rules here will light up the UI without further wiring.

/**
 * @param {{ entries: Record<string, {unitId:string,count:number}>, factionId?: string, detachmentId?: string }} army
 * @param {{ unitsById: Record<string, Unit>, detachments: Detachment[] }} ctx
 * @returns {{ warnings: string[], errors: string[] }}
 */
export function validateArmy(army, ctx) {
  const warnings = [];
  const errors = [];

  const entries = Object.values(army.entries || {});

  if (entries.length === 0) {
    warnings.push('Diese Armee ist leer.');
  }

  // TODO(validation): battleline minimum
  // TODO(validation): character cap
  // TODO(validation): detachment-specific role limits
  // TODO(validation): faction homogeneity (all units share army faction)

  if (army.factionId) {
    for (const e of entries) {
      const u = ctx.unitsById[e.unitId];
      if (u && u.factionId !== army.factionId) {
        errors.push(`Einheit "${u.name}" gehört nicht zu Fraktion "${army.factionId}".`);
      }
    }
  }

  return { warnings, errors };
}
