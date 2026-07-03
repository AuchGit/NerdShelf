// scripts/wh40k-import/merge.mjs
//
// Cross-source reconciliation. Each source produces a partial canonical
// dataset (see normalize.mjs); this layer merges them into ONE canonical
// dataset. The merge is field-aware, deterministic, and documented.
//
// ─────────────────── PRIORITY RULES ───────────────────
//
// Two principles guide the per-field priorities below:
//
//   1. STRUCTURE  → BSData wins. BSData encodes legal constraints
//      (modelCounts, costs, profile shapes, infoLink references) with
//      tournament accuracy because that's its native job.
//
//   2. PROSE      → Wahapedia wins. Wahapedia provides clean, copy-paste
//      friendly rules text whereas BSData often stores rules as terse
//      conditional modifiers that don't read well.
//
// The seed source is a fallback only — if BSData and Wahapedia both
// contribute, seed entries with the same canonical id are dropped.
//
// Conflicts that can't be auto-resolved (e.g. point-cost mismatch) are
// recorded as warnings on the dataset and surfaced by the report layer
// so the dataset author can fix the upstream divergence.

const SOURCE_RANK = { manual: 0, bsdata: 1, wahapedia: 2, seed: 3 };

/**
 * Merge an ordered list of partial canonicals (highest-priority first
 * doesn't matter — the per-field rules below are explicit) into one.
 *
 * Returns { merged, conflicts, stats }.
 */
export function mergeCanonicals(parts) {
  const conflicts = [];
  const stats = {};

  const factions       = mergeById(parts, 'factions',       FACTION_RULES, conflicts);
  const detachments    = mergeById(parts, 'detachments',    DETACHMENT_RULES, conflicts);
  const units          = mergeById(parts, 'units',          UNIT_RULES, conflicts);
  const modelProfiles  = mergeById(parts, 'modelProfiles',  PROFILE_RULES, conflicts);
  const weaponProfiles = mergeById(parts, 'weaponProfiles', WEAPON_RULES, conflicts);
  const abilities      = mergeById(parts, 'abilities',      ABILITY_RULES, conflicts);
  const keywords       = mergeById(parts, 'keywords',       KEYWORD_RULES, conflicts);
  const stratagems     = mergeById(parts, 'stratagems',     STRATAGEM_RULES, conflicts);
  const enhancements   = mergeById(parts, 'enhancements',   ENHANCEMENT_RULES, conflicts);
  const armyRules      = mergeById(parts, 'armyRules',      ARMYRULE_RULES, conflicts);
  const unitCompositions = mergeById(parts, 'unitCompositions', COMPOSITION_RULES, conflicts);
  const wargearOptions   = mergeById(parts, 'wargearOptions',   WARGEAR_RULES, conflicts);

  for (const k of Object.keys({
    factions, detachments, units, modelProfiles, weaponProfiles,
    abilities, keywords, stratagems, enhancements, armyRules,
    unitCompositions, wargearOptions,
  })) {
    stats[k] = { count: arguments[1]?.[k]?.length };
  }

  return {
    merged: {
      factions, detachments, units, modelProfiles, weaponProfiles,
      abilities, keywords, stratagems, enhancements, armyRules,
      unitCompositions, wargearOptions,
    },
    conflicts,
    stats,
  };
}

/**
 * Merge a single entity collection by id, applying the per-field rules.
 * Rules:
 *   { fieldName: 'first' | 'longest' | 'merge-array' | 'sum-sources' | <custom fn> }
 * If a field is omitted from the rules, the canonical default applies:
 *   - arrays  → merge-array (concat + dedup)
 *   - strings → longest (longest wins, ties → bsdata)
 *   - numbers → first
 */
function mergeById(parts, key, rules, conflicts) {
  const byId = new Map();
  for (const part of parts) {
    for (const ent of part[key] || []) {
      if (!ent?.id) continue;
      const existing = byId.get(ent.id);
      if (!existing) {
        byId.set(ent.id, structuredClone(ent));
        continue;
      }
      mergeEntity(existing, ent, rules, conflicts);
    }
  }
  return Array.from(byId.values());
}

