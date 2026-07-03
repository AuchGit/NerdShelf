// src/features/wh40k/services/loadout.js
//
// Effective-loadout resolution for a unit entry. This is the single
// source of truth for "what is this unit actually equipped with" — used
// by the army panel, the squad editor, the read-only army view and the
// text export. The rule-clarity principle: outside of edit mode a unit
// NEVER shows an unresolved either/or weapon list, only the weapons the
// player actually selected (plus the datasheet defaults).
//
// Selection storage (on army entries and squad entries):
//
//   entry.loadout = { [wargearOptionId]: number[] }
//
// Each array element is one APPLICATION of that option (one model using
// the swap), holding the index of the chosen alternative in
// `structured.choices`. Options with a single alternative therefore
// store `[0, 0]` for "two models took it", and "one of the following"
// options store the picked index per model.
//
// Legacy compatibility: squad entries created before this refactor carry
// `wargearOptionIds: string[]` (bare "this option is on" checkmarks).
// `migrateLegacySelections` converts what is unambiguous (single-choice
// options → one application of choice 0) and reports the rest.

import {
  parseWargearOption, maxApplications, normalizeItemName,
} from './wargearGrammar';

export { maxApplications, describeConstraint } from './wargearGrammar';

/* ─────────────────── slots ─────────────────── */

/**
 * The selectable wargear slots of a unit: every wargear option that
 * parses into a structured replace/add rule. Unparsed options are
 * returned in `unstructured` so the UI can still show their text (they
 * simply can't be selected/validated mechanically).
 *
 * `wargearById` is data.wargearById from useWh40kData.
 */
export function getWargearSlots(unit, wargearById) {
  const slots = [];
  const unstructured = [];
  for (const id of unit?.wargearOptionIds || []) {
    const opt = wargearById?.[id];
    if (!opt) continue;
    // Dataset ships `structured`; fall back to runtime parsing for
    // datasets that predate the import-pipeline upgrade.
    const structured = opt.structured || parseWargearOption(opt.text) || null;
    if (structured && (structured.kind === 'replace' || structured.kind === 'add')) {
      slots.push({ id, text: opt.text, structured });
    } else if (structured && (structured.kind === 'none')) {
      continue;
    } else {
      unstructured.push({ id, text: structured?.note || opt.text });
    }
  }
  return { slots, unstructured };
}

/** Display label for one alternative of a slot ("Power fist", "1 heavy stubber + 1 storm bolter"). */
export function choiceLabel(choice) {
  return (choice?.items || [])
    .map(i => (i.count > 1 ? `${i.count}× ${i.name}` : i.name))
    .join(' + ');
}

/* ─────────────────── weapon-profile matching ─────────────────── */

/**
 * Find the hydrated weapon profiles of `unit` that belong to an item
 * name from loadout/option prose. Handles multi-profile weapons
 * ("Plasma pistol" → "Plasma pistol - standard" + "- supercharge") and
 * trailing plural s ("2 phosphor pistols" → "Phosphor pistol").
 */
export function matchWeaponProfiles(unit, itemName) {
  const target = normalizeItemName(itemName);
  if (!target) return [];
  const profiles = unit?.wargear || [];
  const norm = (n) => normalizeItemName(n);

  let hits = profiles.filter(p => norm(p.name) === target);
  if (hits.length > 0) return hits;

  // Multi-profile prefix: "plasma pistol - standard" / "… – supercharge".
  hits = profiles.filter(p => norm(p.name).startsWith(target + ' - '));
  if (hits.length > 0) return hits;

  // Singular/plural drift in prose ("phosphor pistols").
  if (target.endsWith('s')) {
    const singular = target.slice(0, -1);
    hits = profiles.filter(p => {
      const n = norm(p.name);
      return n === singular || n.startsWith(singular + ' - ');
    });
    if (hits.length > 0) return hits;
  }
  return [];
}

/* ─────────────────── resolution ─────────────────── */

/**
 * Resolve the effective equipment of one unit entry.
 *
 * @param unit        hydrated unit (from data.unitsById)
 * @param modelCount  models in this entry
 * @param selections  entry.loadout ({ optionId: choiceIdx[] })
 * @param wargearById data.wargearById
 * @returns {{
 *   known: boolean,        // false → no default-loadout data; items lists
 *                          //         every datasheet profile (ambiguous)
 *   items: Array<{ name, count, profiles, isWeapon }>,
 *   warnings: string[],
 * }}
 */
