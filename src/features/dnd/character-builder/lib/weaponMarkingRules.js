// src/features/dnd/character-builder/lib/weaponMarkingRules.js
//
// Data-driven catalog of features that let a character "mark" / "bond
// with" a weapon, granting passive bonuses on attack and damage rolls
// with that weapon. Used by:
//   - the rules engine (computeAttacks applies the effects)
//   - the inventory UI ("Mark as …" buttons appear on equipped weapons)
//
// Adding a new mark = adding a new rule entry here, no JS changes
// elsewhere. The feature-detection and effect-application code never
// hardcodes a class name or a subclass — only data structures from
// this catalog and the character row.
//
// Rule schema:
//   id          — stable slot key. Stored under
//                 character.status.markedWeapons[id] = weaponId.
//   label       — short pill label shown on the attack row.
//   note        — long description used as tooltip / help text.
//   feature     — feature name to match in the character's gained features.
//                 Matched case-insensitively against (1) subclass-feature
//                 names auto-granted by the chosen subclass, (2) features
//                 picked under classes[*].levelChoices[*].optionalFeatures.
//                 If `feature` is omitted, the rule always applies as
//                 long as `className` / `subclass` match.
//   className   — optional: restrict to characters that took this class.
//   subclass    — optional: substring matched against subclassId
//                 (which has form "Name__Source" in this app).
//   count       — number of weapons the user can have marked under this
//                 rule at once. Default 1.
//   effects     — { abilityOverride?, attackBonus?, damageBonus? }
//     abilityOverride — ability key ('str' | 'dex' | 'con' | 'int' |
//                        'wis' | 'cha'). Replaces the natural STR/DEX/
//                        finesse choice for attack AND damage.
//     attackBonus     — flat +N added to attack rolls.
//     damageBonus     — flat +N added to damage rolls.
//   requires    — pre-conditions a weapon must satisfy to be markable:
//     proficient: true     — only weapons the character is proficient with
//     notTwoHanded: true   — disallow Two-Handed property
//     melee: true          — only melee weapons (no Ammunition/Thrown-only)
//
// Compounding: if multiple rules attach to the same weapon, their
// effects stack additively. abilityOverride from a later rule wins.

export const WEAPON_MARKING_RULES = [
  {
    id: 'hex_warrior',
    label: 'Hex Warrior',
    note: 'Hexblade: nutze CHA für Angriff & Schaden statt STR/DEX. Nicht zweihändig. Wahl erneuerbar nach langer Rast.',
    feature: 'Hex Warrior',
    className: 'Warlock',
    subclass: 'Hexblade',
    count: 1,
    effects: { abilityOverride: 'cha' },
    requires: { proficient: true, notTwoHanded: true },
  },
  {
    id: 'pact_weapon',
    label: 'Pact Weapon',
    note: 'Pact of the Blade: zählt als magisch. In Kombination mit Hex Warrior (Hexblade) gilt der CHA-Override automatisch.',
    feature: 'Pact of the Blade',
    className: 'Warlock',
    count: 1,
    // No own ability-override here on purpose — base rules don't grant it.
    // If the character ALSO has Hex Warrior, that rule's mark will be set
    // on the same weapon and provide the CHA-override on its own.
    effects: {},
    requires: {},
  },
  {
    id: 'improved_pact_weapon',
    label: 'Improved Pact Weapon',
    note: 'Eldritch Invocation: deine Pakt-Waffe bekommt +1 auf Angriff und Schaden.',
    feature: 'Improved Pact Weapon',
    className: 'Warlock',
    // Applies to whatever weapon is marked as pact_weapon — the UI
    // surfaces this rule only after the user has picked a Pact Weapon.
    requires: { markedAlso: 'pact_weapon' },
    count: 1,
    effects: { attackBonus: 1, damageBonus: 1 },
  },
]

// Normalised string compare (lowercase, trimmed).
function eq(a, b) {
  if (a == null || b == null) return false
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

function contains(haystack, needle) {
  if (haystack == null || needle == null) return false
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase())
}

/**
 * Collect every feature name the character has gained, across:
 *   - automatic class features for each class+level taken
 *   - automatic subclass features once a subclass was chosen
 *   - optional features picked at level-up (Eldritch Invocations etc.)
 *   - feats (origin + ASI)
 *
 * We currently can't read the full class-features JSON synchronously here
 * (it's a fetched dataset), so we infer from what the character row knows
 * about itself plus a small list of subclass-implied features.
 *
 * Returns a Set<string> of feature names lowercased.
 */
