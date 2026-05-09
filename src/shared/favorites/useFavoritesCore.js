// src/shared/favorites/useFavoritesCore.js
//
// Generic, domain-agnostic favorites hook. Used by features (wh40k, future
// systems) that need a per-user favorites set persisted to Supabase. The
// existing MTG favorites hook (`features/mtg/deck-builder/hooks/useFavorites.js`)
// keeps its Scryfall-specific bulk-fetch behaviour and is intentionally not
// rewritten here — but new features should use this shared core.
//
// Required Supabase table (see scripts/wh40k-schema.sql):
//   create table nerdshelf_favorites (
//     id          bigserial primary key,
//     user_id     uuid not null references auth.users(id) on delete cascade,
//     domain      text not null,         -- e.g. 'wh40k'
//     item_id     text not null,         -- normalized id within the domain
//     item_label  text default '',       -- denormalized for offline display
//     created_at  timestamptz default now(),
//     unique (user_id, domain, item_id)
//   );
//
// If the table doesn't exist (e.g. before the migration is applied), the hook
// degrades gracefully — favorites become an in-memory-only set for the session.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

const TABLE = 'nerdshelf_favorites';

/**
 * @param {object} options
 * @param {string} options.domain        e.g. 'wh40k'
 * @param {(item: any) => string} options.extractId
 * @param {(item: any) => string} [options.extractLabel]
 */
export function useFavoritesCore({ domain, extractId, extractLabel }) {
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
        .from(TABLE)
        .select('item_id, item_label')
        .eq('user_id', user.id)
        .eq('domain', domain);
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
        next.add(row.item_id);
        if (row.item_label) {
          itemCacheRef.current.set(row.item_id, { id: row.item_id, label: row.item_label });
        }
      }
      setIds(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, domain]);

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
        .from(TABLE)
        .delete()
        .eq('user_id', user.id)
        .eq('domain', domain)
        .eq('item_id', id);
    } else {
      result = await supabase
        .from(TABLE)
        .insert({
          user_id: user.id,
          domain,
          item_id: id,
          item_label: extractLabel ? (extractLabel(item) || '') : '',
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
  }, [user, ids, domain, extractId, extractLabel, tableMissing]);

  return {
    ids,
    isFavorite,
    toggleFavorite,
    loading,
    error,
    tableMissing,
  };
}
