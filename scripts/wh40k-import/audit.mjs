// scripts/wh40k-import/audit.mjs
//
// Data completeness audit. Reads the *emitted* canonical dataset on disk
// (not any in-memory pipeline state) and produces three artefacts:
//
//   1. A structured report object  → in-memory + JSON file on disk
//   2. A pretty console summary    → stdout
//   3. A Markdown report           → file on disk (suitable to copy/paste
//                                    into a release notes / docs page)
//
// The audit is intentionally separate from validate.mjs:
//
//   - validate.mjs runs INSIDE the pipeline as a *gate*. It speaks in
//     errors/warnings and is the line of defence the importer trips on.
//
//   - audit.mjs runs AFTER the pipeline as a *coverage measurement*. It
//     reports counts, distributions, completeness ratios, source mix —
//     "is this dataset shippable?" rather than "is this dataset valid?".
//
// Strict mode (WH40K_STRICT=1) raises any audit warning to a build
// failure, suitable for CI gates beyond the smoke `check-wh40k-dataset`.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GAME_EDITION, DATASET_VERSION, OUTPUT_ROOT, REPORT_DIR, STRICT,
} from './config.mjs';

/* ─────────────────── coverage thresholds ─────────────────── */
//
// Tunable, per-mode. `seed` clears with a curated 22-unit dataset; `full`
// clears only with a real BSData+Wahapedia import.

export const THRESHOLDS = {
  seed: {
    minFactions: 8,
    minUnits: 18,
    minDetachments: 12,
    minModelProfiles: 18,
    minWeapons: 18,
    minKeywords: 10,
    minAbilities: 15,
    minStratagems: 0,        // seed has no strats
    minEnhancements: 0,      // seed has no enhancements
    suspiciousFactionUnitFloor: 1,
    coverageWarnAbsentEntities: ['stratagems', 'enhancements'],
  },
  full: {
    minFactions: 18,
    minUnits: 250,
    minDetachments: 50,
    minModelProfiles: 300,
    minWeapons: 400,
    minKeywords: 80,
    minAbilities: 250,
    minStratagems: 80,
    minEnhancements: 60,
    suspiciousFactionUnitFloor: 8,
    coverageWarnAbsentEntities: [],
  },
};

/** Choose a profile based on dataset size — once a real import has run we
 *  raise the bar automatically. */
export function pickThresholdProfile(counts) {
  if (counts.units >= 100 || counts.stratagems >= 50) return 'full';
  return 'seed';
}

/* ─────────────────── loaders ─────────────────── */

async function loadDataset(edition = GAME_EDITION, version = DATASET_VERSION) {
  const dir = resolve(OUTPUT_ROOT, edition, version);
  if (!existsSync(dir)) throw new Error(`audit: ${dir} does not exist`);
  const j = async (f) => {
    try { return JSON.parse(await readFile(resolve(dir, f), 'utf8')); }
    catch (e) { throw new Error(`audit: failed to read ${f}: ${e.message}`); }
  };
  return {
    factions:         await j('factions.json'),
    detachments:      await j('detachments.json'),
    units:            await j('units.json'),
    modelProfiles:    await j('model-profiles.json'),
    weaponProfiles:   await j('weapons.json'),
    abilities:        await j('abilities.json'),
    keywords:         await j('keywords.json'),
    stratagems:       await j('stratagems.json'),
    enhancements:     await j('enhancements.json'),
    armyRules:        await j('army-rules.json'),
    unitCompositions: await j('unit-compositions.json'),
    wargearOptions:   await j('wargear-options.json'),
    manifest:         await j('manifest.json'),
  };
}

/* ─────────────────── checks ─────────────────── */