export function resolveLoadout(unit, modelCount, selections, wargearById) {
  const warnings = [];
  const groups = unit?.loadout?.groups || [];
  const models = Math.max(1, Number(modelCount) || 1);

  if (groups.length === 0) {
    // No default-equipment data — the honest fallback is the full
    // datasheet weapon list, flagged as unresolved.
    return {
      known: false,
      items: (unit?.wargear || []).map(p => ({
        name: p.name, count: null, profiles: [p], isWeapon: true,
      })),
      warnings,
    };
  }

  // ── 1. Distribute models over loadout groups ──────────
  const explicit = groups.filter(g => g.scope === 'named' && g.count != null);
  const explicitSum = explicit.reduce((s, g) => s + g.count, 0);
  const restCount = Math.max(0, models - explicitSum);

  const pool = new Map(); // normName → { name, count }
  const addItem = (name, n) => {
    if (n <= 0) return;
    const key = normalizeItemName(name);
    const cur = pool.get(key);
    if (cur) cur.count += n;
    else pool.set(key, { name, count: n });
  };
  const removeItem = (name, n, label) => {
    const key = normalizeItemName(name);
    const cur = pool.get(key);
    const have = cur ? cur.count : 0;
    if (have < n) {
      warnings.push(`${label}: nicht genug „${name}" zum Ersetzen (${have} vorhanden, ${n} benötigt).`);
    }
    if (cur) {
      cur.count = Math.max(0, cur.count - n);
      if (cur.count === 0) pool.delete(key);
    }
  };

  for (const g of groups) {
    const n = g.scope === 'all' ? models
      : g.scope === 'unit' ? 1
      : g.count == null ? restCount
      : Math.min(g.count, models);
    for (const item of g.items) addItem(item.name, (item.count || 1) * n);
  }

  // ── 2. Apply wargear selections ───────────────────────
  const { slots } = getWargearSlots(unit, wargearById || {});
  const slotById = new Map(slots.map(s => [s.id, s]));
  for (const [optionId, apps] of Object.entries(selections || {})) {
    const slot = slotById.get(optionId);
    if (!slot || !Array.isArray(apps) || apps.length === 0) continue;
    const s = slot.structured;
    const limit = maxApplications(s, models);
    const usable = apps.slice(0, limit);
    if (apps.length > limit) {
      warnings.push(`Option „${shortSlotLabel(slot)}": ${apps.length}× gewählt, aber nur ${limit}× erlaubt.`);
    }
    for (const choiceIdx of usable) {
      const choice = s.choices[choiceIdx];
      if (!choice) continue;
      for (const r of s.removes || []) removeItem(r.name, r.count || 1, shortSlotLabel(slot));
      for (const it of choice.items) addItem(it.name, it.count || 1);
    }
  }

  // ── 3. Materialise, matching weapon profiles ──────────
  const items = [...pool.values()].map(({ name, count }) => {
    const profiles = matchWeaponProfiles(unit, name);
    return { name, count, profiles, isWeapon: profiles.length > 0 };
  });
  // Ranged first, then melee, then non-weapon gear; alphabetic within.
  const rank = (it) => it.isWeapon ? (it.profiles[0].range === 'Melee' ? 1 : 0) : 2;
  items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return { known: true, items, warnings };
}

/** A short human label for a slot — the removed weapon or first choice. */
function shortSlotLabel(slot) {
  const s = slot.structured;
  if (s.removes?.length) return s.removes.map(r => r.name).join(' + ');
  return choiceLabel(s.choices[0]) || 'Wargear';
}

/* ─────────────────── summaries ─────────────────── */

/**
 * Compact one-line summary of the CHOSEN wargear (deviations from the
 * default loadout) for collapsed cards and exports.
 * Returns '' when the entry runs pure datasheet defaults.
 */
export function selectionSummary(unit, selections, wargearById) {
  const { slots } = getWargearSlots(unit, wargearById || {});
  const slotById = new Map(slots.map(s => [s.id, s]));
  const parts = [];
  for (const [optionId, apps] of Object.entries(selections || {})) {
    const slot = slotById.get(optionId);
    if (!slot || !Array.isArray(apps) || apps.length === 0) continue;
    // Group identical picks: [0,0,1] → "2× A, 1× B".
    const byChoice = new Map();
    for (const idx of apps) byChoice.set(idx, (byChoice.get(idx) || 0) + 1);
    for (const [idx, n] of byChoice) {
      const label = choiceLabel(slot.structured.choices[idx]);
      if (!label) continue;
      parts.push(n > 1 ? `${n}× ${label}` : label);
    }
  }
  return parts.join(' · ');
}

