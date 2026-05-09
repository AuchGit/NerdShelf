// scripts/wh40k-import/validate.mjs
//
// Validation runner. Combines:
//   1. Per-entity structural validation (delegated to schema.mjs)
//   2. Cross-entity reference validation (foreign keys are real)
//   3. Sanity validation (no orphans, no circular refs, sane totals)
//
// Each issue carries a severity ('error' | 'warning'). Errors fail an
// import (unless a --soft flag is passed via the CLI); warnings are
// surfaced in the report but don't block.

import { validateDataset } from './schema.mjs';

/**
 * Run every validator over `dataset` and return a flat list of issues.
 * @param {object} dataset  Canonical dataset (post-merge).
 */
export function runValidators(dataset) {
  const issues = [];

  // 1. Structural per-entity
  issues.push(...validateDataset(dataset));

  // 2. Reference integrity
  issues.push(...validateReferences(dataset));

  // 3. Sanity / invariants
  issues.push(...validateSanity(dataset));

  return issues;
}

/* ─────────────────── reference integrity ─────────────────── */
//
// Every foreign key field in the canonical model must resolve. Dangling
// references usually mean the merge layer dropped a row, or BSData
// references a sharedSelectionEntry we didn't index.

function validateReferences(ds) {
  const issues = [];
  const factionIds   = new Set(ds.factions.map(f => f.id));
  const detIds       = new Set(ds.detachments.map(d => d.id));
  const unitIds      = new Set(ds.units.map(u => u.id));
  const profIds      = new Set(ds.modelProfiles.map(p => p.id));
  const weaponIds    = new Set(ds.weaponProfiles.map(w => w.id));
  const abilityIds   = new Set(ds.abilities.map(a => a.id));
  const stratIds     = new Set(ds.stratagems.map(s => s.id));
  const enhIds       = new Set(ds.enhancements.map(e => e.id));
  const armyRuleIds  = new Set(ds.armyRules.map(r => r.id));
  const compIds      = new Set(ds.unitCompositions.map(c => c.id));
  const wgIds        = new Set(ds.wargearOptions.map(w => w.id));

  const ref = (set, id, code, path, entityId) => {
    if (id && !set.has(id)) {
      issues.push({ severity: 'error', code, path, entityId, message: `dangling reference "${id}"` });
    }
  };

  for (const d of ds.detachments) {
    ref(factionIds, d.factionId, 'ref-detachment-faction', `detachments.${d.id}.factionId`, d.id);
    for (const id of d.abilityIds || [])    ref(abilityIds, id, 'ref-detachment-ability',  `detachments.${d.id}.abilityIds`, d.id);
    for (const id of d.stratagemIds || [])  ref(stratIds,   id, 'ref-detachment-strat',    `detachments.${d.id}.stratagemIds`, d.id);
    for (const id of d.enhancementIds || []) ref(enhIds,    id, 'ref-detachment-enh',      `detachments.${d.id}.enhancementIds`, d.id);
  }

  for (const f of ds.factions) {
    for (const id of f.armyRuleIds || []) ref(armyRuleIds, id, 'ref-faction-armyrule', `factions.${f.id}.armyRuleIds`, f.id);
  }

  for (const u of ds.units) {
    ref(factionIds, u.factionId, 'ref-unit-faction',  `units.${u.id}.factionId`, u.id);
    ref(compIds,    u.compositionId, 'ref-unit-comp', `units.${u.id}.compositionId`, u.id);
    for (const id of u.modelProfileIds || []) ref(profIds, id, 'ref-unit-profile', `units.${u.id}.modelProfileIds`, u.id);
    for (const id of u.weaponProfileIds || []) ref(weaponIds, id, 'ref-unit-weapon', `units.${u.id}.weaponProfileIds`, u.id);
    for (const id of u.abilityIds || []) ref(abilityIds, id, 'ref-unit-ability', `units.${u.id}.abilityIds`, u.id);
    for (const id of u.wargearOptionIds || []) ref(wgIds, id, 'ref-unit-wargear', `units.${u.id}.wargearOptionIds`, u.id);
    for (const id of u.canLead || [])    ref(unitIds, id, 'ref-unit-canlead',  `units.${u.id}.canLead`, u.id);
    for (const id of u.canBeLedBy || []) ref(unitIds, id, 'ref-unit-canbeled', `units.${u.id}.canBeLedBy`, u.id);
  }

  for (const p of ds.modelProfiles)  ref(unitIds,    p.unitId,  'ref-profile-unit',  `modelProfiles.${p.id}.unitId`, p.id);
  for (const w of ds.weaponProfiles) if (w.unitId)  ref(unitIds,    w.unitId,  'ref-weapon-unit',   `weaponProfiles.${w.id}.unitId`, w.id);
  for (const a of ds.abilities) {
    if (a.factionId)    ref(factionIds, a.factionId,    'ref-ability-faction',    `abilities.${a.id}.factionId`, a.id);
    if (a.detachmentId) ref(detIds,     a.detachmentId, 'ref-ability-detachment', `abilities.${a.id}.detachmentId`, a.id);
    if (a.unitId)       ref(unitIds,    a.unitId,       'ref-ability-unit',       `abilities.${a.id}.unitId`, a.id);
  }
  for (const s of ds.stratagems) {
    ref(detIds, s.detachmentId,  'ref-strat-detachment', `stratagems.${s.id}.detachmentId`, s.id);
    ref(factionIds, s.factionId, 'ref-strat-faction',    `stratagems.${s.id}.factionId`, s.id);
  }
  for (const e of ds.enhancements) {
    ref(detIds, e.detachmentId,  'ref-enh-detachment', `enhancements.${e.id}.detachmentId`, e.id);
    ref(factionIds, e.factionId, 'ref-enh-faction',    `enhancements.${e.id}.factionId`, e.id);
  }
  for (const r of ds.armyRules) ref(factionIds, r.factionId, 'ref-armyrule-faction', `armyRules.${r.id}.factionId`, r.id);
  for (const c of ds.unitCompositions) ref(unitIds, c.unitId, 'ref-comp-unit', `unitCompositions.${c.id}.unitId`, c.id);
  for (const w of ds.wargearOptions)   ref(unitIds, w.unitId, 'ref-wargear-unit', `wargearOptions.${w.id}.unitId`, w.id);

  return issues;
}

