// scripts/wh40k-import/config.mjs
//
// Pipeline configuration: source paths, output layout, dataset version. The
// runtime app NEVER reads this file — it's pipeline-only. All values can be
// overridden via env vars so CI/build pipelines remain ergonomic.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(__dirname, '..', '..');

/* ─────────────────── dataset version ─────────────────── */
//
// Bumping rules — the runtime app reads `index.json` to resolve the active
// version, so bumps are seamless once a new versioned folder is published:
//
//   - GAME_EDITION:       major edition (10e). Bump on a new edition release.
//   - DATASET_VERSION:    schema/codex revision. Bump on:
//                           * canonical schema changes (breaking the runtime)
//                           * codex/dataslate refreshes worth a snapshot
//                         Bump format: integer 'v1', 'v2', … (string).
//   - SCHEMA_VERSION:     stable contract for the JSON files inside a version.
//                         Components key off this. Bump only on breaking
//                         shape changes; non-breaking additions keep it.
//
// Old versions are intentionally NOT deleted on bump — keeping `10e/v1/`
// around lets the user pin to a known-good snapshot if a v2 import is bad.

export const GAME_EDITION = process.env.WH40K_EDITION || '10e';
export const DATASET_VERSION = process.env.WH40K_VERSION || 'v1';
export const SCHEMA_VERSION = 1;

/* ─────────────────── source paths ─────────────────── */

export const VENDOR_DIR = process.env.WH40K_VENDOR || resolve(ROOT, 'vendor', 'wh40k');

export const BSDATA_REMOTE = process.env.WH40K_BSDATA_REMOTE
  || 'https://github.com/BSData/wh40k-10e.git';
export const BSDATA_LOCAL = process.env.WH40K_BSDATA_LOCAL
  || resolve(VENDOR_DIR, 'bsdata-10e');
export const BSDATA_BRANCH = process.env.WH40K_BSDATA_BRANCH || 'main';

export const WAHAPEDIA_LOCAL = process.env.WH40K_WAHAPEDIA_LOCAL
  || resolve(VENDOR_DIR, 'wahapedia');
// Wahapedia exports a public ZIP of CSVs; URL is documented but not
// hard-failed on if missing — the importer treats Wahapedia as a secondary
// (rules-text) source that the BSData primary can stand in for.
export const WAHAPEDIA_CSV_BASE = process.env.WH40K_WAHAPEDIA_CSV_BASE
  || 'https://wahapedia.ru/wh40k10ed/';

/* ─────────────────── output paths ─────────────────── */

export const OUTPUT_ROOT = resolve(ROOT, 'public', 'data', 'wh40k');
export function versionDir() {
  return resolve(OUTPUT_ROOT, GAME_EDITION, DATASET_VERSION);
}

/* ─────────────────── feature flags ─────────────────── */

// Strict mode raises non-fatal validator warnings to errors. CI should pass
// WH40K_STRICT=1 to fail the build on any anomaly.
export const STRICT = process.env.WH40K_STRICT === '1';

// Allow callers to skip a source — useful when iterating on the BSData
// parser without re-downloading Wahapedia, etc.
export const ENABLED_SOURCES = (
  process.env.WH40K_SOURCES || 'bsdata,wahapedia,seed'
).split(',').map(s => s.trim()).filter(Boolean);

// When true, parsers may use cached intermediate JSON instead of re-parsing
// raw sources. Speeds up local iteration; disabled by default for CI.
export const CACHE_PARSERS = process.env.WH40K_CACHE === '1';
export const CACHE_DIR = resolve(VENDOR_DIR, '.cache');

/* ─────────────────── reporting paths ─────────────────── */

export const REPORT_DIR = resolve(VENDOR_DIR, 'reports');
