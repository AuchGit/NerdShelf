// src/shared/inventory/useInventory.js
//
// Generic, domain-scoped inventory hook. Tracks owned-quantity for items
// in any feature (wh40k units, mtg cards, future systems).
//
// Required Supabase table (see scripts/wh40k-schema.sql):
//   create table nerdshelf_inventory (
//     id          bigserial primary key,
//     user_id     uuid not null references auth.users(id) on delete cascade,
//     domain      text not null,
//     item_id     text not null,
//     quantity    integer not null default 1,
//     item_label  text default '',
//     created_at  timestamptz default now(),
//     updated_at  timestamptz default now(),
//     unique (user_id, domain, item_id)
//   );
//
// Behavior:
//   - quantity 0 means "not owned" — rows are deleted when quantity reaches 0,
//     so a missing key in `quantities` Map === not owned.
//   - Optimistic updates with rollback on error.
//   - Graceful soft-degrade when the table doesn't exist yet (session-only).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

const TABLE = 'nerdshelf_inventory';

/**
 * @param {object} options
 * @param {string} options.domain
 */
export function useInventory({ domain }) {
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
      const { data, error: err } = await supabase
        .from(TABLE)
        .select('item_id, quantity')
        .eq('user_id', user.id)
        .eq('domain', domain);
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
  }, [user, domain]);

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
   * @param {string} id
   * @param {number} qty
   * @param {string} [label]   denormalized label persisted with the row
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
      result = await supabase
        .from(TABLE)
        .delete()
        .eq('user_id', user.id)
        .eq('domain', domain)
        .eq('item_id', id);
    } else if (prev === 0) {
      result = await supabase
        .from(TABLE)
        .insert({
          user_id: user.id,
          domain,
          item_id: id,
          quantity: safe,
          item_label: label,
        });
    } else {
      result = await supabase
        .from(TABLE)
        .update({ quantity: safe, item_label: label, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('domain', domain)
        .eq('item_id', id);
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
  }, [user, domain, quantities, tableMissing]);

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
