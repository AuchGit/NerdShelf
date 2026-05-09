// scripts/wh40k-import/ids.mjs
//
// Stable, deterministic ID generation for canonical entities.
//
// Why stability matters: user data (favorites, inventory, saved army lists)
// is keyed by these IDs. If a re-import of upstream data causes IDs to
// change, the user's saved data silently loses its referent.
//
// Design rules:
//
//   1. IDs are pure functions of canonical fields (faction name, entity
//      name, parent ID). NEVER incorporate array order, file paths, or
//      timestamps.
//
//   2. IDs are slug-friendly: lowercase, alphanumeric + '-', with '--' as
//      a parent/child separator. This makes them readable in URLs, logs,
//      and saved files.
//
//   3. Collisions must be deterministic too: when two entities slug to
//      the same string we append `-{8charsha1}` of the canonical name +
//      parent. The hash is stable across imports of the same data.
//
//   4. Renames must be tracked. If upstream renames "Astra Militarum" to
//      "Imperial Guard", the old slug `astra-militarum` becomes wrong.
//      The aliases map (aliases.json) records:
//        { "astra-militarum": "imperial-guard" }
//      so old saved data still resolves.
//
//   5. The ID schema is documented inline next to each generator so
//      future contributors stay disciplined.

import crypto from 'node:crypto';

/* ─────────────────── slugify ─────────────────── */

const FOLD_MAP = {
  'ä': 'ae', 'Ä': 'ae',
  'ö': 'oe', 'Ö': 'oe',
  'ü': 'ue', 'Ü': 'ue',
  'ß': 'ss',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'À': 'a', 'Á': 'a', 'Â': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'È': 'e', 'É': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'Ò': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u',
  'ñ': 'n', 'ç': 'c',
};

/** Convert any human string to a canonical slug. Stable for stable input. */
export function slugify(input) {
  if (input == null) return '';
  let s = String(input);
  // Apply diacritic folding
  s = s.replace(/[äÄöÖüÜßàáâãåÀÁÂèéêëÈÉìíîïòóôõÒùúûñç]/g, ch => FOLD_MAP[ch] || ch);
  s = s.toLowerCase();
  // Strip apostrophes and similar punctuation that should NOT introduce a -
  // (T'au → tau, not t-au; "knight's" → knights)
  s = s.replace(/['’`´‘"„“”]/g, '');
  // Anything else non-alphanumeric becomes a single '-'
  s = s.replace(/[^a-z0-9]+/g, '-');
  // Collapse and trim
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}

/** Short hash used for collision tiebreakers. Deterministic. */
export function shortHash(...parts) {
  const input = parts.filter(Boolean).join('|');
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
}

/* ─────────────────── ID generators ─────────────────── */
//
// Each generator follows the convention:
//   id = `${typePrefix}-${parentSlug}--${childSlug}`
//
// Globally scoped entities (Faction, Keyword) skip the parent.
// Sub-entities (ModelProfile under a Unit, Stratagem under a Detachment)
// embed the parent's id directly so the parentage is recoverable from a
// child id alone.

/**
 * Faction id — global. Slugged faction name.
 *   "Space Marines"        → "space-marines"
 *   "Adeptus Custodes"     → "adeptus-custodes"
 *   "T'au Empire"          → "tau-empire"
 */
export function factionId(name) {
  const slug = slugify(name);
  if (!slug) throw new Error(`factionId: empty slug for name "${name}"`);
  return slug;
}

/**
 * Detachment id — scoped to faction.
 *   ("space-marines", "Gladius Task Force") → "det-space-marines--gladius-task-force"
 */
export function detachmentId(factionIdValue, name) {
  const slug = slugify(name);
  if (!slug) throw new Error(`detachmentId: empty slug for "${name}"`);
  return `det-${factionIdValue}--${slug}`;
}

/**
 * Unit id — scoped to faction.
 *   ("space-marines", "Captain") → "unit-space-marines--captain"
 *
 * Different factions can share unit names (Captain, Lord, …) without
 * colliding. Within a faction, different *datasheets* with the same name
 * are extremely rare (e.g. the "Captain in Terminator Armour" vs "Captain"
 * disambiguates itself by name). If a true collision is detected at
 * normalize time, the second occurrence appends a stable hash of
 * distinguishing fields (see `withCollisionSuffix`).
 */
export function unitId(factionIdValue, name) {
  const slug = slugify(name);
  if (!slug) throw new Error(`unitId: empty slug for "${name}"`);
  return `unit-${factionIdValue}--${slug}`;
}

/**
 * Model profile id — scoped to a unit. The model NAME within the unit is
 * the discriminator (Captain might have a "Captain" profile, "Veteran
 * Sergeant" profile, etc.). When duplicate names exist for one unit, the
 * caller appends an index via `withCollisionSuffix`.
 */
export function modelProfileId(unitIdValue, name) {
  return `${unitIdValue}--profile-${slugify(name)}`;
}

/** Weapon profile id — scoped to a unit when unit-bound, otherwise global. */
export function weaponProfileId(unitIdValue, name) {
  if (unitIdValue) return `${unitIdValue}--weapon-${slugify(name)}`;
  return `weapon--${slugify(name)}`;
}

/** Composition id — there is exactly one composition per unit. */
export function compositionId(unitIdValue) {
  return `${unitIdValue}--composition`;
}

/**
 * Wargear-option id — multiple per unit; ordering used as discriminator
 * (this is the ONLY place where order is part of the ID, because the
 * source XML lists options as a numbered sequence with no other natural
 * key). Future imports must preserve the source ordering for stability.
 */
export function wargearOptionId(unitIdValue, index) {
  return `${unitIdValue}--wargear-${index}`;
}

/**
 * Ability id — encoded with scope so unit/detachment/faction abilities
 * with the same name don't collide.
 */
export function abilityId(scope, parentId, name) {
  const slug = slugify(name);
  if (parentId) return `${parentId}--ability-${slug}`;
  return `ability-${scope}--${slug}`;
}

/** Stratagem id — scoped to its detachment. */
export function stratagemId(detachmentIdValue, name) {
  return `${detachmentIdValue}--strat-${slugify(name)}`;
}

/** Enhancement id — scoped to its detachment. */
export function enhancementId(detachmentIdValue, name) {
  return `${detachmentIdValue}--enh-${slugify(name)}`;
}

/** Keyword id — global. Uppercase keyword text, slugged. */
export function keywordId(name) {
  return `kw-${slugify(name)}`;
}

/** Army-rule id — scoped to faction. */
export function armyRuleId(factionIdValue, name) {
  return `armyrule-${factionIdValue}--${slugify(name)}`;
}

/* ─────────────────── collision tiebreaker ─────────────────── */

/**
 * If a generator produces an id that already exists in `seen`, append a
 * stable hash of the disambiguator fields. The hash is short (8 chars,
 * sha1) and deterministic — the same input always yields the same id.
 *
 *   const id = withCollisionSuffix(unitId(f,n), [n, sourceId], seen);
 */
export function withCollisionSuffix(baseId, disambiguators, seen) {
  if (!seen.has(baseId)) return baseId;
  const candidate = `${baseId}-${shortHash(...disambiguators)}`;
  if (!seen.has(candidate)) return candidate;
  // Pathological case — different content but same disambiguator hash.
  // Fall back to incrementing suffix; once we hit this we've already lost
  // some stability so loud-fail to flag the data issue at validation time.
  let i = 2;
  while (seen.has(`${candidate}-${i}`)) i++;
  return `${candidate}-${i}`;
}