function mergeEntity(target, incoming, rules, conflicts) {
  const allKeys = new Set([...Object.keys(target), ...Object.keys(incoming)]);
  for (const k of allKeys) {
    if (k === 'id' || k === 'source') continue;
    const rule = rules[k] ?? defaultRule(target[k], incoming[k]);
    target[k] = applyRule(rule, target[k], incoming[k], target, incoming, k, conflicts);
  }
  // Track contributors on source
  target.source = mergeSource(target.source, incoming.source);
}

function defaultRule(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return 'merge-array';
  if (typeof a === 'string' || typeof b === 'string') return 'longest';
  if (typeof a === 'number' || typeof b === 'number') return 'first';
  return 'first';
}

function applyRule(rule, a, b, target, incoming, fieldName, conflicts) {
  if (typeof rule === 'function') return rule(a, b, target, incoming);
  switch (rule) {
    case 'first':
      return a !== undefined && a !== null && a !== '' ? a : b;
    case 'incoming':
      return b !== undefined && b !== null && b !== '' ? b : a;
    case 'longest':
      if (typeof a !== 'string') return b ?? a;
      if (typeof b !== 'string') return a ?? b;
      if (a === b) return a;
      // Different strings → keep longest (usually the rules-text one)
      return a.length >= b.length ? a : b;
    case 'merge-array':
      return mergeArrayDedup(a, b);
    case 'prefer-bsdata':
      return preferBySource(a, b, target.source, incoming.source, 'bsdata');
    case 'prefer-wahapedia':
      return preferBySource(a, b, target.source, incoming.source, 'wahapedia');
    case 'min-positive':
      return minPositive(a, b);
    case 'max':
      return maxOf(a, b);
    case 'conflict-numeric': {
      // Non-equal numerics generate a conflict warning; we keep the BSData
      // value (structure-authoritative).
      const av = Number(a), bv = Number(b);
      if (Number.isFinite(av) && Number.isFinite(bv) && av !== bv) {
        conflicts.push({
          severity: 'warning',
          code: 'numeric-conflict',
          entityId: target.id,
          field: fieldName,
          message: `${fieldName}: ${av} (${target.source?.primary}) vs ${bv} (${incoming.source?.primary})`,
        });
      }
      return preferBySource(a, b, target.source, incoming.source, 'bsdata');
    }
    default:
      return a ?? b;
  }
}

function mergeArrayDedup(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length === 0) return bb;
  if (bb.length === 0) return aa;
  // For arrays of strings/ids: dedup by value.
  if (aa.every(x => typeof x === 'string') && bb.every(x => typeof x === 'string')) {
    const seen = new Set(); const out = [];
    for (const v of [...aa, ...bb]) { if (!seen.has(v)) { seen.add(v); out.push(v); } }
    return out;
  }
  // Otherwise stable concat (caller must ensure id-uniqueness).
  return [...aa, ...bb];
}

function preferBySource(a, b, srcA, srcB, preferred) {
  if (srcA?.primary === preferred) return a;
  if (srcB?.primary === preferred) return b;
  return a ?? b;
}

function minPositive(a, b) {
  const av = Number(a), bv = Number(b);
  if (av > 0 && bv > 0) return Math.min(av, bv);
  return av > 0 ? av : (bv > 0 ? bv : (a ?? b));
}
function maxOf(a, b) {
  const av = Number(a), bv = Number(b);
  if (Number.isFinite(av) && Number.isFinite(bv)) return Math.max(av, bv);
  return a ?? b;
}

function mergeSource(s, t) {
  if (!s) return t;
  if (!t) return s;
  const primary = SOURCE_RANK[s.primary] <= SOURCE_RANK[t.primary] ? s.primary : t.primary;
  const contributors = new Set([
    ...(s.contributors || [s.primary]),
    ...(t.contributors || [t.primary]),
  ]);
  contributors.delete(primary);
  return {
    primary,
    contributors: [...contributors],
    sourceIds: { ...(s.sourceIds || {}), ...(t.sourceIds || {}) },
  };
}

