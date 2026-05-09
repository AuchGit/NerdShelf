// scripts/wh40k-import/schema.d.ts
//
// Canonical Warhammer 40K data model — the SINGLE source of truth for the
// app runtime. Pipeline scripts (parsers, normalizers, validators) and
// runtime hooks (useWh40kData, future army-validation, exports) all key
// off these types.
//
// The .d.ts form makes types available in any .js file via JSDoc imports
// without requiring a tsc step in the existing JS toolchain:
//
//   /** @typedef {import('../../scripts/wh40k-import/schema').Unit} Unit */
//
// Compatibility contract:
//   - SCHEMA_VERSION (in config.mjs) tracks breaking changes to these types.
//   - New OPTIONAL fields can be added without bumping SCHEMA_VERSION.
//   - Renaming a field, changing its type, or adding a required field
//     requires a SCHEMA_VERSION bump and a migration plan in aliases.json.
//   - Stable IDs (FactionId, UnitId, …) are documented to be deterministic
//     functions of canonical names; see ids.mjs.

/* ───────────────────────── IDs ───────────────────────── */
//
// Branded string aliases — purely documentation; at runtime these are
// plain strings. The brand prevents accidentally passing a UnitId where a
// FactionId is expected when callers opt into TS strict-mode IDE checks.

export type FactionId      = string & { readonly __brand: 'FactionId' };
export type DetachmentId   = string & { readonly __brand: 'DetachmentId' };
export type UnitId         = string & { readonly __brand: 'UnitId' };
export type ModelProfileId = string & { readonly __brand: 'ModelProfileId' };
export type WeaponProfileId= string & { readonly __brand: 'WeaponProfileId' };
export type AbilityId      = string & { readonly __brand: 'AbilityId' };
export type KeywordId      = string & { readonly __brand: 'KeywordId' };
export type StratagemId    = string & { readonly __brand: 'StratagemId' };
export type EnhancementId  = string & { readonly __brand: 'EnhancementId' };
export type ArmyRuleId     = string & { readonly __brand: 'ArmyRuleId' };
export type CompositionId  = string & { readonly __brand: 'CompositionId' };
export type WargearOptionId= string & { readonly __brand: 'WargearOptionId' };

/* ─────────────────── enumerated values ─────────────────── */

/** 10th Edition battlefield roles. */
export type Role =
  | 'character'      // CHARACTER keyword
  | 'epic-hero'      // EPIC HERO subset of CHARACTER
  | 'battleline'     // BATTLELINE keyword (objective bonus)
  | 'infantry'       // catch-all for INFANTRY without battleline/character
  | 'mounted'        // MOUNTED
  | 'vehicle'        // VEHICLE
  | 'walker'         // VEHICLE + WALKER
  | 'monster'        // MONSTER
  | 'beast'          // BEAST
  | 'fortification'  // FORTIFICATION
  | 'transport'      // DEDICATED TRANSPORT
  | 'aircraft'       // AIRCRAFT
  | 'titanic';       // TITANIC

export type Alignment = 'imperium' | 'chaos' | 'xenos' | 'unaligned';

export type AbilityScope =
  | 'core'        // game-wide (Deep Strike, Stealth, …)
  | 'faction'     // army rule (Oath of Moment, Reanimation Protocols, …)
  | 'detachment'  // detachment-specific
  | 'unit'        // datasheet-bound
  | 'wargear'     // weapon ability or item-bound
  | 'enhancement' // granted by an enhancement
  | 'damaged';    // triggered when wounded below threshold

export type StratagemKind =
  | 'battle-tactic'
  | 'wargear'
  | 'epic-deed'
  | 'strategic-ploy'
  | 'requisition';

export type WeaponKind = 'ranged' | 'melee';

export type KeywordKind =
  | 'general'      // INFANTRY, VEHICLE, CHARACTER, …
  | 'role'         // BATTLELINE, EPIC HERO
  | 'faction'      // ADEPTUS ASTARTES, NECRONS, …
  | 'subfaction'   // ULTRAMARINES, CADIA, …
  | 'unit-type'    // TERMINATOR, BIKER, …
  | 'army-of-renown';

