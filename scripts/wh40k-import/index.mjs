#!/usr/bin/env node
//
// scripts/wh40k-import/index.mjs
//
// CLI entry for the Warhammer 40K import pipeline.
//
// Usage:
//   node scripts/wh40k-import                # full pipeline (BSData + Wahapedia + seed merge)
//   node scripts/wh40k-import seed           # write only the curated seed dataset
//   node scripts/wh40k-import import         # alias for "full pipeline"
//   node scripts/wh40k-import test           # run dataset tests against current output
//   WH40K_STRICT=1 node scripts/wh40k-import # treat warnings as errors
//
// All paths and version numbers come from config.mjs (env-overridable).

import { performance } from 'node:perf_hooks';
import { STRICT, ENABLED_SOURCES } from './config.mjs';
import { bsdataSource, wahapediaSource, seedSource } from './sources.mjs';
import {
  normalizeBsdata, normalizeWahapedia, normalizeSeed, blankCanonical,
} from './normalize.mjs';
import { mergeCanonicals } from './merge.mjs';
import { runValidators, partitionIssues } from './validate.mjs';
import { writeDataset } from './output.mjs';
import { buildReport, printReport, writeReportFile, makeLogger } from './report.mjs';
import { ALIAS_IDS } from './canonicalize.mjs';
//
// Parsers are loaded lazily so that running `seed` mode works without the
// optional dev dependencies (fast-xml-parser, csv-parse) being installed.

async function loadBsdataParser()    { return (await import('./parsers/bsdata.mjs')).parseBsdataRepo; }
async function loadWahapediaParser() { return (await import('./parsers/wahapedia.mjs')).parseWahapediaDir; }

const ALIGNMENT_BY_FACTION = {
  'space-marines': 'imperium',
  'adeptus-custodes': 'imperium',
  'astra-militarum': 'imperium',
  'imperial-knights': 'imperium',
  'adeptus-mechanicus': 'imperium',
  'adepta-sororitas': 'imperium',
  'grey-knights': 'imperium',
  'agents-of-the-imperium': 'imperium',
  'chaos-space-marines': 'chaos',
  'death-guard': 'chaos',
  'thousand-sons': 'chaos',
  'world-eaters': 'chaos',
  'chaos-daemons': 'chaos',
  'chaos-knights': 'chaos',
  'necrons': 'xenos',
  'tyranids': 'xenos',
  'genestealer-cults': 'xenos',
  'aeldari': 'xenos',
  'drukhari': 'xenos',
  'orks': 'xenos',
  'leagues-of-votann': 'xenos',
  'tau-empire': 'xenos',
};