/**
 * One-line effective-weapons summary ("5× Boltgun · 1× Meltagun · …")
 * used where the full table doesn't fit (exports, tooltips).
 */
export function loadoutSummary(resolved) {
  if (!resolved) return '';
  if (!resolved.known) {
    return resolved.items.map(i => i.name).join(' / ');
  }
  return resolved.items
    .map(i => (i.count != null && i.count !== 1 ? `${i.count}× ${i.name}` : i.name))
    .join(' · ');
}

/* ─────────────────── validation ─────────────────── */

/**
 * Validate one entry's loadout. Returns German error strings; empty
 * array = legal. Used by validateArmy and (as hard blocks) by the
 * loadout editor.
 */
export function validateEntryLoadout(unit, modelCount, selections, wargearById) {
  const errors = [];
  if (!unit) return errors;
  const models = Math.max(1, Number(modelCount) || 1);
  const { slots } = getWargearSlots(unit, wargearById || {});
  const slotById = new Map(slots.map(s => [s.id, s]));

  for (const [optionId, apps] of Object.entries(selections || {})) {
    if (!Array.isArray(apps) || apps.length === 0) continue;
    const slot = slotById.get(optionId);
    if (!slot) {
      errors.push(`${unit.name}: unbekannte Wargear-Option gewählt (${optionId}).`);
      continue;
    }
    const s = slot.structured;
    const limit = maxApplications(s, models);
    if (apps.length > limit) {
      errors.push(`${unit.name}: „${shortSlotLabel(slot)}" ${apps.length}× gewählt — bei ${models} Modellen sind maximal ${limit} erlaubt.`);
    }
    for (const idx of apps) {
      if (!s.choices[idx]) {
        errors.push(`${unit.name}: ungültige Auswahl in „${shortSlotLabel(slot)}".`);
        break;
      }
    }
  }

  // Replacement-pool consistency (e.g. two options both replacing the
  // same single default weapon).
  const resolved = resolveLoadout(unit, models, selections, wargearById);
  for (const w of resolved.warnings) errors.push(`${unit.name}: ${w}`);

  return errors;
}

/* ─────────────────── legacy migration ─────────────────── */

/**
 * Convert a pre-refactor `wargearOptionIds` checklist into structured
 * selections. Single-alternative options migrate to one application of
 * that alternative; multi-choice options were never resolvable and are
 * returned in `unmigrated` (the editor shows them as still-to-pick).
 */
export function migrateLegacySelections(unit, wargearOptionIds, wargearById) {
  const selections = {};
  const unmigrated = [];
  if (!Array.isArray(wargearOptionIds) || wargearOptionIds.length === 0) {
    return { selections, unmigrated };
  }
  const { slots } = getWargearSlots(unit, wargearById || {});
  const slotById = new Map(slots.map(s => [s.id, s]));
  for (const id of wargearOptionIds) {
    const slot = slotById.get(id);
    if (slot && slot.structured.choices.length === 1) {
      selections[id] = [0];
    } else {
      unmigrated.push(id);
    }
  }
  return { selections, unmigrated };
}

/**
 * Normalise an army/squad entry to the current shape: guarantees
 * `modelCount` (datasheet minimum) and `loadout` (migrating legacy
 * checklists on the fly). Pure — returns a new object when changes are
 * needed, the same reference otherwise.
 */
export function normalizeEntryLoadout(entry, unit, wargearById) {
  if (!entry || !unit) return entry;
  let changed = false;
  let next = entry;
  if (next.modelCount == null) {
    const min = unit.composition?.minModels != null
      ? Math.max(1, unit.composition.minModels)
      : (unit.modelCounts?.[0] || 1);
    next = { ...next, modelCount: min };
    changed = true;
  }
  if (!next.loadout) {
    const { selections } = migrateLegacySelections(unit, next.wargearOptionIds, wargearById);
    next = { ...next, loadout: selections };
    changed = true;
  }
  return changed ? next : entry;
}
