// src/features/mtg/deck-builder/hooks/useMtgWishlist.js
//
// Auto-computed "Wishlist" — the list of MTG cards the user needs but
// doesn't have enough copies of, derived from:
//
//   Σ deck-quantity(card) − inventory-quantity(card)
//
// across every deck the user owns. The list is reactive: it updates as
// the user adjusts inventory or saves a deck.
//
// Architectural notes:
//
//   - Wishlist is a *computed view*, not a stored entity. No new Supabase
//     table, no schema migration. The single source of truth is the deck
//     contents + inventory hooks that already exist.
//
//   - Foil tracking lives in the canonical inventory row's quantity (one
//     row per (user_id, domain, item_id)) — the wishlist treats foils
//     and non-foils as interchangeable for needs calculation. Future
//     foil-aware bookkeeping can layer on without changing this hook.
//
//   - Manual entries (a card the user wants but isn't yet in a deck) are
//     persisted to a dedicated `nerdshelf_inventory`-style ad-hoc list
//     under domain `mtg-wishlist-manual` so they survive sessions
//     without inflating the auto-computed bucket. We expose `manual` +
//     `addManual` / `removeManual` for that path.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import { useAuth } from '../../../../core/auth/AuthContext';
import { useMtgInventory } from './useMtgInventory';

const MANUAL_DOMAIN = 'mtg-wishlist-manual';
const TABLE = 'nerdshelf_inventory';

/**
 * @param {object} opts
 * @param {boolean} [opts.includeSideboard=true]  count sideboard copies?
 * @param {boolean} [opts.includeCommander=true]  count the commander zone?
 */
export function useMtgWishlist(opts = {}) {
  const { includeSideboard = true, includeCommander = true } = opts;
  const { user } = useAuth();
  const inv = useMtgInventory();
  const [decks, setDecks] = useState([]);
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [error, setError] = useState(null);
  const [manualRows, setManualRows] = useState([]); // {card_id, label, quantity}

  /* ─── load decks ─── */
  useEffect(() => {
    if (!user) { setDecks([]); setLoadingDecks(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingDecks(true);
      const { data, error: err } = await supabase
        .from('mtg_decks')
        .select('id, name, data')
        .eq('user_id', user.id);
      if (cancelled) return;
      if (err) { setError(err.message); setLoadingDecks(false); return; }
      setDecks(data || []);
      setLoadingDecks(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  /* ─── load manual wishlist entries ─── */
  useEffect(() => {
    if (!user) { setManualRows([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from(TABLE)
        .select('item_id, item_label, quantity')
        .eq('user_id', user.id)
        .eq('domain', MANUAL_DOMAIN);
      if (cancelled) return;
      if (err) { /* table-missing soft-degrades */ return; }
      setManualRows((data || []).map(r => ({
        cardId: r.item_id, label: r.item_label || '', quantity: r.quantity,
      })));
    })();
    return () => { cancelled = true; };
  }, [user]);

  /* ─── compute the wishlist ─── */
  const wishlist = useMemo(() => {
    // 1. Aggregate required quantities per scryfall id across all decks.
    const need = new Map();              // cardId → { card, count, sources: [deckName] }
    const bump = (cardId, card, n, src) => {
      if (!cardId || n <= 0) return;
      const row = need.get(cardId) || { card, count: 0, sources: [] };
      row.count += n;
      if (!row.card) row.card = card;
      if (src && !row.sources.includes(src)) row.sources.push(src);
      need.set(cardId, row);
    };
    for (const d of decks) {
      const data = d.data || {};
      const src = d.name || 'Unbenanntes Deck';
      for (const [id, entry] of Object.entries(data.mainboard || {})) {
        bump(id, entry?.card, entry?.count || 0, src);
      }
      if (includeSideboard) {
        for (const [id, entry] of Object.entries(data.sideboard || {})) {
          bump(id, entry?.card, entry?.count || 0, src);
        }
      }
      if (includeCommander && data.commander?.id) {
        bump(data.commander.id, data.commander, 1, src);
      }
    }

    // 2. Subtract inventory, retain anything still > 0.
    const auto = [];
    for (const [cardId, row] of need) {
      const owned = inv.getQuantity(cardId);
      const missing = row.count - owned;
      if (missing > 0) {
        auto.push({
          cardId,
          card: row.card,
          neededTotal: row.count,
          owned,
          missing,
          sources: row.sources,
          kind: 'auto',
        });
      }
    }
    auto.sort((a, b) =>
      b.missing - a.missing ||
      (a.card?.name || '').localeCompare(b.card?.name || '')
    );

    // 3. Append manual entries (deduped — auto wins if the same card)
    const autoIds = new Set(auto.map(a => a.cardId));
    const manual = manualRows
      .filter(m => !autoIds.has(m.cardId))
      .map(m => ({
        cardId: m.cardId,
        card: null,                      // manual entries store label-only by default
        label: m.label,
        neededTotal: m.quantity,
        owned: inv.getQuantity(m.cardId),
        missing: Math.max(0, m.quantity - inv.getQuantity(m.cardId)),
        sources: [],
        kind: 'manual',
      }));

    return [...auto, ...manual];
  }, [decks, inv, manualRows, includeSideboard, includeCommander]);

  /* ─── manual API ─── */
  const addManual = useCallback(async (card, quantity = 1) => {
    if (!user || !card?.id) return;
    setManualRows(rows => {
      const existing = rows.find(r => r.cardId === card.id);
      if (existing) {
        return rows.map(r => r.cardId === card.id
          ? { ...r, quantity: r.quantity + quantity }
          : r);
      }
      return [...rows, { cardId: card.id, label: card.name || '', quantity }];
    });
    const existing = manualRows.find(r => r.cardId === card.id);
    const nextQty = (existing?.quantity || 0) + quantity;
    if (existing) {
      await supabase.from(TABLE).update({ quantity: nextQty, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('domain', MANUAL_DOMAIN).eq('item_id', card.id);
    } else {
      await supabase.from(TABLE).insert({
        user_id: user.id, domain: MANUAL_DOMAIN, item_id: card.id,
        item_label: card.name || '', quantity,
      });
    }
  }, [user, manualRows]);

  const removeManual = useCallback(async (cardId) => {
    if (!user) return;
    setManualRows(rows => rows.filter(r => r.cardId !== cardId));
    await supabase.from(TABLE).delete()
      .eq('user_id', user.id).eq('domain', MANUAL_DOMAIN).eq('item_id', cardId);
  }, [user]);

  return {
    wishlist,
    autoCount: wishlist.filter(w => w.kind === 'auto').length,
    manualCount: wishlist.filter(w => w.kind === 'manual').length,
    totalMissing: wishlist.reduce((s, w) => s + w.missing, 0),
    loading: loadingDecks || inv.loading,
    error: error || inv.error,
    decks,
    addManual,
    removeManual,
  };
}
