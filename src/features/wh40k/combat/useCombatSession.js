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
      return {
        ...state,
        units: { ...state.units, [action.instanceId]: { ...u, currentModels, status } },
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

    setUnitStatus: (instanceId, status) => dispatch({ type: 'unitStatus', instanceId, status }),
    adjustModels:  (instanceId, delta) => dispatch({ type: 'unitModels', instanceId, delta }),
    setUnitNotes:  (instanceId, notes) => dispatch({ type: 'unitNotes', instanceId, notes }),
    toggleUnitTag: (instanceId, tag, add) => dispatch({ type: 'unitTag', instanceId, tag, add: add !== false }),

    toggleStratagem: (stratagemId) => dispatch({ type: 'stratUsage', stratagemId }),
    addPhaseEvent:   (kind, text, extra) => dispatch({ type: 'addPhaseEvent', kind, text, extra }),
    setPhaseNotes:   (phase, notes) => dispatch({ type: 'phaseNotes', phase, notes }),
    setSessionNotes: (notes) => dispatch({ type: 'sessionNotes', notes }),
    setOnceFlag:     (key, value) => dispatch({ type: 'setOnceFlag', key, value: !!value }),
  }), []);

  return [session, api];
}