function buildIndex(ds) {
  return {
    factionsById:       indexBy(ds.factions, 'id'),
    detachmentsById:    indexBy(ds.detachments, 'id'),
    unitsById:          indexBy(ds.units, 'id'),
    modelProfilesById:  indexBy(ds.modelProfiles, 'id'),
    weaponsById:        indexBy(ds.weaponProfiles, 'id'),
    abilitiesById:      indexBy(ds.abilities, 'id'),
    keywordsById:       indexBy(ds.keywords, 'id'),
    unitsByFaction:     groupBy(ds.units, 'factionId'),
    detachmentsByFaction: groupBy(ds.detachments, 'factionId'),
    stratagemsByDet:    groupBy(ds.stratagems, 'detachmentId'),
    enhancementsByDet:  groupBy(ds.enhancements, 'detachmentId'),
  };
}

function indexBy(arr, k) { const m = {}; for (const e of arr) m[e[k]] = e; return m; }
function groupBy(arr, k) { const m = {}; for (const e of arr) (m[e[k]] ||= []).push(e); return m; }

/**
 * Run every audit check. Returns:
 *   {
 *     counts,                        // per-entity totals
 *     factionCoverage: FactionRow[], // unit counts per faction etc.
 *     issues,                        // { severity, code, message }[]
 *     sourceMix,                     // { bsdata, wahapedia, seed, manual }
 *     completeness,                  // ratios for the score panel
 *   }
 */
