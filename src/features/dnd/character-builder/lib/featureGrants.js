// src/features/dnd/character-builder/lib/featureGrants.js
//
// Data-driven catalog: "if a character has THIS class feature, they
// automatically gain THESE proficiencies". Subclass features whose
// proficiency grants live in `entries` (free text) — instead of in
// the structured `startingProficiencies` of the base class — get
// captured here so they actually count when the rules engine asks
// "is this weapon proficient?".
//
// Adding a new grant = adding a row. No JS path changes elsewhere.
//
// Each entry:
//   feature   — name as it appears in 5etools data (matched
//                case-insensitively against gatherCharacterFeatures()).
//   weapons   — proficiency tokens to add to computed.proficiencies.weapons.
//                Accepted shapes: "simple", "martial", or a specific name.
//   armor     — same, for armor proficiencies. "light"/"medium"/"heavy"/"shield".

export const FEATURE_PROFICIENCY_GRANTS = [
  {
    feature: 'Hex Warrior',
    weapons: ['martial'],
    armor:   ['medium', 'shield'],
  },
  {
    feature: 'Battle Ready',
    // Battle Smith doesn't add weapon proficiencies — it just lets you
    // use INT for attacks. Keep the entry for documentation symmetry
    // even though the arrays are empty.
    weapons: [],
    armor:   [],
  },
  {
    feature: 'Path of the Kensei',
    // Kensei "Kensei Weapons" are chosen from your existing proficiencies
    // — no new grants. Bonus die etc. live in dedicated features.
    weapons: [],
    armor:   [],
  },
  {
    feature: 'Training in War and Song',
    // Bladesinger (Wizard): gain proficiency with light armor, one
    // melee weapon of choice, and Performance.
    weapons: [],  // the chosen weapon is captured in the level-up flow
    armor:   ['light'],
  },
  // Common Eldritch Invocations and other commonly-missed grants can go
  // here. Add lines as players run into "wait, I should be proficient with
  // X but the sheet says I'm not".
]
