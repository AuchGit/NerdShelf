// src/features/mtg/deck-builder/services/landBudgetPipeline.js
//
// Decouples the BUDGET axis from the tempo/early/greed trio in the land
// suggester. The trio sliders shape an "ideal" mana base (call into
// `suggestLands` with the budget pressure pinned to premium). The budget
// slider then walks a deterministic SWAP CHAIN that trades premium
// fixing for cheaper lands one copy at a time — least-important slots
// first.
//
// Pipeline:
//
//   1. detectExistingLands(mainboard)
//        Walks the deck once, classifies every land as basic / catalog
//        dual / catalog fixer / utility (unknown name). Each detected
//        land is treated as a HARD LOCK — it stays in the final
//        breakdown and counts toward the land target. The user adds
//        the lands they want directly to the deck; we read them.
//
//   2. ideal = suggestLands(mainboard, { ...trio, constraint:'open',
//                                        utilityLands: locked-from-deck })
//        At constraint='open' the internal budget pressure is high
//        (~0.95), so the trio's preferred fixing tier dominates — that's
//        the "premium" anchor we walk away from.
//
//   3. swapChain = computeSwapChain(idealBreakdown, ctx)
//        Greedy descent: at each step, find the single best swap (one
//        copy of one land → one copy of a cheaper substitute, ranked
//        by €-saved / quality-lost / pair importance) and append it.
//        Repeat until no further swap exists. Locked names (the user's
//        pre-existing picks) are skipped.
//
//   4. final = applyBudgetSwaps(ideal, swapChain, budgetValue)
//        budgetValue ∈ [0..1]. 1.0 = no swaps (ideal premium); 0.0 =
//        every swap applied (basics + cheapest fixing). The integer
//        step count is round((1-budget) · swapChain.length).
//
// Result preserves the same fields the old `suggestLands` returned plus:
//   - existing:     what we detected in the deck
//   - swapChain:    full ordered list (each entry is { from, to, eurSaved,
//                   qualityLoss, reason, ... })
//   - swapsApplied: prefix of swapChain actually applied at this budget
//   - lastSwap:     the most recent swap in the applied prefix (for the
//                   "last change" UI hint)

import {
  LAND_CATALOG_EXPORT as LAND_CATALOG,
  FIXING_LANDS_EXPORT as FIXING_LANDS,
  COLOR_TO_BASIC_EXPORT as COLOR_TO_BASIC,
  BASIC_PRICE_EUR_EXPORT as BASIC_PRICE_EUR,
  pairKeyOf as pairKey,
  findLandMetaExt as findLandMeta,
  buildCostReportExt as buildCostReport,
  analyzeStructureExt as analyzeStructure,
  deriveBaseLandCountExt as deriveBaseLandCount,
  deriveTargetsExt as deriveTargets,
  normalizeSlidersExt as normalizeSliders,
  modeToConfig,
} from './landSuggestion';
import { analyzeDeck, isLand, isBasicLand } from './deckAnalysis';

const COLORS = ['W', 'U', 'B', 'R', 'G'];

const BASIC_NAMES = new Set([
  ...Object.values(COLOR_TO_BASIC),
  'Wastes',
]);

const ALL_CATALOG_NAMES = (() => {
  const set = new Set();
  for (const opts of Object.values(LAND_CATALOG)) for (const o of opts) set.add(o.name);
  for (const o of FIXING_LANDS) set.add(o.name);
  for (const c of COLORS) set.add(COLOR_TO_BASIC[c]);
  set.add('Wastes');
  return set;
})();

// ────────────────────────────────────────────────────────────────────────
// 1. EXISTING-LAND DETECTION
// ────────────────────────────────────────────────────────────────────────

/**
 * Walk a Scryfall-hydrated mainboard once and classify every land. The
 * result has stable shape so the modal can render "what we found" and
 * the pipeline can treat each bucket differently.
 *
 * Lookup is BY NAME against the curated LAND_CATALOG / FIXING_LANDS /
 * basic list. Anything else (e.g. "Bojuka Bog", "Reflecting Pool",
 * "Cabal Coffers", weird singletons) lands in `utility`: the suggester
 * keeps them in the deck untouched but can't optimize them.
 */
export function detectExistingLands(mainboard) {
  const basics       = new Map(); // basic name → count
  const catalogPair  = new Map(); // dual name  → { count, pair, tier, priceEur }
  const catalogFixer = new Map(); // fixer name → { count, fixesAny, priceTier, priceEur }
  const utility      = new Map(); // unknown    → { count, card }
  let total = 0;

  for (const entry of Object.values(mainboard || {})) {
    const { card, count } = entry;
    if (!card || !isLand(card)) continue;
    total += count;
    const name = card.name;

    if (BASIC_NAMES.has(name)) {
      basics.set(name, (basics.get(name) || 0) + count);
      continue;
    }

    // Pair-specific dual (Shock / Check / Painland / Guildgate)
    let matchedPair = null;
    for (const [pkey, opts] of Object.entries(LAND_CATALOG)) {
      const hit = opts.find(o => o.name === name);
      if (hit) {
        matchedPair = { name: hit.name, pair: pkey, tier: hit.priceTier, priceEur: hit.priceEur };
        break;
      }
    }
    if (matchedPair) {
      const prev = catalogPair.get(name) || { count: 0, ...matchedPair };
      prev.count += count;
      catalogPair.set(name, prev);
      continue;
    }

    // Fixer (basic-fetcher / triome)
    const fixer = FIXING_LANDS.find(o => o.name === name);
    if (fixer) {
      const prev = catalogFixer.get(name) || {
        count: 0, fixesAny: !!fixer.fixesAny, priceTier: fixer.priceTier,
        priceEur: fixer.priceEur, fixes: fixer.fixes,
      };
      prev.count += count;
      catalogFixer.set(name, prev);
      continue;
    }

    // Unknown land — treat as utility (kept as-is in deck, not optimized).
    const prev = utility.get(name) || { count: 0, card, isBasic: isBasicLand(card) };
    prev.count += count;
    utility.set(name, prev);
  }

  return { basics, catalogPair, catalogFixer, utility, total };
}

// ────────────────────────────────────────────────────────────────────────
// 2. SWAP CATALOG
// ────────────────────────────────────────────────────────────────────────

