// src/features/wh40k/services/points.js
//
// Army-level point computation. Single source of truth — used by the army
// builder header, the dashboard cards, and (eventually) the validator.
//
// `entries` shape: { [unitId]: { unitId, count } }

export function totalArmyPoints(entries, unitsById) {
  let sum = 0;
  for (const e of Object.values(entries || {})) {
    const u = unitsById[e.unitId];
    if (!u) continue;
    sum += (u.points || 0) * (e.count || 0);
  }
  return sum;
}

export function totalModelCount(entries, unitsById) {
  let n = 0;
  for (const e of Object.values(entries || {})) {
    const u = unitsById[e.unitId];
    if (!u) continue;
    const baseSize = u.modelCounts?.[0] || 1;
    n += baseSize * (e.count || 0);
  }
  return n;
}
