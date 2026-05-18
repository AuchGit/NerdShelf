// src/features/wh40k/services/points.js
//
// Army-level point computation. Single source of truth — used by the army
// builder header, the dashboard cards, and (eventually) the validator.
//
// `entries` shape:
//   - Plain unit entry: { unitId, count }
//     keyed by unitId — adding the same unit twice bumps `count`.
//   - Saved-squad entry: { unitId, count: 1, squadId, squadName, modelCount }
//     keyed by `squad-<squadId>` — each saved squad is its own slot so
//     multiple squads of the same datasheet at different sizes don't
//     collapse into each other.

/**
 * Look up the canonical cost of a unit at a specific model count using
 * the unit's `pointsCosts` table. Falls back to the legacy scalar `points`
 * if no matching tier exists.
 */
function unitCostAt(unit, modelCount) {
  if (!unit) return 0;
  const tiers = Array.isArray(unit.pointsCosts) ? unit.pointsCosts : [];
  if (modelCount != null) {
    const exact = tiers.find(t => Number(t.models) === Number(modelCount));
    if (exact) return Number(exact.cost) || 0;
    // Fallback to the closest tier with models <= modelCount.
    const sorted = tiers
      .map(t => ({ models: Number(t.models) || 0, cost: Number(t.cost) || 0 }))
      .sort((a, b) => a.models - b.models);
    let last = null;
    for (const t of sorted) if (t.models <= modelCount) last = t;
    if (last) return last.cost;
  }
  return unit.points || 0;
}

export function entryPoints(entry, unitsById) {
  const u = unitsById[entry.unitId];
  if (!u) return 0;
  const per = unitCostAt(u, entry.modelCount);
  return per * (entry.count || 0);
}

export function totalArmyPoints(entries, unitsById) {
  let sum = 0;
  for (const e of Object.values(entries || {})) {
    sum += entryPoints(e, unitsById);
  }
  return sum;
}

export function totalModelCount(entries, unitsById) {
  let n = 0;
  for (const e of Object.values(entries || {})) {
    const u = unitsById[e.unitId];
    if (!u) continue;
    const baseSize = e.modelCount != null
      ? Number(e.modelCount)
      : (u.modelCounts?.[0] || 1);
    n += baseSize * (e.count || 0);
  }
  return n;
}
