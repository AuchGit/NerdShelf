// src/features/wh40k/combat/schema.js
//
// Combat Helper — domain model.
//
// The Combat Helper is a *gameplay companion*, not a rules engine. It
// tracks state that's easy to forget mid-game (CP, once-per-battle uses,
// phase reminders, destroyed units, scoring) and surfaces phase-specific
// nudges. Everything below is data; the reminder engine and React hooks
// operate over these shapes only.
//
// ───────────────────────────── entities ─────────────────────────────
//
//   CombatSession
//     { id, name, armyId, opponent?, scenario?, createdAt, updatedAt,
//       currentRound, currentTurn, currentPhase,
//       cp, vp, opponentVp,
//       units:           Record<UnitInstanceId, CombatUnitState>,
//       roundLog:        CombatRound[],
//       stratagemUsage:  Record<StratagemId, { used: boolean, lastRound?: number, totalUses: number }>,
//       onceFlags:       Record<string, boolean>,   // arbitrary once-per-* booleans
//       notes:           string,
//       savedAt:         ISO string                  // last persistence flush
//     }
//
//   CombatUnitState
//     { instanceId,         // local id (unitId + occurrence)
//       unitId,             // canonical 40K unit id
//       name,               // display name (denormalised for offline view)
//       status,             // 'alive'|'engaged'|'fled'|'destroyed'
//       startingModels, currentModels,
//       wounds,             // current wound count on the lead model (0 = full)
//       stratActive,        // stratagems currently affecting this unit
//       attached,           // optional: instanceId of leader/bodyguard pair
//       tags:               // free-form session tags (string[])
//       reminders:          // ids of reminders explicitly dismissed for this unit
//       notes:              // free-form text
//     }
//
//   CombatRound
//     { round, turn, phases: Record<PhaseId, CombatPhaseLog> }
//
//   CombatPhaseLog
//     { phase, completed, durationSec?, notes, events: CombatEvent[] }
//
//   CombatEvent — a free-form record of something the user noted in a phase:
//     { id, kind, text, at: ISO, unitInstanceId?, stratagemId? }
//
// Persistence is local-only (Supabase optional later): the helper saves
// sessions to localStorage with a normalised schema version so migrations
// stay tractable.

export const COMBAT_SCHEMA_VERSION = 1;

/** Canonical phase order for a 10e player turn. */
export const PHASES = [
  { id: 'command',  label: 'Command Phase',   short: 'Command' },
  { id: 'movement', label: 'Movement Phase',  short: 'Movement' },
  { id: 'shooting', label: 'Shooting Phase',  short: 'Shooting' },
  { id: 'charge',   label: 'Charge Phase',    short: 'Charge' },
  { id: 'fight',    label: 'Fight Phase',     short: 'Fight' },
  { id: 'end',      label: 'End Phase',       short: 'End' },
];

export const PHASE_IDS = PHASES.map(p => p.id);

export const UNIT_STATUSES = [
  { id: 'alive',     label: 'Aktiv',      color: 'var(--color-success)' },
  { id: 'engaged',   label: 'Im Gefecht', color: 'var(--color-warning)' },
  { id: 'fled',      label: 'Geflohen',   color: 'var(--color-text-muted)' },
  { id: 'destroyed', label: 'Zerstört',   color: 'var(--color-danger)' },
];

export function nextPhase(phaseId) {
  const i = PHASE_IDS.indexOf(phaseId);
  if (i < 0 || i === PHASE_IDS.length - 1) return null;
  return PHASE_IDS[i + 1];
}
export function prevPhase(phaseId) {
  const i = PHASE_IDS.indexOf(phaseId);
  if (i <= 0) return null;
  return PHASE_IDS[i - 1];
}

/* ─────────────────── factory helpers ─────────────────── */

let _id = 0;
function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${(_id++).toString(36)}`;
}

/**
 * Build an empty session, derived from an army. We snapshot the army
 * roster into per-unit state so editing the army afterwards doesn't
 * silently mutate an in-progress game.
 */
export function createSession({ army, unitsById, name }) {
  const session = {
    schemaVersion: COMBAT_SCHEMA_VERSION,
    id: uid('cs'),
    name: name || army?.name || 'Unbenannte Schlacht',
    armyId: army?.id || null,
    armyName: army?.name || null,
    factionId: army?.faction || army?.factionId || null,
    detachmentId: army?.detachment || army?.detachmentId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentRound: 1,
    currentTurn: 'player',          // 'player' | 'opponent'
    currentPhase: 'command',
    cp: 1,                          // starting CP per 10e core rules
    vp: 0,
    opponentVp: 0,
    units: {},
    roundLog: [emptyRound(1)],
    stratagemUsage: {},
    onceFlags: {},
    notes: '',
    savedAt: null,
  };

  const entries = Object.values(army?.data?.entries || army?.entries || {});
  for (const e of entries) {
    const u = unitsById[e.unitId];
    if (!u) continue;
    for (let i = 0; i < (e.count || 1); i++) {
      const inst = uid('u');
      session.units[inst] = {
        instanceId: inst,
        unitId: u.id,
        name: u.name,
        role: u.role,
        keywords: u.keywords || [],
        status: 'alive',
        startingModels: (u.modelCounts && u.modelCounts[0]) || 1,
        currentModels: (u.modelCounts && u.modelCounts[0]) || 1,
        wounds: 0,
        stratActive: [],
        attached: null,
        tags: [],
        reminders: [],
        notes: '',
      };
    }
  }
  return session;
}

export function emptyRound(round) {
  return {
    round,
    turn: 'player',
    phases: Object.fromEntries(PHASE_IDS.map(p => [p, {
      phase: p, completed: false, notes: '', events: [],
    }])),
  };
}

export function makeEvent(kind, text, extra = {}) {
  return {
    id: uid('ev'),
    kind, text,
    at: new Date().toISOString(),
    ...extra,
  };
}