export function auditDataset(ds, opts = {}) {
  const counts = {
    factions:         ds.factions.length,
    detachments:      ds.detachments.length,
    units:            ds.units.length,
    modelProfiles:    ds.modelProfiles.length,
    weapons:          ds.weaponProfiles.length,
    abilities:        ds.abilities.length,
    keywords:         ds.keywords.length,
    stratagems:       ds.stratagems.length,
    enhancements:     ds.enhancements.length,
    armyRules:        ds.armyRules.length,
    unitCompositions: ds.unitCompositions.length,
    wargearOptions:   ds.wargearOptions.length,
  };

  const profile = opts.profile || pickThresholdProfile(counts);
  const thresh = THRESHOLDS[profile];
  const issues = [];
  const idx = buildIndex(ds);

  /* ─── minimums ─── */
  const MIN_MAP = {
    factions: thresh.minFactions, units: thresh.minUnits,
    detachments: thresh.minDetachments, modelProfiles: thresh.minModelProfiles,
    weapons: thresh.minWeapons, keywords: thresh.minKeywords,
    abilities: thresh.minAbilities, stratagems: thresh.minStratagems,
    enhancements: thresh.minEnhancements,
  };
  for (const [k, min] of Object.entries(MIN_MAP)) {
    if (counts[k] < min) {
      issues.push({
        severity: 'error',
        code: `count-${k}-below-min`,
        message: `${k} = ${counts[k]} < minimum ${min} (profile=${profile})`,
      });
    }
  }

  /* ─── faction coverage rows ─── */
  const factionCoverage = ds.factions.map(f => {
    const units = idx.unitsByFaction[f.id] || [];
    const dets = idx.detachmentsByFaction[f.id] || [];
    const detStratCount = dets.reduce((s, d) => s + (idx.stratagemsByDet[d.id] || []).length, 0);
    const detEnhCount = dets.reduce((s, d) => s + (idx.enhancementsByDet[d.id] || []).length, 0);
    return {
      id: f.id, name: f.name,
      units: units.length,
      detachments: dets.length,
      stratagems: detStratCount,
      enhancements: detEnhCount,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  for (const row of factionCoverage) {
    if (row.units < thresh.suspiciousFactionUnitFloor) {
      issues.push({
        severity: 'warning',
        code: 'faction-low-units',
        entityId: row.id,
        message: `faction "${row.name}" has only ${row.units} units (floor=${thresh.suspiciousFactionUnitFloor})`,
      });
    }
    if (row.detachments === 0) {
      issues.push({
        severity: 'warning',
        code: 'faction-no-detachments',
        entityId: row.id,
        message: `faction "${row.name}" has no detachments`,
      });
    }
  }

  /* ─── per-unit completeness ─── */
  let unitsNoWeapons = 0;
  let unitsNoAbilities = 0;
  let unitsNoKeywords = 0;
  let unitsNoPoints = 0;
  let unitsMalformedSv = 0;
  let unitsNoComposition = 0;

  for (const u of ds.units) {
    if ((u.weaponProfileIds || []).length === 0) unitsNoWeapons++;
    if ((u.abilityIds || []).length === 0)       unitsNoAbilities++;
    if ((u.keywords || []).length === 0)         unitsNoKeywords++;
    if ((u.points || []).length === 0)           unitsNoPoints++;
    if (!u.compositionId || !idx.unitsById[u.id]) { /* covered elsewhere */ }
    if (!idx.unitsById[u.id]) continue;
    // statline sanity from referenced profiles
    for (const pid of u.modelProfileIds || []) {
      const p = idx.modelProfilesById[pid];
      if (!p) continue;
      if (p.sv && !/^\d\+$/.test(p.sv)) { unitsMalformedSv++; break; }
    }
    if (!u.compositionId) unitsNoComposition++;
  }

  const completeness = {
    weapons:   pct(ds.units.length - unitsNoWeapons,   ds.units.length),
    abilities: pct(ds.units.length - unitsNoAbilities, ds.units.length),
    keywords:  pct(ds.units.length - unitsNoKeywords,  ds.units.length),
    points:    pct(ds.units.length - unitsNoPoints,    ds.units.length),
    composition: pct(ds.units.length - unitsNoComposition, ds.units.length),
  };

  if (unitsNoWeapons > 0)   issues.push({ severity: 'warning', code: 'units-no-weapons',   message: `${unitsNoWeapons} unit(s) have no weapons` });
  if (unitsNoAbilities > 0) issues.push({ severity: 'warning', code: 'units-no-abilities', message: `${unitsNoAbilities} unit(s) have no abilities` });
  if (unitsNoKeywords > 0)  issues.push({ severity: 'error',   code: 'units-no-keywords',  message: `${unitsNoKeywords} unit(s) have no keywords` });
  if (unitsNoPoints > 0)    issues.push({ severity: 'error',   code: 'units-no-points',    message: `${unitsNoPoints} unit(s) have no point cost` });
  if (unitsMalformedSv > 0) issues.push({ severity: 'warning', code: 'units-malformed-sv', message: `${unitsMalformedSv} unit(s) have malformed save stat` });

  /* ─── ref / orphan sweep ─── */
  const dangling = [];
  const reachable = {
    weapons: new Set(), profiles: new Set(), abilities: new Set(),
  };
  for (const u of ds.units) {
    for (const id of u.weaponProfileIds || []) {
      if (!idx.weaponsById[id]) dangling.push(`unit ${u.id} → weapon ${id}`);
      else reachable.weapons.add(id);
    }
    for (const id of u.modelProfileIds || []) {
      if (!idx.modelProfilesById[id]) dangling.push(`unit ${u.id} → profile ${id}`);
      else reachable.profiles.add(id);
    }
    for (const id of u.abilityIds || []) {
      if (!idx.abilitiesById[id]) dangling.push(`unit ${u.id} → ability ${id}`);
      else reachable.abilities.add(id);
    }
  }
  if (dangling.length) {
    issues.push({
      severity: 'error', code: 'dangling-refs',
      message: `${dangling.length} dangling reference(s); first: ${dangling[0]}`,
    });
  }
  const orphanWeapons = ds.weaponProfiles.filter(w => !reachable.weapons.has(w.id));
  const orphanProfiles = ds.modelProfiles.filter(p => !reachable.profiles.has(p.id));
  if (orphanWeapons.length)
    issues.push({ severity: 'warning', code: 'orphan-weapons', message: `${orphanWeapons.length} orphan weapon profile(s)` });
  if (orphanProfiles.length)
    issues.push({ severity: 'warning', code: 'orphan-profiles', message: `${orphanProfiles.length} orphan model profile(s)` });

  /* ─── duplicate canonical names ─── */
  const nameMap = new Map();
  for (const u of ds.units) {
    const key = `${u.factionId}:${(u.name || '').toLowerCase()}`;
    if (nameMap.has(key)) {
      issues.push({
        severity: 'warning', code: 'duplicate-unit-name',
        entityId: u.id,
        message: `duplicate unit name within faction: "${u.name}" (${u.id} vs ${nameMap.get(key)})`,
      });
    } else nameMap.set(key, u.id);
  }

  /* ─── absent-entity coverage warnings (seed profile only) ─── */
  for (const k of thresh.coverageWarnAbsentEntities || []) {
    if (counts[k] === 0) {
      issues.push({
        severity: 'info',
        code: `coverage-${k}-empty`,
        message: `${k} is empty — expected once a real import is run`,
      });
    }
  }

  /* ─── source mix ─── */
  const sourceMix = { bsdata: 0, wahapedia: 0, seed: 0, manual: 0, unknown: 0 };
  for (const u of ds.units) {
    const p = u.source?.primary;
    if (p && sourceMix[p] != null) sourceMix[p]++;
    else sourceMix.unknown++;
  }

  return {
    profile, counts, factionCoverage, issues, sourceMix, completeness,
    manifest: ds.manifest || null,
  };
}

function pct(x, y) { if (!y) return 0; return Math.round((x / y) * 1000) / 10; }

/* ─────────────────── report renderers ─────────────────── */

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

export function printAuditReport(r) {
  const ln = (s = '') => console.log(s);
  ln();
  ln(`${C.bold}═══ WH40K coverage audit ═══${C.reset}  ${C.dim}(profile=${r.profile})${C.reset}`);
  ln();
  ln(`${C.bold}Counts${C.reset}`);
  for (const [k, v] of Object.entries(r.counts)) {
    ln(`  ${k.padEnd(20)} ${String(v).padStart(6)}`);
  }
  ln();
  ln(`${C.bold}Per-unit completeness (%)${C.reset}`);
  for (const [k, v] of Object.entries(r.completeness)) {
    const colour = v >= 90 ? C.green : v >= 60 ? C.yellow : C.red;
    ln(`  ${k.padEnd(20)} ${colour}${String(v).padStart(5)}%${C.reset}`);
  }
  ln();
  ln(`${C.bold}Source mix (units)${C.reset}`);
  for (const [k, v] of Object.entries(r.sourceMix)) {
    if (v > 0) ln(`  ${k.padEnd(20)} ${String(v).padStart(6)}`);
  }
  ln();
  ln(`${C.bold}Faction coverage${C.reset}`);
  ln(`  ${'Faction'.padEnd(28)} ${'Units'.padStart(6)} ${'Det.'.padStart(5)} ${'Strat'.padStart(6)} ${'Enh'.padStart(5)}`);
  for (const row of r.factionCoverage) {
    ln(`  ${row.name.padEnd(28)} ${String(row.units).padStart(6)} ${String(row.detachments).padStart(5)} ${String(row.stratagems).padStart(6)} ${String(row.enhancements).padStart(5)}`);
  }
  ln();
  const errs = r.issues.filter(i => i.severity === 'error');
  const warns = r.issues.filter(i => i.severity === 'warning');
  const infos = r.issues.filter(i => i.severity === 'info');
  if (errs.length) {
    ln(`${C.bold}${C.red}Errors${C.reset} (${errs.length})`);
    for (const e of errs.slice(0, 50)) ln(`  ${C.red}✗${C.reset} [${e.code}] ${e.message}`);
    ln();
  }
  if (warns.length) {
    ln(`${C.bold}${C.yellow}Warnings${C.reset} (${warns.length})`);
    for (const w of warns.slice(0, 30)) ln(`  ${C.yellow}!${C.reset} [${w.code}] ${w.message}`);
    if (warns.length > 30) ln(`  ${C.dim}… ${warns.length - 30} more${C.reset}`);
    ln();
  }
  if (infos.length) {
    ln(`${C.bold}${C.cyan}Info${C.reset} (${infos.length})`);
    for (const i of infos) ln(`  ${C.cyan}i${C.reset} [${i.code}] ${i.message}`);
    ln();
  }

  const status = errs.length === 0
    ? `${C.green}${C.bold}Audit PASS${C.reset}`
    : `${C.red}${C.bold}Audit FAIL${C.reset}`;
  ln(`${status} — ${errs.length} error(s), ${warns.length} warning(s)`);
}

export function renderMarkdown(r) {
  const lines = [];
  lines.push(`# WH40K coverage audit`);
  lines.push('');
  lines.push(`Profile: \`${r.profile}\``);
  if (r.manifest) {
    lines.push(`Edition: \`${r.manifest.edition}\` · Version: \`${r.manifest.version}\` · Generated: \`${r.manifest.generatedAt}\``);
  }
  lines.push('');

  lines.push(`## Counts`);
  lines.push('');
  lines.push('| Entity | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of Object.entries(r.counts)) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  lines.push(`## Per-unit completeness`);
  lines.push('');
  lines.push('| Field | % |');
  lines.push('|---|---:|');
  for (const [k, v] of Object.entries(r.completeness)) lines.push(`| ${k} | ${v}% |`);
  lines.push('');

  lines.push(`## Source mix (units)`);
  lines.push('');
  lines.push('| Source | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of Object.entries(r.sourceMix)) if (v > 0) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  lines.push(`## Faction coverage`);
  lines.push('');
  lines.push('| Faction | Units | Detachments | Stratagems | Enhancements |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of r.factionCoverage) {
    lines.push(`| ${row.name} | ${row.units} | ${row.detachments} | ${row.stratagems} | ${row.enhancements} |`);
  }
  lines.push('');

  const errs = r.issues.filter(i => i.severity === 'error');
  const warns = r.issues.filter(i => i.severity === 'warning');
  if (errs.length) {
    lines.push(`## Errors (${errs.length})`);
    lines.push('');
    for (const e of errs) lines.push(`- \`${e.code}\` ${e.message}`);
    lines.push('');
  }
  if (warns.length) {
    lines.push(`## Warnings (${warns.length})`);
    lines.push('');
    for (const w of warns) lines.push(`- \`${w.code}\` ${w.message}`);
    lines.push('');
  }

  lines.push(`## Status`);
  lines.push('');
  lines.push(errs.length === 0 ? '**Audit PASS**' : '**Audit FAIL**');
  return lines.join('\n');
}

/* ─────────────────── CLI surface ─────────────────── */

/**
 * Top-level "audit" command. Loads the on-disk dataset, runs the audit,
 * writes JSON + Markdown reports, prints the console summary, and sets
 * the process exit code based on (errors + strict-mode warnings).
 */
export async function runAuditCommand() {
  const ds = await loadDataset();
  const report = auditDataset(ds);
  printAuditReport(report);

  await mkdir(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = resolve(REPORT_DIR, `wh40k-audit-${ts}.json`);
  const mdPath   = resolve(REPORT_DIR, `wh40k-audit-${ts}.md`);
  // Stable filenames for "latest"
  const jsonLatest = resolve(REPORT_DIR, `wh40k-audit-report.json`);
  const mdLatest   = resolve(REPORT_DIR, `wh40k-audit-report.md`);

  const jsonBody = JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n';
  const mdBody = renderMarkdown(report) + '\n';
  await writeFile(jsonPath, jsonBody);
  await writeFile(mdPath, mdBody);
  await writeFile(jsonLatest, jsonBody);
  await writeFile(mdLatest, mdBody);

  console.log(`\nreports written:`);
  console.log(`  ${jsonLatest}`);
  console.log(`  ${mdLatest}`);

  const errors = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');
  if (errors.length > 0) {
    process.exitCode = 1;
  } else if (STRICT && warnings.length > 0) {
    console.log(`\n${C.yellow}strict mode: ${warnings.length} warning(s) → exit 1${C.reset}`);
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}
