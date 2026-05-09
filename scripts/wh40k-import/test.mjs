// scripts/wh40k-import/test.mjs
//
// Automated dataset tests. Run via `node scripts/wh40k-import/test.mjs` —
// the runner exits non-zero on any failure, suitable for CI.
//
// Categories (described inline next to each suite):
//   1. minimums        Fail if the dataset is suspiciously empty.
//   2. integrity       Re-runs the validators; any error fails the suite.
//   3. invariants      Higher-level rules the validators don't enforce.
//
// The runner deliberately does NOT exercise the importer or parsers; it
// asserts properties of the *emitted* dataset. This makes it usable as a
// "golden snapshot" check without needing source data on the CI machine.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GAME_EDITION, DATASET_VERSION, OUTPUT_ROOT } from './config.mjs';
import { runValidators, partitionIssues } from './validate.mjs';

let tests = 0, fails = 0;
const failures = [];

function assert(cond, name, detail = '') {
  tests++;
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fails++;
    failures.push({ name, detail });
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  }
}

function suite(name, fn) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  fn();
}

/** Lazy-load the dataset under test. */
async function loadDataset(edition = GAME_EDITION, version = DATASET_VERSION) {
  const dir = resolve(OUTPUT_ROOT, edition, version);
  const read = async (file) => {
    try { return JSON.parse(await readFile(resolve(dir, file), 'utf8')); }
    catch { return []; }
  };
  return {
    factions:         await read('factions.json'),
    detachments:      await read('detachments.json'),
    units:            await read('units.json'),
    modelProfiles:    await read('model-profiles.json'),
    weaponProfiles:   await read('weapons.json'),
    abilities:        await read('abilities.json'),
    keywords:         await read('keywords.json'),
    stratagems:       await read('stratagems.json'),
    enhancements:     await read('enhancements.json'),
    armyRules:        await read('army-rules.json'),
    unitCompositions: await read('unit-compositions.json'),
    wargearOptions:   await read('wargear-options.json'),
  };
}

/* ─────────────────── thresholds ─────────────────── */

// Two thresholds: 'seed' (small curated dataset) and 'full' (real import).
// The runner picks 'full' when the dataset is larger than the seed
// floor — i.e. once a real import has been run, the bar rises.
const THRESHOLDS = {
  seed: {
    factions: 8, detachments: 15, units: 20,
    modelProfiles: 20, weaponProfiles: 20, keywords: 10,
  },
  full: {
    factions: 18, detachments: 50, units: 250,
    modelProfiles: 300, weaponProfiles: 400,
    abilities: 200, stratagems: 80, enhancements: 60, keywords: 80,
  },
};

function pickThresholds(ds) {
  // If we have signs of a "real" import (≥ 100 units OR ≥ 50 stratagems)
  // we apply the full thresholds.
  if (ds.units.length >= 100 || ds.stratagems.length >= 50) return THRESHOLDS.full;
  return THRESHOLDS.seed;
}

/* ─────────────────── suites ─────────────────── */

async function main() {
  const ds = await loadDataset();
  const thresholds = pickThresholds(ds);

  suite('minimums', () => {
    for (const [k, min] of Object.entries(thresholds)) {
      const have = ds[k]?.length ?? 0;
      assert(have >= min, `${k} ≥ ${min}`, `have ${have}`);
    }
  });

  suite('integrity (validator pass)', () => {
    const issues = runValidators(ds);
    const { errors, warnings } = partitionIssues(issues);
    assert(errors.length === 0, 'no validation errors',
      errors.length ? errors.slice(0, 3).map(e => e.message).join(' | ') : '');
    // Warnings are allowed but visible
    if (warnings.length > 0) {
      console.log(`  \x1b[33m·\x1b[0m ${warnings.length} warning(s)`);
    }
  });

  suite('invariants', () => {
    // Every unit has a non-empty faction
    assert(
      ds.units.every(u => u.factionId && ds.factions.find(f => f.id === u.factionId)),
      'every unit links to an existing faction',
      brokenSample(ds.units.filter(u => !ds.factions.find(f => f.id === u.factionId)).map(u => u.id)),
    );

    // Every detachment has a faction
    assert(
      ds.detachments.every(d => ds.factions.find(f => f.id === d.factionId)),
      'every detachment links to an existing faction',
      brokenSample(ds.detachments.filter(d => !ds.factions.find(f => f.id === d.factionId)).map(d => d.id)),
    );

    // Every weapon profile is reachable from a unit
    const reachableWeapons = new Set();
    for (const u of ds.units) for (const id of u.weaponProfileIds || []) reachableWeapons.add(id);
    const orphanWeapons = ds.weaponProfiles.filter(w => !reachableWeapons.has(w.id));
    assert(
      orphanWeapons.length === 0,
      'no orphan weapon profiles',
      brokenSample(orphanWeapons.map(w => w.id)),
    );

    // Every unit has at least one model profile
    const noProfileUnits = ds.units.filter(u => (u.modelProfileIds || []).length === 0);
    assert(
      noProfileUnits.length === 0,
      'every unit has at least one model profile',
      brokenSample(noProfileUnits.map(u => u.id)),
    );

    // Point values are non-negative integers
    const badPoints = ds.units.filter(u =>
      (u.points || []).some(p => !Number.isFinite(p.cost) || p.cost < 0)
    );
    assert(
      badPoints.length === 0,
      'all unit point values are non-negative',
      brokenSample(badPoints.map(u => u.id)),
    );

    // Stable ID format check (all canonical IDs lowercase + `-` only)
    const allIds = [
      ...ds.factions, ...ds.detachments, ...ds.units,
      ...ds.modelProfiles, ...ds.weaponProfiles,
      ...ds.abilities, ...ds.keywords, ...ds.stratagems,
      ...ds.enhancements, ...ds.armyRules,
    ].map(e => e.id);
    const malformed = allIds.filter(id => !/^[a-z0-9][a-z0-9-]*(--[a-z0-9-]+)*$/.test(id));
    assert(
      malformed.length === 0,
      'all canonical IDs match slug format',
      brokenSample(malformed),
    );

    // Keywords are uppercase
    const badKw = ds.keywords.filter(k => k.name !== k.name.toUpperCase());
    assert(badKw.length === 0, 'all keyword names are uppercase',
      brokenSample(badKw.map(k => k.name)));
  });

  console.log();
  if (fails > 0) {
    console.log(`\x1b[31m\x1b[1m${fails}/${tests} tests failed\x1b[0m`);
    process.exitCode = 1;
  } else {
    console.log(`\x1b[32m\x1b[1m${tests}/${tests} tests passed\x1b[0m`);
  }
}

function brokenSample(ids) {
  if (!ids?.length) return '';
  return ids.slice(0, 3).join(', ') + (ids.length > 3 ? ` (+${ids.length - 3})` : '');
}

main().catch(e => {
  console.error('test runner crashed:', e);
  process.exitCode = 2;
});
