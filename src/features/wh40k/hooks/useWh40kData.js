// src/features/wh40k/hooks/useWh40kData.js
//
// Loads the canonical Warhammer 40K dataset and exposes both:
//
//   - The canonical normalized entities (factions, units, abilities, …
//     each as { id, …refs }) for code that wants to do its own joins.
//
//   - A "hydrated" view of every unit (resolved abilities, weapons,
//     keywords, modelProfiles inlined) so the existing components —
//     UnitCard / UnitDetail / filterUnits — keep working without changes.
//
// Loading flow (offline-first):
//
//   1. Fetch `/data/wh40k/index.json` (root pointer).
//   2. Resolve `current.{edition}/{version}` to a directory.
//   3. Fetch every JSON file in that directory in parallel.
//   4. Build O(1) lookup maps and the hydrated unit view.
//
// In PWA builds the service worker's StaleWhileRevalidate rule already
// covers `/data/`, so subsequent loads are instant and offline-safe.
//
// Migration safety: legacy IDs (the pre-canonical `sm_captain` style used
// by the first wh40k seed) are translated through `aliases.json`, so
// favorites/inventory entries created before the migration still resolve.

import { useEffect, useState } from 'react';

const ROOT_INDEX = '/data/wh40k/index.json';

// Module-level cache — survives component remounts and HMR.
let cachePromise = null;

/**
 * Wrap fetch errors with a NerdShelf-specific diagnostic message so a
 * misbundled or stale release fails loudly with a recipe to fix it
 * (instead of e.g. "404" or "Unexpected token < in JSON").
 */
async function fetchJsonOrDiagnose(url, label) {
  let res;
  try { res = await fetch(url); }
  catch (e) {
    throw new Error(`WH40K dataset: network error fetching ${label} — ${e.message}`);
  }
  if (!res.ok) {
    // The most common cause is a release that didn't bundle the dataset.
    // Surface the diagnostic the user can act on instead of bare HTTP code.
    const hint = res.status === 404
      ? ` (file missing from bundle — run "npm run wh40k:seed" before building, or check that public/data/wh40k/ is on disk)`
      : '';
    throw new Error(`WH40K dataset: ${label} returned HTTP ${res.status}${hint}`);
  }
  try { return await res.json(); }
  catch (e) {
    throw new Error(`WH40K dataset: ${label} is not valid JSON (${e.message})`);
  }
}

async function loadAll() {
  if (typeof console !== 'undefined') {
    console.info('[wh40k] loading dataset…');
  }
  const t0 = Date.now();

  // 1. Resolve current version
  const idx = await fetchJsonOrDiagnose(ROOT_INDEX, 'index.json');
  const { edition, version } = idx.current || {};
  if (!edition || !version) {
    throw new Error('WH40K dataset: index.json has no current.{edition,version} — re-run "npm run wh40k:seed".');
  }
  const base = `/data/wh40k/${edition}/${version}`;

  // 2. Fetch every canonical file in parallel.
  const j = (path) => fetchJsonOrDiagnose(`${base}/${path}`, path);

  const [
    factions, detachments, units,
    modelProfiles, weaponProfiles,
    abilities, keywords, stratagems, enhancements, armyRules,
    unitCompositions, wargearOptions, aliases, manifest,
  ] = await Promise.all([
    j('factions.json'), j('detachments.json'), j('units.json'),
    j('model-profiles.json'), j('weapons.json'),
    j('abilities.json'), j('keywords.json'),
    j('stratagems.json'), j('enhancements.json'), j('army-rules.json'),
    j('unit-compositions.json'), j('wargear-options.json'),
    j('aliases.json').catch(() => ({})),
    j('manifest.json').catch(() => null),
  ]);

  // 3. Lookup maps (O(1))
  const factionsById       = indexBy(factions, 'id');
  const detachmentsById    = indexBy(detachments, 'id');
  const unitsById          = indexBy(units, 'id');
  const modelProfilesById  = indexBy(modelProfiles, 'id');
  const weaponProfilesById = indexBy(weaponProfiles, 'id');
  const abilitiesById      = indexBy(abilities, 'id');
  const keywordsById       = indexBy(keywords, 'id');
  const stratagemsById     = indexBy(stratagems, 'id');
  const enhancementsById   = indexBy(enhancements, 'id');
  const compositionsById   = indexBy(unitCompositions, 'id');
  const wargearById        = indexBy(wargearOptions, 'id');

  const detachmentsByFaction = groupBy(detachments, 'factionId');
  const unitsByFaction       = groupBy(units, 'factionId');
  const stratagemsByDetachment   = groupBy(stratagems, 'detachmentId');
  const enhancementsByDetachment = groupBy(enhancements, 'detachmentId');

  // 4. Hydrate units — components consume this shape (the same shape the
  //    pre-canonical seed used) so no UI changes are needed at this step.
  const hydratedUnits = units.map(u => hydrateUnit(u, {
    modelProfilesById, weaponProfilesById, abilitiesById,
    compositionsById, wargearById,
  }));
  const hydratedById = indexBy(hydratedUnits, 'id');
  const hydratedByFaction = groupBy(hydratedUnits, 'factionId');

  // Pre-compute filter universes
  const keywordSet = new Set();
  for (const u of units) for (const k of u.keywords || []) keywordSet.add(k);
  const allKeywords = [...keywordSet].sort();

  const roleSet = new Set();
  for (const u of units) if (u.role) roleSet.add(u.role);
  const allRoles = [...roleSet].sort();

  // Runtime sanity. The release-pipeline gate (`check-wh40k-dataset.mjs`)
  // already enforces these, but we belt-and-braces in case a user mounts
  // a hand-edited dist or runs from an unusual checkout.
  if (manifest && idx.schemaVersion != null && manifest.schemaVersion !== idx.schemaVersion) {
    console.warn(
      `[wh40k] schemaVersion mismatch: index.json=${idx.schemaVersion}, manifest=${manifest.schemaVersion}`
    );
  }
  if (factions.length === 0 || units.length === 0) {
    console.error('[wh40k] dataset loaded but is empty — release likely missing import step.');
  }
  if (typeof console !== 'undefined') {
    console.info(`[wh40k] loaded ${factions.length} factions, ${units.length} units in ${Date.now() - t0}ms`);
  }

  return {
    // version metadata
    edition, version, manifest,

    // canonical (normalized)
    canonical: {
      factions, detachments, units,
      modelProfiles, weaponProfiles, abilities, keywords,
      stratagems, enhancements, armyRules,
      unitCompositions, wargearOptions,
    },

    // lookups
    factions, factionsById,
    detachments, detachmentsById, detachmentsByFaction,
    units: hydratedUnits, unitsById: hydratedById, unitsByFaction: hydratedByFaction,
    modelProfilesById, weaponProfilesById, abilitiesById, keywordsById,
    stratagemsById, stratagemsByDetachment,
    enhancementsById, enhancementsByDetachment,
    compositionsById, wargearById,

    // helpers / aliases
    aliases,
    /** Translate a legacy id to the current canonical id. */
    resolveId: (id) => aliases[id] || id,

    // filter universes
    allKeywords, allRoles,
  };
}

