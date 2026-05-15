// src/features/wh40k/combat/onceFlags.js
//
// Heuristic detector for "once per battle" / "once per game" / "once
// per turn" abilities. The Combat Helper surfaces a tap-to-mark toggle
// for each detected ability so the user remembers what they've already
// burned.
//
// We deliberately keep this as a small pure helper rather than a full
// rules parser — the heuristic is right ~95% of the time on Wahapedia
// prose ("Once per battle, …", "Once per game, …", "Once per turn,
// …"). False negatives are recoverable (user can write a manual note);
// false positives only add an extra checkbox the user can ignore.

// Tiny inline slugger — the canonical import-pipeline slugify lives in
// scripts/wh40k-import/ids.mjs but that's a Node-only module. We don't
// import it here so the runtime stays decoupled from build-time code.
function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PATTERNS = [
  { re: /once per battle/i,       kind: 'battle',  label: '1× pro Schlacht' },
  { re: /once per game/i,         kind: 'battle',  label: '1× pro Spiel' },
  { re: /once per turn/i,         kind: 'turn',    label: '1× pro Zug' },
  { re: /once per phase/i,        kind: 'phase',   label: '1× pro Phase' },
];

/**
 * Inspect an ability's text and return a "once flag" descriptor if the
 * ability is limited-use, or `null` otherwise.
 *
 * @returns {{ kind:'battle'|'turn'|'phase', label:string, key:string } | null}
 */
export function detectOnceFlag(ability) {
  if (!ability?.text) return null;
  for (const p of PATTERNS) {
    if (p.re.test(ability.text)) {
      return {
        kind: p.kind,
        label: p.label,
        // Stable per-ability key. Combined with the unit instanceId in
        // the UI to scope the usage flag to a specific unit instance.
        key: slugify(ability.name || ability.id || 'ability'),
      };
    }
  }
  return null;
}
