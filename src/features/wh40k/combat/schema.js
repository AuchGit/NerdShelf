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
export function createSession({ army, unitsById, name, mission }) {
  const session = {
    schemaVersion: COMBAT_SCHEMA_VERSION,
    id: uid('cs'),
    name: name || army?.name || 'Unbenannte Schlacht',
    armyId: army?.id || null,
    armyName: army?.name || null,
    armyShareToken: army?.shareToken || army?.share_token || null,
    factionId: army?.faction || army?.factionId || null,
    detachmentId: army?.detachment || army?.detachmentId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentRound: 1,
    currentTurn: 'player',          // 'player' | 'opponent'
    currentPhase: 'command',
    cp: 1,                          // starting CP per 10e core rules
    vp: 0,                           // legacy flat counter (kept for compat)
    opponentVp: 0,
    // Structured mission state (set via MissionSetup before the session
    // is created; the in-session VP panel reads/writes through this).
    mission: mission || null,
    // Per-source VP tally so the user can see at a glance how points
    // were earned (primary vs each secondary vs bonus).
    scoring: mission ? createScoringRows(mission) : { rows: [], opponentRows: [] },
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
    // Snapshot the unit's lead-model wound count so the wound tracker can
    // work without going back to the canonical data at every render.
    // Look at the first model profile to pull the "W" stat.
    const leadW = parseInt(String(u.stats?.[0]?.w || '1'), 10) || 1;
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
        // Wound tracking on the *lead* model — useful for multi-wound
        // single-model units (monsters, vehicles, characters). For
        // multi-model squads the value rolls over: when leadWounds hits
        // leadW, decrement currentModels and reset to 0. The UI handles
        // both interactions through `applyWound`.
        leadWoundsMax: leadW,
        leadWoundsCurrent: 0,
        stratActive: [],
        attached: null,
        tags: [],
        reminders: [],
        // Per-unit "once-per-battle" abilities the user has consumed
        // (free-form keys — usually the slugged ability name).
        oncePerBattleUsed: [],
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

/**
 * Build initial scoring rows from a mission setup. Each row is one VP
 * source the player can score points in (Primary + each Secondary). The
 * opponent gets a mirror set so the user can track both sides in the
 * companion. The values are user-driven — no auto-calc.
 *
 * Row shape: { id, kind:'primary'|'secondary'|'bonus', name, max, value }
 */
export function createScoringRows(mission) {
  const rows = [];
  const opponentRows = [];
  if (mission?.primary) {
    rows.push({
      id: 'primary', kind: 'primary',
      name: mission.primary.name || 'Primary',
      max: mission.primary.maxScore ?? 50,
      value: 0,
    });
    opponentRows.push({
      id: 'primary', kind: 'primary',
      name: mission.primary.name || 'Primary',
      max: mission.primary.maxScore ?? 50,
      value: 0,
    });
  }
  for (const s of mission?.secondaries || []) {
    rows.push({
      id: `secondary-${s.id}`, kind: 'secondary',
      name: s.name, max: s.maxScore ?? 15, value: 0,
    });
    opponentRows.push({
      id: `secondary-${s.id}`, kind: 'secondary',
      name: s.name, max: s.maxScore ?? 15, value: 0,
    });
  }
  return { rows, opponentRows };
}
