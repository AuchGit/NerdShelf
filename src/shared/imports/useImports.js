// src/shared/imports/useImports.js
//
// Domain-scoped hook for share-token imports. Each domain has its own
// imports table (split from the legacy single `nerdshelf_imports` —
// see scripts/split-nerdshelf-tables.sql):
//
//   'mtg_deck'      → mtg_imports     → mtg_decks
//   'wh40k_army'    → wh40k_imports   → wh40k_armies
//   'dnd_character' → dnd_imports     → dnd_characters
//
// Read-only by design: the hook only SELECTs from the source entity table
// (the public-by-import RLS policy on each entity table lets that
// SELECT through for any token the importer has on file).
//
// Soft-degrades when the imports table hasn't been migrated yet so the
// dashboards still render owned items without crashing.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

// Domain → { imports table, source entity table }.
const DOMAIN_CONFIG = {
  mtg_deck:      { importsTable: 'mtg_imports',   srcTable: 'mtg_decks'      },
  wh40k_army:    { importsTable: 'wh40k_imports', srcTable: 'wh40k_armies'   },
  dnd_character: { importsTable: 'dnd_imports',   srcTable: 'dnd_characters' },
};

/**
 * Look up a token across all domains. Used by the import-input UI to
 * preview "yes, this token resolves to a deck/army/character belonging
 * to <name>" before the user confirms the import.
 *
 * Returns { domain, sourceId, ownerId, ownerName, entityName } or null.
 */
export async function lookupShareToken(token) {
  const cleaned = (token || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
  if (!cleaned || cleaned.length < 8) return null;
  const { data, error } = await supabase.rpc('lookup_share_token', { p_token: cleaned });
  if (error) {
    if (/function|does not exist|schema cache/i.test(error.message)) {
      throw new Error('Token-Lookup nicht verfügbar (Migration scripts/split-nerdshelf-tables.sql noch nicht eingespielt).');
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.domain) return null;
  return {
    domain:     row.domain,
    sourceId:   row.source_id,
    ownerId:    row.owner_id,
    ownerName:  row.owner_name || '',
    entityName: row.entity_name || '',
    token:      cleaned,
  };
}

/**
 * @param {object} opts
 * @param {'mtg_deck'|'wh40k_army'|'dnd_character'} opts.domain
 * @param {string} [opts.select='*']  columns to fetch from the source table
 */
export function useImports({ domain, select = '*' }) {
  const { user } = useAuth();
  const [imports, setImports]   = useState([]);
  const [entities, setEntities] = useState([]);
  const [owners, setOwners]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [tableMissing, setTableMissing] = useState(false);

  const cfg = DOMAIN_CONFIG[domain];

  const reload = useCallback(async () => {
    if (!user) {
      setImports([]); setEntities([]); setOwners({});
      return;
    }
    if (!cfg) {
      setError(`Unbekannte Import-Domäne: ${domain}`);
      return;
    }
    setLoading(true);
    setError(null);

    // 1. List my imports for this domain (one row per imported share token).
    const { data: rows, error: err1 } = await supabase
      .from(cfg.importsTable)
      .select('*')
      .eq('user_id', user.id)
      .order('imported_at', { ascending: false });
    if (err1) {
      if (/does not exist|relation|schema cache/i.test(err1.message)) {
        setTableMissing(true);
      } else {
        setError(err1.message);
      }
      setLoading(false);
      return;
    }
    setImports(rows || []);

    const tokens = (rows || []).map(r => r.source_token).filter(Boolean);
    if (tokens.length === 0) {
      setEntities([]); setOwners({});
      setLoading(false);
      return;
    }

    // 2. Fetch the actual source rows by share_token. The RLS policy on
    //    each entity table lets the SELECT through for any token the
    //    importer has on file (scripts/split-nerdshelf-tables.sql).
    const { data: src, error: err2 } = await supabase
      .from(cfg.srcTable)
      .select(select)
      .in('share_token', tokens);
    if (err2) {
      setError(err2.message);
      setLoading(false);
      return;
    }
    setEntities(src || []);

    // 3. Fetch player names for the owners we now know about.
    //    Goes through the get_player_names RPC (SECURITY DEFINER) instead
    //    of a direct profiles SELECT — the profiles "public name via
    //    imports" RLS policy is expensive (UNIONs across three imports
    //    tables per row) and was a major hot spot in the Supabase stats.
    //    The RPC enforces the same authorisation but runs once per call.
    const ownerIds = [...new Set((src || []).map(s => s.user_id).filter(Boolean))];
    if (ownerIds.length > 0) {
      const { data: profs, error: err3 } = await supabase
        .rpc('get_player_names', { p_user_ids: ownerIds });
      const map = {};
      if (!err3) {
        for (const p of profs || []) map[p.id] = p.player_name || '';
      }
      setOwners(map);
    } else {
      setOwners({});
    }
    setLoading(false);
  }, [user, domain, select, cfg]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (token) => {
    if (!user) throw new Error('Nicht eingeloggt.');
    if (!cfg)  throw new Error(`Unbekannte Import-Domäne: ${domain}`);
    const cleaned = (token || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
    if (!cleaned) throw new Error('Token ist leer.');

    const lookup = await lookupShareToken(cleaned);
    if (!lookup) throw new Error('Token nicht gefunden.');
    if (lookup.domain !== domain) {
      throw new Error(`Dieser Token gehört zu „${labelForDomain(lookup.domain)}", nicht zu „${labelForDomain(domain)}".`);
    }
    if (lookup.ownerId === user.id) {
      throw new Error('Das ist dein eigener Token — Imports zeigen nur fremde Einträge.');
    }

    const { error: err } = await supabase
      .from(cfg.importsTable)
      .insert({
        user_id:      user.id,
        source_token: cleaned,
        source_id:    lookup.sourceId,
      });
    if (err) {
      if (/duplicate key/i.test(err.message)) {
        throw new Error('Dieser Token wurde schon importiert.');
      }
      throw err;
    }
    await reload();
    return lookup;
  }, [user, domain, cfg, reload]);

  const remove = useCallback(async (token) => {
    if (!user || !cfg) return;
    setEntities(prev => prev.filter(e => e.share_token !== token));
    setImports(prev => prev.filter(i => i.source_token !== token));
    const { error: err } = await supabase
      .from(cfg.importsTable)
      .delete()
      .eq('user_id', user.id)
      .eq('source_token', token);
    if (err) setError(err.message);
  }, [user, cfg]);

  /** Find an imported entity by id (for read-only view routes). */
  const findById = useCallback((id) => entities.find(e => e.id === id) || null, [entities]);

  return {
    imports,
    entities,
    owners,
    loading,
    error,
    tableMissing,
    reload,
    add,
    remove,
    findById,
    /** Resolve a userId to its player_name, with a sensible fallback. */
    ownerNameFor: (userId) => owners[userId] || 'Unbekannter Spieler',
  };
}

function labelForDomain(d) {
  switch (d) {
    case 'mtg_deck':      return 'MTG-Deck';
    case 'wh40k_army':    return 'WH40K-Armee';
    case 'dnd_character': return 'DnD-Charakter';
    default:              return d;
  }
}