/* ─────────────────────── entities ─────────────────────── */

export interface Faction {
  id: FactionId;
  name: string;
  shortName: string;
  alignment: Alignment;
  /** UI hint; not authoritative — comes from a hand-curated palette. */
  color?: string;
  /** UI hint; single-glyph icon used in lists. */
  icon?: string;
  /** Top-level army-wide rules (e.g. Oath of Moment). */
  armyRuleIds: ArmyRuleId[];
  /** Faction keywords every datasheet of this faction has. */
  factionKeywords: string[];
  /** Source attribution per field for trace/debug. */
  source?: SourceAttribution;
}

export interface Detachment {
  id: DetachmentId;
  factionId: FactionId;
  name: string;
  /** Free-form lore/intent text. */
  description?: string;
  /** Detachment-specific abilities/rules. */
  abilityIds: AbilityId[];
  stratagemIds: StratagemId[];
  enhancementIds: EnhancementId[];
  source?: SourceAttribution;
}

export interface PointEntry {
  /** Number of models the cost applies to (1, 5, 10, …). */
  models: number;
  /** Cost in points. */
  cost: number;
}

export interface Unit {
  id: UnitId;
  factionId: FactionId;
  name: string;
  role: Role;
  /** Canonical keyword strings (uppercase). */
  keywords: string[];
  /** Subset of `keywords` that are faction keywords. */
  factionKeywords: string[];
  /** Multiple cost rows handle '5/10' or 'unit / leader' style entries. */
  points: PointEntry[];
  modelProfileIds: ModelProfileId[];
  weaponProfileIds: WeaponProfileId[];
  abilityIds: AbilityId[];
  compositionId: CompositionId;
  wargearOptionIds: WargearOptionId[];
  /** Capacity for transports; absent if non-transport. */
  transportCapacity?: number;
  /** Profiles when this unit is below half wounds (vehicles/monsters). */
  damagedProfileIds?: ModelProfileId[];
  /** Datasheet IDs this unit may attach to (Leader). */
  canLead?: UnitId[];
  /** Datasheet IDs that may attach TO this unit (Bodyguard). */
  canBeLedBy?: UnitId[];
  /** Notes worth surfacing in UI but not fitting another field. */
  notes?: string;
  source?: SourceAttribution;
}

export interface ModelProfile {
  id: ModelProfileId;
  unitId: UnitId;
  /** "Captain", "Veteran Sergeant", … */
  name: string;
  /** Display strings preserved verbatim — '6"', '2+', 'd6', etc. */
  m: string;
  t: string;
  sv: string;
  w: string;
  ld: string;
  oc: string;
  /** Optional invulnerable save; '-' or null if absent. */
  invSv?: string | null;
  /** Stat-line for damaged state. */
  damagedThreshold?: number;
  source?: SourceAttribution;
}

export interface WeaponProfile {
  id: WeaponProfileId;
  /** Owning unit; if null the weapon is shared (rare in 10e). */
  unitId: UnitId | null;
  name: string;
  kind: WeaponKind;
  range: string;     // 'Melee' or '24"'
  attacks: string;   // '1', 'd6', 'd6+1'
  bs?: string;       // ranged
  ws?: string;       // melee
  strength: string;
  ap: string;
  damage: string;
  /** Weapon abilities: ASSAULT, HEAVY, TWIN-LINKED, DEVASTATING WOUNDS, … */
  abilities: string[];
  /** Free-form note that didn't fit a keyword (e.g. 'one-shot'). */
  note?: string;
  source?: SourceAttribution;
}

export interface Ability {
  id: AbilityId;
  name: string;
  text: string;
  scope: AbilityScope;
  factionId?: FactionId;
  detachmentId?: DetachmentId;
  unitId?: UnitId;
  /** When scope==='damaged', optional half-wounds threshold context. */
  damagedThreshold?: number;
  source?: SourceAttribution;
}

export interface Keyword {
  id: KeywordId;
  /** Canonical uppercase form for matching. */
  name: string;
  kind: KeywordKind;
  /** When kind==='faction' / 'subfaction', the owning faction. */
  factionId?: FactionId;
  source?: SourceAttribution;
}

