// src/features/mtg/deck-builder/services/consistencySim.js
//
// Monte Carlo deck consistency simulator. Configurable rule engine — each
// rule type is just a function over the simulation state, so future UI can
// add rule types without touching simulation internals.
//
// Rule shapes:
//   { id, type: 'CARD_IN_HAND_BY_TURN',     cardName, count?, turn? }
//   { id, type: 'COMBO_IN_OPENING_HAND',    cards: [name, ...] }
//   { id, type: 'MANA_REQUIREMENT_BY_TURN', turn, total?, colors?: ['R','R'] }
//   { id, type: 'MULLIGAN_TRIGGER',         minLands?, maxLands?, groups? }
//   { id, type: 'GENERAL_HAND_QUALITY',     minLands?, maxLands?, requirePlayByTurn?, groups? }
//   { id, type: 'PERFECT_START',            minLands?, maxLands?, groups?, conditions?: [<rule>, ...] }
//
// MULLIGAN_TRIGGER fires (i.e. forces a mulligan) when the hand FAILS the
// stated requirements: lands outside [minLands, maxLands] OR any group not
// satisfied. Brick rate counts hands that still trigger after the limit.
//
// `groups` shape (used by GENERAL_HAND_QUALITY + PERFECT_START):
//   [{ minCount: 1, cards: ['Lightning Bolt', 'Shock'] }, ...]
//   "At least minCount cards in the opening hand are one of (any of cards)."

import { isLand } from './deckAnalysis';
import { getManaCost, parseManaCost } from './scryfall';

const COLORS = ['W', 'U', 'B', 'R', 'G'];

// ─── Deck preparation ──────────────────────────────────────────────────────

function expandDeck(mainboard) {
  const arr = [];
  for (const { card, count } of Object.values(mainboard || {})) {
    for (let i = 0; i < count; i++) arr.push(card);
  }
  return arr;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Mana / land helpers ───────────────────────────────────────────────────

/** Returns the colors a land can produce. Uses Scryfall's `produced_mana`
 *  field when present, falling back to basic-land subtypes and oracle text. */
function landProducesColors(card) {
  if (Array.isArray(card.produced_mana)) {
    const mapped = card.produced_mana.filter(c => COLORS.includes(c));
    if (mapped.length > 0) return mapped;
    if (card.produced_mana.includes('C')) return [];
  }
  const t = card.type_line || '';
  const out = [];
  if (t.includes('Plains')) out.push('W');
  if (t.includes('Island')) out.push('U');
  if (t.includes('Swamp')) out.push('B');
  if (t.includes('Mountain')) out.push('R');
  if (t.includes('Forest')) out.push('G');
  if (out.length > 0) return out;
  // Last-ditch: parse "Add {X}" patterns from oracle text
  const text = card.oracle_text || '';
  if (/any color/i.test(text)) return [...COLORS];
  for (const c of COLORS) {
    const re = new RegExp(`add[^.]*\\{${c}\\}`, 'i');
    if (re.test(text)) out.push(c);
  }
  return out;
}

/** Decompose a mana cost into { generic, colored: {W,U,B,R,G} }. Hybrid pips
 *  are billed as generic (either color works, simplified). */
function parseManaRequirement(card) {
  const cost = getManaCost(card);
  const syms = parseManaCost(cost);
  let generic = 0;
  const colored = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const raw of syms) {
    const s = raw.toUpperCase();
    if (/^\d+$/.test(s)) { generic += parseInt(s, 10); continue; }
    if (s === 'X') continue; // assume X=0
    if (s === 'C') { generic += 1; continue; }
    if (s.includes('/')) { generic += 1; continue; }
    if (COLORS.includes(s)) colored[s] += 1;
  }
  return { generic, colored };
}

