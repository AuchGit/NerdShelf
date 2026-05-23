// src/shared/inventory/useInventory.js
//
// Generic, per-domain inventory hook. Each domain stores inventory in its
// own table; this hook takes the table name as a parameter.
//
// Required Supabase tables (see scripts/split-nerdshelf-tables.sql):
//
//   mtg_inventory(
//     user_id uuid, item_id text, quantity int,
//     item_label text, kind text default 'collection',
//     created_at timestamptz, updated_at timestamptz,
//     UNIQUE(user_id, item_id, kind)
//   )
//
//   wh40k_inventory(
//     user_id uuid, item_id text, quantity int, item_label text,
//     created_at, updated_at,
//     UNIQUE(user_id, item_id)
//   )
//
// The MTG table has a `kind` column because it serves two purposes
// (real collection vs. manually-added wishlist entries). Callers that
// only have one purpose just omit `kind` and the hook ignores it; the
// SQL default ('collection') applies. Callers that need the second
// purpose pass kind='wishlist-manual'.
//
// Behavior:
//   - quantity 0 → row deleted (a missing key in `quantities` Map === not owned).
//   - Optimistic updates with rollback on error.
//   - Graceful soft-degrade when the table doesn't exist yet (session-only).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

/**
 * @param {object} options
 * @param {string} options.table   Supabase table name, e.g. 'wh40k_inventory'.
 * @param {string} [options.kind]  Optional secondary scope on a multi-use
 *                                 table (currently only MTG: 'collection'
 *                                 vs 'wishlist-manual'). When omitted the
 *                                 hook reads/writes WITHOUT a kind filter
 *                                 — appropriate for single-use tables.
 */
export function useInventory({ table, kind }) {
  const { user } = useAuth();
  const [quantities, setQuantities] = useState(() => new Map()); // id -> qty
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    if (!user) {
      setQuantities(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      let q = supabase
        .from(table)
        .select('item_id, quantity')
        .eq('user_id', user.id);
      if (kind) q = q.eq('kind', kind);

      const { data, error: err } = await q;
      if (cancelled) return;
      if (err) {
        if (/does not exist|relation|schema cache/i.test(err.message)) {
          setTableMissing(true);
        } else {
          setError(err.message);
        }
        setLoading(false);
        return;
      }
      const map = new Map();
      for (const row of data || []) {
        if (row.quantity > 0) map.set(row.item_id, row.quantity);
      }
      setQuantities(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, table, kind]);

  const getQuantity = useCallback(
    (id) => quantities.get(id) || 0,
    [quantities]
  );

  const isOwned = useCallback(
    (id) => (quantities.get(id) || 0) > 0,
    [quantities]
  );

  /**
   * Set the absolute quantity for an item. Pass 0 to remove.
   */
  const setQuantity = useCallback(async (id, qty, label = '') => {
    if (!user || !id) return;
    const safe = Math.max(0, Math.floor(qty || 0));
    const prev = quantities.get(id) || 0;
    if (safe === prev) return;

    // Optimistic update
    setQuantities(map => {
      const next = new Map(map);
      if (safe === 0) next.delete(id);
      else next.set(id, safe);
      return next;
    });

    if (tableMissing) return;

    let result;
    if (safe === 0) {
      let q = supabase.from(table).delete()
        .eq('user_id', user.id).eq('item_id', id);
      if (kind) q = q.eq('kind', kind);
      result = await q;
    } else if (prev === 0) {
      const row = { user_id: user.id, item_id: id, quantity: safe, item_label: label };
      if (kind) row.kind = kind;
      result = await supabase.from(table).insert(row);
    } else {
      let q = supabase.from(table).update({
        quantity: safe, item_label: label, updated_at: new Date().toISOString(),
      }).eq('user_id', user.id).eq('item_id', id);
      if (kind) q = q.eq('kind', kind);
      result = await q;
    }

    if (result.error) {
      // Rollback
      setQuantities(map => {
        const next = new Map(map);
        if (prev === 0) next.delete(id);
        else next.set(id, prev);
        return next;
      });
      setError(result.error.message);
    }
  }, [user, table, kind, quantities, tableMissing]);

  const adjustQuantity = useCallback(
    (id, delta, label) => setQuantity(id, (quantities.get(id) || 0) + delta, label),
    [setQuantity, quantities]
  );

  const totalOwned = quantities.size;

  return {
    quantities,
    getQuantity,
    isOwned,
    setQuantity,
    adjustQuantity,
    totalOwned,
    loading,
    error,
    tableMissing,
  };
}
