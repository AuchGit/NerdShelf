// src/features/wh40k/combat/missions.js
//
// 10e mission presets used by the Combat Helper's setup flow.
//
// Coverage scope:
//   - Game sizes (Combat Patrol / Incursion / Strike Force / Onslaught)
//     with their canonical point ceilings.
//   - Primary mission objectives from the Leviathan deck (the most
//     widely played pool). Each carries the per-end-of-turn / per-end-
//     of-battle scoring guidance the Combat Helper surfaces during play.
//   - Secondary missions (both Fixed and Tactical pools) with their
//     end-state scoring guidance.
//
// Design notes:
//   - Data only. No UI, no calculation — the components consume these
//     presets and render whatever's needed.
//   - IDs are stable slugs so a saved session keeps resolving to the
//     correct preset when the mission set is updated.
//   - The list is curated rather than scraped: GW's mission decks are
//     compact (~12 primaries, ~12 secondaries) and update on dataslate
//     cadence, not in real time.

export const GAME_SIZES = [
  { id: 'combat-patrol', label: 'Combat Patrol', points: 500 },
  { id: 'incursion',     label: 'Incursion',     points: 1000 },
  { id: 'strike-force',  label: 'Strike Force',  points: 2000 },
  { id: 'onslaught',     label: 'Onslaught',     points: 3000 },
];

export const MISSION_DECKS = [
  { id: 'leviathan',         label: 'Leviathan' },
  { id: 'tempest-of-war',    label: 'Tempest of War' },
  { id: 'pariah-nexus',      label: 'Pariah Nexus' },
  { id: 'crusade',           label: 'Crusade' },
  { id: 'custom',            label: 'Eigene / Hausregel' },
];

export const DEPLOYMENT_MAPS = [
  { id: 'dawn-of-war',    label: 'Dawn of War' },
  { id: 'hammer-and-anvil', label: 'Hammer and Anvil' },
  { id: 'search-and-destroy', label: 'Search and Destroy' },
  { id: 'sweeping-engagement', label: 'Sweeping Engagement' },
  { id: 'tipping-point',  label: 'Tipping Point' },
  { id: 'crucible-of-battle', label: 'Crucible of Battle' },
];

/* ─────────────────── primary missions (Leviathan) ─────────────────── */

/**
 * @typedef {object} PrimaryMission
 * @property {string} id
 * @property {string} name
 * @property {string} deck           Which mission deck it belongs to.
 * @property {string} summary        Short one-line summary for cards.
 * @property {string} scoring        Per-end-of-turn / end-of-battle text.
 * @property {number} maxScore       Standard primary cap (usually 50).
 */

export const PRIMARY_MISSIONS = [
  { id: 'take-and-hold',    name: 'Take and Hold',    deck: 'leviathan',
    summary: '4 fixe Objectives. Mehr halten als Gegner.',
    scoring: 'Am Ende deiner Command Phase ab Runde 2: 5 VP wenn du 1 hältst, 10 wenn 2, 15 wenn 3+.',
    maxScore: 50 },
  { id: 'scorched-earth',   name: 'Scorched Earth',   deck: 'leviathan',
    summary: '4 Objectives. Halten oder Verbrennen für Punkte.',
    scoring: 'Hold 1 = 5 / 2 = 10 / 3+ = 15. Burn ab Runde 3 für je 5 VP (max. 2 pro Spiel).',
    maxScore: 50 },
  { id: 'the-ritual',       name: 'The Ritual',       deck: 'leviathan',
    summary: 'Mittiges + 4 Objectives, das mittige zählt doppelt.',
    scoring: 'Hold 1 = 5 / 2 = 10 / 3+ = 15. Mittiges objective = +5 VP wenn gehalten.',
    maxScore: 50 },
  { id: 'priority-targets', name: 'Priority Targets', deck: 'leviathan',
    summary: 'Rundenabhängig wechselnde Quadranten.',
    scoring: 'Pro Runde 1 oder 2 Quadranten gewertet. Bis zu 15 VP/Runde.',
    maxScore: 50 },
  { id: 'purge-the-foe',    name: 'Purge the Foe',    deck: 'leviathan',
    summary: 'Töten, halten, beides.',
    scoring: 'Hold 1 = 5 / 2+ = 10. Pro zerstörter Einheit ab R2: 1 VP (max. 5/Runde).',
    maxScore: 50 },
  { id: 'deploy-teleport-homers', name: 'Deploy Teleport Homers', deck: 'leviathan',
    summary: 'Marker auf Objectives platzieren.',
    scoring: 'Hold 1 = 5 / 2 = 10 / 3+ = 15. +5 wenn dieses Turn ein Homer gesetzt wurde.',
    maxScore: 50 },
  { id: 'supply-drop',      name: 'Supply Drop',      deck: 'leviathan',
    summary: 'Marker wandert über das Feld.',
    scoring: 'Hold ab R2. Marker bringt 5 VP extra.',
    maxScore: 50 },
];

