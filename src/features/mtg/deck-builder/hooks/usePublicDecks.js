// src/features/mtg/deck-builder/hooks/usePublicDecks.js
//
// Decks other people shared with every NerdShelf user, plus their owners'
// names. Stays empty — without an error — on a database that doesn't have
// public decks yet (scripts/mtg-public-decks.sql), so the dashboard works
// the same as before until the migration has run.

import { useEffect, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import { useAuth } from '../../../../core/auth/AuthContext';

// Plenty for a circle of friends; keeps one request from growing unbounded.
const LIMIT = 200;

async function fetchPublicDecks(userId) {
  const { data, error } = await supabase
    .from('mtg_decks')
    .select('*')
    .eq('is_public', true)
    .neq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(LIMIT);
  if (error) return { decks: [], owners: {} };

  const owners = {};
  const ownerIds = [...new Set((data || []).map(d => d.user_id).filter(Boolean))];
  if (ownerIds.length > 0) {
    const { data: names, error: namesErr } = await supabase
      .rpc('get_player_names', { p_user_ids: ownerIds });
    if (!namesErr) for (const p of names || []) owners[p.id] = p.player_name || '';
  }
  return { decks: data || [], owners };
}

export default function usePublicDecks() {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [loaded, setLoaded] = useState({ userId: null, decks: [], owners: {} });

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    fetchPublicDecks(userId)
      .then(result => { if (!cancelled) setLoaded({ userId, ...result }); })
      .catch(() => { if (!cancelled) setLoaded({ userId, decks: [], owners: {} }); });
    return () => { cancelled = true; };
  }, [userId]);

  const mine = loaded.userId === userId;
  return {
    decks: mine ? loaded.decks : [],
    owners: mine ? loaded.owners : {},
    loading: !!userId && !mine,
  };
}