function indexBy(arr, key) {
  const m = {};
  for (const e of arr) m[e[key]] = e;
  return m;
}
function groupBy(arr, key) {
  const m = {};
  for (const e of arr) {
    const k = e[key];
    if (k == null) continue;
    (m[k] ||= []).push(e);
  }
  return m;
}

/**
 * Build a "hydrated" view of a canonical unit — refs resolved into the
 * inline shape the existing UI expects. The hydrated object contains:
 *
 *   { id, factionId, name, role, keywords, factionKeywords,
 *     // canonical-normalized fields kept for code that wants them:
 *     modelProfileIds, weaponProfileIds, abilityIds, compositionId,
 *     pointsCosts: [{models, cost}],     // canonical shape preserved
 *     // resolved view used by UnitCard / UnitDetail / filterUnits:
 *     points: <number>,                  // scalar (first cost) — UI legacy
 *     modelCounts: <number[]>,           // models per point row
 *     stats, abilities, wargear,
 *     composition: { text, minModels, maxModels } }
 *
 * Why a scalar `points`: the existing UI/services were written against a
 * single number. Keeping that surface stable means no component churn —
 * the canonical `pointsCosts` array is exposed for future callers that
 * need the full cost table (e.g. tournament-style multi-model pricing).
 */
function hydrateUnit(u, ctx) {
  const stats = (u.modelProfileIds || [])
    .map(id => ctx.modelProfilesById[id])
    .filter(Boolean)
    .map(p => ({ name: p.name, m: p.m, t: p.t, sv: p.sv, w: p.w, ld: p.ld, oc: p.oc, invSv: p.invSv }));

  const wargear = (u.weaponProfileIds || [])
    .map(id => ctx.weaponProfilesById[id])
    .filter(Boolean)
    .map(w => ({
      name: w.name,
      range: w.range,
      a: w.attacks,
      bs: w.bs || undefined,
      ws: w.ws || undefined,
      s: w.strength,
      ap: w.ap,
      d: w.damage,
      abilities: w.abilities,
    }));

  const abilities = (u.abilityIds || [])
    .map(id => ctx.abilitiesById[id])
    .filter(Boolean)
    .map(a => ({ name: a.name, text: a.text }));

  const composition = ctx.compositionsById[u.compositionId] || null;
  const modelCounts = (u.points || []).map(p => p.models);
  const flatPoints = (u.points && u.points[0]) ? u.points[0].cost : 0;

  return {
    ...u,
    points: flatPoints,            // legacy scalar for existing UI
    pointsCosts: u.points || [],   // canonical [{models,cost}] preserved
    modelCounts,
    stats,
    wargear,
    abilities,
    composition,
  };
}

/* ─────────────────── React hook ─────────────────── */

export function useWh40kData() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!cachePromise) cachePromise = loadAll();
    cachePromise
      .then(data => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch(err => {
        if (cancelled) return;
        // Reset cache so a future remount can retry the load.
        cachePromise = null;
        setState({ data: null, loading: false, error: err.message || String(err) });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