/**
 * For a given land name, return EVERY one-step downgrade candidate. The
 * chain builder picks the best one per step (across all current lands)
 * via score = €saved · (1 - qualityLoss · pairImportance).
 *
 * Returns an array of { to, eurSaved, qualityLoss, reason }. Empty when
 * the land is already at the cheapest tier (basics, Evolving Wilds, …).
 *
 * `ctx.colorWeight(color)` returns the relative importance of `color`
 * in the deck (0..1, sums roughly to 1 across all used colors). Used
 * to pick which BASIC to replace a downgraded dual with — we pick the
 * basic whose color has more demand, so we don't accidentally cut
 * sources of the splash color.
 */
function nextDowngrades(name, ctx = {}) {
  const colorWeight = ctx.colorWeight || (() => 1);
  // priceOf falls through to catalog `priceEur` for any name without a
  // live cache entry, so all eurSaved calculations stay sane.
  const priceOf = ctx.priceOf || ((n, fallback) => fallback);
  // Runtime pair corrections override the catalog's nested key when
  // Scryfall says otherwise. Used to pick the right basic-color for
  // the terminal swap so a miscategorised land terminates correctly.
  const corrections = ctx.corrections || null;
  const out = [];

  // ── Pair-specific catalog dual (walks the per-pair ladder) ──
  // The catalog is sorted by CATALOG priceEur ascending, but LIVE
  // Scryfall prices can re-order things. We walk the ladder looking
  // for the next-cheaper alternative under LIVE prices (skipping any
  // catalog rung that is currently MORE expensive than `from`). The
  // basic terminal swap is ALWAYS offered as a fallback so the chain
  // can always go all the way down.
  for (const [pkey, opts] of Object.entries(LAND_CATALOG)) {
    const idx = opts.findIndex(o => o.name === name);
    if (idx < 0) continue;
    const from = opts[idx];
    const fromPrice = priceOf(from.name, from.priceEur) ?? 0;

    // Walk catalog ladder for the next strictly-cheaper option.
    for (let j = idx - 1; j >= 0; j--) {
      const candidate = opts[j];
      const candPrice = priceOf(candidate.name, candidate.priceEur) ?? 0;
      if (candPrice >= fromPrice) continue;   // skip — same or pricier in reality
      const tierDiff = (from.priceTier || 0) - (candidate.priceTier || 0);
      const qualityLoss =
        tierDiff === 0 ? 0.22
        : tierDiff === 1 ? 0.55
        : 0.55 + tierDiff * 0.25;
      const tierTag = tierDiff === 0
        ? `Tier ${from.priceTier}`
        : `Tier ${from.priceTier}→${candidate.priceTier}`;
      out.push({
        to: candidate.name,
        eurSaved: fromPrice - candPrice,
        qualityLoss,
        pairCode: pkey,
        reason: `${from.name} → ${candidate.name} (${tierTag})`,
      });
      break;
    }

    // Terminal basic swap — always offered (even if a ladder step also
    // exists), so the chain can keep going once all duals are gone.
    // Use the runtime-corrected pair so a miscategorised land
    // terminates into the RIGHT basic colour.
    const actualPair = corrections?.get(name) || pkey;
    const [cA, cB] = [actualPair[0], actualPair[1]];
    const pickColor = colorWeight(cA) >= colorWeight(cB) ? cA : cB;
    const basicName = COLOR_TO_BASIC[pickColor];
    const basicPrice = priceOf(basicName, BASIC_PRICE_EUR) ?? 0;
    if (fromPrice > basicPrice) {
      out.push({
        to: basicName,
        eurSaved: fromPrice - basicPrice,
        qualityLoss: 0.90,
        pairCode: pkey,
        reason: `${from.name} → ${basicName} (Tier ${from.priceTier} → Basic)`,
      });
    }
    return out;
  }

  // ── Fixer (basic-fetcher / triome) ──────────────────────────
  const fixer = FIXING_LANDS.find(o => o.name === name);
  if (fixer) {
    const fromPrice = priceOf(fixer.name, fixer.priceEur);
    if (fixer.fixesAny) {
      // Walk down through cheaper basic-fetchers first, then to a basic.
      // Use LIVE prices for the "cheaper than" comparison so reality
      // (Fabled Passage at 3.5€, Evolving Wilds at 0.25€) drives order.
      const cheaperFetchers = FIXING_LANDS
        .filter(o => o.fixesAny && o.name !== fixer.name)
        .map(o => ({ land: o, price: priceOf(o.name, o.priceEur) ?? Infinity }))
        .filter(({ price }) => price < (fromPrice ?? Infinity))
        .sort((a, b) => b.price - a.price);
      if (cheaperFetchers.length > 0) {
        const to = cheaperFetchers[0].land;
        const toPrice = cheaperFetchers[0].price;
        out.push({
          to: to.name,
          eurSaved: (fromPrice ?? 0) - (toPrice ?? 0),
          qualityLoss: 0.20,
          reason: `${fixer.name} → ${to.name} (günstigerer Basic-Fetcher)`,
        });
      } else {
        const bestColor = COLORS
          .filter(c => colorWeight(c) > 0)
          .sort((a, b) => colorWeight(b) - colorWeight(a))[0];
        if (bestColor) {
          const basicName = COLOR_TO_BASIC[bestColor];
          const basicPrice = priceOf(basicName, BASIC_PRICE_EUR);
          out.push({
            to: basicName,
            eurSaved: (fromPrice ?? 0) - (basicPrice ?? 0),
            qualityLoss: 0.60,
            reason: `${fixer.name} → ${basicName} (kein Fix mehr)`,
          });
        }
      }
      return out;
    }
    // Triome → basic of its most-demanded color
    const triColors = fixer.fixes || [];
    const bestColor = triColors.slice().sort((a, b) => colorWeight(b) - colorWeight(a))[0];
    if (bestColor) {
      const basicName = COLOR_TO_BASIC[bestColor];
      const basicPrice = priceOf(basicName, BASIC_PRICE_EUR);
      out.push({
        to: basicName,
        eurSaved: (fromPrice ?? 0) - (basicPrice ?? 0),
        qualityLoss: 1.10,
        reason: `${fixer.name} → ${basicName} (Triome → Basic)`,
      });
    }
    return out;
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 3. SWAP CHAIN BUILDER
// ────────────────────────────────────────────────────────────────────────

/**
 * Greedy: walk the ideal breakdown, at each step pick the single best
 * downgrade across every currently-present land. Append, apply, repeat.
 *
 * Score is plain €-per-quality-loss, attenuated by the pair's color
 * weight so duals in MAIN-color pairs (heavily used colors) get swapped
 * LATER than duals in splash pairs. Concretely:
 *
 *    swapScore = (eurSaved + 0.05)
 *              / ((qualityLoss + 0.10) · (1 + 0.6 · pairImportance))
 *
 * pairImportance = avg(colorWeight(a), colorWeight(b)) for pair-specific
 * lands; for fixers it's mean weight across the colors they cover.
 *
 * `lockedNames` are user-detected lands that we never swap — they stay
 * in the final breakdown exactly as the user put them.
 *
 * Tie-break on (eurSaved desc, name asc) so the chain is deterministic.
 */
function buildSwapChain(initialBreakdown, ctx) {
  const lockedNames = ctx.lockedNames instanceof Set ? ctx.lockedNames : new Set();
  const colorWeight = ctx.colorWeight || (() => 0.2);
  const priceOf = ctx.priceOf || ((n, fallback) => fallback);
  const corrections = ctx.corrections || null;

  const pairImportance = (cand) => {
    if (cand.pairCode) {
      return (colorWeight(cand.pairCode[0]) + colorWeight(cand.pairCode[1])) / 2;
    }
    return 0.4;
  };

  const working = { ...initialBreakdown };
  const chain = [];
  const SAFETY = 300; // hard upper bound — even a 40-land deck can't exceed this

  for (let iter = 0; iter < SAFETY; iter++) {
    let best = null;
    let bestScore = -Infinity;

    for (const [name, count] of Object.entries(working)) {
      if (count <= 0) continue;
      if (lockedNames.has(name)) continue;
      const downs = nextDowngrades(name, { colorWeight, priceOf, corrections });
      for (const dg of downs) {
        const imp = pairImportance(dg);
        const score = (dg.eurSaved + 0.05) / ((dg.qualityLoss + 0.10) * (1 + 0.6 * imp));
        if (
          score > bestScore
          || (score === bestScore && best && (
            dg.eurSaved > best.eurSaved
            || (dg.eurSaved === best.eurSaved && name.localeCompare(best.from) < 0)
          ))
        ) {
          best = {
            from: name,
            to: dg.to,
            eurSaved: dg.eurSaved,
            qualityLoss: dg.qualityLoss,
            reason: dg.reason,
            pairCode: dg.pairCode,
            score,
          };
          bestScore = score;
        }
      }
    }

    if (!best) break;

    chain.push(best);
    working[best.from] = (working[best.from] || 0) - 1;
    if (working[best.from] <= 0) delete working[best.from];
    working[best.to] = (working[best.to] || 0) + 1;
  }

  return chain;
}

// ────────────────────────────────────────────────────────────────────────
// 4. APPLY SWAPS
// ────────────────────────────────────────────────────────────────────────

function applyBudgetSwaps(idealBreakdown, swapChain, budget) {
  const clampedBudget = Math.max(0, Math.min(1, budget));
  const totalSteps = swapChain.length;
  const stepsToApply = Math.round(totalSteps * (1 - clampedBudget));
  const applied = swapChain.slice(0, stepsToApply);
  const final = { ...idealBreakdown };
  for (const sw of applied) {
    final[sw.from] = (final[sw.from] || 0) - 1;
    if (final[sw.from] <= 0) delete final[sw.from];
    final[sw.to] = (final[sw.to] || 0) + 1;
  }
  return {
    final,
    appliedSwaps: applied,
    totalSteps,
    stepsApplied: stepsToApply,
    lastSwap: applied.length > 0 ? applied[applied.length - 1] : null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 5. PUBLIC ENTRY
// ────────────────────────────────────────────────────────────────────────

/**
 * Run the decoupled budget pipeline.
 *
 *   trio sliders → IDEAL allocation built locally (pure-premium per pair)
 *   budget slider → walks the swap chain step by step away from premium
 *
 * The ideal allocator is intentionally NOT routed through the legacy
 * `suggestLands` scoring (which still produces a tier mix even at high
 * budget pressure because of its internal floor / bias stabilisers). At
 * budget = 1.0 a deckbrewer-style premium mana base is what you get:
 * every dual slot is the best available card for the pair, every
 * triome / Fabled Passage is used only when the trio sliders justify
 * it. The swap chain then trades those slots one at a time as the
 * budget slider moves toward 0.
 *
 * @param {Object} mainboard         current deck
 * @param {Object} [options]
 * @param {Object} [options.commander]
 * @param {number} [options.deckSize]
 * @param {Object} [options.sliders]  trio { tempo, earlyGame, greed } (0..1 each)
 * @param {number} [options.budget]   separate slider 0..1 (1 = premium ideal)
 * @param {string} [options.archetype] optional preset key for slider defaults
 * @param {Set<string>|Array<string>|null} [options.keptLandNames]
 *        Names the user explicitly wants to PRESERVE — these are
 *        locked into the breakdown and excluded from the swap chain.
 *        Lands in the deck NOT in this set are treated as "the
 *        suggester is free to replace them" — useful when you've
 *        already applied a suggestion and want a fresh take while
 *        keeping just your custom Bojuka Bog / Reflecting Pool etc.
 *        Omit (or null) → preserve every detected land (legacy
 *        behaviour, equivalent to "all utility + all catalog locked").
 */
export function suggestLandsWithBudget(mainboard, options = {}) {
  const {
    commander,
    deckSize,
    archetype,
    budget = 1.0,
    keptLandNames = null,
    livePrices = null,    // Map<name, eurNumber> — live Scryfall prices
                          // override the catalog's hardcoded priceEur.
                          // When null, catalog prices are used (legacy).
    pairCorrections = null, // Map<name, actualPairCode> — derived from
                          // Scryfall color_identity. Lets the suggester
                          // pick lands by their REAL pair even when
                          // the static catalog has them in the wrong
                          // nested key (e.g. Undercity Sewers listed
                          // under BG but actually UB/Dimir).
  } = options;

  // Seed sliders from preset (if any) then override with caller values.
  const presetSliders = archetype ? (modeToConfig(archetype) || {}) : {};
  const sliders = normalizeSliders({ ...presetSliders, ...(options.sliders || {}) });

  // ── 1. Detect what's already in the deck ─────────────────
  const existing = detectExistingLands(mainboard);

  // Normalise the kept-set. null → keep everything (legacy default).
  const kept = keptLandNames == null
    ? null
    : (keptLandNames instanceof Set ? keptLandNames : new Set(keptLandNames));
  const shouldKeep = (name) => kept == null ? true : kept.has(name);

  // Price resolver: live Scryfall price first, catalog fallback.
  // Returns a number in EUR or null if no price is known.
  const priceMap = livePrices instanceof Map
    ? livePrices
    : (livePrices ? new Map(Object.entries(livePrices)) : null);
  const priceOf = (name, catalogPrice = null) => {
    if (priceMap && priceMap.has(name)) {
      const v = priceMap.get(name);
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    }
    if (typeof catalogPrice === 'number' && Number.isFinite(catalogPrice)) return catalogPrice;
    // Last-resort fallback: look up in the catalog directly.
    const meta = findLandMeta(name);
    return meta.priceEur ?? null;
  };

  // Pair-code resolver: catalog says X, Scryfall might say Y. The
  // correction map (built by landPriceCache) wins when it has an entry.
  const corrections = pairCorrections instanceof Map
    ? pairCorrections
    : (pairCorrections ? new Map(Object.entries(pairCorrections)) : null);
  /**
   * Given a desired (a, b) color pair, return every catalog land that
   * actually belongs to it according to Scryfall (with catalog as
   * fallback). This replaces blind `LAND_CATALOG[pairKey(a,b)]`
   * lookups so a miscategorised land surfaces in its true pair.
   */
  const landsForPair = (a, b) => {
    const target = pairKey(a, b);
    const out = [];
    for (const [catalogKey, opts] of Object.entries(LAND_CATALOG)) {
      for (const opt of opts) {
        const corrected = corrections?.get(opt.name);
        const actualPair = corrected || catalogKey;
        if (actualPair === target) out.push(opt);
      }
    }
    return out;
  };

  // ── 2. Analyse the deck ──────────────────────────────────
  const isCommander = !!commander;
  const targetDeckSize = deckSize ?? (isCommander ? 100 : 60);
  const analysis  = analyzeDeck(mainboard, commander);
  const structure = analyzeStructure(mainboard, analysis);
  const signals = {
    rampDensity:     structure.rampDensity,
    rampClass:       structure.rampClass,
    flexibilityClass: structure.flexibilityClass,
    treasureClass:   structure.treasureClass,
    engineClass:     structure.engineClass,
  };

  // ── 3. Build the IDEAL allocation (pure-premium) ─────────
  // Only "kept" lands are seeded into the breakdown as locked starting
  // material. Everything else the suggester treats as "freely
  // replaceable" — i.e. the user said go ahead and re-pick.
  const ideal = buildIdealAllocation({
    analysis, structure, signals, sliders,
    isCommander, targetDeckSize,
    existing,
    shouldKeep,
    landsForPair,
  });

  // ── 4. Color-importance weights for swap prioritisation ──
  const totalShare = COLORS.reduce((s, c) => s + (analysis.colorShare[c] || 0), 0) || 1;
  const colorWeight = (c) => (analysis.colorShare[c] || 0) / totalShare;

  // ── 5. Build the swap chain ──────────────────────────────
  // Locked names = only the user-confirmed "behalten" picks. Generated
  // lands stay swappable so the budget slider can keep moving them.
  // Swap chain receives priceOf so its €-saved ranking is live-priced.
  const lockedNames = new Set();
  for (const [name] of existing.basics)       if (shouldKeep(name)) lockedNames.add(name);
  for (const [name] of existing.catalogPair)  if (shouldKeep(name)) lockedNames.add(name);
  for (const [name] of existing.catalogFixer) if (shouldKeep(name)) lockedNames.add(name);
  for (const [name] of existing.utility)      if (shouldKeep(name)) lockedNames.add(name);
  const swapChain = buildSwapChain(ideal.breakdown, {
    lockedNames, colorWeight, priceOf, corrections,
  });

  // ── 6. Apply swaps per budget slider ─────────────────────
  const applied = applyBudgetSwaps(ideal.breakdown, swapChain, budget);

  // ── 7. Cost report ───────────────────────────────────────
  // Only the user-kept utility lands tag the cost-report's "utility"
  // category; unchecked utility lands have been dropped from the
  // breakdown by `buildIdealAllocation`. Utility-land prices are read
  // from the live mainboard card (already in `existing.utility`) so
  // weird singletons like Bojuka Bog carry their real Cardmarket
  // price instead of being treated as price-unknown.
  const utilityAlloc = new Map();
  const utilityCardPrice = new Map();
  for (const [name, info] of existing.utility) {
    if (!shouldKeep(name)) continue;
    utilityAlloc.set(name, info.count);
    const card = info.card;
    if (card) {
      const liveCardPrice = card.prices?.eur ?? card.prices?.eur_foil;
      const n = liveCardPrice == null ? null : Number(liveCardPrice);
      if (Number.isFinite(n)) utilityCardPrice.set(name, n);
    }
  }
  const finalCost = buildLivePricedCost(applied.final, {
    priceOf,
    utilityNames: new Set(utilityAlloc.keys()),
    utilityCardPrice,
  });

  // ── 8. Per-color source recount + explanation ────────────
  const perColor = recomputePerColor(applied.final);

  // ── 9. Quality score for the final breakdown ─────────────
  const score = scoreManabase(applied.final, {
    analysis, sliders, isCommander, perColor,
    colorSourceTargets: ideal.colorSourceTargets,
  });

  const explanation = buildExplanation({
    analysis, structure, ideal, sliders, applied, finalCost, targetDeckSize,
    existing, budget, score,
  });

  return {
    totalLands: ideal.landTarget,
    breakdown: applied.final,
    perColor,
    cost: finalCost,
    explanation,
    score,
    analysis: {
      ...analysis,
      structure,
      rampDensity:     structure.rampDensity,
      rampClass:       structure.rampClass,
      treasureClass:   structure.treasureClass,
      flexibilityClass: structure.flexibilityClass,
    },
    breakdownByCategory: ideal.breakdownByCategory,
    landBreakdown: ideal.landBreakdown,
    colorSourceTargets: ideal.colorSourceTargets,
    existing,
    swapChain,
    swapsApplied: applied.appliedSwaps,
    stepsApplied: applied.stepsApplied,
    totalSteps: applied.totalSteps,
    lastSwap: applied.lastSwap,
    budget,
    config: sliders,
  };
}

// ────────────────────────────────────────────────────────────────────────
// IDEAL ALLOCATOR (pure-premium, no tier-mixing stabilisers)
// ────────────────────────────────────────────────────────────────────────

/**
 * Build the IDEAL landbase: every dual slot fills with the TOP tier land
 * of its color pair. Greed sliders only influence how many slots are
 * duals vs basics (and how many triomes a 3+-color list sprinkles in).
 *
 * Pre-existing lands (user-added) are locked into the breakdown verbatim
 * and reduce the remaining generated quota. They do NOT influence the
 * tier choice of generated slots — the user gets the same premium for
 * the remaining slots regardless.
 */
function buildIdealAllocation({
  analysis, structure, signals, sliders,
  isCommander, targetDeckSize, existing,
  shouldKeep = () => true,
  landsForPair = null,
}) {
  // Fallback when no Scryfall-aware resolver is provided (legacy callers).
  const lookupPair = landsForPair || ((a, b) => LAND_CATALOG[pairKey(a, b)] || []);
  const landBreakdown = deriveBaseLandCount(analysis, structure, isCommander);
  let landTarget = landBreakdown.total;

  // Honour deck-size constraint — never request more land slots than exist.
  const nonLand = analysis.nonLandCount;
  const slotsAvailable = Math.max(landTarget, targetDeckSize - nonLand);
  if (slotsAvailable > 0 && slotsAvailable < landTarget) landTarget = slotsAvailable;

  // Slider knobs (basics-vs-duals split + per-color floor).
  const { dualPct, minSourcesPerColor } = deriveTargets(sliders, signals);

  // Color source targets (used for explanation / diagnostics).
  const colorSourceTargets = {};
  for (const c of COLORS) {
    colorSourceTargets[c] = Math.round(5 + (analysis.pips[c] || 0) * 0.30);
  }

  // ── Seed breakdown with the user's KEPT pre-existing lands ──
  // Unchecked entries are ignored here — the suggester gets to fill
  // those slots fresh from premium picks.
  const breakdown = {};
  let lockedTotal = 0;
  for (const [name, count] of existing.basics) {
    if (!shouldKeep(name)) continue;
    breakdown[name] = (breakdown[name] || 0) + count; lockedTotal += count;
  }
  for (const [name, info] of existing.catalogPair) {
    if (!shouldKeep(name)) continue;
    breakdown[name] = (breakdown[name] || 0) + info.count; lockedTotal += info.count;
  }
  for (const [name, info] of existing.catalogFixer) {
    if (!shouldKeep(name)) continue;
    breakdown[name] = (breakdown[name] || 0) + info.count; lockedTotal += info.count;
  }
  for (const [name, info] of existing.utility) {
    if (!shouldKeep(name)) continue;
    breakdown[name] = (breakdown[name] || 0) + info.count; lockedTotal += info.count;
  }

  const colorsUsed = analysis.colorsUsed;
  const numColors = colorsUsed.length;

  // Remaining slots to generate (after the locked ones).
  const remaining = Math.max(0, landTarget - lockedTotal);

  // ── Colorless / single-color short circuits ──────────────
  if (numColors === 0) {
    if (remaining > 0) breakdown['Wastes'] = (breakdown['Wastes'] || 0) + remaining;
    return {
      breakdown, landTarget, landBreakdown,
      colorSourceTargets,
      breakdownByCategory: categorise(breakdown),
    };
  }
  if (numColors === 1) {
    const c = colorsUsed[0];
    if (remaining > 0) breakdown[COLOR_TO_BASIC[c]] = (breakdown[COLOR_TO_BASIC[c]] || 0) + remaining;
    return {
      breakdown, landTarget, landBreakdown,
      colorSourceTargets,
      breakdownByCategory: categorise(breakdown),
    };
  }

  // ── Multi-color: split into basics + duals + (optional) triomes ──
  let dualSlots = Math.round(remaining * dualPct);
  let basicSlots = remaining - dualSlots;

  // Triomes scale with deck color count AND greed. For 3+ color decks
  // they're often the only way to get genuine 3-color reach without
  // burning through fetch budget.
  //   3 colors → up to 2 (one matching triome, optional second copy)
  //   4 colors → up to 4 (4 of the 5 triomes cover all 4 colors)
  //   5 colors → up to 5 (one of each triome)
  // Greed scales these caps (low greed → 0 triomes; high greed → max).
  let triomeSlots = 0;
  if (numColors >= 3) {
    const capByColors = numColors === 3 ? 2 : numColors === 4 ? 4 : 5;
    const greedFactor = Math.max(0, Math.min(1, (sliders.greed - 0.25) * 1.6));
    triomeSlots = Math.round(capByColors * greedFactor);
    if (isCommander) triomeSlots = Math.min(triomeSlots, numColors); // singleton cap
    triomeSlots = Math.min(triomeSlots, Math.max(0, dualSlots));
    dualSlots = Math.max(0, dualSlots - triomeSlots);
  }

  // ── Basic allocation (color share blended toward uniform by greed) ──
  const sumShare = colorsUsed.reduce((s, c) => s + analysis.colorShare[c], 0) || 1;
  const uniform = 1 / numColors;
  const blend = sliders.greed * 0.4;
  let allocated = 0;
  colorsUsed.forEach((c, i) => {
    const last = i === colorsUsed.length - 1;
    const share = analysis.colorShare[c] / sumShare;
    const eff = share * (1 - blend) + uniform * blend;
    const want = last ? Math.max(0, basicSlots - allocated) : Math.round(basicSlots * eff);
    if (want > 0) {
      const name = COLOR_TO_BASIC[c];
      breakdown[name] = (breakdown[name] || 0) + want;
      allocated += want;
    }
  });

  // ── Dual allocation: each pair gets weight = sum of its colors'
  //    shares; quota fills HIGHEST tier first, ranked WITHIN tier by
  //    style-vs-slider fit (shock vs fastland vs surveil … picks
  //    the best one for the deck's tempo / early / greed profile).
  if (dualSlots > 0) {
    const pairs = [];
    for (let i = 0; i < colorsUsed.length; i++) {
      for (let j = i + 1; j < colorsUsed.length; j++) {
        const a = colorsUsed[i], b = colorsUsed[j];
        const w = analysis.colorShare[a] + analysis.colorShare[b];
        pairs.push({ a, b, weight: w });
      }
    }
    const totalW = pairs.reduce((s, p) => s + p.weight, 0) || 1;
    const globalCap = isCommander ? 1 : 4;
    let used = 0;
    pairs.forEach((p, k) => {
      const last = k === pairs.length - 1;
      const raw = last ? Math.max(0, dualSlots - used) : dualSlots * (p.weight / totalW);
      const n = Math.round(raw);
      used += n;
      if (n <= 0) return;
      const opts = lookupPair(p.a, p.b);
      if (opts.length === 0) return;
      // Two-key sort: tier desc, then style-fit desc. Within tier, the
      // ranker decides whether (e.g.) Shock or Fastland or Surveil
      // land suits the deck better — context-aware via avgCmc and
      // structure signals so fast aggro lists pick fastlands while
      // mid/slow decks default to shocks.
      const rankCtx = {
        isCommander,
        avgCmc: analysis.avgCmc || 0,
        rampClass: signals?.rampClass,
        treasureClass: signals?.treasureClass,
      };
      const ranked = opts.slice().sort((x, y) => {
        const tierDiff = (y.priceTier || 0) - (x.priceTier || 0);
        if (tierDiff !== 0) return tierDiff;
        return rankLandStyle(y, sliders, rankCtx)
             - rankLandStyle(x, sliders, rankCtx);
      });
      let spill = n;
      for (const land of ranked) {
        if (spill <= 0) break;
        const existingCount = breakdown[land.name] || 0;
        const room = Math.max(0, globalCap - existingCount);
        const take = Math.min(room, spill);
        if (take > 0) {
          breakdown[land.name] = existingCount + take;
          spill -= take;
        }
      }
      // If still spilling (cap exhausted across all tiers) convert the
      // residual into basics of the pair's dominant color.
      if (spill > 0) {
        const c = analysis.colorShare[p.a] >= analysis.colorShare[p.b] ? p.a : p.b;
        const name = COLOR_TO_BASIC[c];
        breakdown[name] = (breakdown[name] || 0) + spill;
      }
    });
  }

  // ── Triome allocation: spread across all triomes whose 3 colors
  //    are inside our color identity, weighted by total colorShare of
  //    the triome's colors. For 3-color decks there's 1 matching
  //    triome; for 4-color, 4 candidates (drop the one missing the
  //    most-used color); for 5-color, all 5.
  if (triomeSlots > 0) {
    const colorSet = new Set(colorsUsed);
    const candidates = FIXING_LANDS
      .filter(f =>
        !f.fixesAny
        && Array.isArray(f.fixes)
        && f.fixes.length === 3
        && f.fixes.every(c => colorSet.has(c))
      )
      .map(f => ({
        triome: f,
        weight: f.fixes.reduce((s, c) => s + (analysis.colorShare[c] || 0), 0),
      }))
      .sort((a, b) => b.weight - a.weight);
    const cap = isCommander ? 1 : 4;
    let remaining = triomeSlots;
    // Round-robin fill: 1 copy each to the top candidates, then a
    // second copy if budget allows, etc. This way 4-color decks get
    // 4 different triomes before any single one doubles up.
    let pass = 0;
    while (remaining > 0 && pass < cap) {
      let advanced = false;
      for (const c of candidates) {
        if (remaining <= 0) break;
        const used = breakdown[c.triome.name] || 0;
        if (used >= cap) continue;
        breakdown[c.triome.name] = used + 1;
        remaining--;
        advanced = true;
      }
      if (!advanced) break;
      pass++;
    }
    // Whatever still spills (e.g. weird color combos with no matching
    // triome at all) becomes basics of the most-demanded color.
    if (remaining > 0) {
      const c = colorsUsed.slice().sort((a, b) => analysis.colorShare[b] - analysis.colorShare[a])[0];
      breakdown[COLOR_TO_BASIC[c]] = (breakdown[COLOR_TO_BASIC[c]] || 0) + remaining;
    }
  }

  return {
    breakdown, landTarget, landBreakdown,
    colorSourceTargets,
    breakdownByCategory: categorise(breakdown),
  };
}

/**
 * Build a cost report compatible with the legacy `buildCostReport` shape
 * but using LIVE prices from `priceOf`. Same item categories so the
 * categorised breakdown UI keeps working unchanged.
 */
function buildLivePricedCost(breakdown, ctx) {
  const { priceOf, utilityNames, utilityCardPrice } = ctx;
  const items = [];
  let total = 0;
  for (const [name, count] of Object.entries(breakdown)) {
    if (count <= 0) continue;
    const meta = findLandMeta(name);
    let category;
    if (utilityNames && utilityNames.has(name)) {
      category = 'utility';
    } else if (meta.source === 'fixing') {
      category = 'fixing';
    } else if (meta.source === 'basic') {
      category = name === 'Wastes' ? 'colorless' : 'basic';
    } else if (meta.priceTier === 1) {
      category = 'dual_t1';
    } else if (meta.priceTier === 2) {
      category = 'dual_t2';
    } else if (meta.priceTier === 3) {
      category = 'dual_t3';
    } else {
      category = 'unknown';
    }
    // Price source priority for utility lands: their own card's
    // Scryfall eur (we captured it in `utilityCardPrice`). For
    // everything else: live cached price → fall back to catalog.
    let unit = null;
    if (category === 'utility' && utilityCardPrice && utilityCardPrice.has(name)) {
      unit = utilityCardPrice.get(name);
    } else {
      unit = priceOf(name, meta.priceEur);
    }
    const subtotal = unit != null ? unit * count : null;
    if (subtotal != null) total += subtotal;
    items.push({
      name, count,
      priceTier: meta.priceTier,
      unitPriceEur: unit,
      subtotalEur: subtotal,
      category,
    });
  }
  return { items, totalEur: total };
}

/**
 * Within-tier style ranking — given multiple lands at the same priceTier
 * (Shock vs Fastland vs Surveil land …), which one fits this deck best?
 *
 *   Default winner is SHOCK / PAINLAND. They're untapped, fetchable,
 *   universal — what any deckbuilder reaches for first when budget
 *   isn't the constraint. Everything else has to EARN its slot via
 *   slider context + deck-derived signals (avgCmc, ramp class).
 *
 * Re-anchored 2026 because the previous (+0.45 fastland) bonus made
 * fastlands win for almost every fast-leaning deck even when the curve
 * extended into T5+ — by which point fastland is just a tapped land.
 *
 *   shock     1.00         Anchor. Untapped, has basic types, fetchable
 *                          by Polluted-Delta-style fetches.
 *   painland  0.95         Same speed as shock, costs 1 life per use.
 *                          Slightly under shock for the life cost.
 *   surveil   0.95 (+0.10 if greed ≥ 0.55)
 *                          Painland + surveil 1 ETB. Greedy/value
 *                          decks edge it over shock.
 *   fastland  0.82 + up to +0.18 if VERY aggro
 *                          Only wins against shock for true aggro:
 *                          tempo+early ≥ 1.50 AND avgCmc ≤ 2.8.
 *                          Mid-range / control: shock comfortably ahead.
 *   checkland 0.82 (+0.10 if greed ≥ 0.55)
 *   slowland  0.75 + up to +0.25 if (tempo+early < 0.85 AND avgCmc ≥ 3.0)
 *                          Strong late-game; not worth it for fast lists.
 *   scryland  0.65
 *   guildgate 0.45
 *   fetch     special: commander = 1.20 (premium); else greed ≥ 0.70 = 1.05; else excluded
 *   bondland  +0.55 in commander only, else excluded
 */
function rankLandStyle(land, sliders, ctx = {}) {
  const tempo = sliders.tempo ?? 0.5;
  const early = sliders.earlyGame ?? 0.5;
  const greed = sliders.greed ?? 0.5;
  const isCommander = !!ctx.isCommander;
  const avgCmc = ctx.avgCmc || 0;
  switch (land.style) {
    case 'fetch':
      if (isCommander) return 1.20;
      if (greed >= 0.70) return 1.05;
      return -10;          // effectively excluded
    case 'shock':
      return 1.00;
    case 'painland':
      return 0.95;
    case 'surveil':
      return 0.95 + (greed >= 0.55 ? 0.10 : 0);
    case 'fastland': {
      // Only beats shock when the deck is TRULY aggressive: high
      // tempo+early AND a low curve so games end before fastland's
      // tap-condition expires.
      const veryAggro = (tempo + early) >= 1.50 && avgCmc <= 2.8;
      if (veryAggro) return 1.00 + 0.18 * Math.min(1, (tempo + early - 1.50) / 0.50);
      return 0.82;
    }
    case 'checkland':
      return 0.82 + (greed >= 0.55 ? 0.10 : 0);
    case 'slowland': {
      const slowFavoured = (tempo + early) < 0.85 && avgCmc >= 3.0;
      if (slowFavoured) return 0.75 + 0.25 * Math.min(1, (0.85 - (tempo + early)) / 0.50);
      return 0.65;
    }
    case 'scryland':
      return 0.65 + (early < 0.4 ? 0.08 : 0);
    case 'guildgate':
      return 0.45;
    case 'bondland':
      return isCommander ? 1.10 : -100;
    default:
      return 0.45;
  }
}

// Effective speed contribution per land style. 1.0 = always untapped
// from turn 1; 0.0 = always tapped. The score function averages this
// across the breakdown to compute the "speed" component.
const STYLE_SPEED = {
  fetch:     1.00,          // sac → untapped land, near-zero tempo loss
  shock:     1.00,
  fastland:  0.95,          // untapped early, tapped after T3
  surveil:   1.00,          // pain-style untapped
  painland:  1.00,
  checkland: 0.85,          // untapped if you control matching basic
  slowland:  0.55,          // tapped early, fine late
  scryland:  0.30,
  guildgate: 0.30,
  bondland:  1.00,
  basic:     1.00,
  triome:    0.35,          // tapped, 3-color reach
  fixer:     0.30,          // basic-fetcher (Evolving Wilds / Fabled Passage)
};

/** Group a flat breakdown by category for the modal's breakdown panel. */
function categorise(breakdown) {
  const basics = {};
  const duals = { tier1: {}, tier2: {}, tier3: {} };
  const fixingLands = {};
  const utilityLands = {};
  for (const [name, count] of Object.entries(breakdown)) {
    if (count <= 0) continue;
    const meta = findLandMeta(name);
    if (meta.source === 'basic') {
      basics[name] = (basics[name] || 0) + count;
    } else if (meta.source === 'fixing') {
      fixingLands[name] = (fixingLands[name] || 0) + count;
    } else if (meta.source === 'dual') {
      const bucket = meta.priceTier === 1 ? 'tier1'
                   : meta.priceTier === 2 ? 'tier2'
                   : meta.priceTier === 3 ? 'tier3' : null;
      if (bucket) duals[bucket][name] = (duals[bucket][name] || 0) + count;
    } else {
      utilityLands[name] = (utilityLands[name] || 0) + count;
    }
  }
  return { basics, duals, fixingLands, utilityLands };
}

/** Build the short human-readable summary line shown above the breakdown. */
function buildExplanation({
  analysis, structure, ideal, sliders, applied, finalCost, targetDeckSize, existing, budget, score,
}) {
  const colorList = analysis.colorsUsed.length > 0 ? analysis.colorsUsed.join('') : 'farbloses';
  const sizeText = `${targetDeckSize}-Karten`;
  const stepInfo = applied.totalSteps > 0
    ? ` · Budget Schritt ${applied.stepsApplied}/${applied.totalSteps}`
    : '';
  const lockedTotal = existing.total || 0;
  const lockedInfo = lockedTotal > 0 ? ` · ${lockedTotal} aus Deck übernommen` : '';
  const scoreInfo = score ? ` · Qualität ${score.total}/100` : '';
  let line =
    `${ideal.landTarget} Länder für ein ${sizeText}-Deck (${colorList}), Ø MV ${analysis.avgCmc.toFixed(2)}.` +
    ` Trio: Tempo ${sliders.tempo.toFixed(2)} · Early ${sliders.earlyGame.toFixed(2)} · Greed ${sliders.greed.toFixed(2)} ·` +
    ` Budget ${budget.toFixed(2)}${stepInfo}${lockedInfo}${scoreInfo}.` +
    ` Mana-Basis ≈ ${finalCost.totalEur.toFixed(2)} €.`;
  if (analysis.nonLandCount + ideal.landTarget > targetDeckSize) {
    line += ` Hinweis: ${analysis.nonLandCount + ideal.landTarget - targetDeckSize} Karte(n) müssen entfernt werden.`;
  }
  return line;
}

// ────────────────────────────────────────────────────────────────────────
// MANABASE QUALITY SCORE (0–100)
// ────────────────────────────────────────────────────────────────────────
//
// Composite score made of four weighted components that together describe
// "how good is THIS mana base for THIS deck":
//
//   - colorSources (35)  per-color sources vs target; worst-color
//                        penalty so a deck missing one color suffers
//                        even if the others are oversupplied.
//   - speed        (25)  fraction of effectively untapped mana; weight
//                        scales with tempo+early so fast decks
//                        penalise tapped lands harder.
//   - reach        (25)  multi-color land density (only matters for
//                        3+ color decks; trivially 100% for mono/2C).
//   - alignment    (15)  match between greed slider and premium share —
//                        greedy decks expect shocks/fetches; budget
//                        slider can erode this but the deck still
//                        functions, so the weight is modest.
//
// Total = sum; clamped to [0,100]. Returns both the rounded score and
// the per-component breakdown so the UI can show what costs points.

export function scoreManabase(breakdown, ctx) {
  const { analysis, sliders, isCommander, perColor, colorSourceTargets } = ctx;
  const colorsUsed = analysis.colorsUsed || [];
  const numColors = colorsUsed.length;

  // ── colorSources component (max 35) ─────────────────────
  let colorComp;
  if (numColors === 0) {
    colorComp = 35;
  } else {
    let worst = 1.0;
    let avg = 0;
    for (const c of colorsUsed) {
      const target = Math.max(1, colorSourceTargets[c] || 6);
      const actual = perColor[c] || 0;
      const ratio = Math.min(1.0, actual / target);
      if (ratio < worst) worst = ratio;
      avg += ratio;
    }
    avg /= numColors;
    // 70% mean + 30% worst — a single colour-starved colour costs more
    // than a small average dip.
    const composite = avg * 0.70 + worst * 0.30;
    colorComp = 35 * composite;
  }

  // ── speed component (max 25) ────────────────────────────
  let totalLands = 0;
  let speedSum = 0;
  for (const [name, count] of Object.entries(breakdown)) {
    if (count <= 0) continue;
    totalLands += count;
    speedSum += count * landSpeedValue(name);
  }
  const rawSpeed = totalLands > 0 ? speedSum / totalLands : 1;
  // Required speed scales with tempo+early. Tempo 1.0 + Early 1.0 → 1.00.
  // Average deck (≈ 0.55 each) → 0.78.
  const tempoEarly = ((sliders.tempo || 0) + (sliders.earlyGame || 0)) / 2;
  const required = 0.40 + 0.55 * tempoEarly;
  const speedComp = 25 * Math.min(1.0, rawSpeed / required);

  // ── reach component (max 25) ────────────────────────────
  let reachComp;
  if (numColors <= 2) {
    reachComp = 25;
  } else {
    let multiWeighted = 0;
    for (const [name, count] of Object.entries(breakdown)) {
      if (count <= 0) continue;
      const sources = colorsProducedBy(name);
      if (sources.length >= 2) {
        // Triomes and fetches count more: 3 colors = 1.5×, fetch any = 1.3×
        const w = sources.length >= 3 ? 1.5 : 1.0;
        multiWeighted += count * w;
      }
    }
    // Target: roughly 5 multi-source lands per color above 2 colors.
    const target = Math.max(1, 5 * (numColors - 1));
    reachComp = 25 * Math.min(1.0, multiWeighted / target);
  }

  // ── alignment component (max 15) ────────────────────────
  // How well does the breakdown's premium share match the greed slider?
  // greed 1.0 → wants 100% premium duals; greed 0.0 → fine with budget.
  let alignComp = 15;
  let totalDuals = 0;
  let premiumDuals = 0;
  for (const [name, count] of Object.entries(breakdown)) {
    if (count <= 0) continue;
    const meta = findLandMeta(name);
    if (meta.source === 'dual') {
      totalDuals += count;
      if ((meta.priceTier || 0) >= 3) premiumDuals += count;
    }
  }
  if (totalDuals > 0) {
    const actualPremium = premiumDuals / totalDuals;
    const targetPremium = sliders.greed || 0.5;
    // Score is highest when actualPremium matches targetPremium. Both
    // OVER and UNDER cost points (a budget slider can erode actual
    // below target, which the user expects → moderate weight).
    const gap = Math.abs(actualPremium - targetPremium);
    alignComp = 15 * (1 - gap * 0.7);
    if (alignComp < 0) alignComp = 0;
  }

  const total = colorComp + speedComp + reachComp + alignComp;
  return {
    total: Math.round(Math.max(0, Math.min(100, total))),
    components: {
      color:     { score: Math.round(colorComp), max: 35 },
      speed:     { score: Math.round(speedComp), max: 25 },
      reach:     { score: Math.round(reachComp), max: 25 },
      alignment: { score: Math.round(alignComp), max: 15 },
    },
    rawSpeed:    Math.round(rawSpeed * 100),
    requiredSpeed: Math.round(required * 100),
  };
}

/** Look up the effective-untapped speed value for a land name. Falls
 *  back to triome / fixer / basic / dual heuristics for entries that
 *  don't carry an explicit `style` tag. */
function landSpeedValue(name) {
  // 1. Direct catalog hit by name → use style.
  for (const opts of Object.values(LAND_CATALOG)) {
    const hit = opts.find(o => o.name === name);
    if (hit) return STYLE_SPEED[hit.style] ?? (hit.tapped ? 0.30 : 1.00);
  }
  // 2. Fixer (basic-fetcher or triome).
  const fixer = FIXING_LANDS.find(o => o.name === name);
  if (fixer) {
    if (fixer.fixesAny) return STYLE_SPEED.fixer;
    return STYLE_SPEED.triome;
  }
  // 3. Basic / wastes
  return STYLE_SPEED.basic;
}

/** Colors this land can produce (one entry per color). Basics → 1
 *  color; pair duals → 2; triomes → 3; fetches → 2 (the pair colors);
 *  basic-fetchers (Evolving Wilds) → all 5. */
function colorsProducedBy(name) {
  for (const [pkey, opts] of Object.entries(LAND_CATALOG)) {
    if (opts.some(o => o.name === name)) {
      return [pkey[0], pkey[1]];
    }
  }
  const fixer = FIXING_LANDS.find(o => o.name === name);
  if (fixer) {
    if (fixer.fixesAny) return ['W', 'U', 'B', 'R', 'G'];
    return fixer.fixes || [];
  }
  for (const c of COLORS) {
    if (COLOR_TO_BASIC[c] === name) return [c];
  }
  return [];
}

/** Walk the breakdown once and count colored-mana sources per color
 *  using the same lookup the suggester uses (basics → 1 source, pair
 *  duals → 1 source per color in pair, fixers → 1 each for any-fetchers
 *  and 1 per color for triomes). */
function recomputePerColor(breakdown) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [name, count] of Object.entries(breakdown)) {
    if (count <= 0) continue;
    // Basic?
    for (const c of COLORS) {
      if (COLOR_TO_BASIC[c] === name) { counts[c] += count; }
    }
    // Pair dual?
    for (const [pkey, opts] of Object.entries(LAND_CATALOG)) {
      if (opts.some(o => o.name === name)) {
        counts[pkey[0]] += count;
        counts[pkey[1]] += count;
      }
    }
    // Fixer?
    const fixer = FIXING_LANDS.find(o => o.name === name);
    if (fixer) {
      if (fixer.fixesAny) {
        for (const c of COLORS) counts[c] += count;
      } else {
        for (const c of (fixer.fixes || [])) counts[c] += count;
      }
    }
  }
  return counts;
}

/** Replace the trailing "Mana-Basis ≈ X.YY €." sentence in the
 *  pre-budget explanation with the post-swap cost so the modal's text
 *  summary stays accurate. */
function rewriteCostTail(text, totalEur) {
  if (!text) return text;
  const re = /Mana-Basis ≈ [^.]*\./;
  const replacement = `Mana-Basis ≈ ${totalEur.toFixed(2)} €.`;
  return re.test(text) ? text.replace(re, replacement) : `${text} ${replacement}`;
}
