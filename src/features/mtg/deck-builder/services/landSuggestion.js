// src/features/mtg/deck-builder/services/landSuggestion.js
//
// Production-ready mana-base suggester. Strict 4-layer architecture:
//
//   LAYER 1 — ARCHETYPE   primary behavior (5 fixed archetypes)
//   LAYER 2 — CONSTRAINTS allowed pool (priceTier filter)
//   LAYER 3 — ADJUSTMENTS user-tuned sliders (tempo / earlyGame / greed)
//   LAYER 4 — SIGNALS     deck-derived facts (ramp density, curve, fixing)
//
// Each layer reads ONLY the layers above it. The pipeline is deterministic:
// same inputs → identical breakdown.

import { analyzeDeck, COLORS, isLand, isRampCard } from './deckAnalysis';
import { getManaCost, parseManaCost } from './scryfall';

// ────────────────────────────────────────────────────────────────────────
// LAYER 1 — ARCHETYPES
// ────────────────────────────────────────────────────────────────────────

export const ARCHETYPES = Object.freeze({
  stable: {
    label: 'Stabil',
    tagline: 'Balanced mana base, Painlands as structural backbone.',
    sliders:    { tempo: 0.40, earlyGame: 0.60, greed: 0.40 },
    constraint: 'open',
    rampScaling: 'mild',
  },
  stable_budget: {
    label: 'Stabil · Budget',
    tagline: 'Stable structure, stronger budget influence; tier 3 only via tempo.',
    sliders:    { tempo: 0.40, earlyGame: 0.60, greed: 0.40 },
    constraint: 'midcap',
    rampScaling: 'mild',
  },
  optimized_tempo: {
    label: 'Optimiert · Tempo',
    tagline: 'Untapped lands prioritized, fast early game.',
    sliders:    { tempo: 0.85, earlyGame: 0.85, greed: 0.45 },
    constraint: 'open',
    rampScaling: 'mild',
  },
  optimized_late_game: {
    label: 'Optimiert · Late Game',
    tagline: 'Greedy fixing allowed, ramp reduces land pressure.',
    sliders:    { tempo: 0.25, earlyGame: 0.30, greed: 0.60 },
    constraint: 'open',
    rampScaling: 'strong',
  },
  early_game_budget: {
    label: 'Early Game · Budget',
    tagline: 'Cheap lands only, strong early consistency.',
    sliders:    { tempo: 0.70, earlyGame: 0.80, greed: 0.30 },
    constraint: 'budget',
    rampScaling: 'medium',
  },
  late_game_budget: {
    label: 'Late Game · Budget',
    tagline: 'Cheap constraint + ramp scaling, supports greedy scaling.',
    sliders:    { tempo: 0.30, earlyGame: 0.40, greed: 0.55 },
    constraint: 'budget',
    rampScaling: 'strong',
  },
});

// Aliases for backward compatibility with old API callers.
const ARCHETYPE_ALIASES = {
  optimized: 'optimized_tempo',
  budget:    'early_game_budget',
};

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);
export const MANA_MODES = ARCHETYPE_KEYS;          // legacy export name
export const DEFAULT_ARCHETYPE = 'stable';

export function getArchetype(key) {
  const resolved = ARCHETYPE_ALIASES[key] || key;
  return ARCHETYPES[resolved] ? { key: resolved, ...ARCHETYPES[resolved] } : null;
}
export function getModeLabel(key) {
  return getArchetype(key)?.label || 'Custom';
}

// ────────────────────────────────────────────────────────────────────────
// LAYER 2 — CONSTRAINTS
// ────────────────────────────────────────────────────────────────────────

export const CONSTRAINTS = Object.freeze({
  open:    { maxPriceTier: 3, label: 'Offen (alle Tiers)' },
  midcap:  { maxPriceTier: 2, label: 'Mid-Tier (kein Premium)' },
  budget:  { maxPriceTier: 1, label: 'Budget (Basics + Guildgates)' },
  basics:  { maxPriceTier: 0, label: 'Nur Basics' },
});

function resolveConstraint(name) {
  return CONSTRAINTS[name] || CONSTRAINTS.open;
}

// ────────────────────────────────────────────────────────────────────────
// LAYER 3 — ADJUSTMENTS
// ────────────────────────────────────────────────────────────────────────

export const DEFAULT_SLIDERS = Object.freeze({
  tempo:     0.50,
  earlyGame: 0.60,
  greed:     0.40,
});

const clamp01 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : (n > 1 ? 1 : n);
};

function normalizeSliders(sliders = {}) {
  return {
    tempo:     clamp01(sliders.tempo     ?? DEFAULT_SLIDERS.tempo),
    earlyGame: clamp01(sliders.earlyGame ?? DEFAULT_SLIDERS.earlyGame),
    greed:     clamp01(sliders.greed     ?? DEFAULT_SLIDERS.greed),
  };
}

// ────────────────────────────────────────────────────────────────────────
// LAYER 4 — DECK SIGNALS
// ────────────────────────────────────────────────────────────────────────

function countColoredPips(card) {
  const cost = getManaCost(card);
  const syms = parseManaCost(cost);
  let n = 0;
  for (const raw of syms) {
    const s = raw.toUpperCase();
    if (s.includes('/')) { n += 1; continue; } // hybrid counts as one colored
    if (COLORS.includes(s)) n += 1;
  }
  return n;
}

function analyzeStructure(mainboard, analysis) {
  let earlyInteraction = 0;
  let lateGame = 0;
  let fixingCount = 0;
  let engineCount = 0;
  let treasureCount = 0;
  let lowCurveCount = 0;        // CMC ≤ 2
  let highCurveCount = 0;       // CMC ≥ 5
  let earlyPipCount = 0;        // weighted colored pips on CMC ≤ 3 spells
  let earlyMulticolorCount = 0; // CMC ≤ 3 spells with ≥ 2 distinct colors
  let ramp2Count = 0;           // ramp at CMC ≤ 2
  let ramp3PlusCount = 0;       // ramp at CMC ≥ 3
  const earlyPipsByColor = { W: 0, U: 0, B: 0, R: 0, G: 0 };

  const interactionRe = /(destroy target|counter target|exile target|deal \d+ damage to|return target|fight target|tap target)/i;
  const fixingRe = /(any color|add (?:\{[wubrg]\}[ ,]+){2,})/i;
  const engineRe = /(treasure|food token|clue token|investigate|create a [^.]*token|whenever .* dies|sacrifice (?:another|a) (?:creature|artifact|permanent)|draw a card|loot)/i;
  // Treasure-specific: cards that explicitly create Treasure tokens. These
  // produce ANY-color mana when sacrificed → effectively flexible fixing.
  const treasureRe = /create (?:a |an |\w+ |\w+ \w+ )?treasure(?: token)?/i;

  for (const { card, count } of Object.values(mainboard || {})) {
    if (isLand(card)) continue;
    const cmc = card.cmc || 0;
    const text = card.oracle_text || '';
    if (cmc <= 2 && interactionRe.test(text)) earlyInteraction += count;
    if (cmc >= 5) lateGame += count;
    if (fixingRe.test(text)) fixingCount += count;
    if (engineRe.test(text)) engineCount += count;
    if (treasureRe.test(text)) treasureCount += count;

    // Curve buckets
    if (cmc <= 2) lowCurveCount += count;
    if (cmc >= 5) highCurveCount += count;

    // Early color pressure: CMC ≤ 3 spells, weighted by how early the
    // colored pips are demanded. CMC 1 → 1.5×, CMC 2 → 1.0×, CMC 3 → 0.5×.
    if (cmc <= 3) {
      const weight = cmc <= 1 ? 1.5 : cmc <= 2 ? 1.0 : 0.5;
      const pips = countColoredPips(card);
      earlyPipCount += pips * weight * count;
      const cardColors = Array.isArray(card.colors) ? card.colors : [];
      if (cardColors.length >= 2) earlyMulticolorCount += weight * count;
      // Per-color pip pressure for the color solver.
      for (const c of cardColors) {
        if (earlyPipsByColor[c] !== undefined) {
          earlyPipsByColor[c] += weight * count;
        }
      }
    }

    // Ramp by CMC (used by the LEQ subtractor).
    if (isRampCard(card)) {
      if (cmc <= 2) ramp2Count += count;
      else ramp3PlusCount += count;
    }
  }

  const denom = Math.max(1, analysis.nonLandCount);
  const rampDensity = analysis.rampCount / denom;
  const rampClass = rampDensity >= 0.15 ? 'high'
                  : rampDensity >= 0.08 ? 'medium'
                  : 'low';
  const engineDensity = engineCount / denom;
  const engineClass = engineDensity >= 0.20 ? 'high'
                    : engineDensity >= 0.10 ? 'medium'
                    : 'low';
  const treasureDensity = treasureCount / denom;
  const treasureClass = treasureDensity >= 0.15 ? 'high'
                      : treasureDensity >= 0.07 ? 'medium'
                      : 'low';

  // Combined "flexible mana" signal — used by fixing-land sizing and the
  // source-floor relaxation. Ramp + treasure both reduce reliance on
  // colored land sources.
  const flexibility = Math.min(1, rampDensity + treasureDensity * 1.2);
  const flexibilityClass = flexibility >= 0.20 ? 'high'
                         : flexibility >= 0.10 ? 'medium'
                         : 'low';

  // Curve / early-color densities (per non-land card).
  const lowCurveDensity  = lowCurveCount  / denom;
  const highCurveDensity = highCurveCount / denom;
  const earlyPipDensity  = earlyPipCount  / denom;
  const earlyMulticolorDensity = earlyMulticolorCount / denom;

  return {
    earlyInteraction, lateGame, fixingCount,
    engineCount, engineDensity, engineClass,
    treasureCount, treasureDensity, treasureClass,
    rampDensity, rampClass,
    flexibility, flexibilityClass,
    lowCurveCount, highCurveCount,
    lowCurveDensity, highCurveDensity,
    earlyPipCount, earlyPipDensity,
    earlyMulticolorCount, earlyMulticolorDensity,
    earlyPipsByColor,
    ramp2Count, ramp3PlusCount,
  };
}

const RAMP_SCALING_MULTIPLIERS = {
  mild:   0.6,
  medium: 1.0,
  strong: 1.6,
};

/**
 * Land-Equivalent (LEQ) production from non-land sources. Each LEQ unit is
 * one land we can drop without losing colored-mana access. Subtracted from
 * the structural land estimate before rounding.
 *
 *   ramp:     2-mana ramp = 0.7 LEQ each, 3+ mana ramp = 0.5 LEQ each (additive)
 *   treasure: sqrt scaling so density classes ≈ 0.3 / 0.7 / 1.2 with
 *             diminishing returns past the high tier (no hard cap)
 *   engine:   sqrt scaling, treasure-only engines deduplicated
 */
/**
 * Continuous early-game color pressure signal. Higher values mean the deck
 * leans on colored mana in turns 1–3 and therefore tolerates less LEQ
 * substitution. Treasure deliberately does NOT contribute here — it
 * arrives too late to fix early-turn color access.
 *
 *   earlyTotalPressure = earlyPipDensity·1.0 + earlyMulticolorDensity·1.3
 *
 * Weights tuned slightly down from the previous (1.2 / 1.5) so the LEQ
 * damping and safety bump don't overfire on average decks.
 */
