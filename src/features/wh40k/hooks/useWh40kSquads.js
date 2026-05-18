// src/features/wh40k/hooks/useWh40kSquads.js
//
// Persistence + reactive cache for the user's saved WH40K squads. A
// "squad" is a named preset of (unit, modelCount, wargearOptionIds,
// notes) that lives between sessions and can be:
//
//   - Built in the Inventory page from owned units (Sammlung-Squads).
//   - Built in the Army Builder from any unit, regardless of ownership
//     (so list-tinkering isn't gated by what's physically on the shelf).
//   - Dropped into an army with one tap via the Army Builder.
//
// Soft-degrades when the `wh40k_squads` table hasn't been migrated yet
// (kept in-session only) — same pattern the army & inventory hooks use.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';

const TABLE = 'wh40k_squads';

/**
 * Row shape (in-memory, camelCased):
 *   { id, userId, name, factionId, unitId, modelCount,
 *     wargearOptionIds: string[], notes: string,
 *     shareToken, createdAt, updatedAt }
 */
function rowToSquad(r) {
  const data = r.data || {};
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name || 'Unbenannter Trupp',
    factionId: r.faction_id || null,
    unitId: r.unit_id,
    modelCount: r.model_count ?? 1,
    wargearOptionIds: Array.isArray(data.wargearOptionIds) ? data.wargearOptionIds : [],
    notes: typeof data.notes === 'string' ? data.notes : '',
    shareToken: r.share_token || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function squadToRow(s, userId) {
  return {
    user_id: userId,
    name: s.name || 'Unbenannter Trupp',
    faction_id: s.factionId || null,
    unit_id: s.unitId,
    model_count: Math.max(1, Math.floor(s.modelCount || 1)),
    data: {
      wargearOptionIds: Array.isArray(s.wargearOptionIds) ? s.wargearOptionIds : [],
      notes: s.notes || '',
    },
    updated_at: new Date().toISOString(),
  };
}

export function useWh40kSquads() {
  const { user } = useAuth();
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!user) {
      setSquads([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (err) {
      if (/does not exist|relation|schema cache/i.test(err.message)) {
        setTableMissing(true);
      } else {
        setError(err.message);
      }
      setLoading(false);
      return;
    }
    setSquads((data || []).map(rowToSquad));
    setLoading(false);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (squad) => {
    if (!user) throw new Error('Nicht eingeloggt.');
    if (!squad.unitId) throw new Error('Squad braucht eine Einheit.');
    if (tableMissing) {
      // Session-only: keep the new squad in memory with a synthetic id.
      const tmp = {
        ...squad,
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: user.id,
        wargearOptionIds: squad.wargearOptionIds || [],
        notes: squad.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSquads(prev => [tmp, ...prev]);
      return tmp;
    }
    const payload = squadToRow(squad, user.id);
    const { data, error: err } = await supabase
      .from(TABLE).insert(payload).select().single();
    if (err) throw err;
    const next = rowToSquad(data);
    setSquads(prev => [next, ...prev]);
    return next;
  }, [user, tableMissing]);

  const update = useCallback(async (id, patch) => {
    if (!user) throw new Error('Nicht eingeloggt.');
    const existing = squads.find(s => s.id === id);
    if (!existing) throw new Error('Squad nicht gefunden.');
    const merged = { ...existing, ...patch };
    if (tableMissing || String(id).startsWith('local-')) {
      const updated = { ...merged, updatedAt: new Date().toISOString() };
      setSquads(prev => prev.map(s => s.id === id ? updated : s));
      return updated;
    }
    const payload = squadToRow(merged, user.id);
    const { data, error: err } = await supabase
      .from(TABLE).update(payload).eq('id', id).eq('user_id', user.id)
      .select().single();
    if (err) throw err;
    const next = rowToSquad(data);
    setSquads(prev => prev.map(s => s.id === id ? next : s));
    return next;
  }, [user, squads, tableMissing]);

  const remove = useCallback(async (id) => {
    if (!user) return;
    // Optimistic — pop immediately so the UI feels snappy.
    const before = squads;
    setSquads(prev => prev.filter(s => s.id !== id));
    if (tableMissing || String(id).startsWith('local-')) return;
    const { error: err } = await supabase
      .from(TABLE).delete().eq('id', id).eq('user_id', user.id);
    if (err) {
      setSquads(before);
      setError(err.message);
    }
  }, [user, squads, tableMissing]);

  const duplicate = useCallback(async (id) => {
    const src = squads.find(s => s.id === id);
    if (!src) return null;
    const { id: _id, createdAt: _c, updatedAt: _u, shareToken: _t, ...rest } = src;
    return create({ ...rest, name: `${src.name} (Kopie)` });
  }, [squads, create]);

  return {
    squads,
    loading,
    error,
    tableMissing,
    reload,
    create,
    update,
    remove,
    duplicate,
  };
}

/**
 * Resolve a squad's legal model-count range from the canonical
 * unit-composition dataset. Returns `{ min, max, fixed }`.
 *   - If the dataset gives both min and max, the user can pick any
 *     value in [min, max].
 *   - If neither is set, the unit is a single-instance unit
 *     (`fixed: true`, model_count locked to whatever the composition
 *     text implies — usually 1, sometimes a fixed multi-model squad
 *     like "1 Sister Superior; 9 Battle Sisters").
 */
export function getSquadSizeRange(unit) {
  if (!unit) return { min: 1, max: 1, fixed: true };
  const comp = unit.composition || {};
  const minM = comp.minModels;
  const maxM = comp.maxModels;
  if (minM != null && maxM != null) {
    return { min: Math.max(1, minM), max: Math.max(minM, maxM), fixed: false };
  }
  // Fixed-size unit: derive count from pointsCosts (the first models
  // count) or the inferred unit composition.
  const fixedCount = unit.modelCounts?.[0] || 1;
  return { min: fixedCount, max: fixedCount, fixed: true };
}

/**
 * Compute the canonical point cost of a (unit, modelCount) pair using
 * the unit's `pointsCosts` cost table. Falls back to the legacy scalar
 * `points` value if no matching tier is found (units the canonical
 * dataset only prices at one size).
 */
export function squadPoints(unit, modelCount) {
  if (!unit) return 0;
  const tiers = Array.isArray(unit.pointsCosts) ? unit.pointsCosts : [];
  const exact = tiers.find(t => Number(t.models) === Number(modelCount));
  if (exact) return Number(exact.cost) || 0;
  // Fall back to the closest tier <= modelCount.
  const sorted = tiers
    .map(t => ({ models: Number(t.models) || 0, cost: Number(t.cost) || 0 }))
    .sort((a, b) => a.models - b.models);
  let last = null;
  for (const t of sorted) {
    if (t.models <= modelCount) last = t;
  }
  if (last) return last.cost;
  return unit.points || 0;
}
