// src/shared/imports/useImports.js
//
// Domain-scoped hook for managing share-token imports — decks / armies /
// characters that another player shared with the current user via their
// share token. Each import is a row in `nerdshelf_imports` that records
// "user X imported source_token Y of domain Z"; the actual entity data
// stays in its native table, gated by the public-by-import RLS policy
// from scripts/nerdshelf-imports-schema.sql.
//
// Read-only by design: this hook only ever performs SELECT on the source
// table. There is no update/delete path because the importer can't
// mutate someone else's data.
//
// Soft-degrades when the import table hasn't been migrated yet — calls
// just resolve to empty so the dashboards still render their owned items
// without crashing.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

const TABLE = 'nerdshelf_imports';

const DOMAIN_TO_TABLE = {
  mtg_deck:      'mtg_decks',
  wh40k_army:    'wh40k_armies',
  dnd_character: 'dnd_characters',
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
    // RPC missing → SQL migration not applied yet
    if (/function|does not exist|schema cache/i.test(error.message)) {
      throw new Error('Token-Lookup nicht verfügbar (Migration scripts/nerdshelf-imports-schema.sql noch nicht eingespielt).');
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
  const [imports, setImports]   = useState([]);   // raw import records
  const [entities, setEntities] = useState([]);   // hydrated source rows
  const [owners, setOwners]     = useState({});   // userId -> player_name
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [tableMissing, setTableMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!user) {
      setImports([]); setEntities([]); setOwners({});
      return;
    }
    setLoading(true);
    setError(null);

    // 1. List my imports for this domain.
    const { data: rows, error: err1 } = await supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .eq('domain', domain)
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

    // 2. Fetch the actual source rows by share_token. The RLS policy
    //    added by nerdshelf-imports-schema.sql lets the SELECT through
    //    for any token the importer has on file.
    const srcTable = DOMAIN_TO_TABLE[domain];
    const { data: src, error: err2 } = await supabase
      .from(srcTable)
      .select(select)
      .in('share_token', tokens);
    if (err2) {
      setError(err2.message);
      setLoading(false);
      return;
    }
    setEntities(src || []);

    // 3. Fetch player names for the owners we now know about.
    const ownerIds = [...new Set((src || []).map(s => s.user_id).filter(Boolean))];
    if (ownerIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, player_name')
        .in('id', ownerIds);
      const map = {};
      for (const p of profs || []) map[p.id] = p.player_name || '';
      setOwners(map);
    } else {
      setOwners({});
    }
    setLoading(false);
  }, [user, domain, select]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (token) => {
    if (!user) throw new Error('Nicht eingeloggt.');
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
      .from(TABLE)
      .insert({
        user_id:      user.id,
        domain,
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
  }, [user, domain, reload]);

  const remove = useCallback(async (token) => {
    if (!user) return;
    setEntities(prev => prev.filter(e => e.share_token !== token));
    setImports(prev => prev.filter(i => i.source_token !== token));
    const { error: err } = await supabase
      .from(TABLE)
      .delete()
      .eq('user_id', user.id)
      .eq('domain', domain)
      .eq('source_token', token);
    if (err) setError(err.message);
  }, [user, domain]);

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
