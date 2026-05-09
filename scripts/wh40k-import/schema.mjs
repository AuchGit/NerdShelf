// scripts/wh40k-import/schema.mjs
//
// Runtime structural validators that mirror schema.d.ts. Hand-rolled rather
// than relying on a third-party validator (zod, ajv, …) to keep the
// pipeline dependency-light. Each validator returns an array of issue
// objects so the higher-level validator runner can aggregate, classify,
// and report them.
//
// Issue shape:
//   { severity: 'error'|'warning', code: string, path: string, message: string, entityId?: string }

const ROLES = new Set([
  'character', 'epic-hero', 'battleline', 'infantry', 'mounted',
  'vehicle', 'walker', 'monster', 'beast', 'fortification',
  'transport', 'aircraft', 'titanic',
]);

const ALIGNMENTS = new Set(['imperium', 'chaos', 'xenos', 'unaligned']);

const ABILITY_SCOPES = new Set([
  'core', 'faction', 'detachment', 'unit', 'wargear', 'enhancement', 'damaged',
]);

const STRATAGEM_KINDS = new Set([
  'battle-tactic', 'wargear', 'epic-deed', 'strategic-ploy', 'requisition',
]);

const KEYWORD_KINDS = new Set([
  'general', 'role', 'faction', 'subfaction', 'unit-type', 'army-of-renown',
]);

const WEAPON_KINDS = new Set(['ranged', 'melee']);

