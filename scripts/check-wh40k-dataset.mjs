#!/usr/bin/env node
//
// scripts/check-wh40k-dataset.mjs
//
// Pre-build gate. Fails the build with a clear error if the WH40K dataset
// the runtime expects is missing or structurally broken. Run as part of
// `prebuild` so neither `npm run build` nor the Tauri release pipeline
// can produce a binary that ships with a broken dataset.
//
// Exit codes:
//   0 — dataset is present and structurally usable
//   1 — dataset is missing → tells the user how to seed it
//   2 — dataset is corrupted / inconsistent → tells the user what's wrong

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public', 'data', 'wh40k');
const INDEX = resolve(PUBLIC, 'index.json');

const REQUIRED = [
  'factions.json', 'units.json', 'detachments.json',
  'model-profiles.json', 'weapons.json',
  'abilities.json', 'keywords.json',
  'stratagems.json', 'enhancements.json',
  'army-rules.json', 'unit-compositions.json', 'wargear-options.json',
  'aliases.json', 'manifest.json',
];

function fail(code, msg, hint) {
  console.error(`\x1b[31m✗ wh40k dataset check failed:\x1b[0m ${msg}`);
  if (hint) console.error(`\x1b[2m  ${hint}\x1b[0m`);
  process.exit(code);
}

(async () => {
  if (!existsSync(INDEX)) {
    fail(1,
      `${INDEX} not found — runtime cannot resolve a dataset version.`,
      `Run "npm run wh40k:seed" to regenerate the bundled 40K dataset.`);
  }

  let idx;
  try { idx = JSON.parse(await readFile(INDEX, 'utf8')); }
  catch (e) {
    fail(2, `index.json is not valid JSON (${e.message})`,
      `Delete public/data/wh40k/index.json and run "npm run wh40k:seed".`);
  }
  const cur = idx?.current;
  if (!cur?.edition || !cur?.version) {
    fail(2, `index.json missing current.{edition,version}`);
  }

  const versionDir = resolve(PUBLIC, cur.edition, cur.version);
  if (!existsSync(versionDir)) {
    fail(1, `version directory ${versionDir} not found`,
      `Run "npm run wh40k:seed" to regenerate ${cur.edition}/${cur.version}.`);
  }

  const missing = REQUIRED.filter(f => !existsSync(resolve(versionDir, f)));
  if (missing.length) {
    fail(1, `${missing.length} required dataset file(s) missing in ${versionDir}`,
      `Missing: ${missing.join(', ')}. Run "npm run wh40k:seed".`);
  }

  let manifest;
  try { manifest = JSON.parse(await readFile(resolve(versionDir, 'manifest.json'), 'utf8')); }
  catch (e) {
    fail(2, `manifest.json is not valid JSON (${e.message})`);
  }
  const counts = manifest?.counts || {};
  // Smoke thresholds — even the seed must clear these. Real imports will
  // be many multiples larger; the audit module enforces the higher bar.
  const SMOKE = { factions: 6, units: 15, detachments: 10 };
  for (const [k, min] of Object.entries(SMOKE)) {
    if ((counts[k] || 0) < min) {
      fail(2, `manifest.counts.${k} = ${counts[k] || 0} < smoke minimum ${min}`,
        `Dataset is suspiciously thin. Re-run the importer.`);
    }
  }

  console.log(`\x1b[32m✓\x1b[0m wh40k dataset OK (${cur.edition}/${cur.version}, ${Object.values(counts).reduce((a,b)=>a+b,0)} entities)`);
})();