function computeEarlyPressure(structure) {
  const pip = structure.earlyPipDensity || 0;
  const mc  = structure.earlyMulticolorDensity || 0;
  return pip * 1.0 + mc * 1.3;
}

function computeLEQ(structure) {
  const ramp2 = structure.ramp2Count || 0;
  const ramp3 = structure.ramp3PlusCount || 0;
  const rampLEQ = ramp2 * 0.7 + ramp3 * 0.5;

  const treasureN = structure.treasureCount || 0;
  const treasureLEQ = treasureN > 0 ? Math.sqrt(treasureN) * 0.45 : 0;

  // Engines that aren't already counted as treasure-makers (avoid double-dip).
  const engineOnly = Math.max(0, (structure.engineCount || 0) - treasureN);
  const engineLEQ = engineOnly > 0 ? Math.sqrt(engineOnly) * 0.30 : 0;

  return {
    rampLEQ:     round1(rampLEQ),
    treasureLEQ: round1(treasureLEQ),
    engineLEQ:   round1(engineLEQ),
    totalLEQ:    round1(rampLEQ + treasureLEQ + engineLEQ),
  };
}

/**
 * deriveBaseLandCount — continuous, deck-driven land count.
 *
 *   landCount =
 *       baseLandEstimate(deckSize, avgCMC)
 *     + curvePressureAdjustment   (low/high curve densities)
 *     + colorPressureAdjustment   (early weighted pips, multicolor density)
 *     - rampLEQ                   (ramp spells / mana rocks)
 *     - treasureLEQ               (treasure makers, soft diminishing)
 *     - engineLEQ                 (sac / draw / value engines, dedup'd)
 *
 * NO archetype overrides. NO hard clamps. Final value is the rounded
 * continuous result with only a sanity floor of 0.
 */