async function main() {
  const cmd = process.argv[2] || 'import';
  const log = makeLogger();
  const t0 = performance.now();

  if (cmd === 'test') {
    // Delegate to test.mjs by import; avoids spawning a child process.
    await import('./test.mjs');
    return;
  }
  if (cmd === 'audit') {
    const { runAuditCommand } = await import('./audit.mjs');
    await runAuditCommand();
    return;
  }

  log.info(`pipeline: ${cmd}, sources=${ENABLED_SOURCES.join(',')}, strict=${STRICT}`);

  // ── 1. Prepare sources ─────────────────────────────────────────────
  const sourceResults = {};
  let bsdataParsed = null, wahapediaParsed = null;

  if (cmd !== 'seed' && ENABLED_SOURCES.includes('bsdata')) {
    sourceResults.bsdata = await bsdataSource.prepare({ logger: log });
    if (sourceResults.bsdata.ok) {
      try {
        const parseBsdataRepo = await loadBsdataParser();
        bsdataParsed = await parseBsdataRepo(sourceResults.bsdata.path, { logger: log });
        log.info(`bsdata: parsed ${bsdataParsed.factions.length} catalogues`);
      } catch (e) {
        if (/Cannot find package 'fast-xml-parser'/.test(e.message)) {
          log.warn(`bsdata: fast-xml-parser not installed — run "npm i -D fast-xml-parser csv-parse" to enable real imports. Skipping.`);
        } else {
          log.error(`bsdata: parser crashed (${e.message})`);
        }
        sourceResults.bsdata.ok = false;
        sourceResults.bsdata.error = e.message;
      }
    }
  }
  if (cmd !== 'seed' && ENABLED_SOURCES.includes('wahapedia')) {
    sourceResults.wahapedia = await wahapediaSource.prepare({ logger: log });
    if (sourceResults.wahapedia.ok) {
      try {
        const parseWahapediaDir = await loadWahapediaParser();
        wahapediaParsed = await parseWahapediaDir(sourceResults.wahapedia.path, { logger: log });
        log.info(`wahapedia: parsed ${wahapediaParsed?.datasheets?.length || 0} datasheets`);
      } catch (e) {
        if (/Cannot find package 'csv-parse'/.test(e.message)) {
          log.warn(`wahapedia: csv-parse not installed — run "npm i -D fast-xml-parser csv-parse" to enable real imports. Skipping.`);
        } else {
          log.error(`wahapedia: parser crashed (${e.message})`);
        }
        sourceResults.wahapedia.ok = false;
        sourceResults.wahapedia.error = e.message;
      }
    }
  }
  if (ENABLED_SOURCES.includes('seed')) {
    sourceResults.seed = await seedSource.prepare();
  }

  // ── 2. Normalize each source independently ────────────────────────
  const partials = [];
  if (bsdataParsed)   partials.push(normalizeBsdata(bsdataParsed, ALIGNMENT_BY_FACTION));
  if (wahapediaParsed) partials.push(normalizeWahapedia(wahapediaParsed, ALIGNMENT_BY_FACTION));
  if (cmd === 'seed' || partials.length === 0) {
    partials.push(normalizeSeed());
  }

  // ── 3. Merge ──────────────────────────────────────────────────────
  let merged, conflicts;
  if (partials.length === 1) {
    merged = partials[0];
    conflicts = [];
  } else {
    const result = mergeCanonicals(partials);
    merged = result.merged;
    conflicts = result.conflicts;
  }
  // Ensure all collections exist even if a source contributed nothing.
  merged = { ...blankCanonical(), ...merged };

  // ── 4. Validate ───────────────────────────────────────────────────
  const issues = runValidators(merged);
  const { errors, warnings } = partitionIssues(issues);

  const allIssues = [...issues, ...conflicts.map(c => ({ ...c, severity: c.severity || 'warning' }))];

  // ── 5. Write (only if no errors, or in non-strict + soft mode) ────
  let writeResult = null;
  if (errors.length === 0) {
    writeResult = await writeDataset(merged, {
      aliases: ALIAS_IDS,
      sources: {
        bsdata:    sourceResults.bsdata?.ok    ? { commit: sourceResults.bsdata.commit }    : undefined,
        wahapedia: sourceResults.wahapedia?.ok ? { fetchedAt: sourceResults.wahapedia.fetchedAt } : undefined,
      },
      logger: log,
    });
  } else {
    log.error(`refusing to write dataset: ${errors.length} validation error(s)`);
  }

  // ── 6. Report ─────────────────────────────────────────────────────
  const durationMs = Math.round(performance.now() - t0);
  const report = buildReport({
    dataset: merged, sourceResults, conflicts, issues: allIssues, durationMs,
  });
  printReport(report);
  try {
    const reportPath = await writeReportFile(report);
    log.info(`report: ${reportPath}`);
  } catch (e) {
    log.warn(`report: failed to persist (${e.message})`);
  }

  // ── 7. Exit code ──────────────────────────────────────────────────
  if (errors.length > 0) process.exitCode = 1;
  else if (STRICT && warnings.length > 0) {
    log.warn(`strict mode: ${warnings.length} warning(s) → exit 1`);
    process.exitCode = 1;
  }
  else process.exitCode = 0;

  // Surface where the dataset landed for human users
  if (writeResult) log.info(`dataset: ${writeResult.dir}`);
}

main().catch(e => {
  console.error('\x1b[31mpipeline crashed:\x1b[0m', e);
  process.exitCode = 2;
});