/* ─────────────────── sanity / invariants ─────────────────── */

function validateSanity(ds) {
  const issues = [];

  // Duplicate IDs (cross-collection)
  const idIndex = new Map(); // id → first-seen-collection
  const collections = [
    'factions', 'detachments', 'units', 'modelProfiles', 'weaponProfiles',
    'abilities', 'keywords', 'stratagems', 'enhancements', 'armyRules',
    'unitCompositions', 'wargearOptions',
  ];
  for (const coll of collections) {
    for (const ent of ds[coll] || []) {
      if (!ent?.id) continue;
      if (idIndex.has(ent.id)) {
        issues.push({
          severity: 'error',
          code: 'duplicate-id',
          entityId: ent.id,
          message: `duplicate id "${ent.id}" in ${coll} (also in ${idIndex.get(ent.id)})`,
        });
      } else {
        idIndex.set(ent.id, coll);
      }
    }
  }

  // No-orphan rules — every model profile must be referenced by exactly
  // one unit (BSData allows reuse but it's vanishingly rare; flag).
  const profileToUnit = new Map();
  for (const u of ds.units) for (const id of u.modelProfileIds || []) {
    if (profileToUnit.has(id) && profileToUnit.get(id) !== u.id) {
      issues.push({
        severity: 'warning',
        code: 'profile-shared',
        entityId: id,
        message: `model profile referenced by multiple units (${profileToUnit.get(id)}, ${u.id})`,
      });
    }
    profileToUnit.set(id, u.id);
  }
  for (const p of ds.modelProfiles) {
    if (!profileToUnit.has(p.id)) {
      issues.push({
        severity: 'warning',
        code: 'profile-orphan',
        entityId: p.id,
        message: `model profile "${p.id}" not referenced by any unit`,
      });
    }
  }

  // Every unit must have at least one model profile and at least one
  // point entry — these are minimum requirements for the army builder.
  for (const u of ds.units) {
    if ((u.modelProfileIds || []).length === 0) {
      issues.push({ severity: 'error', code: 'unit-noprofile', entityId: u.id,
        message: `unit "${u.id}" has no model profiles` });
    }
    if ((u.points || []).length === 0) {
      issues.push({ severity: 'warning', code: 'unit-nopoints', entityId: u.id,
        message: `unit "${u.id}" has no point cost` });
    }
    // Faction keywords must be a subset of keywords
    const kws = new Set(u.keywords || []);
    for (const fk of u.factionKeywords || []) {
      if (!kws.has(fk)) {
        issues.push({
          severity: 'warning',
          code: 'unit-fk-not-kw',
          entityId: u.id,
          message: `unit "${u.id}" has factionKeyword "${fk}" not present in keywords[]`,
        });
      }
    }
  }

  // Stat strings should match the 10e shapes (e.g. saves end with '+')
  for (const p of ds.modelProfiles) {
    if (p.sv && !/^\d\+$/.test(p.sv)) {
      issues.push({ severity: 'warning', code: 'mp-sv-format', entityId: p.id,
        message: `model "${p.id}" save "${p.sv}" not in N+ format` });
    }
    if (p.t && !/^\d{1,2}$/.test(p.t)) {
      issues.push({ severity: 'warning', code: 'mp-t-format', entityId: p.id,
        message: `model "${p.id}" toughness "${p.t}" not numeric` });
    }
  }

  // Detachments without stratagems are a yellow flag (10e detachments
  // always have stratagems and enhancements).
  for (const d of ds.detachments) {
    if ((d.stratagemIds || []).length === 0) {
      issues.push({ severity: 'warning', code: 'det-no-strats', entityId: d.id,
        message: `detachment "${d.id}" has no stratagems` });
    }
    if ((d.enhancementIds || []).length === 0) {
      issues.push({ severity: 'warning', code: 'det-no-enhs', entityId: d.id,
        message: `detachment "${d.id}" has no enhancements` });
    }
  }

  // Circular leader-bodyguard references
  for (const u of ds.units) {
    for (const led of u.canBeLedBy || []) {
      const leader = ds.units.find(x => x.id === led);
      if (leader?.canBeLedBy?.includes(u.id)) {
        issues.push({ severity: 'error', code: 'circular-leader', entityId: u.id,
          message: `circular leader chain: ${u.id} ↔ ${led}` });
      }
    }
  }

  return issues;
}

/* ─────────────────── partition helpers ─────────────────── */

export function partitionIssues(issues) {
  const errors = [];
  const warnings = [];
  for (const i of issues) {
    if (i.severity === 'error') errors.push(i);
    else warnings.push(i);
  }
  return { errors, warnings };
}