function deriveBaseLandCount(analysis, structure, isCommander) {
  const avgCmc = analysis.avgCmc || 0;
  const baseLandEstimate = isCommander
    ? 35 + (avgCmc - 3.0) * 1.5
    : 21 + (avgCmc - 2.5) * 1.5;

  // ── A. Curve pressure ─────────────────────────────────────
  let curveAdj = 0;
  if      (structure.lowCurveDensity >= 0.55) curveAdj -= 1.0;
  else if (structure.lowCurveDensity >= 0.40) curveAdj -= 0.5;
  if      (structure.highCurveDensity >= 0.20) curveAdj += 1.0;
  else if (structure.highCurveDensity >= 0.10) curveAdj += 0.5;

  // ── B. Color pressure ─────────────────────────────────────
  let colorAdj = 0;
  const numColors = analysis.colorsUsed.length;
  if      (structure.earlyPipDensity >= 1.20) colorAdj += 1.0;
  else if (structure.earlyPipDensity >= 0.80) colorAdj += 0.5;
  if (numColors >= 3 && structure.earlyMulticolorDensity >= 0.15) colorAdj += 1.0;
  if (numColors >= 4) colorAdj += 0.5;

  // ── C. LEQ subtraction (early-pressure damped) ───────────
  const leq = computeLEQ(structure);
  const earlyPressure = computeEarlyPressure(structure);
  // Soft LEQ damping — much gentler curve than the previous (1 − P) form.
  // At P = 0   → 1.00 (full LEQ trust)
  // At P = 0.5 → 0.60
  // At P = 1.0 → 0.45 (clamp floor)
  const leqMul = Math.max(0.45, Math.min(1.0, 1 - earlyPressure * 0.8));
  const effectiveLEQ = leq.totalLEQ * leqMul;

  // Continuous early-safety bump — fractional, ramps in over a 0.67-wide
  // window starting at P = 0.8. Replaces the old binary "P ≥ 1 → +1".
  let earlySafetyBump = Math.max(0, Math.min(1, (earlyPressure - 0.8) * 1.5));
  // Micro-stability guard — extreme early-pressure decks always carry at
  // least half a land of safety even if the linear form lands lower.
  if (earlyPressure > 1.2) earlySafetyBump = Math.max(earlySafetyBump, 0.5);

  const continuous = baseLandEstimate + curveAdj + colorAdj - effectiveLEQ + earlySafetyBump;
  const total = Math.max(0, Math.round(continuous));

  return {
    total,
    baseline:     round1(baseLandEstimate),
    curveAdj:     round1(curveAdj),
    colorAdj:     round1(colorAdj),
    rampLEQ:      leq.rampLEQ,
    treasureLEQ:  leq.treasureLEQ,
    engineLEQ:    leq.engineLEQ,
    totalLEQ:     leq.totalLEQ,
    earlyPressure: round1(earlyPressure),
    leqMul:       round1(leqMul),
    effectiveLEQ: round1(effectiveLEQ),
    earlySafetyBump: round1(earlySafetyBump),
    continuous:   round1(continuous),
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

/**
 * Per-color source target. Continuous, deck-derived: more pip demand and
 * heavier early-game color pressure → more required sources. Colors whose
 * pips concentrate in turns 1–3 receive an early-factor multiplier so
 * splash colors stay light and main colors get extra sources.
 *
 *   baseTarget = 5 + min(8, totalPips·0.30) + earlyPips·0.50
 *   earlyFactor = 1 + (earlyPips / totalPips) · 1.2
 *   finalTarget = baseTarget · earlyFactor
 */
function targetSourcesForColor(color, analysis, structure) {
  const totalPips = analysis.pips[color] || 0;
  const earlyPips = (structure.earlyPipsByColor && structure.earlyPipsByColor[color]) || 0;
  const baseTarget = 5 + Math.min(8, totalPips * 0.30) + earlyPips * 0.50;
  const earlyFactor = totalPips > 0 ? 1 + (earlyPips / totalPips) * 1.2 : 1;
  const finalTarget = baseTarget * earlyFactor;
  return {
    target: Math.round(finalTarget),
    baseTarget: round1(baseTarget),
    earlyFactor: round1(earlyFactor),
    boosted: earlyFactor > 1.05,
  };
}

// ────────────────────────────────────────────────────────────────────────
// LAND TIER SYSTEM
// ────────────────────────────────────────────────────────────────────────
//
// Every land has:
//   priceTier:
//     0 = basic lands
//     1 = budget fixing       (guildgates, slow taplands)
//     2 = mid-tier fixing     (pain lands, check lands, conditional duals)
//     3 = premium fixing      (shock lands, fast lands, top efficiency)
//
//   priceEur: rough Cardmarket-trend EUR per copy (used for cost output).
//   tapped:   ETB tapped under typical conditions.
//   fixesCount: how many distinct colors it can produce.

const COLOR_TO_BASIC = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest',
};

const BASIC_PRICE_EUR = 0.10;

const LAND_CATALOG = {
  WU: [
    { name: 'Azorius Guildgate',  priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Glacial Fortress',   priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 }, // check
    { name: 'Hallowed Fountain',  priceTier: 3, priceEur: 12.00, tapped: false, fixesCount: 2 }, // shock
  ],
  UB: [
    { name: 'Dimir Guildgate',    priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Drowned Catacomb',   priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Watery Grave',       priceTier: 3, priceEur: 14.00, tapped: false, fixesCount: 2 },
  ],
  BR: [
    { name: 'Rakdos Guildgate',   priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Dragonskull Summit', priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Blood Crypt',        priceTier: 3, priceEur: 12.00, tapped: false, fixesCount: 2 },
  ],
  GR: [
    { name: 'Gruul Guildgate',    priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Rootbound Crag',     priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Stomping Ground',    priceTier: 3, priceEur: 11.00, tapped: false, fixesCount: 2 },
  ],
  GW: [
    { name: 'Selesnya Guildgate', priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Sunpetal Grove',     priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Temple Garden',      priceTier: 3, priceEur: 11.00, tapped: false, fixesCount: 2 },
  ],
  BW: [
    { name: 'Orzhov Guildgate',   priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Isolated Chapel',    priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Godless Shrine',     priceTier: 3, priceEur: 12.00, tapped: false, fixesCount: 2 },
  ],
  RU: [
    { name: 'Izzet Guildgate',    priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Sulfur Falls',       priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Steam Vents',        priceTier: 3, priceEur: 12.00, tapped: false, fixesCount: 2 },
  ],
  BG: [
    { name: 'Golgari Guildgate',  priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Woodland Cemetery',  priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Overgrown Tomb',     priceTier: 3, priceEur: 12.00, tapped: false, fixesCount: 2 },
  ],
  RW: [
    { name: 'Boros Guildgate',    priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Clifftop Retreat',   priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Sacred Foundry',     priceTier: 3, priceEur: 12.00, tapped: false, fixesCount: 2 },
  ],
  GU: [
    { name: 'Simic Guildgate',    priceTier: 1, priceEur: 0.20, tapped: true,  fixesCount: 2 },
    { name: 'Hinterland Harbor',  priceTier: 2, priceEur: 3.00, tapped: false, fixesCount: 2 },
    { name: 'Breeding Pool',      priceTier: 3, priceEur: 14.00, tapped: false, fixesCount: 2 },
  ],
};

function pairKey(a, b) { return [a, b].sort().join(''); }

// ────────────────────────────────────────────────────────────────────────
// FIXING LAND SYSTEM (separate from tier 0–3)
// ────────────────────────────────────────────────────────────────────────
//
// Evaluated separately from per-pair tier picks. Always tapped, but bring
// flexibility (any-basic fetchers) or 3-color reach (triomes). They count
// toward the dual budget but use their own scoring path.

// Tier reflects MANA-BASE ROLE (basics → guild → mid → premium), independent
// of EUR price. Evolving Wilds / Terramorphic Expanse / Fabled Passage are
// MID-TIER fixers (tier 2), so they slot into the same pool as painlands /
// checklands. Triomes remain premium (tier 3) due to their 3-color reach.
// `priceEur` is the ONLY input to the cost report.
const FIXING_LANDS = [
  { name: 'Evolving Wilds',       tapped: true, priceTier: 2, priceEur: 0.25, fixesAny: true,  fixes: ['W','U','B','R','G'], etbValue: 0.10 },
  { name: 'Terramorphic Expanse', tapped: true, priceTier: 2, priceEur: 0.20, fixesAny: true,  fixes: ['W','U','B','R','G'], etbValue: 0.10 },
  { name: 'Fabled Passage',       tapped: true, priceTier: 2, priceEur: 3.50, fixesAny: true,  fixes: ['W','U','B','R','G'], etbValue: 0.50 },
  { name: 'Indatha Triome',       tapped: true, priceTier: 3, priceEur: 6.00, fixesAny: false, fixes: ['W','B','G'],         etbValue: 0.40 },
  { name: 'Ketria Triome',        tapped: true, priceTier: 3, priceEur: 6.00, fixesAny: false, fixes: ['G','U','R'],         etbValue: 0.40 },
  { name: 'Raugrin Triome',       tapped: true, priceTier: 3, priceEur: 6.00, fixesAny: false, fixes: ['U','R','W'],         etbValue: 0.40 },
  { name: 'Savai Triome',         tapped: true, priceTier: 3, priceEur: 6.00, fixesAny: false, fixes: ['R','W','B'],         etbValue: 0.40 },
  { name: 'Zagoth Triome',        tapped: true, priceTier: 3, priceEur: 6.00, fixesAny: false, fixes: ['B','G','U'],         etbValue: 0.40 },
];

/** Allocate `slots` across the FIXING_LANDS catalog. Picks deterministic
 *  by (priority desc, name asc), full-fills the top candidate up to its cap
 *  before moving on. Singleton when `isCommander`. */
function allocateFixingLands(slots, deckColors, sliders, isCommander, ctx = {}) {
  if (slots <= 0) return new Map();
  const usedColors = new Set(deckColors);
  const exclude = ctx.excludeNames instanceof Set ? ctx.excludeNames : null;
  const candidates = FIXING_LANDS.filter(l =>
    (!exclude || !exclude.has(l.name))
    && (l.fixesAny || l.fixes.every(c => usedColors.has(c)))
  );
  if (candidates.length === 0) return new Map();

  const tapMul = ctx.tappedPenaltyMul ?? 1.0;
  const tappedTempoPenalty = Math.max(0, sliders.tempo + sliders.earlyGame * 0.5 - 0.55) * tapMul;
  const scored = candidates.map(l => {
    const colorRelevance = l.fixesAny
      ? Math.min(deckColors.length || 1, 5)
      : l.fixes.filter(c => usedColors.has(c)).length;
    const budgetPenalty = (l.priceTier ?? 0) * 0.18 * (1 - sliders.greed * 0.4);
    const tappedPen = l.tapped ? tappedTempoPenalty : 0;
    const priority = colorRelevance + (l.etbValue ?? 0) - tappedPen - budgetPenalty;
    return { land: l, priority };
  });
  scored.sort((a, b) =>
    b.priority - a.priority || a.land.name.localeCompare(b.land.name)
  );

  const cap = isCommander ? 1 : 4;
  const result = new Map();
  let remaining = slots;
  for (let i = 0; i < scored.length && remaining > 0; i++) {
    const take = Math.min(cap, remaining);
    if (take > 0) {
      result.set(scored[i].land.name, take);
      remaining -= take;
    }
  }
  return result;
}

function findFixingLand(name) {
  return FIXING_LANDS.find(l => l.name === name) || null;
}

// ── Fuzzy land-name resolution ────────────────────────────────────────────

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const A = a.toLowerCase().trim();
  const B = b.toLowerCase().trim();
  if (A === B) return 1;
  // Substring boost — handles partial typing like "Riveteers Outl…"
  if (B.includes(A) || A.includes(B)) {
    const longer = Math.max(A.length, B.length);
    const shorter = Math.min(A.length, B.length);
    return Math.max(0.75, shorter / longer);
  }
  // Token-overlap boost — handles reordered tokens
  const tokensA = new Set(A.split(/\s+/).filter(Boolean));
  const tokensB = new Set(B.split(/\s+/).filter(Boolean));
  if (tokensA.size && tokensB.size) {
    let shared = 0;
    for (const t of tokensA) if (tokensB.has(t)) shared++;
    const overlap = shared / Math.max(tokensA.size, tokensB.size);
    if (overlap >= 0.5) {
      const lev = levenshtein(A, B);
      const maxLen = Math.max(A.length, B.length);
      const lexSim = maxLen === 0 ? 1 : 1 - lev / maxLen;
      return Math.max(overlap, lexSim);
    }
  }
  const dist = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function allKnownLandNames() {
  const names = new Set();
  for (const opts of Object.values(LAND_CATALOG)) {
    for (const o of opts) names.add(o.name);
  }
  for (const o of FIXING_LANDS) names.add(o.name);
  for (const c of COLORS) names.add(COLOR_TO_BASIC[c]);
  names.add('Wastes');
  return Array.from(names);
}

const FUZZY_THRESHOLD = 0.72;

/** Resolve a utility-land input name. Returns:
 *    { name, resolvedFrom: 'exact' | 'fuzzy' | 'unknown',
 *      matchedName?: string, score?: number, originalInput: string } */
function resolveUtilityName(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) return { name: input, resolvedFrom: 'unknown', originalInput: input };
  const known = allKnownLandNames();

  // Exact (case-insensitive) first.
  const exact = known.find(n => n.toLowerCase() === input.toLowerCase());
  if (exact) {
    return {
      name: exact,
      resolvedFrom: 'exact',
      originalInput: input,
    };
  }

  // Fuzzy: highest similarity, tie-break by name.
  let best = null;
  let bestScore = 0;
  for (const candidate of known) {
    const score = similarity(input, candidate);
    if (
      score > bestScore
      || (score === bestScore && best && candidate.localeCompare(best) < 0)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best && bestScore >= FUZZY_THRESHOLD) {
    return {
      name: best,
      resolvedFrom: 'fuzzy',
      matchedName: best,
      score: bestScore,
      originalInput: input,
    };
  }
  // Below threshold — keep the user's literal input so it still gets a slot.
  return {
    name: input,
    resolvedFrom: 'unknown',
    originalInput: input,
    score: bestScore,
  };
}

// ────────────────────────────────────────────────────────────────────────
// SOFT TIER CURVE
// ────────────────────────────────────────────────────────────────────────
//
// Replaces the old hard `maxPriceTier` filter. Constraints map to a
// continuous "optimal tier" target; sliders shift it; lands are weighted by
// proximity. The only true hard filter is the `basics` constraint, which
// represents the explicit "no duals" extreme.

const TIER_DECAY = 0.55;          // mild, NOT steep
const TIER2_FLOOR_OFFSET = 0.05;  // T2 weight never sits below T1's

const CONSTRAINT_OPTIMAL_TIER = {
  basics: -1,    // sentinel: extreme constraint disables duals entirely
  budget: 1.4,   // T1 dominant, healthy T2 mix, no T3
  midcap: 2.0,   // T2 dominant transition layer
  open:   2.3,   // T2 + T3 mix, some T1
};

/**
 * Continuous budget pressure derived from the constraint level. This is the
 * single axis the per-slot scoring uses to substitute lands of different
 * tiers. Spread is intentionally wide so the slider produces visibly
 * different mana bases:
 *
 *   open   → 0.95   (lavish — premium dominates where appropriate)
 *   midcap → 0.50   (balanced — Tier 2 backbone, occasional Tier 3)
 *   budget → 0.15   (strict — Tier 1 / fetchers / basics dominate)
 *   basics → 0.00   (extreme — basics only, enforced upstream)
 *
 * Budget pressure is used ONLY in scoring. It does not touch land count,
 * LEQ, ramp logic, or the early-pressure model.
 */
function constraintBudgetValue(constraintKey) {
  switch (constraintKey) {
    case 'basics': return 0.00;
    case 'budget': return 0.15;
    case 'midcap': return 0.50;
    case 'open':
    default:       return 0.95;
  }
}

/**
 * BUDGET FILTER LAYER — additive logit-bias (stabilised).
 *
 * Replaces the previous multiplicative `availability` step. Multiplying
 * `baseWeight × availability` produced winner-takes-all flips when small
 * budget changes pushed a tier's multiplier near 0 — the floor+remainder
 * allocator would then award almost every slot to whichever tier kept a
 * high availability.
 *
 * The new model adds a small SIGNED bias to each candidate's score before
 * the allocator's normalize-and-floor step. The bias is continuous in
 * `budgetPressure`, monotonic per tier, and small enough that it shapes
 * preference without overriding raw fitness — i.e. soft preference
 * shaping, not ranking dominance.
 *
 * Per-tier biases (continuous, smooth across [0..1]):
 *
 *   basics  (T0)   →  0                                  (always neutral)
 *   T1             → −0.40·bp + 0.20                     (slight neg at low,
 *                                                          ~ −0.20 at lavish)
 *   T2             → +0.30 − (bp − 0.5)²·0.80            (peak at bp = 0.5)
 *   T3             → −0.30 + 0.60·bp                     (rises smoothly)
 *   fetcher        →  0.05 + 0.20·bp                     (mild positive slope)
 *
 *  | budget | T1     | T2     | T3     | fetcher |
 *  | 0.15   | +0.140 | +0.204 | −0.210 | +0.080  |
 *  | 0.50   |  0.000 | +0.300 |  0.000 | +0.150  |
 *  | 0.95   | −0.180 | +0.156 | +0.270 | +0.240  |
 *
 * Magnitudes are bounded to ±0.30 so a tier that scores well on the raw
 * fitness axis still wins; only close-to-tied decisions are nudged.
 */
function tierBudgetBias(budgetPressure, tier, landType) {
  const bp = budgetPressure;
  if (tier === 0) return 0;
  if (landType === 'fetcher') return 0.05 + 0.20 * bp;
  if (tier === 1) return -0.40 * bp + 0.20;
  if (tier === 2) {
    const d = bp - 0.50;
    return 0.30 - d * d * 0.80;
  }
  if (tier === 3) return -0.30 + 0.60 * bp;
  return 0;
}

function classifyLandType(cand) {
  if (!cand) return 'pair';
  if (cand._kind === 'fixing') {
    if (cand.fixesAny) return 'fetcher';
    if (Array.isArray(cand.fixes) && cand.fixes.length > 2) return 'triome';
    return 'fetcher';
  }
  return 'pair';
}

function optimalTierFor(constraintKey, sliders) {
  const base = CONSTRAINT_OPTIMAL_TIER[constraintKey] ?? 2.0;
  if (base < 0) return base;
  // High tempo+early shifts the optimum slightly upward (toward premium
  // untapped); slow late-game decks shift slightly downward (toward T1/T2).
  const tempoShift = (sliders.tempo + sliders.earlyGame * 0.5 - 0.75) * 0.3;
  return base + tempoShift;
}

/**
 * UNIFIED fixing-land value function.
 *
 * Single ranked pool — pair-specific duals (tier 1–3), basic-fetchers
 * (Evolving Wilds / Terramorphic Expanse / Fabled Passage), and triomes
 * all compete here. NO separate allocation buckets.
 *
 * Scoring model (per the structural-budget spec):
 *
 *   score =
 *       fixingStrength
 *     + colorMatchScore
 *     + tempoFit
 *     - tappedPenalty   (× tempo via the slider formula)
 *     + budgetEfficiencyScore
 *     + (small synergy bonuses kept from prior tuning)
 *
 * BUDGET as STRUCTURAL SUBSTITUTION DRIVER
 * ─────────────────────────────────────────
 *   priceTerm     = log(priceEur + 1)
 *   valuePerEuro  = log(1 + (fixingStrength + 0.5) / max(0.10, priceEur))
 *
 *   budgetEfficiencyScore
 *     = budgetPressure       · valuePerEuro · 0.30           // mild "good value" bias
 *     + (2.5·budgetPressure − 1.75) · priceTerm              // signed: rewards expensive
 *                                                            // at lavish, penalizes at strict
 *
 * High budget → premium lands (shocks / fastlands) win on raw priceTerm.
 * Mid budget  → painlands / checklands (Tier 2) dominate as the bridge.
 * Low budget  → guildgates / fetches / cheap taplands win because the
 *               priceTerm penalty is large relative to other components.
 *
 * No tier is ever excluded — every land remains in the candidate pool.
 */
export function fixingValueScore(land, sliders, ctx = {}) {
  const s = normalizeSliders(sliders);
  const tier = land.priceTier ?? 0;
  const mul = ctx.tappedPenaltyMul ?? 1.0;
  const pair = ctx.pair || null;
  const numColors = ctx.numColors ?? 2;
  const budgetPressure = clamp01(ctx.budget ?? 0.5);
  const priceEur = Math.max(0.05, land.priceEur ?? 0.10);

  // ── colorMatchScore ─────────────────────────────────
  let colorMatchScore = 0;
  if (pair) {
    const fixesPair = land.fixesAny
      || (land.fixes
            ? land.fixes.includes(pair[0]) && land.fixes.includes(pair[1])
            : true);
    if (!fixesPair) return -Infinity;
    colorMatchScore = 1.0;
    if (land.fixes && land.fixes.length > 2 && numColors >= 3) {
      colorMatchScore += 0.30 * Math.min(land.fixes.length - 2, numColors - 2);
    }
    if (land.fixesAny && numColors >= 3) colorMatchScore += 0.20;
  }

  // ── fixingStrength ──────────────────────────────────
  // Tier 2 is the structural backbone, so it gets the largest intrinsic
  // tier boost; Tier 3 a smaller one (its strength comes mainly through
  // priceTerm at lavish budgets); Tier 1 has none.
  const tierBoost = tier === 2 ? 0.20 : tier === 3 ? 0.10 : 0;
  const fixingStrength = (!land.tapped ? 1.5 : 1.0)
                       + (land.etbValue || 0) * 0.6
                       + tierBoost;

  // ── tempoFit / tappedPenalty ────────────────────────
  const tempoFit = !land.tapped ? s.earlyGame * 0.30 : 0;
  const tappedPenalty = land.tapped
    ? Math.max(0, s.tempo + s.earlyGame * 0.5 - 0.55) * 1.2 * mul
    : 0;

  // ── budgetEfficiencyScore (CORE STRUCTURAL AXIS) ────
  const priceTerm = Math.log(priceEur + 1);
  const valuePerEuro = Math.log(1 + (fixingStrength + 0.5) / priceEur);
  const valueReward = budgetPressure * valuePerEuro * 0.30;
  const priceEfficiency = (2.5 * budgetPressure - 1.75) * priceTerm;
  const budgetEfficiencyScore = valueReward + priceEfficiency;

  // ── Cross-system bonuses (kept) ─────────────────────
  const etb = land.etbValue ?? 0;
  const flex = ctx.flexibilityClass === 'high' ? 0.30
             : ctx.flexibilityClass === 'medium' ? 0.15 : 0;
  const rampSynergy = flex * (etb + (land.tapped ? 0.20 : 0));
  const treasureEtbBoost = (
    ctx.treasureClass === 'high' ? 0.20
    : ctx.treasureClass === 'medium' ? 0.10
    : 0
  ) * etb;
  const greedBonus = ((land.fixesCount ?? 1) > 1 ? 1 : 0) * s.greed * 0.15;

  return colorMatchScore
       + fixingStrength
       + tempoFit
       - tappedPenalty
       + budgetEfficiencyScore
       + rampSynergy
       + treasureEtbBoost
       + greedBonus;
}

/** Per-land "fitness" combining tier intrinsic value, tempo, and the
 *  structural budget axis. Retained for backward compatibility — uses the
 *  same budgetEfficiencyScore formula as `fixingValueScore`. */
export function scoreLand(land, sliders, ctx = {}) {
  const s = normalizeSliders(sliders);
  const tier = land.priceTier ?? 0;
  const budgetPressure = clamp01(ctx.budget ?? 0.5);
  const priceEur = Math.max(0.05, land.priceEur ?? 0.10);
  const mul = ctx.tappedPenaltyMul ?? 1.0;

  const tierBoost = tier === 2 ? 0.20 : tier === 3 ? 0.10 : 0;
  const fixingStrength = (!land.tapped ? 1.5 : 1.0)
                       + (land.etbValue || 0) * 0.6
                       + tierBoost;

  const priceTerm = Math.log(priceEur + 1);
  const valuePerEuro = Math.log(1 + (fixingStrength + 0.5) / priceEur);
  const budgetEfficiencyScore =
      budgetPressure * valuePerEuro * 0.30
    + (2.5 * budgetPressure - 1.75) * priceTerm;

  const tappedPenalty = land.tapped
    ? Math.max(0, s.tempo + s.earlyGame * 0.5 - 0.55) * 1.2 * mul
    : 0;
  const greedBonus = ((land.fixesCount ?? 1) > 1 ? 1 : 0) * s.greed * 0.15;

  return fixingStrength + budgetEfficiencyScore - tappedPenalty + greedBonus;
}

/** Combine deck signals + utility-land count into a tapped-penalty
 *  multiplier. Ramp/engine-heavy decks tolerate more tapped lands;
 *  utility-land density consumes tempo budget so remaining lands need
 *  to be cleaner.  Range clamped to [0.4 .. 1.4]. */
function tapToleranceFromSignals(signals, utilityCount) {
  let tol = 1.0;
  if (signals.rampClass === 'high') tol -= 0.40;
  else if (signals.rampClass === 'medium') tol -= 0.20;
  if (signals.engineClass === 'high') tol -= 0.30;
  else if (signals.engineClass === 'medium') tol -= 0.15;
  // Treasure makers stretch mana on their own — the colored-land base can
  // afford more tapped slots. (high → +0.25 tolerance ≡ −0.25 multiplier)
  if (signals.treasureClass === 'high') tol -= 0.25;
  else if (signals.treasureClass === 'medium') tol -= 0.12;
  // Each utility land already costs some tempo → tighten tolerance for
  // remaining slots.
  tol += Math.min(0.50, (utilityCount || 0) * 0.05);
  return Math.max(0.4, Math.min(1.4, tol));
}

/**
 * Allocate `count` dual-land slots for one color pair across its tier
 * options. Deterministic: largest fractional remainder breaks ties.
 *
 *   weight(land) = -|tier - optimalTier| * decay  - tappedPenalty + greedBonus
 *
 * Painland (T2) rule: in any non-`basics` constraint, T2 weight is lifted
 * to at least T1's so it never gets fully penalized below tier 1.
 */
function pairAllocation(options, count, sliders, constraintKey, ctxOverrides = {}) {
  if (count <= 0 || !options || options.length === 0) return new Map();
  if (constraintKey === 'basics') return new Map();

  const optimalTier = optimalTierFor(constraintKey, sliders);
  const ctx = { optimalTier, tappedPenaltyMul: 1.0, ...ctxOverrides };

  const scored = options.map(opt => ({
    opt,
    w: scoreLand(opt, sliders, ctx),
  }));

  // T2 floor: never below T1 in normal modes.
  const t1 = scored.find(x => x.opt.priceTier === 1);
  const t2 = scored.find(x => x.opt.priceTier === 2);
  if (t1 && t2 && t2.w < t1.w + TIER2_FLOOR_OFFSET) {
    t2.w = t1.w + TIER2_FLOOR_OFFSET;
  }

  // Soft, never zero — keeps every tier viable. Subtract minW so the
  // strongest option dominates without fully zeroing out the others.
  const minW = Math.min(...scored.map(x => x.w));
  const shifted = scored.map(x => ({ name: x.opt.name, w: (x.w - minW) + 0.05 }));
  const total = shifted.reduce((s, x) => s + x.w, 0);

  // Floor-then-largest-remainder allocation (deterministic).
  const fractions = shifted.map(x => ({ name: x.name, raw: count * x.w / total }));
  const result = new Map();
  let remaining = count;
  for (const f of fractions) {
    const floored = Math.floor(f.raw);
    if (floored > 0) result.set(f.name, floored);
    remaining -= floored;
  }
  if (remaining > 0) {
    const remainders = fractions
      .map(f => ({ name: f.name, frac: f.raw - Math.floor(f.raw) }))
      .sort((a, b) => b.frac - a.frac || a.name.localeCompare(b.name));
    for (let i = 0; i < remainders.length && remaining > 0; i++) {
      const k = remainders[i].name;
      result.set(k, (result.get(k) || 0) + 1);
      remaining--;
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// LAND-TARGET / DUAL-PCT / FLOOR derivation (sliders + signals)
// ────────────────────────────────────────────────────────────────────────

/** Slider/archetype-driven knobs for the post-land-count steps:
 *  basics-vs-duals split percentage and the per-color source floor. */
function deriveTargets(sliders, signals) {
  const { earlyGame, greed } = sliders;
  const dualPct = clamp01(0.10 + greed * 0.55);
  let minSourcesPerColor = Math.round(4 + greed * 7) + (earlyGame >= 0.8 ? 1 : 0);
  if (signals.flexibilityClass === 'high') minSourcesPerColor = Math.max(5, minSourcesPerColor - 1);
  else if (signals.rampClass === 'high') minSourcesPerColor = Math.max(5, minSourcesPerColor - 1);
  return { dualPct, minSourcesPerColor };
}

// ────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE
// ────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} mainboard
 * @param {Object} [options]
 * @param {Object} [options.commander]
 * @param {number} [options.deckSize]
 * @param {string} [options.archetype]    'stable' | 'optimized_tempo' | …
 * @param {string} [options.constraint]   'open' | 'midcap' | 'budget' | 'basics'
 * @param {Object} [options.sliders]      { tempo, earlyGame, greed }
 * @param {string} [options.mode]         legacy alias for archetype
 * @param {Object} [options.config]       legacy { tempo, earlyGame, budget, greed }
 */
export function suggestLands(mainboard, options = {}) {
  // ── Resolve inputs across legacy + new API ───────────────
  const legacyConfig = options.config || null;
  const legacyMode   = options.mode   || null;

  const archetypeKey = options.archetype
    || (legacyMode ? (ARCHETYPE_ALIASES[legacyMode] || legacyMode) : null)
    || (legacyConfig?.preset
        ? (ARCHETYPE_ALIASES[legacyConfig.preset] || legacyConfig.preset)
        : null)
    || DEFAULT_ARCHETYPE;
  const archetype = getArchetype(archetypeKey) || getArchetype(DEFAULT_ARCHETYPE);

  // Legacy "budget" slider (0..1) → constraint name.
  let constraint;
  if (options.constraint && CONSTRAINTS[options.constraint]) {
    constraint = resolveConstraint(options.constraint);
  } else if (legacyConfig?.budget != null) {
    const b = clamp01(legacyConfig.budget);
    constraint = resolveConstraint(
      b >= 0.85 ? 'basics'
      : b >= 0.65 ? 'budget'
      : b >= 0.40 ? 'midcap'
      : 'open'
    );
  } else {
    constraint = resolveConstraint(archetype.constraint);
  }

  const sliderInput = options.sliders
    || (legacyConfig
         ? { tempo: legacyConfig.tempo, earlyGame: legacyConfig.earlyGame, greed: legacyConfig.greed }
         : null)
    || archetype.sliders;
  const sliders = normalizeSliders({ ...archetype.sliders, ...sliderInput });

  // ── Deck signals (Layer 4) ───────────────────────────────
  const commander = options.commander || null;
  const isCommander = !!commander;
  const targetDeckSize = options.deckSize ?? (isCommander ? 100 : 60);
  const analysis  = analyzeDeck(mainboard, commander);
  const structure = analyzeStructure(mainboard, analysis);
  const signals = {
    avgCmc:      analysis.avgCmc,
    rampCount:   analysis.rampCount,
    rampDensity: structure.rampDensity,
    rampClass:   structure.rampClass,
    earlyInteraction: structure.earlyInteraction,
    lateGame:    structure.lateGame,
    fixingCount: structure.fixingCount,
    colorsUsed:  analysis.colorsUsed,
  };

  // ── Continuous deck-driven land count ───────────────────
  // Quantity comes purely from deck signals (curve, color pressure, LEQ).
  // Archetypes are NOT applied here — presets only seed sliders.
  const landBreakdown = deriveBaseLandCount(analysis, structure, isCommander);
  let landTarget = landBreakdown.total;
  const archetypeDelta = 0; // archetypes do not modify land count

  // Per-color source targets — continuous, deck-derived. Stores the final
  // target plus the breakdown so the explanation can flag boosted colors.
  const colorSourceTargets = {};
  const colorTargetMeta = {};
  for (const c of COLORS) {
    const t = targetSourcesForColor(c, analysis, structure);
    colorSourceTargets[c] = t.target;
    colorTargetMeta[c] = t;
  }
  const boostedColors = COLORS.filter(c => colorTargetMeta[c].boosted);

  // Downstream slider knobs (basics-vs-duals split only). The source-floor
  // is now per-color (via colorSourceTargets) so the legacy global floor
  // is just a fallback for the explanation summary.
  const { dualPct, minSourcesPerColor } = deriveTargets(sliders, signals);

  // Explanation continuity (zero-ed adjustments are fine here).
  const rampImpact      = landBreakdown.rampLEQ;
  const engineAdjustment = -landBreakdown.engineLEQ;

  const slotsAvailable = Math.max(landTarget, targetDeckSize - analysis.nonLandCount);
  if (slotsAvailable > 0 && slotsAvailable < landTarget) landTarget = slotsAvailable;

  const colorsUsed = analysis.colorsUsed;
  const numColors = colorsUsed.length;
  const breakdown = {};

  // ── Utility lands (hard-insert, deterministic, fuzzy-resolved) ───────
  const utilityInput = Array.isArray(options.utilityLands) ? options.utilityLands : [];
  const utilityAlloc = new Map();      // resolved name → count
  const utilityResolved = [];          // [{ name, count, resolvedFrom, matchedName?, originalInput, score? }]
  let utilityTotalRequested = 0;
  // Pre-resolve names so we can sum requested copies under their canonical form.
  const resolvedInputs = utilityInput
    .map(u => {
      const wanted = Math.max(0, Math.floor(Number(u?.desiredCopies) || 0));
      if (!u?.name || wanted <= 0) return null;
      const r = resolveUtilityName(u.name);
      return { ...r, desired: wanted };
    })
    .filter(Boolean);
  for (const r of resolvedInputs) utilityTotalRequested += r.desired;

  let utilityRemaining = Math.min(utilityTotalRequested, landTarget);
  for (const r of resolvedInputs) {
    if (utilityRemaining <= 0) {
      utilityResolved.push({
        name: r.name, count: 0,
        resolvedFrom: r.resolvedFrom,
        matchedName: r.matchedName,
        originalInput: r.originalInput,
        score: r.score,
        truncated: true,
      });
      continue;
    }
    const grant = Math.min(r.desired, utilityRemaining);
    utilityAlloc.set(r.name, (utilityAlloc.get(r.name) || 0) + grant);
    utilityRemaining -= grant;
    utilityResolved.push({
      name: r.name, count: grant,
      resolvedFrom: r.resolvedFrom,
      matchedName: r.matchedName,
      originalInput: r.originalInput,
      score: r.score,
      truncated: grant < r.desired,
    });
  }
  let utilityTotalGranted = 0;
  for (const v of utilityAlloc.values()) utilityTotalGranted += v;
  for (const [name, n] of utilityAlloc) breakdown[name] = (breakdown[name] || 0) + n;

  // Remaining land budget after utility hard-inserts.
  const generatedTarget = landTarget - utilityTotalGranted;

  // ── Colorless special case ──────────────────────────────
  if (numColors === 0) {
    if (generatedTarget > 0) {
      breakdown['Wastes'] = (breakdown['Wastes'] || 0) + generatedTarget;
    }
    return formatResult({
      totalLands: landTarget, breakdown,
      analysis, structure, signals,
      perColor: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      isCommander, targetDeckSize,
      archetype, constraint, sliders,
      minSourcesPerColor, rampImpact, engineAdjustment,
      landBreakdown, archetypeDelta, colorSourceTargets,
      utilityAlloc, utilityRequested: utilityTotalRequested, utilityResolved,
      basicAllocation: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      fixingAlloc: new Map(), pairs: [],
    });
  }

  // ── Basics / duals / fixing split ────────────────────────
  let basicCount, dualCount;
  if (numColors === 1) { basicCount = generatedTarget; dualCount = 0; }
  else                 { dualCount  = Math.round(generatedTarget * dualPct);
                         basicCount = generatedTarget - dualCount; }

  // Constraint context.
  const constraintKey =
    constraint.maxPriceTier === 0 ? 'basics'
    : constraint.maxPriceTier === 1 ? 'budget'
    : constraint.maxPriceTier === 2 ? 'midcap'
    : 'open';

  // Tap-tolerance multiplier — relaxed for ramp/engine/treasure decks,
  // tightened by any utility lands the user already locked in.
  const tappedPenaltyMul = tapToleranceFromSignals(signals, utilityTotalGranted);
  const utilityNameSet = new Set(utilityAlloc.keys());

  // Track allocation per land name so fetchers/triomes can't exceed legality.
  const fixingAlloc = new Map();   // fetcher/triome counts (for category tagging)
  const dualAllocByName = new Map(); // every allocation, for global cap checks
  const globalCap = isCommander ? 1 : 4;

  // ── Basic allocation (greed blends pip share toward uniform) ──
  const basicAllocation = {};
  const totalShare = colorsUsed.reduce((s, c) => s + analysis.colorShare[c], 0) || 1;
  const uniform = 1 / numColors;
  const blend = sliders.greed * 0.4;
  let allocated = 0;
  colorsUsed.forEach((c, i) => {
    const isLast = i === colorsUsed.length - 1;
    const rawShare = analysis.colorShare[c] / totalShare;
    const eff = rawShare * (1 - blend) + uniform * blend;
    const want = isLast ? basicCount - allocated : Math.round(basicCount * eff);
    basicAllocation[c] = Math.max(0, want);
    allocated += basicAllocation[c];
  });
  for (const c of colorsUsed) {
    if (basicAllocation[c] > 0) breakdown[COLOR_TO_BASIC[c]] = basicAllocation[c];
  }

  // ── Dual allocation ──────────────────────────────────────
  const pairs = [];
  for (let i = 0; i < colorsUsed.length; i++) {
    for (let j = i + 1; j < colorsUsed.length; j++) {
      pairs.push([colorsUsed[i], colorsUsed[j]]);
    }
  }

  // ── UNIFIED per-pair allocation ─────────────────────────
  // Every fixing land (pair-specific T1/T2/T3, fetchers, triomes) shares a
  // single ranked pool per pair. Global per-name cap enforced (1 in
  // commander, 4 otherwise). Names already in `utilityAlloc` are excluded.
  if (pairs.length > 0 && dualCount > 0 && constraintKey !== 'basics') {
    const weighted = pairs.map(([a, b]) => ({
      pair: [a, b],
      weight: analysis.colorShare[a] + analysis.colorShare[b],
    }));
    const totalW = weighted.reduce((s, p) => s + p.weight, 0) || 1;
    let used = 0;
    weighted.forEach(({ pair, weight }, k) => {
      const isLast = k === weighted.length - 1;
      const n = isLast ? dualCount - used : Math.round(dualCount * (weight / totalW));
      if (n <= 0) return;

      const [a, b] = pair;
      // Build the unified pool for this pair:
      //   pair-specific (LAND_CATALOG) + every fetcher/triome that fixes both
      //   colors of the pair, minus anything the user already pinned as utility.
      const pool = [];
      for (const opt of (LAND_CATALOG[pairKey(a, b)] || [])) {
        if (utilityNameSet.has(opt.name)) continue;
        pool.push({ ...opt, _kind: 'pair', pair: [a, b] });
      }
      for (const f of FIXING_LANDS) {
        if (utilityNameSet.has(f.name)) continue;
        if (!(f.fixesAny || (f.fixes.includes(a) && f.fixes.includes(b)))) continue;
        pool.push({ ...f, _kind: 'fixing', pair: [a, b] });
      }
      if (pool.length === 0) return;

      // Score each candidate via the unified function.
      const ctxScore = {
        optimalTier: optimalTierFor(constraintKey, sliders),
        tappedPenaltyMul,
        flexibilityClass: signals.flexibilityClass,
        treasureClass: signals.treasureClass,
        budget: constraintBudgetValue(constraintKey),
        pair: [a, b],
        numColors,
      };
      const scored = pool.map(c => ({ cand: c, w: fixingValueScore(c, sliders, ctxScore) }));

      // T2 floor: pair-specific T2 weight ≥ T1 weight — keeps painlands
      // from being outcompeted by guildgates in non-extreme constraints.
      const t1 = scored.find(x => x.cand._kind === 'pair' && x.cand.priceTier === 1);
      const t2 = scored.find(x => x.cand._kind === 'pair' && x.cand.priceTier === 2);
      if (t1 && t2 && t2.w < t1.w + 0.05) t2.w = t1.w + 0.05;

      // BudgetFilterLayer — additive logit-bias (kept).
      const budgetPressureValue = constraintBudgetValue(constraintKey);
      const biased = scored.map(x => {
        const tier = x.cand.priceTier ?? 0;
        const landType = classifyLandType(x.cand);
        const bias = tierBudgetBias(budgetPressureValue, tier, landType);
        return { cand: x.cand, baseScore: x.w, bias, tier, landType };
      });

      function remainingCap(name) {
        const usedName = dualAllocByName.get(name) || 0;
        return Math.max(0, globalCap - usedName);
      }

      // ── Substitution-based group allocator ─────────────────
      // Each candidate is bucketed into a functional group keyed by
      //   `${sortedFixesColors}|${landType}`
      // so functionally interchangeable lands compete only with each
      // other (e.g. all "BR pair-specific" lands form one group;
      // basic-fetchers form another; triomes a third).
      //
      // Slots are first apportioned across groups (so fetchers / triomes
      // never disappear entirely), then within each group a slot-by-slot
      // pick uses:
      //
      //   substitutionScore = baseScore + tierBudgetBias − pricePressure
      //
      //   pricePressure     = priceNormalized · (1 − budgetPressure)
      //
      // Diminishing returns are applied per pick (multiplicative
      //   1 / (1 + alreadyPicked · 0.4))
      // so a single tier doesn't fill every slot at extreme budgets.
      //
      // Effect: budget changes act as a *substitution pressure* — single
      // slots flip (1 Shock → 1 Painland) instead of whole tiers
      // appearing or disappearing.
      const priceNormalized = (priceEur) =>
        Math.min(1, Math.log((priceEur ?? 0) + 1) / Math.log(16));

      // Single continuous-market group per color identity. Tiers and
      // landType (pair / fetcher / triome) no longer partition the
      // allocation — every candidate that satisfies the pair's color
      // requirement competes in one pool. Tier remains a SCORING input
      // (via m.bias / tierInfluence inside candidateScore), never a
      // structural filter.
      const pairColorKey = [pair[0], pair[1]].slice().sort().join('');
      const groups = [{
        key: pairColorKey,
        members: biased,
        weight: Math.max(...biased.map(m => m.baseScore + m.bias)),
      }];

      // Apportion slots across groups via running-rounding (smooth in weight).
      const minGroupW = Math.min(...groups.map(g => g.weight));
      const shiftedGroups = groups.map(g => ({
        ...g,
        sw: Math.max(0.05, (g.weight - minGroupW) + 0.05),
      }));
      const totalGW = shiftedGroups.reduce((s, g) => s + g.sw, 0) || 1;
      let runningGroupShare = 0;
      let groupAllocated = 0;
      for (let i = 0; i < shiftedGroups.length; i++) {
        const g = shiftedGroups[i];
        const isLast = i === shiftedGroups.length - 1;
        runningGroupShare += (g.sw / totalGW) * n;
        const target = isLast ? n : Math.round(runningGroupShare);
        g.slots = Math.max(0, target - groupAllocated);
        groupAllocated += g.slots;
      }

      // ── Continuous-transition allocator (stepwise) ────────
      // Allocations are no longer computed directly at the target bp.
      // Instead we compute a baseline at bp = 0 and walk to the target
      // in 0.05 increments, performing at most one swap per group per
      // step (and only when the improvement exceeds SWAP_THRESHOLD).
      //
      // This is purely a transition layer — the scoring formulas
      // (baseScore, tierBudgetBias, pricePressure, upgradePenalty,
      // premiumPenalty, tanh, diminishing, stickiness) are unchanged
      // and are simply applied with a stepped budget value.
      const PREMIUM_SCALE = 0.80;
      const PREMIUM_TRANSITION = 0.30;
      const ABS_PRICE_WEIGHT = 0.30;
      const STICKINESS = 0.05;
      // SWAP_THRESHOLD is computed dynamically per step inside
      // singleStepUpdate (see threshold = 0.015 + 0.035·(1 − bp)).

      const smoothstep = (edge0, edge1, x) => {
        if (x <= edge0) return 0;
        if (x >= edge1) return 1;
        const t = (x - edge0) / (edge1 - edge0);
        return t * t * (3 - 2 * t);
      };

      const baselineNormFor = (members) => {
        if (members.length === 0) return 0;
        const sorted = members
          .map(m => priceNormalized(m.cand.priceEur))
          .sort((a, b) => a - b);
        const idx = Math.floor((sorted.length - 1) * 0.25);
        const baseline = sorted[idx];
        return Number.isFinite(baseline) ? baseline : sorted[0];
      };

      // Pre-compute per-group price tables and baselines.
      const groupCtx = new Map();
      for (const g of shiftedGroups) {
        const memberPriceNorm = new Map();
        for (const m of g.members) {
          memberPriceNorm.set(m.cand.name, priceNormalized(m.cand.priceEur));
        }
        groupCtx.set(g.key, {
          group: g,
          memberPriceNorm,
          baselineNorm: baselineNormFor(g.members),
        });
      }

      // Cap-snapshot at start of pair processing — caps from previous
      // pairs are fixed, the simulation never mutates dualAllocByName.
      const capSnapshot = new Map(dualAllocByName);
      function remainingCapAt(name, allocMap) {
        let used = capSnapshot.get(name) || 0;
        for (const ga of allocMap.values()) used += ga.get(name) || 0;
        return Math.max(0, globalCap - used);
      }

      // Single-candidate substitution score at a given bp. The tier
      // contribution is now applied via tierInfluence — a softened form
      // of the existing m.bias — so tier remains a SCORING feature only,
      // never a structural partition.
      //
      //   tierInfluence = 0.6 + 0.4 · m.bias
      //
      // The +0.6 offset is constant across candidates (cancels in
      // comparisons); the ·0.4 scaling halves the structural pull of tier
      // bias so a higher-tier card no longer dominates the pool simply
      // by virtue of its tier.
      function candidateScore(m, bpVal, alreadyPicked, isPreviousPick,
                              premiumCount, groupSlots, gctx) {
        const isPremium = (m.tier === 3);
        const pNorm = gctx.memberPriceNorm.get(m.cand.name) ?? 0;
        const pricePressure = pNorm * (1 - bpVal) * ABS_PRICE_WEIGHT;
        const upgradeScale = 1.0 + 0.2 * (1 - bpVal);
        const upgradeDelta = Math.max(0, pNorm - gctx.baselineNorm);
        const upgradePenalty = upgradeDelta * (1 - bpVal) * upgradeScale;
        const premiumShareTarget = smoothstep(0.4, 0.9, bpVal);
        const currentPremiumShare = premiumCount / Math.max(1, groupSlots);
        const premiumPenalty = isPremium
          ? smoothstep(premiumShareTarget, premiumShareTarget + PREMIUM_TRANSITION,
                       currentPremiumShare) * PREMIUM_SCALE
          : 0;
        const tierInfluence = 0.6 + 0.4 * m.bias;
        const raw = m.baseScore + tierInfluence
                  - pricePressure - upgradePenalty - premiumPenalty;
        // Lighter compression — keeps smoothing for far-extreme scores
        // but preserves more of the difference at the close-to-tied
        // boundary where transitions actually trigger.
        const compressed = Math.tanh(raw * 0.7);
        const diminish = 1 / (1 + alreadyPicked * 0.6
                              + (isPremium ? alreadyPicked * 0.4 : 0));
        const stickinessBonus = isPreviousPick ? STICKINESS : 0;
        return compressed * diminish + stickinessBonus;
      }

      function premiumCountIn(groupAlloc, members) {
        let n = 0;
        for (const [name, cnt] of groupAlloc) {
          const m = members.find(x => x.cand.name === name);
          if (m && m.tier === 3) n += cnt;
        }
        return n;
      }

      // Softmax-based fractional slot allocation (deterministic).
      //
      // Replaces the previous greedy slot-by-slot picking. For each
      // group:
      //
      //   1.  Score every member once at bpVal (single-shot baseline:
      //       alreadyPicked=0, premiumCount=0, no previousPick).
      //   2.  Apply softmax over scores → fractional weights.
      //   3.  expected[i] = weights[i] · groupSlots
      //   4.  Floor each expected count; track remainders.
      //   5.  Distribute leftover slots by largest remainder, with
      //       deterministic name tie-break.
      //   6.  Respect globalCap throughout; overflow falls back to score
      //       order.
      //
      // The existing singleStepUpdate / swap layer still runs on top —
      // it now acts as a micro-correction layer rather than the
      // primary allocator.
      function runSlotAllocation(bpVal) {
        const result = new Map();
        for (const g of shiftedGroups) {
          if (g.slots <= 0) { result.set(g.key, new Map()); continue; }
          const gctx = groupCtx.get(g.key);

          // Single-shot per-candidate score at bpVal.
          const memberScores = g.members.map(m => ({
            m,
            score: candidateScore(m, bpVal, 0, false, 0, g.slots, gctx),
          }));

          // Softmax with numerical-stability shift.
          const maxS = Math.max(...memberScores.map(x => x.score));
          const exps = memberScores.map(x => Math.exp(x.score - maxS));
          const sumExp = exps.reduce((s, e) => s + e, 0) || 1;
          const weights = exps.map(e => e / sumExp);

          // Expected slot counts → floor + remainder.
          const allocations = memberScores.map((ms, i) => {
            const expected = weights[i] * g.slots;
            return {
              member: ms.m,
              score: ms.score,
              expected,
              allocated: Math.floor(expected),
              remainder: expected - Math.floor(expected),
            };
          });

          // Cap-respecting initial pass — clip floors to remainingCap.
          let totalAllocated = 0;
          for (const a of allocations) {
            const cap = remainingCapAt(a.member.cand.name, result);
            a.allocated = Math.min(a.allocated, cap);
            totalAllocated += a.allocated;
          }

          // Distribute leftover slots by largest remainder, name asc tie.
          let remaining = g.slots - totalAllocated;
          const sortedByRemainder = allocations.slice().sort((a, b) =>
            b.remainder - a.remainder
            || a.member.cand.name.localeCompare(b.member.cand.name)
          );
          for (const a of sortedByRemainder) {
            if (remaining <= 0) break;
            const cap = remainingCapAt(a.member.cand.name, result) - a.allocated;
            if (cap <= 0) continue;
            a.allocated += 1;
            remaining--;
          }

          // Overflow safety — caps blocked all remainder picks.
          if (remaining > 0) {
            const sortedByScore = allocations.slice().sort((a, b) =>
              b.score - a.score
              || a.member.cand.name.localeCompare(b.member.cand.name)
            );
            for (const a of sortedByScore) {
              while (remaining > 0) {
                const cap = remainingCapAt(a.member.cand.name, result) - a.allocated;
                if (cap <= 0) break;
                a.allocated += 1;
                remaining--;
              }
              if (remaining <= 0) break;
            }
          }

          const groupAlloc = new Map();
          for (const a of allocations) {
            if (a.allocated > 0) groupAlloc.set(a.member.cand.name, a.allocated);
          }
          result.set(g.key, groupAlloc);
        }
        return result;
      }

      // Clone allocation map (deep, deterministic).
      function cloneAlloc(alloc) {
        const copy = new Map();
        for (const [k, v] of alloc) copy.set(k, new Map(v));
        return copy;
      }

      // Single-step transition with dynamic threshold + momentum bonus.
      //
      //   threshold(bp)   = 0.015 + 0.035·(1 − bp)
      //                     (~0.044 at bp=0.15, ~0.017 at bp=0.95)
      //   momentumBonus   = ±0.02 when the candidate's tier moves in the
      //                     same direction as the current budget step
      //                     (upgrade if Δbp > 0, downgrade if Δbp < 0)
      //   stacking discount: threshold ×0.7 if the candidate already
      //                     exists in the allocation (smooth 1→2 stacks)
      function singleStepUpdate(alloc, bpVal, prevBpVal) {
        const direction = bpVal > prevBpVal ? 1
                        : bpVal < prevBpVal ? -1
                        : 0;
        const threshold = 0.015 + 0.035 * (1 - bpVal);
        const updated = cloneAlloc(alloc);
        for (const g of shiftedGroups) {
          if (g.slots <= 0) continue;
          const groupAlloc = updated.get(g.key);
          if (!groupAlloc || groupAlloc.size === 0) continue;
          const gctx = groupCtx.get(g.key);
          const premiumCount = premiumCountIn(groupAlloc, g.members);

          // Find weakest filled (score if we remove one copy).
          let weakestM = null;
          let weakestScore = Infinity;
          for (const m of g.members) {
            const cnt = groupAlloc.get(m.cand.name) || 0;
            if (cnt <= 0) continue;
            const adjPremium = (m.tier === 3) ? premiumCount - 1 : premiumCount;
            const sc = candidateScore(
              m, bpVal, cnt - 1, false, adjPremium, g.slots, gctx
            );
            if (
              sc < weakestScore
              || (sc === weakestScore && weakestM
                  && m.cand.name.localeCompare(weakestM.cand.name) > 0)
            ) {
              weakestM = m;
              weakestScore = sc;
            }
          }
          if (!weakestM) continue;

          // Find best alternative (different name, cap allows).
          // Apply budget-momentum bonus: when bp is rising, slightly
          // favour swaps to a higher tier; when falling, favour lower.
          const adjPremiumIfSwap = (weakestM.tier === 3)
            ? premiumCount - 1 : premiumCount;
          let bestAltM = null;
          let bestAltScore = -Infinity;
          for (const m of g.members) {
            if (m.cand.name === weakestM.cand.name) continue;
            if (remainingCapAt(m.cand.name, updated) <= 0) continue;
            const cnt = groupAlloc.get(m.cand.name) || 0;
            const baseSc = candidateScore(
              m, bpVal, cnt, false, adjPremiumIfSwap, g.slots, gctx
            );
            const tierDelta = (m.tier ?? 0) - (weakestM.tier ?? 0);
            const momentumBonus =
              direction !== 0 && Math.sign(tierDelta) === direction
                ? 0.02 : 0;
            const sc = baseSc + momentumBonus;
            if (
              sc > bestAltScore
              || (sc === bestAltScore && bestAltM
                  && m.cand.name.localeCompare(bestAltM.cand.name) < 0)
            ) {
              bestAltM = m;
              bestAltScore = sc;
            }
          }
          if (!bestAltM) continue;

          // Stacking discount — slightly easier to add a copy of a card
          // that's already part of the allocation, so 1→2 transitions
          // happen smoothly.
          const alreadyHas = (groupAlloc.get(bestAltM.cand.name) || 0) > 0;
          const effectiveThreshold = alreadyHas ? threshold * 0.7 : threshold;

          if (bestAltScore > weakestScore + effectiveThreshold) {
            const wname = weakestM.cand.name;
            const aname = bestAltM.cand.name;
            const wnext = (groupAlloc.get(wname) || 0) - 1;
            if (wnext <= 0) groupAlloc.delete(wname);
            else groupAlloc.set(wname, wnext);
            groupAlloc.set(aname, (groupAlloc.get(aname) || 0) + 1);
          }
        }
        return updated;
      }

      // Walk bp from 0 → target in 0.05 steps. Each step carries the
      // previous bp so `singleStepUpdate` can compute the budget
      // direction for the momentum bonus.
      const targetBp = budgetPressureValue;
      let alloc = runSlotAllocation(0);
      const steps = Math.max(3, Math.ceil(Math.abs(targetBp) / 0.05));
      let prevBp = 0;
      for (let i = 1; i <= steps; i++) {
        const bp_i = (targetBp * i) / steps;
        alloc = singleStepUpdate(alloc, bp_i, prevBp);
        prevBp = bp_i;
      }

      // Commit the final allocation to breakdown / dualAllocByName /
      // fixingAlloc. Member lookup gives us the correct _kind for the
      // fixingAlloc bucket.
      let allocatedTotal = 0;
      for (const g of shiftedGroups) {
        const groupAlloc = alloc.get(g.key);
        if (!groupAlloc) continue;
        for (const [name, cnt] of groupAlloc) {
          if (cnt <= 0) continue;
          breakdown[name] = (breakdown[name] || 0) + cnt;
          dualAllocByName.set(name, (dualAllocByName.get(name) || 0) + cnt);
          const member = g.members.find(x => x.cand.name === name);
          if (member && member.cand._kind === 'fixing') {
            fixingAlloc.set(name, (fixingAlloc.get(name) || 0) + cnt);
          }
          allocatedTotal += cnt;
        }
      }

      // Overflow safety net — if caps blocked allocation in some groups,
      // dump remaining slots into uncapped pair-specific candidates by
      // best score (deterministic by name).
      let remaining = n - allocatedTotal;
      if (remaining > 0) {
        const fallback = biased
          .filter(b => b.cand._kind === 'pair')
          .sort((a, b) =>
            (b.baseScore + b.bias) - (a.baseScore + a.bias)
            || a.cand.name.localeCompare(b.cand.name)
          );
        for (let i = 0; remaining > 0 && fallback.length > 0; i++) {
          const t = fallback[i % fallback.length];
          if (remainingCap(t.cand.name) <= 0) continue;
          breakdown[t.cand.name] = (breakdown[t.cand.name] || 0) + 1;
          dualAllocByName.set(t.cand.name, (dualAllocByName.get(t.cand.name) || 0) + 1);
          remaining--;
        }
      }

      used += n;
    });
  } else if (constraintKey === 'basics') {
    // Extreme constraint: no duals/fixers — fold the dual budget back
    // into basics (note: fixingSlots is already 0 here).
    if (dualCount > 0 && colorsUsed.length > 0) {
      const extraPer = Math.floor(dualCount / colorsUsed.length);
      let leftover = dualCount - extraPer * colorsUsed.length;
      for (const c of colorsUsed) {
        let add = extraPer;
        if (leftover > 0) { add += 1; leftover -= 1; }
        if (add > 0) {
          basicAllocation[c] = (basicAllocation[c] || 0) + add;
          breakdown[COLOR_TO_BASIC[c]] = basicAllocation[c];
        }
      }
    }
  }

  // ── Per-color sources ────────────────────────────────────
  // `perColor` counts every source at full value (1.0 each). `earlyPerColor`
  // applies the fetchland early-game nerf: basic-fetchers (Evolving Wilds,
  // Terramorphic Expanse, Fabled Passage) only contribute 0.6 each because
  // they enter tapped and fetch a basic — they cannot fix turn-1 colors.
  // Pair-specific lands and triomes still count fully.
  const perColor      = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const earlyPerColor = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of colorsUsed) {
    perColor[c]      += basicAllocation[c] || 0;
    earlyPerColor[c] += basicAllocation[c] || 0;
  }
  for (const [a, b] of pairs) {
    const opts = LAND_CATALOG[pairKey(a, b)] || [];
    for (const opt of opts) {
      const n = breakdown[opt.name] || 0;
      if (!n) continue;
      perColor[a] += n;
      perColor[b] += n;
      earlyPerColor[a] += n;
      earlyPerColor[b] += n;
    }
  }
  // Tempo-aware fetchland early value — fast decks penalise basic-fetchers
  // more (they enter tapped); slow decks tolerate them better.
  //   earlyFetchValue = 0.5 + (1 − tempo) · 0.2
  //   tempo = 1.0 → 0.50   tempo = 0.5 → 0.60   tempo = 0.0 → 0.70
  const earlyFetchValue = 0.5 + (1 - sliders.tempo) * 0.2;
  for (const [name, n] of fixingAlloc) {
    const meta = findFixingLand(name);
    if (!meta || !n) continue;
    const fixesIntoUsed = meta.fixesAny
      ? colorsUsed
      : meta.fixes.filter(c => colorsUsed.includes(c));
    const earlyContribution = meta.fixesAny ? earlyFetchValue : 1.0;
    for (const c of fixesIntoUsed) {
      perColor[c] += n;
      earlyPerColor[c] += n * earlyContribution;
    }
  }

  // ── Per-color source-floor top-up (early-weighted) ─────
  // Targets are deck-derived per color. Only RAMP earns a relief here —
  // treasure does NOT loosen early-game color requirements (treasure
  // arrives too late to help T1–T3 plays).
  const rampRelief = (structure.rampClass === 'high') ? 1 : 0;
  const effectiveTarget = (c) => Math.max(5, (colorSourceTargets[c] || 6) - rampRelief);
  // Compare against the EARLY-weighted source count so basic-fetchers
  // (Evolving Wilds etc.) don't create false confidence in early colors.
  for (const c of colorsUsed) {
    const target = effectiveTarget(c);
    while (earlyPerColor[c] < target) {
      const donor = colorsUsed
        .filter(x =>
          x !== c
          && (basicAllocation[x] || 0) > 0
          && earlyPerColor[x] > effectiveTarget(x)
        )
        .sort((a, b) => earlyPerColor[b] - earlyPerColor[a])[0];
      if (!donor) break;
      basicAllocation[donor] -= 1;
      basicAllocation[c] = (basicAllocation[c] || 0) + 1;
      breakdown[COLOR_TO_BASIC[donor]] = basicAllocation[donor];
      breakdown[COLOR_TO_BASIC[c]] = basicAllocation[c];
      if (basicAllocation[donor] === 0) delete breakdown[COLOR_TO_BASIC[donor]];
      perColor[donor]      -= 1;
      perColor[c]          += 1;
      earlyPerColor[donor] -= 1;
      earlyPerColor[c]     += 1;
    }
  }

  return formatResult({
    totalLands: landTarget, breakdown,
    analysis, structure, signals,
    perColor, isCommander, targetDeckSize,
    archetype, constraint, sliders,
    minSourcesPerColor, rampImpact, engineAdjustment,
    landBreakdown, archetypeDelta, colorSourceTargets,
    colorTargetMeta, boostedColors,
    utilityAlloc, utilityRequested: utilityTotalRequested, utilityResolved,
    basicAllocation, fixingAlloc, pairs,
  });
}

// ────────────────────────────────────────────────────────────────────────
// COST CALCULATION
// ────────────────────────────────────────────────────────────────────────

function findLandMeta(name) {
  if (Object.values(COLOR_TO_BASIC).includes(name) || name === 'Wastes') {
    return { priceEur: BASIC_PRICE_EUR, priceTier: 0, source: 'basic' };
  }
  for (const opts of Object.values(LAND_CATALOG)) {
    const hit = opts.find(o => o.name === name);
    if (hit) return { priceEur: hit.priceEur, priceTier: hit.priceTier, source: 'dual' };
  }
  const fixer = FIXING_LANDS.find(o => o.name === name);
  if (fixer) return { priceEur: fixer.priceEur, priceTier: fixer.priceTier, source: 'fixing' };
  return { priceEur: null, priceTier: null, source: 'unknown' };
}

function buildCostReport(breakdown, utilityAlloc, fixingAlloc) {
  // Precedence: utility > fixing > duals > basics. Each card name appears
  // EXACTLY ONCE in the cost report. The breakdown object is already keyed
  // by name, so duplicates are impossible — but we still walk it via a Map
  // for defensive merging and emit a warning if anything weird shows up.
  const utilityNames = new Set(utilityAlloc ? Array.from(utilityAlloc.keys()) : []);
  const fixingNames = new Set(fixingAlloc ? Array.from(fixingAlloc.keys()) : []);
  const merged = new Map();
  for (const [name, count] of Object.entries(breakdown || {})) {
    if (merged.has(name)) {
      // eslint-disable-next-line no-console
      console.warn(`[landSuggestion] duplicate breakdown entry for "${name}" — merging counts.`);
      merged.set(name, merged.get(name) + count);
    } else {
      merged.set(name, count);
    }
  }

  let total = 0;
  const items = [];
  for (const [name, count] of merged) {
    const meta = findLandMeta(name);
    let category;
    if (utilityNames.has(name)) {
      category = 'utility';
    } else if (fixingNames.has(name) || meta.source === 'fixing') {
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
    const unit = meta.priceEur;
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

function buildCategorizedBreakdown({ basicAllocation, breakdown, fixingAlloc, utilityAlloc, pairs }) {
  const basics = {};
  for (const c of COLORS) {
    const n = basicAllocation?.[c] || 0;
    if (n > 0) basics[COLOR_TO_BASIC[c]] = n;
  }
  if ((breakdown['Wastes'] || 0) > 0) basics['Wastes'] = breakdown['Wastes'];

  const duals = { tier1: {}, tier2: {}, tier3: {} };
  for (const [a, b] of pairs || []) {
    const opts = LAND_CATALOG[pairKey(a, b)] || [];
    for (const opt of opts) {
      const n = breakdown[opt.name] || 0;
      if (!n) continue;
      const bucket = opt.priceTier === 1 ? 'tier1'
                   : opt.priceTier === 2 ? 'tier2'
                   : opt.priceTier === 3 ? 'tier3' : null;
      if (bucket) duals[bucket][opt.name] = (duals[bucket][opt.name] || 0) + n;
    }
  }

  const utilityLands = {};
  for (const [name, n] of (utilityAlloc || new Map())) {
    if (n > 0) utilityLands[name] = n;
  }

  // Fixing-land bucket excludes anything already in `utilityLands` so a
  // single name never sits in two categories.
  const fixingLands = {};
  const utilityKeys = new Set(Object.keys(utilityLands));
  for (const [name, n] of (fixingAlloc || new Map())) {
    if (n > 0 && !utilityKeys.has(name)) fixingLands[name] = n;
  }

  return { basics, duals, fixingLands, utilityLands };
}

// ────────────────────────────────────────────────────────────────────────
// RESULT FORMATTING
// ────────────────────────────────────────────────────────────────────────

function describeStrongestSignal(sliders) {
  const distances = [
    ['tempo',     Math.abs(sliders.tempo     - 0.5)],
    ['earlyGame', Math.abs(sliders.earlyGame - 0.5)],
    ['greed',     Math.abs(sliders.greed     - 0.5)],
  ];
  distances.sort((a, b) => b[1] - a[1]);
  return distances[0][1] > 0.1 ? distances[0][0] : null;
}

function formatResult({
  totalLands, breakdown,
  analysis, structure, signals, perColor,
  isCommander, targetDeckSize,
  archetype, constraint, sliders,
  minSourcesPerColor, rampImpact, engineAdjustment = 0,
  landBreakdown = null, archetypeDelta = 0, colorSourceTargets = null,
  colorTargetMeta = null, boostedColors = [],
  utilityAlloc = new Map(), utilityRequested = 0, utilityResolved = [],
  basicAllocation = {}, fixingAlloc = new Map(), pairs = [],
}) {
  const cost = buildCostReport(breakdown, utilityAlloc, fixingAlloc);
  const breakdownByCategory = buildCategorizedBreakdown({
    basicAllocation, breakdown, fixingAlloc, utilityAlloc, pairs,
  });

  const issues = [];
  for (const c of analysis.colorsUsed) {
    if ((perColor[c] || 0) < minSourcesPerColor) {
      issues.push(`${c}: nur ${perColor[c]} Quellen (Ziel ≥${minSourcesPerColor})`);
    }
  }

  const colorList = analysis.colorsUsed.length > 0 ? analysis.colorsUsed.join('') : 'farbloses';
  const sizeText = isCommander ? '100-Karten' : `${targetDeckSize}-Karten`;
  const dominant = describeStrongestSignal(sliders);
  const sliderLine =
    `Tempo ${sliders.tempo.toFixed(2)} · Early ${sliders.earlyGame.toFixed(2)} · Greed ${sliders.greed.toFixed(2)}`;

  const rampNote = `${structure.rampClass} (${(structure.rampDensity * 100).toFixed(0)}%)`;

  // Tier distribution insight (brief, schema-compatible)
  const tierCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const it of cost.items) {
    if (it.priceTier != null && tierCounts[it.priceTier] !== undefined) {
      tierCounts[it.priceTier] += it.count;
    }
  }
  const tierDistText = `T0×${tierCounts[0]} · T1×${tierCounts[1]} · T2×${tierCounts[2]} · T3×${tierCounts[3]}`;

  // Utility / fixing summary lines
  let utilityLine = '';
  if (utilityAlloc && utilityAlloc.size > 0) {
    const items = Array.from(utilityAlloc.entries()).map(([n, c]) => `${n} ×${c}`);
    utilityLine = ` Utility-Lands: ${items.join(', ')}`;
    if (utilityRequested > Array.from(utilityAlloc.values()).reduce((a, b) => a + b, 0)) {
      utilityLine += ` (gekürzt durch Land-Cap)`;
    }
    utilityLine += '.';
  }
  const fuzzyMatches = (utilityResolved || []).filter(u => u.resolvedFrom === 'fuzzy');
  if (fuzzyMatches.length > 0) {
    const list = fuzzyMatches
      .map(m => `"${m.originalInput}" → ${m.matchedName} (${(m.score * 100).toFixed(0)}%)`)
      .join(', ');
    utilityLine += ` Fuzzy: ${list}.`;
  }
  let fixingLine = '';
  if (fixingAlloc && fixingAlloc.size > 0) {
    const items = Array.from(fixingAlloc.entries()).map(([n, c]) => `${n} ×${c}`);
    fixingLine = ` Fixing-Lands: ${items.join(', ')}.`;
  }

  // Engine + treasure summary (LEQ totals already in land-derivation line).
  let engineLine = '';
  if (structure.engineClass !== 'low') {
    engineLine = ` Engine-Dichte ${(structure.engineDensity * 100).toFixed(0)}% (${structure.engineClass}).`;
  }
  let treasureLine = '';
  if (structure.treasureClass !== 'low') {
    treasureLine = ` Treasure: ${structure.treasureClass} (${(structure.treasureDensity * 100).toFixed(0)}%) → weniger Fixing-Druck, gelockerter Quellen-Floor.`;
  }

  // Continuous deck-derived land count summary (LEQ model with early
  // pressure damping).
  let landDeriveLine = '';
  if (landBreakdown) {
    const parts = [`Basis ${landBreakdown.baseline}`];
    if (landBreakdown.curveAdj)    parts.push(`Curve ${landBreakdown.curveAdj > 0 ? '+' : ''}${landBreakdown.curveAdj}`);
    if (landBreakdown.colorAdj)    parts.push(`Farbdruck ${landBreakdown.colorAdj > 0 ? '+' : ''}${landBreakdown.colorAdj}`);
    if (landBreakdown.rampLEQ)     parts.push(`Ramp-LEQ −${landBreakdown.rampLEQ}`);
    if (landBreakdown.treasureLEQ) parts.push(`Treasure-LEQ −${landBreakdown.treasureLEQ}`);
    if (landBreakdown.engineLEQ)   parts.push(`Engine-LEQ −${landBreakdown.engineLEQ}`);
    if (landBreakdown.leqMul != null && landBreakdown.leqMul < 1.0) {
      parts.push(`LEQ ×${landBreakdown.leqMul} (Early-Druck)`);
    }
    if (landBreakdown.earlySafetyBump) {
      parts.push(`+${landBreakdown.earlySafetyBump} (Early-Safety)`);
    }
    landDeriveLine = ` Land-Herleitung: ${parts.join(' · ')} → ${totalLands}.`;
  }
  let earlyPressureLine = '';
  if (landBreakdown && landBreakdown.earlyPressure != null && landBreakdown.earlyPressure > 0) {
    earlyPressureLine = ` Early-Druck: ${landBreakdown.earlyPressure}.`;
  }
  // Budget as structural substitution axis — surfaces the active pressure
  // value so the user can see which slots flipped between tiers.
  let budgetLine = '';
  if (constraint) {
    const constraintKey =
      constraint.maxPriceTier === 0 ? 'basics'
      : constraint.maxPriceTier === 1 ? 'budget'
      : constraint.maxPriceTier === 2 ? 'midcap'
      : 'open';
    const pressure = constraintBudgetValue(constraintKey);
    const tone =
      pressure >= 0.85 ? 'lavish — Shocks/Fastlands dürfen dominieren'
      : pressure >= 0.45 ? 'mid — T2-Painlands/Checklands sind das Rückgrat'
      : pressure >= 0.10 ? 'strict — Substitution Richtung Guildgates/Fetcher'
      : 'extrem — nur Basics';
    budgetLine = ` Budget-Druck: ${pressure.toFixed(2)} (${tone}).`;
  }
  let boostedLine = '';
  if (boostedColors && boostedColors.length > 0) {
    boostedLine = ` Early-Quellen-Boost: ${boostedColors.join('')}.`;
  }

  let explanation = `${totalLands} Länder für ein ${sizeText}-Deck (${colorList}), Ø MV ${analysis.avgCmc.toFixed(2)}.`;
  explanation += landDeriveLine;
  explanation += earlyPressureLine;
  explanation += boostedLine;
  explanation += budgetLine;
  explanation += ` Archetyp: ${archetype.label} — ${archetype.tagline}`;
  explanation += ` Constraint: ${constraint.label}.`;
  explanation += ` Tier-Verteilung: ${tierDistText}.`;
  explanation += ` Ramp: ${rampNote}.${engineLine}${treasureLine}`;
  explanation += fixingLine;
  explanation += utilityLine;
  if (dominant) explanation += ` Dominanter Slider: ${dominant}.`;
  explanation += ` (${sliderLine})`;
  explanation += ` Mana-Basis ≈ ${cost.totalEur.toFixed(2)} €.`;

  if (analysis.nonLandCount + totalLands > targetDeckSize) {
    explanation += ` Hinweis: ${analysis.nonLandCount + totalLands - targetDeckSize} Karte(n) müssen vor dem Übernehmen entfernt werden.`;
  } else if (analysis.nonLandCount + totalLands < targetDeckSize) {
    explanation += ` Du hast aktuell nur ${analysis.nonLandCount} Nicht-Länder.`;
  }
  if (issues.length > 0) explanation += ` ⚠ ${issues.join(' · ')}`;

  return {
    totalLands,
    breakdown,
    breakdownByCategory,
    perColor,
    explanation,
    analysis: {
      ...analysis,
      structure,
      rampDensity:     structure.rampDensity,
      rampClass:       structure.rampClass,
      engineDensity:   structure.engineDensity,
      engineClass:     structure.engineClass,
      treasureDensity: structure.treasureDensity,
      treasureClass:   structure.treasureClass,
      flexibility:     structure.flexibility,
      flexibilityClass: structure.flexibilityClass,
      dominantSlider:  dominant,
      strategy:        archetype.tagline,
    },
    utilityResolved,
    landBreakdown,
    archetypeDelta,
    colorSourceTargets,
    colorTargetMeta,
    boostedColors,
    archetype: { key: archetype.key, label: archetype.label, tagline: archetype.tagline },
    constraint: (() => {
      const key = constraint.label === CONSTRAINTS.open.label ? 'open'
                : constraint.label === CONSTRAINTS.budget.label ? 'budget'
                : constraint.label === CONSTRAINTS.midcap.label ? 'midcap'
                : 'basics';
      return {
        key,
        label: constraint.label,
        maxPriceTier: constraint.maxPriceTier,
        budgetPressure: constraintBudgetValue(key),
      };
    })(),
    config: sliders,
    cost,
  };
}

// ────────────────────────────────────────────────────────────────────────
// LEGACY EXPORTS — keep older call sites compiling
// ────────────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = Object.freeze({
  ...DEFAULT_SLIDERS,
  budget: 0.5,
});

export function normalizeConfig(config = {}) {
  return {
    ...normalizeSliders(config),
    budget: clamp01(config.budget ?? 0.5),
    preset: config.preset || null,
  };
}

export function modeToConfig(mode) {
  const a = getArchetype(mode);
  if (!a) return { ...DEFAULT_CONFIG };
  // Map archetype constraint back to a budget slider value for old UIs.
  const budgetSlider =
    a.constraint === 'basics' ? 0.95
    : a.constraint === 'budget' ? 0.80
    : a.constraint === 'midcap' ? 0.55
    : 0.30;
  return { ...a.sliders, budget: budgetSlider, preset: a.key };
}

export function getModeProfile(mode) {
  const archetype = getArchetype(mode) || getArchetype(DEFAULT_ARCHETYPE);
  const sliders = normalizeSliders(archetype.sliders);
  return deriveTargets(sliders, { rampClass: 'low', flexibilityClass: 'low' });
}

export function getPresetLabel(key) { return getModeLabel(key); }
export function getPresetNote(key)  { return getArchetype(key)?.tagline || ''; }
