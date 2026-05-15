// scripts/wh40k-import/parsers/wahapedia.mjs
//
// Wahapedia CSV parser. Wahapedia uses pipe-delimited (`|`) CSVs with a
// trailing-pipe quirk and embedded HTML in description fields. The parser
// returns a per-CSV array of rows keyed by header name; the normalizer
// joins them into the canonical model.
//
// Schema notes (10e, as of 2026):
//   - Datasheets.csv:    id | name | link | faction_id | source_id |
//                        legend | role | loadout | transport | …
//   - Datasheets_models.csv: datasheet_id | line | name | M | T | Sv | …
//   - Datasheets_wargear.csv:  datasheet_id | line | line_in_wargear |
//                              dice | name | description | range | type | A | BS_WS | S | AP | D
//   - Datasheets_keywords.csv: datasheet_id | keyword | model | is_faction_keyword
//   - Datasheets_abilities.csv: datasheet_id | line | ability_id | model | name | description | type | parameter
//   - Datasheets_unit_composition.csv: datasheet_id | line | description
//   - Datasheets_models_cost.csv: datasheet_id | line | description | cost
//   - Stratagems.csv:    id | faction_id | name | type | cp_cost | legend | turn | phase | detachment | description
//   - Enhancements.csv:  id | faction_id | name | cost | legend | description | detachment
//   - Abilities.csv:     id | type | name | legend | description | faction_id
//   - Factions.csv:      id | name | link
//
// Files that are missing on disk are silently skipped — the normalizer
// treats Wahapedia as a contributor, not a hard requirement.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { stripHtml as _stripHtml } from './util.mjs';

// Re-export for callers that previously imported stripHtml from this module.
export const stripHtml = _stripHtml;

const PARSE_OPTIONS = {
  delimiter: '|',
  columns: true,
  skip_empty_lines: true,
  relax_column_count: true,
  relax_quotes: true,
  trim: true,
  // Wahapedia exports their CSVs with a UTF-8 BOM, which otherwise ends
  // up prefixed to the first column header (`﻿id` instead of `id`).
  bom: true,
};

async function readCsv(dir, file) {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const text = await readFile(path, 'utf8');
  // Wahapedia files often end with a stray pipe per line — csv-parse
  // tolerates this with relax_column_count.
  return parse(text, PARSE_OPTIONS);
}

export async function parseWahapediaDir(dir, { logger } = {}) {
  const log = logger || console;
  if (!existsSync(dir)) {
    log.warn?.(`wahapedia: directory ${dir} not found`);
    return null;
  }
  const [
    factions, datasheets, datasheetModels, datasheetWargear,
    datasheetKeywords, datasheetAbilities, datasheetComposition,
    datasheetModelsCost, datasheetOptions, stratagems, enhancements,
    abilities, detachmentAbilities,
  ] = await Promise.all([
    readCsv(dir, 'Factions.csv'),
    readCsv(dir, 'Datasheets.csv'),
    readCsv(dir, 'Datasheets_models.csv'),
    readCsv(dir, 'Datasheets_wargear.csv'),
    readCsv(dir, 'Datasheets_keywords.csv'),
    readCsv(dir, 'Datasheets_abilities.csv'),
    readCsv(dir, 'Datasheets_unit_composition.csv'),
    readCsv(dir, 'Datasheets_models_cost.csv'),
    readCsv(dir, 'Datasheets_options.csv'),
    readCsv(dir, 'Stratagems.csv'),
    readCsv(dir, 'Enhancements.csv'),
    readCsv(dir, 'Abilities.csv'),
    readCsv(dir, 'Detachment_abilities.csv'),
  ]);

  // Group children by datasheet_id once so the normalizer can do O(1)
  // lookups instead of walking arrays.
  const groupBy = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) {
      const k = r[key];
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };

  return {
    factions: factions || [],
    datasheets: datasheets || [],
    modelsByDsId:        groupBy(datasheetModels,        'datasheet_id'),
    wargearByDsId:       groupBy(datasheetWargear,       'datasheet_id'),
    keywordsByDsId:      groupBy(datasheetKeywords,      'datasheet_id'),
    abilitiesByDsId:     groupBy(datasheetAbilities,     'datasheet_id'),
    compositionByDsId:   groupBy(datasheetComposition,   'datasheet_id'),
    modelCostByDsId:     groupBy(datasheetModelsCost,    'datasheet_id'),
    optionsByDsId:       groupBy(datasheetOptions,       'datasheet_id'),
    stratagems:          stratagems          || [],
    enhancements:        enhancements        || [],
    abilities:           abilities           || [],
    detachmentAbilities: detachmentAbilities || [],
  };
}

// stripHtml lives in parsers/util.mjs (re-exported above).
