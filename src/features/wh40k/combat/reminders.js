// src/features/wh40k/combat/reminders.js
//
// Reminder engine — pure, data-driven, deliberately small.
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
// What lives here vs. what lives in coreRules.js:
//   • coreRules.js holds the *rule reference* — what you do this phase,
//     the rulebook walk-through. It's always present once the phase is
//     active, and it's where the player goes for "how does X work?".
//   • reminders here are *conditional nudges* — they only appear when
//     the session state warrants them. "You have a unit under half
//     strength, expect a Battle-shock test", "You haven't gained your
//     CP yet", etc. The trigger is the value, not the text.
//
// Anything that's just a duplicated paragraph from the rulebook (e.g.
// "remember to declare charges, roll 2D6, ≥ distance, …") does NOT
// belong here — it's noise next to the actual phase guide and clutters
// every alive unit's card. The Combat HUD already shows the phase
// flow in coreRules.charge with proper companion-style cards.

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
    title: 'Kommandopunkt einsammeln',
    detail: 'Zu Beginn deiner Command Phase: +1 CP (max. 15). Im allerersten Player-Turn der Schlacht entfällt das.',
    when: (ctx) => ctx.phase === 'command' && !ctx.onceFlag(`cp-gained-r${ctx.round}`),
  },
  {
    id: 'battle-shock-due',
    phase: 'command',
    scope: 'global',
    severity: 'warning',
    title: 'Battle-shock-Tests fällig',
    detail: 'Mindestens eine deiner Einheiten ist unter halber Stärke. Test pro betroffener Einheit: 2W6 + Ld vs. Threshold. Bei Fehlschlag: OC 0, keine Stratagems.',
    when: (ctx) => ctx.phase === 'command'
      && ctx.aliveUnits.some(u => u.currentModels > 0 && u.currentModels < (u.startingModels / 2)),
  },
  {
    id: 'leader-not-attached',
    phase: 'command',
    scope: 'unit',
    severity: 'warning',
    title: 'Anführer noch nicht zugewiesen',
    detail: 'Diese Character-Einheit ist nicht an eine Bodyguard-Einheit attached. Vor der ersten Bewegung deklarieren — bewahrt vor Verlust durch sniping.',
    when: (ctx, unit) =>
      Array.isArray(unit.keywords) && unit.keywords.includes('CHARACTER')
      && !unit.attached
      && unit.status === 'alive'
      && ctx.round === 1
      && ctx.phase === 'command',
  },
  {
    id: 'unit-below-half',
    phase: '*',
    scope: 'unit',
    severity: 'warning',
    title: 'Unter halber Stärke',
    detail: 'Diese Einheit ist unter ihrer Starting Strength halbiert. Kommende Command Phase: Battle-shock-Test. Bei Fehlschlag: OC 0 + keine Stratagems.',
    when: (ctx, unit) =>
      unit.status === 'alive'
      && unit.currentModels > 0
      && unit.startingModels > 1
      && unit.currentModels < (unit.startingModels / 2),
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
