// scripts/wh40k-import/canonicalize.mjs
//
// Source-name canonicalization layer. BSData and Wahapedia disagree on
// faction spellings, keyword punctuation, and weapon naming. To keep
// stable IDs across imports, every source-name passes through this layer
// BEFORE the id generator sees it.
//
// Rules are explicit and curated — automatic fuzzy matching is too risky
// for identifiers that user data (favorites/inventory) is keyed by.
//
// Adding a rule:
//   1. Find the divergence (the audit's `duplicate-unit-name` warning is
//      usually the smoking gun).
//   2. Decide on the canonical spelling. Prefer GW's printed wording.
//   3. Add an entry mapping the alternate spelling(s) → canonical name
//      under the right table below.
//   4. If the canonical form changed *from a previous import*, also add
//      the old slug → new slug to ALIAS_IDS so old saved data resolves.

/* ─────────────────── faction names ─────────────────── */
//
// Map of (lowercase, spaces-collapsed) source name → canonical name.

const FACTION_NAME_ALIASES = {
  'imperial guard': 'Astra Militarum',
  'astra militarum (imperial guard)': 'Astra Militarum',
  'tau': "T'au Empire",
  "t'au": "T'au Empire",
  'tau empire': "T'au Empire",
  'eldar': 'Aeldari',
  'craftworlds': 'Aeldari',
  'dark eldar': 'Drukhari',
  'space marine': 'Space Marines',
  'adeptus astartes': 'Space Marines',
  'csm': 'Chaos Space Marines',
  'chaos marines': 'Chaos Space Marines',
  'sisters of battle': 'Adepta Sororitas',
  'adeptus mechanicus (skitarii)': 'Adeptus Mechanicus',
  'admech': 'Adeptus Mechanicus',
  'votann': 'Leagues of Votann',
  'kin': 'Leagues of Votann',
};

export function canonicalFactionName(input) {
  if (!input) return input;
  const key = String(input).toLowerCase().replace(/\s+/g, ' ').trim();
  return FACTION_NAME_ALIASES[key] || input;
}

/* ─────────────────── keyword canonicalisation ─────────────────── */
//
// Keywords come in two flavours of inconsistency:
//   - case ("Infantry" vs "INFANTRY")
//   - punctuation ("T'au Empire" vs "T'AU EMPIRE" vs "TAU EMPIRE")
//
// We normalise to UPPERCASE with apostrophes stripped (matches in-game
// rules text typography). The mapping below also collapses a handful of
// legacy or source-specific keyword aliases.

const KEYWORD_ALIASES = {
  'IMPERIAL GUARD': 'ASTRA MILITARUM',
  'TAU EMPIRE': "T'AU EMPIRE",
  'TAU': "T'AU EMPIRE",
  'ELDAR': 'AELDARI',
  'CRAFTWORLDS': 'AELDARI',
  'DARK ELDAR': 'DRUKHARI',
  'DAEMON': 'DAEMONS',
};

export function canonicalKeyword(input) {
  if (!input) return input;
  let k = String(input).toUpperCase().replace(/['’`´‘"]/g, '');
  // We strip the apostrophe consistently and re-insert canonically below.
  if (k === 'TAU EMPIRE') k = "T'AU EMPIRE";
  if (k === 'TAU')        k = "T'AU EMPIRE";
  k = k.replace(/\s+/g, ' ').trim();
  return KEYWORD_ALIASES[k] || k;
}

/* ─────────────────── weapon-name normalisation ─────────────────── */
//
// Weapons are the messiest because:
//   - one source may have "Bolt Pistol" and the other "Bolt pistol"
//   - some sources include the loadout option, e.g. "Astartes
//     chainsword (close combat weapon)"
//   - Wahapedia often suffixes profiles with "[melee]" / "[shooting]"
//
// We never *rename* a weapon — that would change stable IDs across
// imports. We *trim* the trailing tag noise and let the merge layer
// reconcile case-only differences.

const WEAPON_NAME_TAG_STRIP = [
  /\s*\[melee\]\s*$/i,
  /\s*\[shooting\]\s*$/i,
  /\s*\(close combat weapon\)\s*$/i,
];

export function canonicalWeaponName(input) {
  if (!input) return input;
  let s = String(input).trim();
  for (const re of WEAPON_NAME_TAG_STRIP) s = s.replace(re, '');
  return s.replace(/\s+/g, ' ').trim();
}

/* ─────────────────── id aliases (migration table) ─────────────────── */
//
// When the canonical form of a name changes between versions, the OLD
// generated id needs to keep resolving for user data. This table is
// written into the dataset's `aliases.json` so the runtime
// (`useWh40kData.resolveId`) translates legacy IDs transparently.
//
// Format: { legacyId: canonicalId }

export const ALIAS_IDS = {
  // ──── pre-canonical seed (underscore IDs) → canonical (dash IDs) ────
  // The very first 40K seed used a hand-rolled ID format (`sm_captain`,
  // `space_marines`). The current canonical IDs are slugged. These
  // aliases let users who favorited a unit pre-migration keep that
  // favorite working.
  'sm_captain':         'unit-space-marines--captain',
  'sm_intercessors':    'unit-space-marines--intercessor-squad',
  'sm_terminators':     'unit-space-marines--terminator-squad',
  'sm_redemptor':       'unit-space-marines--redemptor-dreadnought',
  'cust_custodian_guard': 'unit-adeptus-custodes--custodian-guard',
  'cust_shield_captain':  'unit-adeptus-custodes--shield-captain',
  'am_guardsmen':         'unit-astra-militarum--cadian-shock-troops',
  'am_leman_russ':        'unit-astra-militarum--leman-russ-battle-tank',
  'csm_legionaries':      'unit-chaos-space-marines--legionaries',
  'csm_chaos_lord':       'unit-chaos-space-marines--chaos-lord',
  'dg_plague_marines':    'unit-death-guard--plague-marines',
  'necron_warriors':      'unit-necrons--necron-warriors',
  'necron_overlord':      'unit-necrons--overlord',
  'necron_doomstalker':   'unit-necrons--canoptek-doomstalker',
  'tyr_termagants':       'unit-tyranids--termagants',
  'tyr_carnifex':         'unit-tyranids--carnifex',
  'ael_guardian_defenders': 'unit-aeldari--guardian-defenders',
  'ael_farseer':            'unit-aeldari--farseer',
  'ork_boyz':               'unit-orks--boyz',
  'ork_warboss':            'unit-orks--warboss',
  'tau_fire_warriors':      "unit-tau-empire--strike-team",
  'tau_crisis_battlesuits': "unit-tau-empire--crisis-battlesuits",

  // Old underscore faction IDs (used in seed v0)
  'space_marines':       'space-marines',
  'adeptus_custodes':    'adeptus-custodes',
  'astra_militarum':     'astra-militarum',
  'chaos_space_marines': 'chaos-space-marines',
  'death_guard':         'death-guard',
  'necrons':             'necrons',
  'tyranids':            'tyranids',
  'aeldari':             'aeldari',
  'orks':                'orks',
  'tau_empire':          "tau-empire",
};