/* ─────────────────── secondaries ─────────────────── */
//
// Two kinds (10e Leviathan):
//   - Fixed:    The same two secondaries every game.
//   - Tactical: Drawn each turn from the deck.
// We expose both; the UI lets the user pick the mode.

/**
 * @typedef {object} Secondary
 * @property {string} id
 * @property {string} name
 * @property {'fixed'|'tactical'} kind
 * @property {string} summary
 * @property {string} scoring
 * @property {number} maxScore           Cap per game.
 */

export const SECONDARY_MISSIONS = [
  // ── Fixed ───────────────────────────────────────────────────────────
  { id: 'bring-it-down',     name: 'Bring It Down',     kind: 'fixed',
    summary: 'MONSTER / VEHICLE Einheiten zerstören.',
    scoring: '2 VP pro vernichtetem MONSTER/VEHICLE, +2 wenn W ≥ 10.',
    maxScore: 15 },
  { id: 'assassinate',       name: 'Assassinate',       kind: 'fixed',
    summary: 'Feindliche CHARACTERS töten.',
    scoring: '3 VP pro zerstörter Charakter-Einheit.',
    maxScore: 15 },
  { id: 'no-prisoners',      name: 'No Prisoners',      kind: 'fixed',
    summary: 'Insgesamt 30+ feindliche Modelle ausschalten.',
    scoring: 'End of game: ≥30 = 8 VP, ≥50 = 12 VP, ≥80 = 15 VP.',
    maxScore: 15 },
  { id: 'cull-the-horde',    name: 'Cull the Horde',    kind: 'fixed',
    summary: 'Massen-Tötung.',
    scoring: '1 VP / Einheit (≥10 Modelle ursprünglich) zerstören.',
    maxScore: 15 },
  // ── Tactical ────────────────────────────────────────────────────────
  { id: 'engage-on-all-fronts', name: 'Engage on All Fronts', kind: 'tactical',
    summary: 'In jeder Tischhälfte präsent sein.',
    scoring: 'End of turn: 2/3 Quadranten = 2 VP, 4 = 5 VP.',
    maxScore: 15 },
  { id: 'behind-enemy-lines',   name: 'Behind Enemy Lines',   kind: 'tactical',
    summary: 'In der gegnerischen Deployment Zone halten.',
    scoring: '1 Einheit = 2 VP, ≥2 Einheiten = 5 VP.',
    maxScore: 15 },
  { id: 'storm-hostile-objective', name: 'Storm Hostile Objective', kind: 'tactical',
    summary: 'Gegner-Objektiv erobern (nicht eigenes).',
    scoring: 'Pro gehaltenem gegnerischem objective ab R2: 3 VP.',
    maxScore: 15 },
  { id: 'a-tempting-target', name: 'A Tempting Target', kind: 'tactical',
    summary: 'Einheit auf zentrales objective bringen.',
    scoring: 'Während deiner Command Phase: 5 VP wenn eine Einheit hält.',
    maxScore: 15 },
  { id: 'overwhelming-force', name: 'Overwhelming Force', kind: 'tactical',
    summary: 'Feindliche Einheit auf objective zerstören.',
    scoring: '3 VP pro feindl. Einheit zerstört, die ein objective hielt.',
    maxScore: 15 },
  { id: 'cleanse',           name: 'Cleanse',           kind: 'tactical',
    summary: 'Quadranten purgieren.',
    scoring: 'End of turn: 2 VP pro Quadrant, in dem nur eigene Einheiten sind, ≥2 hat.',
    maxScore: 15 },
  { id: 'defend-stronghold', name: 'Defend Stronghold', kind: 'tactical',
    summary: 'Eigene Deployment-Zone halten.',
    scoring: 'End of turn: ≥1 Einheit komplett in eigener Zone = 4 VP.',
    maxScore: 15 },
];

/* ─────────────────── helpers ─────────────────── */

export function gameSizeById(id) { return GAME_SIZES.find(g => g.id === id); }
export function missionDeckById(id) { return MISSION_DECKS.find(m => m.id === id); }
export function deploymentById(id) { return DEPLOYMENT_MAPS.find(d => d.id === id); }
export function primaryById(id)   { return PRIMARY_MISSIONS.find(p => p.id === id); }
export function secondaryById(id) { return SECONDARY_MISSIONS.find(s => s.id === id); }

/** Default mission state used when creating a session without a setup pass. */
export function defaultMissionState() {
  return {
    gameSize: 'strike-force',
    deckId: 'leviathan',
    deployment: '',
    primaryId: '',
    secondaryMode: 'fixed',          // 'fixed' | 'tactical'
    secondaryIds: [],
    pointLimit: 2000,
    opponentName: '',
    opponentArmy: '',
  };
}