export interface Stratagem {
  id: StratagemId;
  detachmentId: DetachmentId;
  factionId: FactionId;
  name: string;
  cpCost: number;
  kind: StratagemKind;
  /** "Your Command phase", "Your opponent's Charge phase", … */
  phase?: string;
  /** "When …" precondition for use. */
  whenText?: string;
  /** Eligible target description. */
  target?: string;
  effect: string;
  /** Restrictions and once-per-turn-style notes. */
  restriction?: string;
  source?: SourceAttribution;
}

export interface Enhancement {
  id: EnhancementId;
  detachmentId: DetachmentId;
  factionId: FactionId;
  name: string;
  /** Cost in points. */
  cost: number;
  text: string;
  /** Restrictions: 'character only', 'INFANTRY only', … */
  restriction?: string;
  source?: SourceAttribution;
}

export interface UnitComposition {
  id: CompositionId;
  unitId: UnitId;
  /** Free-form composition text, verbatim from datasheet. */
  text: string;
  /** Min/max model counts where parseable; null if not extractable. */
  minModels?: number | null;
  maxModels?: number | null;
  /** Required model profiles by name + count, e.g. [{name:'Sergeant',count:1}]. */
  requires?: { profileName: string; count: number }[];
}

export interface WargearOption {
  id: WargearOptionId;
  unitId: UnitId;
  /** Verbatim option text from the datasheet. */
  text: string;
  /** Structured form when extractable; null otherwise. */
  structured?: {
    perModelLimit?: number;
    swap?: { from: string; to: string }[];
    add?: string[];
    remove?: string[];
  } | null;
}

export interface ArmyRule {
  id: ArmyRuleId;
  factionId: FactionId;
  name: string;
  text: string;
  source?: SourceAttribution;
}

/* ─────────────────── meta / tracking ─────────────────── */

export interface SourceAttribution {
  /** Source the entity primarily came from. */
  primary: 'bsdata' | 'wahapedia' | 'seed' | 'manual';
  /** Other sources that contributed fields (used by merge layer). */
  contributors?: ('bsdata' | 'wahapedia' | 'seed' | 'manual')[];
  /** Source-specific identifier(s) for round-trip / debugging. */
  sourceIds?: { bsdata?: string; wahapedia?: string };
}

/** Maps legacy IDs to the current canonical ID — survives schema migrations. */
export interface AliasMap {
  /** id used in older datasets / saved user data → current canonical id. */
  [legacyId: string]: string;
}

/** Top-level dataset shape (one per version). */
export interface Dataset {
  schemaVersion: number;
  edition: string;        // '10e'
  version: string;        // 'v1'
  generatedAt: string;    // ISO timestamp
  factions: Faction[];
  detachments: Detachment[];
  units: Unit[];
  modelProfiles: ModelProfile[];
  weaponProfiles: WeaponProfile[];
  abilities: Ability[];
  keywords: Keyword[];
  stratagems: Stratagem[];
  enhancements: Enhancement[];
  armyRules: ArmyRule[];
  unitCompositions: UnitComposition[];
  wargearOptions: WargearOption[];
  aliases: AliasMap;
}

/** Version manifest — one of these per /<edition>/<version>/manifest.json. */
export interface VersionManifest {
  schemaVersion: number;
  edition: string;
  version: string;
  generatedAt: string;
  /** Counts per entity for a fast sanity glance from the runtime. */
  counts: Record<string, number>;
  /** Source provenance — which sources fed this dataset. */
  sources: { bsdata?: { commit?: string }; wahapedia?: { fetchedAt?: string } };
  /** SHA-256 of each emitted file, for integrity checks. */
  fileHashes: Record<string, string>;
}

/** Top-level pointer at /public/data/wh40k/index.json. */
export interface RootIndex {
  /** Latest published version the runtime should load by default. */
  current: { edition: string; version: string };
  /** All available versions, newest first. */
  versions: { edition: string; version: string; generatedAt: string }[];
}
