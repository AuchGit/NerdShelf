// scripts/wh40k-import/sources.mjs
//
// Source adapters: get raw upstream data onto disk so parsers can read it.
// Each adapter is responsible for its own fetch / clone / cache strategy
// and exposes a simple `prepare()` returning a path the parser can read.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import {
  BSDATA_LOCAL, BSDATA_REMOTE, BSDATA_BRANCH,
  WAHAPEDIA_LOCAL, WAHAPEDIA_CSV_BASE,
} from './config.mjs';

const exec = promisify(execFile);

/* ─────────────────── BSData (Git repository) ─────────────────── */

export const bsdataSource = {
  name: 'bsdata',
  /**
   * Ensure a BSData checkout exists locally.
   * Strategy:
   *   - If `BSDATA_LOCAL` already exists, fast-forward it (`git pull`).
   *   - Otherwise clone from `BSDATA_REMOTE` (depth 1) into `BSDATA_LOCAL`.
   * Falls back gracefully when `git` is unavailable: the caller is told
   *   the source is unprepared and the pipeline skips this adapter.
   */
  async prepare({ logger }) {
    if (existsSync(BSDATA_LOCAL)) {
      logger.info(`bsdata: using existing checkout at ${BSDATA_LOCAL}`);
      try {
        await exec('git', ['-C', BSDATA_LOCAL, 'pull', '--ff-only'], { timeout: 60_000 });
      } catch (e) {
        logger.warn(`bsdata: git pull failed (${e.message}), proceeding with cached data`);
      }
      return { ok: true, path: BSDATA_LOCAL, commit: await safeCommit(BSDATA_LOCAL) };
    }
    await mkdir(dirname(BSDATA_LOCAL), { recursive: true });
    logger.info(`bsdata: cloning ${BSDATA_REMOTE} → ${BSDATA_LOCAL}`);
    try {
      await exec('git', [
        'clone', '--depth', '1', '--branch', BSDATA_BRANCH,
        BSDATA_REMOTE, BSDATA_LOCAL,
      ], { timeout: 300_000 });
      return { ok: true, path: BSDATA_LOCAL, commit: await safeCommit(BSDATA_LOCAL) };
    } catch (e) {
      logger.warn(`bsdata: clone failed (${e.message}); skipping this source`);
      return { ok: false, path: null, error: e.message };
    }
  },
};

async function safeCommit(repo) {
  try {
    const { stdout } = await exec('git', ['-C', repo, 'rev-parse', '--short', 'HEAD']);
    return stdout.trim();
  } catch { return null; }
}

/* ─────────────────── Wahapedia (CSV download) ─────────────────── */

// Wahapedia exports a structured set of CSVs at https://wahapedia.ru/wh40k10ed/.
// The endpoint can change; we download by name when first needed and cache
// to disk. The set below covers all entities we want; missing files are
// logged but non-fatal (BSData is the primary source).
const WAHAPEDIA_FILES = [
  'Factions.csv',
  'Detachment_abilities.csv',
  'Datasheets.csv',
  'Datasheets_models.csv',
  'Datasheets_wargear.csv',
  'Datasheets_options.csv',
  'Datasheets_abilities.csv',
  'Datasheets_keywords.csv',
  'Datasheets_unit_composition.csv',
  'Datasheets_models_cost.csv',
  'Stratagems.csv',
  'Enhancements.csv',
  'Abilities.csv',
];

export const wahapediaSource = {
  name: 'wahapedia',
  files: WAHAPEDIA_FILES,
  /**
   * Ensure a local Wahapedia mirror exists. Downloads any missing CSVs
   * into `WAHAPEDIA_LOCAL`. Existing files are kept (Wahapedia tags
   * its CSVs with a date column; manual refreshes by deleting the file
   * are sufficient). Returns ok:true even on partial download — the
   * normalizer will gracefully ignore missing CSVs.
   */
  async prepare({ logger }) {
    await mkdir(WAHAPEDIA_LOCAL, { recursive: true });
    let okCount = 0;
    for (const file of WAHAPEDIA_FILES) {
      const local = `${WAHAPEDIA_LOCAL}/${file}`;
      if (existsSync(local)) { okCount++; continue; }
      const url = `${WAHAPEDIA_CSV_BASE.replace(/\/$/, '')}/${file}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await (await import('node:fs/promises')).writeFile(local, buf);
        okCount++;
        logger.info(`wahapedia: downloaded ${file}`);
      } catch (e) {
        logger.warn(`wahapedia: failed to fetch ${file}: ${e.message}`);
      }
    }
    return {
      ok: okCount > 0,
      path: WAHAPEDIA_LOCAL,
      fetchedAt: new Date().toISOString(),
      partial: okCount < WAHAPEDIA_FILES.length,
    };
  },
};

/* ─────────────────── seed (hand-curated) ─────────────────── */

// The seed source produces a small but valid dataset from inline curated
// content. It exists so:
//   1. The runtime app keeps working before BSData/Wahapedia are run.
//   2. CI smoke tests have something deterministic to run against.
//   3. A user without git access still gets a functional 40K module.

export const seedSource = {
  name: 'seed',
  async prepare() {
    // Seed has no external dependency; the inline curated payload lives
    // in normalize.mjs (`buildSeedDataset`).
    return { ok: true };
  },
};