/** Check whether `card` is castable given a list of lands assumed in play. */
function canCast(card, lands) {
  if (isLand(card)) return false;
  const { generic, colored } = parseManaRequirement(card);
  const totalNeeded = generic + COLORS.reduce((s, c) => s + colored[c], 0);
  if (lands.length < totalNeeded) return false;

  const single = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const duals = [];
  let colorless = 0;
  for (const land of lands) {
    const produces = landProducesColors(land);
    if (produces.length === 0) colorless += 1;
    else if (produces.length === 1) single[produces[0]] += 1;
    else duals.push(produces);
  }

  const remaining = { ...colored };
  let pool = lands.length;

  // 1) pay colored from same-color basics first
  for (const c of COLORS) {
    const pay = Math.min(single[c], remaining[c]);
    remaining[c] -= pay;
    pool -= pay;
  }
  // 2) pay leftover colored from dual producers (greedy)
  for (const dual of duals) {
    let assigned = false;
    for (const c of dual) {
      if (remaining[c] > 0) {
        remaining[c] -= 1;
        pool -= 1;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      // dual contributes to generic
      // pool already counted, nothing else to do
    }
  }
  for (const c of COLORS) if (remaining[c] > 0) return false;
  return pool >= generic;
}

function nameMatches(card, target) {
  if (!card?.name || !target) return false;
  return card.name.toLowerCase() === target.toLowerCase();
}

/** Each group asks for at least `minCount` cards from any of `cards`. */
function evaluateGroups(hand, groups) {
  if (!groups || groups.length === 0) return true;
  for (const g of groups) {
    const min = Math.max(1, g.minCount ?? 1);
    const targets = (g.cards || []).map(n => (n || '').toLowerCase());
    if (targets.length === 0) continue;
    let found = 0;
    for (const card of hand) {
      const n = (card?.name || '').toLowerCase();
      if (targets.includes(n)) found++;
    }
    if (found < min) return false;
  }
  return true;
}

// ─── Rule evaluation ───────────────────────────────────────────────────────

function evaluateRule(rule, ctx) {
  const { hand, drawnByTurn, maxTurn } = ctx;
  const turnCap = (t) => Math.min(Math.max(0, t ?? maxTurn), maxTurn);

  switch (rule.type) {
    case 'CARD_IN_HAND_BY_TURN': {
      const turn = turnCap(rule.turn);
      const pool = drawnByTurn[turn] || [];
      const matches = pool.filter(c => nameMatches(c, rule.cardName)).length;
      return matches >= (rule.count ?? 1);
    }

    case 'COMBO_IN_OPENING_HAND': {
      const list = rule.cards || [];
      if (list.length === 0) return false;
      const handNames = hand.map(c => (c.name || '').toLowerCase());
      const counter = new Map();
      for (const n of handNames) counter.set(n, (counter.get(n) || 0) + 1);
      for (const target of list) {
        const key = target.toLowerCase();
        if ((counter.get(key) || 0) <= 0) return false;
        counter.set(key, counter.get(key) - 1);
      }
      return true;
    }

    case 'MANA_REQUIREMENT_BY_TURN': {
      const turn = turnCap(rule.turn);
      const pool = drawnByTurn[turn] || [];
      // We can play at most `turn` lands by the start of turn `turn`.
      const lands = pool.filter(isLand).slice(0, turn);
      const reqColors = (rule.colors || []).filter(c => COLORS.includes(c));
      const totalNeeded = rule.total ?? reqColors.length;
      if (lands.length < totalNeeded) return false;

      const single = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      const duals = [];
      let any = 0;
      for (const l of lands) {
        const p = landProducesColors(l);
        if (p.length === 0) any += 1;
        else if (p.length === 1) single[p[0]] += 1;
        else duals.push(p);
      }

      const need = {};
      for (const c of reqColors) need[c] = (need[c] || 0) + 1;
      for (const c of Object.keys(need)) {
        const pay = Math.min(single[c] || 0, need[c]);
        need[c] -= pay;
      }
      for (const dual of duals) {
        for (const c of dual) {
          if ((need[c] || 0) > 0) { need[c] -= 1; break; }
        }
      }
      return Object.values(need).every(n => n <= 0);
    }

    case 'MULLIGAN_TRIGGER': {
      // Returns true when the hand TRIGGERS a mulligan.
      const minLands = rule.minLands ?? 2;
      const maxLands = rule.maxLands ?? 5;
      const lands = hand.filter(isLand).length;
      if (lands < minLands || lands > maxLands) return true;
      if (!evaluateGroups(hand, rule.groups)) return true;
      return false;
    }

    case 'GENERAL_HAND_QUALITY': {
      const minLands = rule.minLands ?? 2;
      const maxLands = rule.maxLands ?? 5;
      const turn = turnCap(rule.requirePlayByTurn ?? 2);
      const lands = hand.filter(isLand).length;
      if (lands < minLands || lands > maxLands) return false;
      if (!evaluateGroups(hand, rule.groups)) return false;
      if (turn <= 0) return true;
      const pool = drawnByTurn[turn] || hand;
      const playLands = pool.filter(isLand).slice(0, turn);
      return pool.some(c => !isLand(c) && canCast(c, playLands));
    }

    case 'PERFECT_START': {
      const hasNewShape =
        rule.minLands != null ||
        rule.maxLands != null ||
        (rule.groups && rule.groups.length > 0);

      if (hasNewShape) {
        const minLands = rule.minLands ?? 0;
        const maxLands = rule.maxLands ?? 7;
        const lands = hand.filter(isLand).length;
        if (lands < minLands || lands > maxLands) return false;
        if (!evaluateGroups(hand, rule.groups)) return false;
        const conditions = rule.conditions || [];
        return conditions.every(cond => evaluateRule(cond, ctx));
      }

      // Legacy shape: pure list of conditions
      const conditions = rule.conditions || [];
      if (conditions.length === 0) return false;
      return conditions.every(cond => evaluateRule(cond, ctx));
    }

    default:
      return false;
  }
}

export function evaluateRules(simState, rules) {
  const out = {};
  for (const rule of rules) {
    out[rule.id] = evaluateRule(rule, simState);
  }
  return out;
}

// ─── Single-game simulation ────────────────────────────────────────────────

/** Default mulligan-keep heuristic: 2–5 lands and at least one cheap spell. */
function defaultKeep(hand) {
  const lands = hand.filter(isLand).length;
  if (lands < 2 || lands > 5) return false;
  return hand.some(c => !isLand(c) && (c.cmc || 0) <= 3);
}

/** Build a mulligan-keep function. The hand is kept iff:
 *   - the MULLIGAN_TRIGGER rule does NOT fire, AND
 *   - the GENERAL_HAND_QUALITY rule's land-window is satisfied
 * (the play-by-turn check uses post-draw context, so it stays in evaluation). */
function buildKeepFn({ mullRule, keepRule }) {
  return (hand) => {
    if (mullRule) {
      const triggers = evaluateRule(mullRule, { hand, drawnByTurn: { 0: hand }, maxTurn: 0 });
      if (triggers) return false;
    }
    if (keepRule) {
      const minLands = keepRule.minLands ?? 2;
      const maxLands = keepRule.maxLands ?? 5;
      const lands = hand.filter(isLand).length;
      if (lands < minLands || lands > maxLands) return false;
      if (!evaluateGroups(hand, keepRule.groups)) return false;
    }
    return hand.some(c => !isLand(c) && (c.cmc || 0) <= 3);
  };
}

/** Pick which `n` cards a London-mulligan player would put on the bottom.
 *  Heuristic: bottom extra lands beyond 4, then the highest-CMC spells. */
function smartBottom(hand, n) {
  if (n <= 0) return { kept: hand.slice(), bottomed: [] };
  const indices = hand.map((_, i) => i);
  const lands = indices.filter(i => isLand(hand[i]));
  const spells = indices.filter(i => !isLand(hand[i]));
  const bottomedSet = new Set();

  // Bottom extra lands (above 4)
  if (lands.length > 4) {
    for (let i = 4; i < lands.length && bottomedSet.size < n; i++) {
      bottomedSet.add(lands[i]);
    }
  }
  // Bottom highest-CMC spells
  spells.sort((a, b) => (hand[b].cmc || 0) - (hand[a].cmc || 0));
  for (const idx of spells) {
    if (bottomedSet.size >= n) break;
    bottomedSet.add(idx);
  }
  // If still short (e.g. all-land hand), bottom from the front
  for (let i = 0; i < hand.length && bottomedSet.size < n; i++) {
    bottomedSet.add(i);
  }

  const kept = [];
  const bottomed = [];
  for (let i = 0; i < hand.length; i++) {
    if (bottomedSet.has(i)) bottomed.push(hand[i]);
    else kept.push(hand[i]);
  }
  return { kept, bottomed };
}

export function simulateHand(deck, options = {}) {
  const {
    maxTurn = 5,
    mulliganLimit = 2,
    keepFn = defaultKeep,
  } = options;

  let mulligans = 0;
  let dealtHand = [];
  let library = [];

  while (true) {
    const cards = deck.slice();
    shuffle(cards);
    dealtHand = cards.slice(0, 7);
    library = cards.slice(7);
    if (keepFn(dealtHand) || mulligans >= mulliganLimit) break;
    mulligans++;
  }

  const bricked = !keepFn(dealtHand);

  // Apply London Mulligan: bottom `mulligans` cards from the 7 we drew.
  const { kept: hand, bottomed } = smartBottom(dealtHand, mulligans);
  library = library.concat(bottomed);

  const drawnByTurn = { 0: hand.slice() };
  for (let t = 1; t <= maxTurn; t++) {
    const next = library.shift();
    drawnByTurn[t] = next ? drawnByTurn[t - 1].concat([next]) : drawnByTurn[t - 1].slice();
  }

  return { hand, drawnByTurn, mulligans, bricked, maxTurn };
}

// ─── Top-level Monte Carlo runner ──────────────────────────────────────────

const DEFAULT_RULES = [
  { id: 'general', type: 'GENERAL_HAND_QUALITY', label: 'Spielbare Eröffnung' },
];

export function runSimulation(mainboard, rules = [], options = {}) {
  const {
    iterations = 5000,
    maxTurn = 5,
    mulliganLimit = 2,
  } = options;

  const deck = expandDeck(mainboard);
  if (deck.length < 30) {
    return {
      keepRate: 0,
      perfectStartRate: null,
      brickRate: 0,
      ruleResults: [],
      summary: 'Deck zu klein für eine Simulation (<30 Karten im Mainboard).',
      iterations: 0,
      tooSmall: true,
    };
  }

  const activeRules = rules.length > 0 ? rules : DEFAULT_RULES;
  const keepRule = activeRules.find(r => r.type === 'GENERAL_HAND_QUALITY') || null;
  const mullRule = activeRules.find(r => r.type === 'MULLIGAN_TRIGGER') || null;
  const keepFn = buildKeepFn({ mullRule, keepRule });
  // Brick = even after all mulligans, the mulligan-trigger rule still fires.
  const isBrick = mullRule
    ? (hand) => evaluateRule(mullRule, { hand, drawnByTurn: { 0: hand }, maxTurn: 0 })
    : (hand) => !keepFn(hand);

  let kept = 0;
  let bricks = 0;
  let perfectStart = 0;
  const ruleHits = Object.fromEntries(activeRules.map(r => [r.id, 0]));
  let perfectRule = activeRules.find(r => r.type === 'PERFECT_START') || null;

  for (let i = 0; i < iterations; i++) {
    const sim = simulateHand(deck, { maxTurn, mulliganLimit, keepFn });
    if (sim.mulligans === 0) kept++;
    if (isBrick(sim.hand)) bricks++;

    const evals = evaluateRules(sim, activeRules);
    for (const r of activeRules) {
      if (evals[r.id]) ruleHits[r.id] += 1;
    }
    if (perfectRule && evals[perfectRule.id]) perfectStart += 1;
  }

  const ruleResults = activeRules.map(r => ({
    id: r.id,
    type: r.type,
    label: r.label || r.id,
    passRate: ruleHits[r.id] / iterations,
  }));

  const keepRate = kept / iterations;
  const brickRate = bricks / iterations;
  const perfectStartRate = perfectRule ? perfectStart / iterations : null;

  return {
    keepRate,
    perfectStartRate,
    brickRate,
    ruleResults,
    summary: buildSummary({ keepRate, brickRate, ruleResults }),
    iterations,
    tooSmall: false,
  };
}

function buildSummary({ keepRate, brickRate, ruleResults }) {
  const messages = [];
  if (keepRate < 0.65) {
    messages.push('Niedrige Keep-Rate — Mana-Kurve oder Land-Anzahl prüfen.');
  } else if (keepRate >= 0.88) {
    messages.push('Sehr stabile Eröffnungshände.');
  } else {
    messages.push('Solide Keep-Rate.');
  }
  if (brickRate > 0.05) {
    messages.push(`${(brickRate * 100).toFixed(1)}% der Hände bleiben nach Mulligans unspielbar.`);
  }
  for (const r of ruleResults) {
    if (r.type === 'GENERAL_HAND_QUALITY') continue;
    if (r.passRate < 0.4) {
      messages.push(`"${r.label}" wird nur in ${(r.passRate * 100).toFixed(0)}% erfüllt.`);
    }
  }
  return messages.join(' ');
}

export { DEFAULT_RULES };
