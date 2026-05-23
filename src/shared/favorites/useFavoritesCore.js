// src/shared/favorites/useFavoritesCore.js
//
// Generic, per-domain favorites hook. Each domain stores its favorites in
// its own table (mtg_favorites, wh40k_favorites). The hook is parameterised
// by table name + the SQL columns the table uses (mtg_favorites kept its
// historical `scryfall_id`/`card_name` shape; wh40k_favorites uses the
// generic `item_id`/`item_label`).
//
// Required Supabase tables (see scripts/split-nerdshelf-tables.sql):
//   wh40k_favorites(user_id, item_id, item_label, created_at, UNIQUE(user_id, item_id))
//   mtg_favorites  (user_id, scryfall_id, card_name)
//
// If the table doesn't exist (migration not yet applied), the hook
// degrades gracefully — favorites become an in-memory-only set for the
// session.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

/**
 * @param {object} options
 * @param {string} options.table              SQL table name, e.g. 'wh40k_favorites'.
 * @param {string} [options.idColumn='item_id']     column that stores the favorited id
 * @param {string} [options.labelColumn='item_label']
 * @param {(item: any) => string} options.extractId
 * @param {(item: any) => string} [options.extractLabel]
 */
export function useFavoritesCore({
  table,
  idColumn = 'item_id',
  labelColumn = 'item_label',
  extractId,
  extractLabel,
}) {
  const { user } = useAuth();
  const [ids, setIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const itemCacheRef = useRef(new Map()); // id -> item

  // Load on user change
  useEffect(() => {
    if (!user) {
      setIds(new Set());
      itemCacheRef.current = new Map();
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from(table)
        .select(`${idColumn}, ${labelColumn}`)
        .eq('user_id', user.id);
      if (cancelled) return;
      if (err) {
        // Treat "table does not exist" as a soft degrade rather than a hard
        // failure — the rest of the app must keep working.
        if (/does not exist|relation|schema cache/i.test(err.message)) {
          setTableMissing(true);
        } else {
          setError(err.message);
        }
        setLoading(false);
        return;
      }
      const next = new Set();
      for (const row of data || []) {
        const id = row[idColumn];
        const label = row[labelColumn];
        next.add(id);
        if (label) itemCacheRef.current.set(id, { id, label });
      }
      setIds(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, table, idColumn, labelColumn]);

  const isFavorite = useCallback((id) => ids.has(id), [ids]);

  const toggleFavorite = useCallback(async (item) => {
    if (!user || item == null) return;
    const id = extractId(item);
    if (!id) return;
    const wasFavorite = ids.has(id);

    // Optimistic update
    setIds(prev => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(id);
      else next.add(id);
      return next;
    });
    if (wasFavorite) itemCacheRef.current.delete(id);
    else itemCacheRef.current.set(id, item);

    if (tableMissing) return; // session-only mode

    let result;
    if (wasFavorite) {
      result = await supabase
        .from(table)
        .delete()
        .eq('user_id', user.id)
        .eq(idColumn, id);
    } else {
      result = await supabase
        .from(table)
        .insert({
          user_id: user.id,
          [idColumn]: id,
          [labelColumn]: extractLabel ? (extractLabel(item) || '') : '',
        });
    }

    if (result.error) {
      // Rollback optimistic change
      setIds(prev => {
        const next = new Set(prev);
        if (wasFavorite) next.add(id);
        else next.delete(id);
        return next;
      });
      if (wasFavorite) itemCacheRef.current.set(id, item);
      else itemCacheRef.current.delete(id);
      setError(result.error.message);
    }
  }, [user, ids, table, idColumn, labelColumn, extractId, extractLabel, tableMissing]);

  return {
    ids,
    isFavorite,
    toggleFavorite,
    loading,
    error,
    tableMissing,
  };
}
