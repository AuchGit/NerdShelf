// src/features/wh40k/combat/useCombatSession.js
//
// React hook holding a single CombatSession + mutators + debounced
// persistence. The hook never returns a promise — all writes are
// synchronous reducer-style updates, so the UI stays snappy and the
// debounced flush handles disk IO in the background.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  PHASE_IDS, emptyRound, makeEvent, nextPhase, prevPhase,
} from './schema.js';
import { saveSessionDebounced } from './persistence.js';

/* ─────────────────── reducer ─────────────────── */

function reducer(state, action) {
  switch (action.type) {
    case 'replace':
      return action.session;

    case 'patch':
      return { ...state, ...action.patch, updatedAt: new Date().toISOString() };

    case 'setPhase': {
      if (!PHASE_IDS.includes(action.phase)) return state;
      return { ...state, currentPhase: action.phase, updatedAt: new Date().toISOString() };
    }
    case 'nextPhase': {
      const np = nextPhase(state.currentPhase);
      if (!np) {
        // End of player turn — mark phase complete & roll into next round
        const log = updatePhaseLog(state, state.currentPhase, p => ({ ...p, completed: true }));
        const round = state.currentRound + 1;
        return {
          ...state,
          roundLog: [...log.roundLog, emptyRound(round)],
          currentRound: round,
          currentPhase: 'command',
          updatedAt: new Date().toISOString(),
        };
      }
      const log = updatePhaseLog(state, state.currentPhase, p => ({ ...p, completed: true }));
      return { ...log, currentPhase: np, updatedAt: new Date().toISOString() };
    }
    case 'prevPhase': {
      const pp = prevPhase(state.currentPhase);
      if (!pp) return state;
      return { ...state, currentPhase: pp, updatedAt: new Date().toISOString() };
    }

    case 'adjustCp':
      return {
        ...state,
        cp: Math.max(0, Math.min(15, state.cp + action.delta)),
        onceFlags: action.delta > 0 && state.currentPhase === 'command'
          ? { ...state.onceFlags, [`cp-gained-r${state.currentRound}`]: true }
          : state.onceFlags,
        updatedAt: new Date().toISOString(),
      };
    case 'setCp':
      return { ...state, cp: Math.max(0, Math.min(15, action.value)), updatedAt: new Date().toISOString() };

    case 'adjustVp':
      return { ...state, vp: Math.max(0, state.vp + action.delta), updatedAt: new Date().toISOString() };
    case 'adjustOpponentVp':
      return { ...state, opponentVp: Math.max(0, state.opponentVp + action.delta), updatedAt: new Date().toISOString() };

    case 'scoreRow': {
      // Structured VP scoring per mission source.
      //   { side: 'player'|'opponent', rowId, delta }
      const sc = state.scoring || { rows: [], opponentRows: [] };
      const key = action.side === 'opponent' ? 'opponentRows' : 'rows';
      const rows = (sc[key] || []).map(r => {
        if (r.id !== action.rowId) return r;
        const max = r.max ?? 999;
        const value = Math.max(0, Math.min(max, (r.value || 0) + action.delta));
        return { ...r, value };
      });
      const next = { ...sc, [key]: rows };
      // Roll up the flat VP totals so legacy UI surfaces stay in sync.
      const total = (next.rows || []).reduce((s, r) => s + (r.value || 0), 0);
      const totalOpp = (next.opponentRows || []).reduce((s, r) => s + (r.value || 0), 0);
      return {
        ...state,
        scoring: next,
        vp: total,
        opponentVp: totalOpp,
        updatedAt: new Date().toISOString(),
      };
    }

    case 'unitStatus': {
      const u = state.units[action.instanceId];
      if (!u) return state;
      return {
        ...state,
        units: { ...state.units, [action.instanceId]: { ...u, status: action.status } },
        updatedAt: new Date().toISOString(),
      };
    }
    case 'unitModels': {
      const u = state.units[action.instanceId];
      if (!u) return state;
      const currentModels = Math.max(0, Math.min(u.startingModels, u.currentModels + action.delta));
      const status = currentModels === 0 ? 'destroyed' : u.status;
      // Decreasing a model resets the leadModel wound counter — the
      // new lead model is fresh.
      const leadWoundsCurrent = action.delta < 0 ? 0 : u.leadWoundsCurrent;
      return {
        ...state,
        units: {
          ...state.units,
          [action.instanceId]: { ...u, currentModels, status, leadWoundsCurrent },
        },
        updatedAt: new Date().toISOString(),
      };
    }
    case 'unitWound': {
      // Apply `delta` wounds to the lead model. Negative delta heals.
      // Wound rollover: every leadWoundsMax wounds consumed → one model
      // is removed (and the wound counter resets). This lets the UI use
      // one widget for both vehicles (single huge model) and squads
      // (many low-W models) — the user just taps ±1 wound.
      const u = state.units[action.instanceId];
      if (!u) return state;
      let currentModels = u.currentModels;
      let leadWoundsCurrent = (u.leadWoundsCurrent || 0) + action.delta;
      const max = u.leadWoundsMax || 1;
      // Rollover (model destroyed)
      while (leadWoundsCurrent >= max && currentModels > 0) {
        currentModels -= 1;
        leadWoundsCurrent -= max;
      }
      // Underflow (heal past 0 → restore a model if any were lost)
      while (leadWoundsCurrent < 0 && currentModels < u.startingModels) {
        currentModels += 1;
        leadWoundsCurrent += max;
      }
      leadWoundsCurrent = Math.max(0, Math.min(max - 1, leadWoundsCurrent));
      if (currentModels <= 0) {
        currentModels = 0;
        leadWoundsCurrent = 0;
      }
      const status = currentModels === 0 ? 'destroyed' : u.status;
      return {
        ...state,
        units: {
          ...state.units,
          [action.instanceId]: { ...u, currentModels, leadWoundsCurrent, status },
        },
        updatedAt: new Date().toISOString(),
      };
    }
    case 'unitOnceFlag': {
      const u = state.units[action.instanceId];
      if (!u) return state;
      const used = new Set(u.oncePerBattleUsed || []);
      if (used.has(action.key)) used.delete(action.key);
      else used.add(action.key);
      return {
        ...state,
        units: {
          ...state.units,
          [action.instanceId]: { ...u, oncePerBattleUsed: [...used] },
        },
        updatedAt: new Date().toISOString(),
      };
    }
    case 'unitNotes': {
      const u = state.units[action.instanceId];
      if (!u) return state;
      return {
        ...state,
        units: { ...state.units, [action.instanceId]: { ...u, notes: action.notes } },
        updatedAt: new Date().toISOString(),
      };
    }
    case 'unitTag': {
      const u = state.units[action.instanceId];
      if (!u) return state;
      const tags = action.add
        ? Array.from(new Set([...(u.tags || []), action.tag]))
        : (u.tags || []).filter(t => t !== action.tag);
      return {
        ...state,
        units: { ...state.units, [action.instanceId]: { ...u, tags } },
        updatedAt: new Date().toISOString(),
      };
    }

    case 'stratUsage': {
      // Legacy toggle — kept for the existing reminder-engine hooks.
      const cur = state.stratagemUsage[action.stratagemId] || { used: false, totalUses: 0 };
      const used = !cur.used;
      return {
        ...state,
        stratagemUsage: {
          ...state.stratagemUsage,
          [action.stratagemId]: {
            ...cur, used,
            lastRound: used ? state.currentRound : cur.lastRound,
            totalUses: used ? cur.totalUses + 1 : cur.totalUses,
          },
        },
        updatedAt: new Date().toISOString(),
      };
    }
    case 'stratApply': {
      // Apply a stratagem: deduct CP, mark it used this round, append a
      // phase-event to the log. Used by the per-strat "Anwenden" button
      // in the detachment panel. If `force` is set the CP check is
      // skipped so the user can apply even with CP=0 (e.g. they earned
      // a free strat from an ability).
      const { stratagemId, cpCost = 0, name = '', force = false } = action;
      if (!stratagemId) return state;
      const newCp = state.cp - (force ? 0 : cpCost);
      if (newCp < 0 && !force) {
        // Not enough CP — surface a tag on the state so the UI can flash
        // a "nicht genug CP" hint but otherwise no-op.
        return { ...state, lastError: 'not-enough-cp', updatedAt: new Date().toISOString() };
      }
      const cur = state.stratagemUsage[stratagemId] || { used: false, totalUses: 0, roundUses: {} };
      const roundUses = { ...(cur.roundUses || {}) };
      roundUses[state.currentRound] = (roundUses[state.currentRound] || 0) + 1;
      const next = {
        ...state,
        cp: Math.max(0, newCp),
        stratagemUsage: {
          ...state.stratagemUsage,
          [stratagemId]: {
            ...cur,
            used: true,
            lastRound: state.currentRound,
            totalUses: (cur.totalUses || 0) + 1,
            roundUses,
          },
        },
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      return updatePhaseLog(next, state.currentPhase, (p) => ({
        ...p,
        events: [
          ...(p.events || []),
          makeEvent('stratagem', `${name || stratagemId} (−${cpCost} CP)`, { stratagemId, cpCost }),
        ],
      }));
    }
    case 'stratReset': {
      // Reset a stratagem's "used" flag — used at end-of-turn for
      // once-per-turn (vs once-per-battle) stratagems.
      const cur = state.stratagemUsage[action.stratagemId];
      if (!cur) return state;
      return {
        ...state,
        stratagemUsage: {
          ...state.stratagemUsage,
          [action.stratagemId]: { ...cur, used: false },
        },
        updatedAt: new Date().toISOString(),
      };
    }

    case 'addPhaseEvent': {
      return updatePhaseLog(state, action.phase || state.currentPhase, (p) => ({
        ...p, events: [...(p.events || []), makeEvent(action.kind || 'note', action.text, action.extra || {})],
      }));
    }
    case 'phaseNotes':
      return updatePhaseLog(state, action.phase, (p) => ({ ...p, notes: action.notes }));

    case 'sessionNotes':
      return { ...state, notes: action.notes, updatedAt: new Date().toISOString() };

    case 'setOnceFlag':
      return {
        ...state,
        onceFlags: { ...state.onceFlags, [action.key]: action.value },
        updatedAt: new Date().toISOString(),
      };

    default:
      return state;
  }
}

function updatePhaseLog(state, phaseId, fn) {
  const round = state.currentRound;
  const log = (state.roundLog || []).slice();
  const idx = log.findIndex(r => r.round === round);
  if (idx === -1) return state;
  const r = log[idx];
  const phaseLog = r.phases?.[phaseId] || { phase: phaseId, completed: false, notes: '', events: [] };
  log[idx] = {
    ...r,
    phases: { ...r.phases, [phaseId]: fn(phaseLog) },
  };
  return { ...state, roundLog: log, updatedAt: new Date().toISOString() };
}

/* ─────────────────── hook ─────────────────── */

/**
 * @param {CombatSession|null} initialSession  starting session (or null)
 */
export function useCombatSession(initialSession) {
  const [session, dispatch] = useReducer(reducer, initialSession);
  // Persist every meaningful change. The persistence layer debounces
  // so rapid edits coalesce to a single write.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!session) return;
    if (!dirtyRef.current) { dirtyRef.current = true; return; } // skip first
    saveSessionDebounced(session);
  }, [session]);

  const api = useMemo(() => ({
    replace: (s) => dispatch({ type: 'replace', session: s }),
    patch:   (patch) => dispatch({ type: 'patch', patch }),

    setPhase:    (phase) => dispatch({ type: 'setPhase', phase }),
    nextPhase:   () => dispatch({ type: 'nextPhase' }),
    prevPhase:   () => dispatch({ type: 'prevPhase' }),

    adjustCp:    (delta) => dispatch({ type: 'adjustCp', delta }),
    setCp:       (value) => dispatch({ type: 'setCp', value }),
    adjustVp:    (delta) => dispatch({ type: 'adjustVp', delta }),
    adjustOpponentVp: (delta) => dispatch({ type: 'adjustOpponentVp', delta }),
    scoreRow:    (side, rowId, delta) => dispatch({ type: 'scoreRow', side, rowId, delta }),

    setUnitStatus: (instanceId, status) => dispatch({ type: 'unitStatus', instanceId, status }),
    adjustModels:  (instanceId, delta) => dispatch({ type: 'unitModels', instanceId, delta }),
    applyWound:    (instanceId, delta) => dispatch({ type: 'unitWound', instanceId, delta }),
    setUnitNotes:  (instanceId, notes) => dispatch({ type: 'unitNotes', instanceId, notes }),
    toggleUnitTag: (instanceId, tag, add) => dispatch({ type: 'unitTag', instanceId, tag, add: add !== false }),
    toggleUnitOnceFlag: (instanceId, key) => dispatch({ type: 'unitOnceFlag', instanceId, key }),

    toggleStratagem: (stratagemId) => dispatch({ type: 'stratUsage', stratagemId }),
    applyStratagem:  (stratagemId, cpCost, name, opts = {}) =>
      dispatch({ type: 'stratApply', stratagemId, cpCost, name, force: !!opts.force }),
    resetStratagem:  (stratagemId) => dispatch({ type: 'stratReset', stratagemId }),
    addPhaseEvent:   (kind, text, extra) => dispatch({ type: 'addPhaseEvent', kind, text, extra }),
    setPhaseNotes:   (phase, notes) => dispatch({ type: 'phaseNotes', phase, notes }),
    setSessionNotes: (notes) => dispatch({ type: 'sessionNotes', notes }),
    setOnceFlag:     (key, value) => dispatch({ type: 'setOnceFlag', key, value: !!value }),
  }), []);

  return [session, api];
}