function err(code, path, message, entityId) {
  return { severity: 'error', code, path, message, entityId };
}
function warn(code, path, message, entityId) {
  return { severity: 'warning', code, path, message, entityId };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function checkId(value, path, issues, entityId) {
  if (!isNonEmptyString(value)) {
    issues.push(err('id-empty', path, `id must be a non-empty string`, entityId));
    return false;
  }
  // Canonical IDs use lowercase, alphanumeric, '-', '--' separators only.
  if (!/^[a-z0-9][a-z0-9-]*(--[a-z0-9-]+)*$/.test(value)) {
    issues.push(warn('id-format', path, `id "${value}" does not match canonical slug format`, entityId));
  }
  return true;
}

/* ─────────────────── per-entity validators ─────────────────── */

export function validateFaction(f, issues = []) {
  const id = f?.id;
  checkId(id, `factions.${id}.id`, issues, id);
  if (!isNonEmptyString(f.name))      issues.push(err('faction-name', `factions.${id}.name`, 'name required', id));
  if (!isNonEmptyString(f.shortName)) issues.push(err('faction-shortName', `factions.${id}.shortName`, 'shortName required', id));
  if (!ALIGNMENTS.has(f.alignment))   issues.push(err('faction-alignment', `factions.${id}.alignment`, `invalid alignment "${f.alignment}"`, id));
  if (!Array.isArray(f.armyRuleIds))   issues.push(err('faction-armyRuleIds', `factions.${id}.armyRuleIds`, 'armyRuleIds must be array', id));
  if (!Array.isArray(f.factionKeywords)) issues.push(err('faction-factionKeywords', `factions.${id}.factionKeywords`, 'factionKeywords must be array', id));
  return issues;
}

export function validateDetachment(d, issues = []) {
  const id = d?.id;
  checkId(id, `detachments.${id}.id`, issues, id);
  if (!isNonEmptyString(d.factionId)) issues.push(err('det-factionId', `detachments.${id}.factionId`, 'factionId required', id));
  if (!isNonEmptyString(d.name))      issues.push(err('det-name', `detachments.${id}.name`, 'name required', id));
  for (const f of ['abilityIds', 'stratagemIds', 'enhancementIds']) {
    if (!Array.isArray(d[f])) issues.push(err('det-array', `detachments.${id}.${f}`, `${f} must be array`, id));
  }
  return issues;
}

export function validateUnit(u, issues = []) {
  const id = u?.id;
  checkId(id, `units.${id}.id`, issues, id);
  if (!isNonEmptyString(u.factionId)) issues.push(err('unit-factionId', `units.${id}.factionId`, 'factionId required', id));
  if (!isNonEmptyString(u.name))      issues.push(err('unit-name', `units.${id}.name`, 'name required', id));
  if (!ROLES.has(u.role))             issues.push(err('unit-role', `units.${id}.role`, `invalid role "${u.role}"`, id));
  for (const f of ['keywords', 'factionKeywords', 'modelProfileIds', 'weaponProfileIds', 'abilityIds', 'wargearOptionIds']) {
    if (!Array.isArray(u[f])) issues.push(err('unit-array', `units.${id}.${f}`, `${f} must be array`, id));
  }
  if (!Array.isArray(u.points)) {
    issues.push(err('unit-points', `units.${id}.points`, 'points must be array of {models,cost}', id));
  } else {
    for (const [i, p] of u.points.entries()) {
      if (!Number.isInteger(p.models) || p.models < 1) {
        issues.push(err('unit-points-models', `units.${id}.points[${i}].models`, 'models must be positive int', id));
      }
      if (!Number.isFinite(p.cost) || p.cost < 0) {
        issues.push(err('unit-points-cost', `units.${id}.points[${i}].cost`, 'cost must be non-negative number', id));
      }
    }
    if (u.points.length === 0) {
      issues.push(warn('unit-points-empty', `units.${id}.points`, 'unit has no point entries', id));
    }
  }
  if (!isNonEmptyString(u.compositionId)) {
    issues.push(err('unit-compositionId', `units.${id}.compositionId`, 'compositionId required', id));
  }
  return issues;
}

export function validateModelProfile(p, issues = []) {
  const id = p?.id;
  checkId(id, `modelProfiles.${id}.id`, issues, id);
  if (!isNonEmptyString(p.unitId))    issues.push(err('mp-unitId', `modelProfiles.${id}.unitId`, 'unitId required', id));
  if (!isNonEmptyString(p.name))      issues.push(err('mp-name', `modelProfiles.${id}.name`, 'name required', id));
  for (const stat of ['m', 't', 'sv', 'w', 'ld', 'oc']) {
    if (!isNonEmptyString(p[stat])) {
      issues.push(err('mp-stat', `modelProfiles.${id}.${stat}`, `${stat} required`, id));
    }
  }
  return issues;
}

export function validateWeaponProfile(w, issues = []) {
  const id = w?.id;
  checkId(id, `weaponProfiles.${id}.id`, issues, id);
  if (!isNonEmptyString(w.name))    issues.push(err('wp-name', `weaponProfiles.${id}.name`, 'name required', id));
  if (!WEAPON_KINDS.has(w.kind))    issues.push(err('wp-kind', `weaponProfiles.${id}.kind`, `invalid kind "${w.kind}"`, id));
  for (const f of ['range', 'attacks', 'strength', 'ap', 'damage']) {
    if (!isNonEmptyString(w[f])) {
      issues.push(err('wp-stat', `weaponProfiles.${id}.${f}`, `${f} required`, id));
    }
  }
  if (!Array.isArray(w.abilities)) issues.push(err('wp-abilities', `weaponProfiles.${id}.abilities`, 'abilities must be array', id));
  if (w.kind === 'melee' && !w.ws && !w.bs) {
    issues.push(warn('wp-skill-missing', `weaponProfiles.${id}.ws`, 'melee weapon missing both ws and bs', id));
  }
  return issues;
}

export function validateAbility(a, issues = []) {
  const id = a?.id;
  checkId(id, `abilities.${id}.id`, issues, id);
  if (!isNonEmptyString(a.name))   issues.push(err('ab-name', `abilities.${id}.name`, 'name required', id));
  if (!isNonEmptyString(a.text))   issues.push(warn('ab-text', `abilities.${id}.text`, 'text empty', id));
  if (!ABILITY_SCOPES.has(a.scope)) issues.push(err('ab-scope', `abilities.${id}.scope`, `invalid scope "${a.scope}"`, id));
  return issues;
}

export function validateKeyword(k, issues = []) {
  const id = k?.id;
  checkId(id, `keywords.${id}.id`, issues, id);
  if (!isNonEmptyString(k.name))    issues.push(err('kw-name', `keywords.${id}.name`, 'name required', id));
  if (k.name !== k.name.toUpperCase()) {
    issues.push(warn('kw-case', `keywords.${id}.name`, `keyword name should be uppercase: "${k.name}"`, id));
  }
  if (!KEYWORD_KINDS.has(k.kind))   issues.push(err('kw-kind', `keywords.${id}.kind`, `invalid kind "${k.kind}"`, id));
  return issues;
}

export function validateStratagem(s, issues = []) {
  const id = s?.id;
  checkId(id, `stratagems.${id}.id`, issues, id);
  if (!isNonEmptyString(s.detachmentId)) issues.push(err('strat-detId', `stratagems.${id}.detachmentId`, 'detachmentId required', id));
  if (!isNonEmptyString(s.factionId))    issues.push(err('strat-factionId', `stratagems.${id}.factionId`, 'factionId required', id));
  if (!isNonEmptyString(s.name))         issues.push(err('strat-name', `stratagems.${id}.name`, 'name required', id));
  if (!Number.isFinite(s.cpCost) || s.cpCost < 0) {
    issues.push(err('strat-cpCost', `stratagems.${id}.cpCost`, `invalid cpCost ${s.cpCost}`, id));
  }
  if (!STRATAGEM_KINDS.has(s.kind)) issues.push(err('strat-kind', `stratagems.${id}.kind`, `invalid kind "${s.kind}"`, id));
  if (!isNonEmptyString(s.effect))  issues.push(warn('strat-effect', `stratagems.${id}.effect`, 'effect empty', id));
  return issues;
}

export function validateEnhancement(e, issues = []) {
  const id = e?.id;
  checkId(id, `enhancements.${id}.id`, issues, id);
  if (!isNonEmptyString(e.detachmentId)) issues.push(err('enh-detId', `enhancements.${id}.detachmentId`, 'detachmentId required', id));
  if (!isNonEmptyString(e.factionId))    issues.push(err('enh-factionId', `enhancements.${id}.factionId`, 'factionId required', id));
  if (!isNonEmptyString(e.name))         issues.push(err('enh-name', `enhancements.${id}.name`, 'name required', id));
  if (!Number.isFinite(e.cost) || e.cost < 0) {
    issues.push(err('enh-cost', `enhancements.${id}.cost`, `invalid cost ${e.cost}`, id));
  }
  if (!isNonEmptyString(e.text)) issues.push(warn('enh-text', `enhancements.${id}.text`, 'text empty', id));
  return issues;
}

export function validateArmyRule(r, issues = []) {
  const id = r?.id;
  checkId(id, `armyRules.${id}.id`, issues, id);
  if (!isNonEmptyString(r.factionId)) issues.push(err('ar-factionId', `armyRules.${id}.factionId`, 'factionId required', id));
  if (!isNonEmptyString(r.name))      issues.push(err('ar-name', `armyRules.${id}.name`, 'name required', id));
  if (!isNonEmptyString(r.text))      issues.push(warn('ar-text', `armyRules.${id}.text`, 'text empty', id));
  return issues;
}

/* ─────────────────── dataset-level ─────────────────── */

export function validateDataset(ds) {
  const issues = [];
  for (const f of ds.factions || [])      validateFaction(f, issues);
  for (const d of ds.detachments || [])   validateDetachment(d, issues);
  for (const u of ds.units || [])         validateUnit(u, issues);
  for (const p of ds.modelProfiles || []) validateModelProfile(p, issues);
  for (const w of ds.weaponProfiles || []) validateWeaponProfile(w, issues);
  for (const a of ds.abilities || [])     validateAbility(a, issues);
  for (const k of ds.keywords || [])      validateKeyword(k, issues);
  for (const s of ds.stratagems || [])    validateStratagem(s, issues);
  for (const e of ds.enhancements || [])  validateEnhancement(e, issues);
  for (const r of ds.armyRules || [])     validateArmyRule(r, issues);
  return issues;
}