export function gatherCharacterFeatures(character) {
  const set = new Set()

  // 1. Optional features explicitly picked at level-up.
  for (const cls of (character.classes || [])) {
    const choices = cls.levelChoices || {}
    for (const lvl of Object.values(choices)) {
      for (const f of (lvl?.optionalFeatures || [])) {
        const name = typeof f === 'string' ? f : f?.name
        if (name) set.add(name.toLowerCase())
      }
    }
  }

  // 2. Feats grant their name as a feature key.
  for (const f of (character.feats || [])) {
    if (f?.featId) set.add(String(f.featId).toLowerCase())
    if (f?.name)   set.add(String(f.name).toLowerCase())
  }

  // 3. Subclass-implied auto-granted features. Right now we only need a
  //    short list of well-known "this subclass gives you X at level 1"
  //    bindings — and even that list is data, not code paths. Extending
  //    it later (or replacing it with the parsed classFeatures JSON)
  //    needs no changes to the consumer.
  for (const cls of (character.classes || [])) {
    const sub = cls.subclassId || ''
    for (const [needle, implied] of SUBCLASS_IMPLIED_FEATURES) {
      if (contains(sub, needle)) {
        for (const name of implied) set.add(name.toLowerCase())
      }
    }
  }

  return set
}

// "Subclass id contains needle (case-insensitive) → these features are
// gained for free as part of the subclass." Kept tiny and data-only so
// the same machinery covers homebrew adds.
const SUBCLASS_IMPLIED_FEATURES = [
  ['Hexblade',  ['Hex Warrior', "Hexblade's Curse"]],
  // Add more rows here as the need arises — no code changes required.
]

/**
 * For the given character, return the marking rules that are currently
 * available to use. Each rule keeps its full schema so the UI can show
 * label/note and the engine can read effects.
 */
export function getAvailableMarkingRules(character) {
  const features = gatherCharacterFeatures(character)
  const taken = (character.classes || []).map(c => ({
    classId: (c.classId || '').toLowerCase(),
    subclassId: (c.subclassId || '').toLowerCase(),
  }))
  const out = []
  for (const rule of WEAPON_MARKING_RULES) {
    if (rule.feature && !features.has(rule.feature.toLowerCase())) continue
    if (rule.className) {
      const hasClass = taken.some(t => eq(t.classId, rule.className))
      if (!hasClass) continue
    }
    if (rule.subclass) {
      const hasSubclass = taken.some(t => contains(t.subclassId, rule.subclass))
      if (!hasSubclass) continue
    }
    out.push(rule)
  }
  return out
}

/**
 * Returns the rule(s) currently active on a specific weapon, in order.
 */
export function getActiveMarksForWeapon(character, weaponId) {
  const marks = character.status?.markedWeapons || {}
  const rules = getAvailableMarkingRules(character)
  const active = []
  for (const r of rules) {
    if (marks[r.id] === weaponId) active.push(r)
  }
  return active
}

/**
 * Mark a weapon under a rule slot. If another weapon was previously in
 * that slot, it's automatically unmarked (rule.count = 1 today; if a
 * count > 1 is ever added the mark store becomes per-rule arrays).
 * Returns a new markedWeapons object — caller persists it.
 */
export function setWeaponMark(character, ruleId, weaponIdOrNull) {
  const prev = { ...(character.status?.markedWeapons || {}) }
  if (weaponIdOrNull == null) {
    delete prev[ruleId]
  } else {
    prev[ruleId] = weaponIdOrNull
  }
  return prev
}

/**
 * True when the given weapon item is eligible to receive `rule`.
 * Centralises the `requires` block evaluation so the inventory UI and
 * the rules engine give consistent answers.
 */
export function weaponEligibleForMark(weapon, rule, character) {
  if (!weapon || !weapon.isWeapon) return false
  const req = rule.requires || {}
  const props = (weapon.properties || []).map(p =>
    String(typeof p === 'string' ? p : p?.name || '').toLowerCase()
  )
  if (req.notTwoHanded && (props.includes('two-handed') || props.includes('2h'))) return false
  if (req.melee && (props.includes('ammunition') || props.includes('a'))) return false
  if (req.markedAlso) {
    const marks = character?.status?.markedWeapons || {}
    if (marks[req.markedAlso] !== weapon.id) return false
  }
  // Proficiency check is delegated to the same helper computeAttacks uses;
  // a missing proficiency only warns at apply time (don't block marking
  // in the UI — homebrew/temporary exceptions exist).
  return true
}

/**
 * Combine the effects of every rule currently active on this weapon
 * into one object — the form computeAttacks consumes.
 */
export function combinedMarkEffects(character, weaponId) {
  const active = getActiveMarksForWeapon(character, weaponId)
  const out = { attackBonus: 0, damageBonus: 0, abilityOverride: null, labels: [] }
  for (const r of active) {
    const e = r.effects || {}
    if (e.attackBonus) out.attackBonus += e.attackBonus
    if (e.damageBonus) out.damageBonus += e.damageBonus
    if (e.abilityOverride) out.abilityOverride = e.abilityOverride
    out.labels.push({ id: r.id, label: r.label, note: r.note })
  }
  return out
}
