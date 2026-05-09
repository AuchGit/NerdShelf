// scripts/wh40k-import/output.mjs
//
// Writes the canonical dataset to disk under the versioned layout:
//
//   public/data/wh40k/
//     index.json                  ← root pointer; updated to point at
//                                   the latest version on each successful import
//     10e/v1/
//       manifest.json             ← per-version metadata + file hashes
//       factions.json
//       units.json
//       detachments.json
//       abilities.json
//       stratagems.json
//       enhancements.json
//       keywords.json
//       weapons.json              ← weapon profiles
//       model-profiles.json
//       army-rules.json
//       unit-compositions.json
//       wargear-options.json
//       aliases.json              ← legacy id → canonical id
//
// Each file is written deterministically (sorted by id) so two imports of
// the same input produce byte-identical output, which is a hard requirement
// for git-friendliness and for reliable hashing.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';
import {
  GAME_EDITION, DATASET_VERSION, SCHEMA_VERSION,
  OUTPUT_ROOT, versionDir,
} from './config.mjs';

const FILE_LAYOUT = [
  ['factions',         'factions.json'],
  ['units',            'units.json'],
  ['detachments',      'detachments.json'],
  ['abilities',        'abilities.json'],
  ['stratagems',       'stratagems.json'],
  ['enhancements',     'enhancements.json'],
  ['keywords',         'keywords.json'],
  ['weaponProfiles',   'weapons.json'],
  ['modelProfiles',    'model-profiles.json'],
  ['armyRules',        'army-rules.json'],
  ['unitCompositions', 'unit-compositions.json'],
  ['wargearOptions',   'wargear-options.json'],
];

/**
 * Write the canonical dataset to disk under the configured edition/version.
 * Returns { dir, manifest } describing what was written.
 */
export async function writeDataset(dataset, { aliases = {}, sources = {}, logger } = {}) {
  const log = logger || console;
  const dir = versionDir();
  await mkdir(dir, { recursive: true });

  const counts = {};
  const fileHashes = {};

  for (const [field, file] of FILE_LAYOUT) {
    const arr = sortById(dataset[field] || []);
    counts[field] = arr.length;
    const json = JSON.stringify(arr, null, 2) + '\n';
    fileHashes[file] = sha256(json);
    await writeFile(resolve(dir, file), json);
  }

  // Aliases
  const aliasJson = JSON.stringify(aliases, Object.keys(aliases).sort(), 2) + '\n';
  fileHashes['aliases.json'] = sha256(aliasJson);
  await writeFile(resolve(dir, 'aliases.json'), aliasJson);

  // Manifest
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    edition: GAME_EDITION,
    version: DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    counts,
    sources,
    fileHashes,
  };
  await writeFile(resolve(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n');

  // Root index.json — preserves any prior versions for snapshot history.
  await updateRootIndex(manifest, log);

  log.info?.(`output: wrote ${Object.values(counts).reduce((a, b) => a + b, 0)} entities to ${dir}`);
  return { dir, manifest };
}

async function updateRootIndex(manifest, log) {
  const indexPath = resolve(OUTPUT_ROOT, 'index.json');
  let existing = null;
  if (existsSync(indexPath)) {
    try {
      existing = JSON.parse(await readFile(indexPath, 'utf8'));
    } catch (e) {
      log.warn?.(`output: failed to read existing index.json (${e.message}); rebuilding`);
      existing = null;
    }
  }
  const versions = (existing?.versions || []).filter(v =>
    !(v.edition === manifest.edition && v.version === manifest.version)
  );
  versions.unshift({
    edition: manifest.edition,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
  });

  const next = {
    schemaVersion: SCHEMA_VERSION,
    current: { edition: manifest.edition, version: manifest.version },
    versions,
  };
  await writeFile(indexPath, JSON.stringify(next, null, 2) + '\n');
}

function sortById(arr) {
  return arr.slice().sort((a, b) =>
    (a.id || '').localeCompare(b.id || '')
  );
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}
