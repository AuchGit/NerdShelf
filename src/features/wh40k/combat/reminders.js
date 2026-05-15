// src/features/wh40k/combat/reminders.js
//
// Reminder engine — pure, data-driven.
//
// Each reminder is a tiny rule object:
//
//   {
//     id,                  // stable string
//     phase,               // 'command'|'movement'|...|'*' (any)
//     scope,               // 'global'|'unit'
//     severity,            // 'info'|'warning'|'critical'
//     title, detail,
//     when(ctx) -> bool    // pure: should this reminder show right now?
//   }
//
// The engine evaluates reminders against a `ReminderContext` derived from
// the current CombatSession. The UI groups them by scope (global vs
// unit-bound) and severity, lets the user dismiss them, and surfaces the
// active count next to the phase nav.
//
// The set below intentionally starts small — the foundation matters more
// than coverage at this stage. Adding a reminder is a one-line change.

import { PHASE_IDS } from './schema.js';

/** Build a context object once per render so each `when()` stays trivial. */
export function buildContext(session, hydratedUnitsById) {
  return {
    session,
    unitsById: hydratedUnitsById || {},
    phase: session.currentPhase,
    round: session.currentRound,
    turn: session.currentTurn,
    cp: session.cp,
    units: Object.values(session.units || {}),
    aliveUnits: Object.values(session.units || {}).filter(u => u.status !== 'destroyed' && u.status !== 'fled'),
    onceFlag: (key) => !!session.onceFlags?.[key],
  };
}

/* ─────────────────── built-in reminders ─────────────────── */

const REMINDERS = [
  {
    id: 'cp-gain',
    phase: 'command',
    scope: 'global',
    severity: 'info',
    title: 'Kommandopunkt erhalten?',
    detail: 'Zu Beginn deines Command Phase erhältst du normalerweise 1 CP (max. 15 CP gespeichert).',
    when: (ctx) => ctx.phase === 'command' && !ctx.onceFlag(`cp-gained-r${ctx.round}`),
  },
  {
    id: 'battle-shock',
    phase: 'command',
    scope: 'global',
    severity: 'warning',
    title: 'Battle-shock-Tests',
    detail: 'Battle-shock-Tests für Einheiten unter halber Stärke oder mit Battle-shock-Marker.',
    when: (ctx) => ctx.phase === 'command'
      && ctx.aliveUnits.some(u =>
        u.currentModels > 0 && u.currentModels < (u.startingModels / 2)
      ),
  },
  {
    id: 'leader-not-attached',
    phase: '*',
    scope: 'unit',
    severity: 'warning',
    title: 'Anführer nicht zugewiesen',
    detail: 'Diese Anführer-Einheit ist noch keiner Bodyguard-Einheit zugeordnet.',
    when: (ctx, unit) =>
      Array.isArray(unit.keywords) && unit.keywords.includes('CHARACTER')
      && !unit.attached
      && unit.status === 'alive'
      && ctx.round === 1
      && ctx.phase === 'command',
  },
  {
    id: 'shooting-eligible',
    phase: 'shooting',
    scope: 'unit',
    severity: 'info',
    title: 'Beschuss noch nicht durchgeführt',
    detail: 'Diese Einheit hat in dieser Schussphase noch nicht gefeuert.',
    when: (ctx, unit) =>
      ctx.phase === 'shooting'
      && unit.status === 'alive'
      && !unit.tags?.includes(`shot-r${ctx.round}`),
  },
  {
    id: 'charge-declared',
    phase: 'charge',
    scope: 'unit',
    severity: 'info',
    title: 'Charge möglich?',
    detail: 'Erinnerung: Charge erklären, 2W6 würfeln, ≥ Distanz, 1" Engagement.',
    when: (ctx, unit) =>
      ctx.phase === 'charge'
      && unit.status === 'alive'
      && !unit.tags?.includes(`advanced-r${ctx.round}`)
      && !unit.tags?.includes(`fellback-r${ctx.round}`),
  },
  {
    id: 'fight-eligible',
    phase: 'fight',
    scope: 'unit',
    severity: 'warning',
    title: 'Kampf in der Fight Phase',
    detail: 'Einheiten innerhalb Engagement Range können / müssen kämpfen.',
    when: (ctx, unit) =>
      ctx.phase === 'fight'
      && unit.status === 'engaged',
  },
  {
    id: 'end-objectives',
    phase: 'end',
    scope: 'global',
    severity: 'critical',
    title: 'Punkte werten',
    detail: 'Primary + Secondary Missions auswerten und VP eintragen.',
    when: (ctx) => ctx.phase === 'end',
  },
  {
    id: 'end-once-cleanup',
    phase: 'end',
    scope: 'global',
    severity: 'info',
    title: 'Auras / einmalige Effekte',
    detail: 'Auras zurücksetzen, Marker entfernen, Reactive Stratagems freigeben.',
    when: (ctx) => ctx.phase === 'end',
  },
];

/* ─────────────────── public API ─────────────────── */

export function listRemindersForPhase(ctx, { onlyPhase } = {}) {
  const phase = onlyPhase ?? ctx.phase;
  const out = [];
  for (const r of REMINDERS) {
    if (r.phase !== '*' && r.phase !== phase) continue;
    if (r.scope === 'global') {
      try { if (r.when(ctx)) out.push({ ...r, scope: 'global' }); }
      catch { /* defensive — bad reminder logic shouldn't crash UI */ }
    } else if (r.scope === 'unit') {
      for (const u of ctx.units) {
        try {
          if (r.when(ctx, u)) {
            out.push({ ...r, scope: 'unit', unitInstanceId: u.instanceId });
          }
        } catch { /* same */ }
      }
    }
  }
  // Severity ordering for stable display
  const SEV = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));
}

export function listRemindersAllPhases(ctx) {
  const result = {};
  for (const p of PHASE_IDS) result[p] = listRemindersForPhase(ctx, { onlyPhase: p });
  return result;
}

/**
 * Phase-level counts useful for the phase strip's badges. Returns a map
 * keyed by phase id with critical/warning/info counts.
 */
export function reminderCountsByPhase(ctx) {
  const all = listRemindersAllPhases(ctx);
  const out = {};
  for (const p of PHASE_IDS) {
    let critical = 0, warning = 0, info = 0;
    for (const r of all[p]) {
      if (r.severity === 'critical') critical++;
      else if (r.severity === 'warning') warning++;
      else info++;
    }
    out[p] = { critical, warning, info, total: all[p].length };
  }
  return out;
}
