// scripts/wh40k-import/report.mjs
//
// Pipeline reporting: human-readable console output and machine-readable
// JSON dump. The CLI prints the console form by default; the JSON form is
// emitted under vendor/wh40k/reports/ for CI to consume.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REPORT_DIR } from './config.mjs';
import { partitionIssues } from './validate.mjs';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};

const ENTITY_LABEL = {
  factions: 'Factions',
  detachments: 'Detachments',
  units: 'Units',
  modelProfiles: 'Model profiles',
  weaponProfiles: 'Weapon profiles',
  abilities: 'Abilities',
  keywords: 'Keywords',
  stratagems: 'Stratagems',
  enhancements: 'Enhancements',
  armyRules: 'Army rules',
  unitCompositions: 'Compositions',
  wargearOptions: 'Wargear options',
};

/**
 * Build a structured report object from the pipeline results. Pure — has
 * no side effects, callers decide whether to print or persist.
 */
export function buildReport({ dataset, sourceResults, conflicts, issues, durationMs }) {
  const { errors, warnings } = partitionIssues(issues);
  const counts = {};
  for (const k of Object.keys(ENTITY_LABEL)) counts[k] = (dataset[k] || []).length;
  return {
    generatedAt: new Date().toISOString(),
    durationMs,
    sourceResults,
    counts,
    conflictCount: conflicts.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    conflicts,
    errors,
    warnings,
  };
}

/** Pretty-print a report to stdout. */
export function printReport(report) {
  const out = (s = '') => console.log(s);
  out();
  out(`${C.bold}═══ WH40K import report ═══${C.reset}  ${C.dim}(${report.durationMs}ms)${C.reset}`);
  out();

  out(`${C.bold}Sources${C.reset}`);
  for (const [name, res] of Object.entries(report.sourceResults || {})) {
    if (!res) { out(`  ${C.dim}- ${name}: skipped${C.reset}`); continue; }
    const status = res.ok ? `${C.green}ok${C.reset}` : `${C.red}failed${C.reset}`;
    out(`  - ${name}: ${status}${res.partial ? ` ${C.yellow}(partial)${C.reset}` : ''}`);
    if (res.commit)     out(`      ${C.dim}commit ${res.commit}${C.reset}`);
    if (res.fetchedAt)  out(`      ${C.dim}fetched ${res.fetchedAt}${C.reset}`);
    if (res.error)      out(`      ${C.red}${res.error}${C.reset}`);
  }
  out();

  out(`${C.bold}Counts${C.reset}`);
  for (const [k, label] of Object.entries(ENTITY_LABEL)) {
    const v = report.counts[k] ?? 0;
    out(`  ${label.padEnd(18)} ${String(v).padStart(6)}`);
  }
  out();

  if (report.conflictCount > 0) {
    out(`${C.bold}${C.yellow}Conflicts${C.reset} (${report.conflictCount})`);
    for (const c of report.conflicts.slice(0, 20)) {
      out(`  ${C.yellow}!${C.reset} [${c.code}] ${c.entityId || ''}  ${C.dim}${c.message}${C.reset}`);
    }
    if (report.conflictCount > 20) out(`  ${C.dim}… ${report.conflictCount - 20} more${C.reset}`);
    out();
  }

  if (report.warningCount > 0) {
    out(`${C.bold}${C.yellow}Warnings${C.reset} (${report.warningCount})`);
    for (const w of report.warnings.slice(0, 30)) {
      out(`  ${C.yellow}!${C.reset} [${w.code}] ${w.entityId || ''}  ${C.dim}${w.message}${C.reset}`);
    }
    if (report.warningCount > 30) out(`  ${C.dim}… ${report.warningCount - 30} more${C.reset}`);
    out();
  }

  if (report.errorCount > 0) {
    out(`${C.bold}${C.red}Errors${C.reset} (${report.errorCount})`);
    for (const e of report.errors.slice(0, 50)) {
      out(`  ${C.red}✗${C.reset} [${e.code}] ${e.entityId || ''}  ${e.message}`);
    }
    if (report.errorCount > 50) out(`  ${C.dim}… ${report.errorCount - 50} more${C.reset}`);
    out();
    out(`${C.red}${C.bold}Import FAILED${C.reset} — fix the errors above and re-run.`);
  } else {
    out(`${C.green}${C.bold}Import OK${C.reset} — ${report.warningCount} warning(s), ${report.conflictCount} conflict(s).`);
  }
}

/** Persist the structured report to disk for CI consumption. */
export async function writeReportFile(report) {
  await mkdir(REPORT_DIR, { recursive: true });
  const ts = report.generatedAt.replace(/[:.]/g, '-');
  const path = resolve(REPORT_DIR, `wh40k-import-${ts}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  return path;
}

export function makeLogger() {
  return {
    info: (msg) => console.log(`${C.cyan}·${C.reset} ${msg}`),
    warn: (msg) => console.warn(`${C.yellow}!${C.reset} ${msg}`),
    error: (msg) => console.error(`${C.red}✗${C.reset} ${msg}`),
  };
}
