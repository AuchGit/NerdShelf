// formulaResolver.js
//
// Generic formula evaluation for homebrew item / feature fields that
// reference the wielder's stats. Lets the user write `8 + PB + WIS`
// in a `saveDc` field, `PB` as `chargesMax`, etc. — the engine then
// resolves against the actual character and emits the numeric pill.
//
// Supported tokens (case-insensitive):
//   PB | PROFICIENCY            → proficiency bonus
//   STR | STR_MOD | STRENGTH    → STR modifier
//   DEX | DEX_MOD | DEXTERITY   → DEX modifier
//   CON | CON_MOD | CONSTITUTION → CON modifier
//   INT | INT_MOD | INTELLIGENCE → INT modifier
//   WIS | WIS_MOD | WISDOM      → WIS modifier
//   CHA | CHA_MOD | CHARISMA    → CHA modifier
//   LEVEL | CL                  → total character level
//
// Dice-bearing formulas (e.g. `1d6+4`) stay as-is — pretty-print uses
// them verbatim; numeric eval returns null so the renderer falls
// back to the original string.
//
// Hardcode-free per design: no item-name lookup, no per-action regex.

const ABILITY_TOKENS = {
  STR: 'str', STR_MOD: 'str', STRENGTH: 'str',
  DEX: 'dex', DEX_MOD: 'dex', DEXTERITY: 'dex',
  CON: 'con', CON_MOD: 'con', CONSTITUTION: 'con',
  INT: 'int', INT_MOD: 'int', INTELLIGENCE: 'int',
  WIS: 'wis', WIS_MOD: 'wis', WISDOM: 'wis',
  CHA: 'cha', CHA_MOD: 'cha', CHARISMA: 'cha',
}

function abilityMod(character, key) {
  // Character-Schema speichert die Score-Base bei character.abilityScores.base
  // + Modifikatoren (racial / background / feats) — die richtige Source of
  // Truth ist getAllAbilityScores. Wir importieren lazy um circular-imports
  // zu vermeiden.
  let score
  if (character?.abilityScores?.base) {
    const base = character.abilityScores.base[key] || 8
    const racial = character.species?.abilityScoreImprovements?.[key] || 0
    const bg = character.background?.abilityScoreImprovements?.[key] || 0
    let featBonus = 0
    for (const feat of (character.feats || [])) {
      featBonus += feat?.abilityBonus?.[key] || 0
    }
    score = base + racial + bg + featBonus
  } else {
    // Fallback für legacy/test-character-shapes
    score = character?.abilities?.[key]?.score ?? character?.abilities?.[key] ?? 10
  }
  return Math.floor((Number(score) - 10) / 2)
}

function profBonus(character) {
  const lvl = (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
  return Math.max(2, 2 + Math.floor(Math.max(0, lvl - 1) / 4))
}

function totalLevel(character) {
  return (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
}

/** True if `expr` looks like a dice formula (1d6, 2d8+3, …). */
export function isDiceFormula(expr) {
  return typeof expr === 'string' && /\b\d*d\d+/i.test(expr)
}

/**
 * Resolve a formula string against a character. Returns a number when
 * the formula is fully numeric, null when it contains dice (caller
 * should fall back to original string), or NaN when the formula
 * couldn't be evaluated. Numeric inputs pass through.
 */
export function resolveFormula(expr, character) {
  if (expr === null || expr === undefined || expr === '') return null
  if (typeof expr === 'number') return expr
  const s = String(expr).trim()
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (isDiceFormula(s)) return null
  // Substitute tokens
  let out = s.toUpperCase()
  // Longest-first so `STR_MOD` matches before `STR`
  const tokens = Object.keys(ABILITY_TOKENS).sort((a, b) => b.length - a.length)
  for (const t of tokens) {
    const re = new RegExp(`\\b${t}\\b`, 'g')
    if (re.test(out)) {
      out = out.replace(new RegExp(`\\b${t}\\b`, 'g'), String(abilityMod(character, ABILITY_TOKENS[t])))
    }
  }
  out = out.replace(/\b(?:PB|PROFICIENCY)\b/g, String(profBonus(character)))
  out = out.replace(/\b(?:LEVEL|CL)\b/g, String(totalLevel(character)))
  // Safety check: only allow digits, operators, parens, whitespace
  if (!/^[\d+\-*/().\s]+$/.test(out)) return NaN
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict";return (${out})`)()
    return Number.isFinite(v) ? v : NaN
  } catch { return NaN }
}

/** Pretty-print: returns the numeric value when resolvable, otherwise
 *  the original formula string (e.g. `1d6+4`). */
export function formatFormula(expr, character) {
  const n = resolveFormula(expr, character)
  if (n === null) return String(expr)  // dice — keep original
  if (Number.isFinite(n)) return String(n)
  return String(expr)  // unresolvable — show raw
}