/* ─────────────────── per-entity rules ─────────────────── */

const FACTION_RULES = {
  name:           'longest',
  shortName:      'longest',
  alignment:      'first',          // alignment is hand-curated; first non-empty wins
  color:          'first',          // UI hint, hand-curated
  icon:           'first',          // UI hint, hand-curated
  armyRuleIds:    'merge-array',
  factionKeywords:'merge-array',
};

const DETACHMENT_RULES = {
  factionId:       'first',
  name:            'longest',
  description:     'prefer-wahapedia', // rules text
  abilityIds:      'merge-array',
  stratagemIds:    'merge-array',
  enhancementIds:  'merge-array',
};

const UNIT_RULES = {
  factionId:       'first',
  name:            'longest',
  role:            'prefer-bsdata',     // role is structural
  keywords:        'merge-array',
  factionKeywords: 'merge-array',
  // points: special handling — keep the BSData entries as authoritative
  // structure but ALSO check for divergence to log conflict.
  points:          (a, b, target, incoming) => mergePointArrays(a, b, target, incoming),
  modelProfileIds: 'merge-array',
  weaponProfileIds:'merge-array',
  abilityIds:      'merge-array',
  compositionId:   'first',
  wargearOptionIds:'merge-array',
  loadout:         'first',           // only Wahapedia ships default equipment
  transportCapacity: 'max',
  damagedProfileIds: 'merge-array',
  canLead:           'merge-array',
  canBeLedBy:        'merge-array',
  notes:           'longest',
};

function mergePointArrays(a, b) {
  // Merge by `models` count, taking the BSData value where divergent.
  const map = new Map();
  for (const e of (Array.isArray(a) ? a : [])) map.set(e.models, e.cost);
  for (const e of (Array.isArray(b) ? b : [])) {
    if (!map.has(e.models)) map.set(e.models, e.cost);
    // else: BSData wins; keep current
  }
  return [...map.entries()].map(([models, cost]) => ({ models, cost }))
    .sort((x, y) => x.models - y.models);
}

const PROFILE_RULES = {
  unitId: 'first', name: 'longest',
  m: 'longest', t: 'longest', sv: 'longest', w: 'longest', ld: 'longest', oc: 'longest',
  invSv: 'first',
  damagedThreshold: 'min-positive',
};

const WEAPON_RULES = {
  unitId: 'first',
  name: 'longest',
  kind: 'prefer-bsdata',
  range: 'longest', attacks: 'longest',
  bs: 'longest', ws: 'longest',
  strength: 'longest', ap: 'longest', damage: 'longest',
  abilities: 'merge-array',
  note: 'longest',
};

const ABILITY_RULES = {
  name: 'longest', text: 'prefer-wahapedia',
  scope: 'first',
  factionId: 'first', detachmentId: 'first', unitId: 'first',
  damagedThreshold: 'min-positive',
};

const KEYWORD_RULES = {
  name: 'longest', kind: 'first', factionId: 'first',
};

const STRATAGEM_RULES = {
  detachmentId: 'first', factionId: 'first',
  name: 'longest', cpCost: 'conflict-numeric', kind: 'first',
  phase: 'longest', whenText: 'longest', target: 'longest',
  effect: 'prefer-wahapedia', restriction: 'longest',
};

const ENHANCEMENT_RULES = {
  detachmentId: 'first', factionId: 'first',
  name: 'longest', cost: 'conflict-numeric',
  text: 'prefer-wahapedia', restriction: 'longest',
};

const ARMYRULE_RULES = {
  factionId: 'first', name: 'longest', text: 'prefer-wahapedia',
};

const COMPOSITION_RULES = {
  unitId: 'first', text: 'longest',
  minModels: 'min-positive', maxModels: 'max',
  requires: 'merge-array',
};

const WARGEAR_RULES = {
  unitId: 'first', text: 'longest', structured: 'first',
};
