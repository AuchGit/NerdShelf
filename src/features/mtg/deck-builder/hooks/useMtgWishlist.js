// src/features/mtg/deck-builder/hooks/useMtgWishlist.js
//
// Auto-computed "Wishlist" — the list of MTG cards the user needs but
// doesn't have enough copies of, derived from:
//
//   Σ deck-quantity(card) − owned copies(card)
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
//   - Owned copies (services/ownedCopies.js): without a fixed artwork any
//     printing of the card in the collection counts; with a fixed artwork
//     only that exact printing does — so the wishlist and the Cardmarket
//     export ask for the artwork the deck wants.
//
//   - Manual entries (a card the user wants but isn't yet in a deck) are
//     persisted to `mtg_inventory` under kind='wishlist-manual' so they
//     coexist with the user's real collection (kind='collection') without
//     either polluting the other's row counts. We expose `manual` +
//     `addManual` / `removeManual` for that path.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import { useAuth } from '../../../../core/auth/AuthContext';
import { useMtgInventory } from './useMtgInventory';
import { applyPrinting } from '../services/deckPrintings';
import {
  buildOwnedIndex, ownedCopiesOf, allocateOwnedCopies, totalCopies,
} from '../services/ownedCopies';
import { getCardPriceEur } from '../services/scryfall';

const TABLE = 'mtg_inventory';
const MANUAL_KIND = 'wishlist-manual';
const NO_ROWS = [];

/**
 * @param {object} opts
 * @param {boolean} [opts.includeSideboard=true]  count sideboard copies?
 * @param {boolean} [opts.includeCommander=true]  count the commander zone?
 */
export function useMtgWishlist(opts = {}) {
  const { includeSideboard = true, includeCommander = true } = opts;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const inv = useMtgInventory();
  // Loaded rows belong to the user they were loaded for.
  const [deckState, setDeckState] = useState({ userId: null, rows: NO_ROWS });
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [error, setError] = useState(null);
  const [manualState, setManualState] = useState({ userId: null, rows: NO_ROWS }); // rows: {cardId, label, quantity}

  const decks = userId && deckState.userId === userId ? deckState.rows : NO_ROWS;
  const manualRows = userId && manualState.userId === userId ? manualState.rows : NO_ROWS;

  /* ─── load decks ─── */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadingDecks(true);
      const { data, error: err } = await supabase
        .from('mtg_decks')
        .select('id, name, data')
        .eq('user_id', user.id);
      if (cancelled) return;
      if (err) { setError(err.message); setLoadingDecks(false); return; }
      setDeckState({ userId: user.id, rows: data || [] });
      setLoadingDecks(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  /* ─── load manual wishlist entries ─── */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from(TABLE)
        .select('item_id, item_label, quantity')
        .eq('user_id', user.id)
        .eq('kind', MANUAL_KIND);
      if (cancelled) return;
      if (err) { /* table-missing soft-degrades */ return; }
      setManualState({
        userId: user.id,
        rows: (data || []).map(r => ({
          cardId: r.item_id, label: r.item_label || '', quantity: r.quantity,
        })),
      });
    })();
    return () => { cancelled = true; };
  }, [user]);

  const updateManualRows = useCallback((fn) => {
    setManualState(prev => ({
      userId,
      rows: fn(prev.userId === userId ? prev.rows : NO_ROWS),
    }));
  }, [userId]);

  const ownedIndex = useMemo(
    () => buildOwnedIndex(inv.quantities, inv.labels),
    [inv.quantities, inv.labels]
  );

  /* ─── compute the wishlist ─── */
  const wishlist = useMemo(() => {
    // 1. Aggregate required quantities per scryfall id across all decks.
    //    `parts` splits the count by the artwork each deck chose for the
    //    card (printing null = no fixed artwork).
    const need = new Map();              // cardId → { card, count, sources: [deckName], parts }
    const bump = (cardId, card, n, src, printing) => {
      if (!cardId || n <= 0) return;
      const row = need.get(cardId) || { card, count: 0, sources: [], parts: [] };
      row.count += n;
      if (!row.card) row.card = card;
      if (src && !row.sources.includes(src)) row.sources.push(src);
      const part = row.parts.find(p => (p.printing?.id || null) === (printing?.id || null));
      if (part) part.count += n;
      else row.parts.push({ printing: printing || null, count: n });
      need.set(cardId, row);
    };
    for (const d of decks) {
      const data = d.data || {};
      const src = d.name || 'Unbenanntes Deck';
      const printings = data.printings || {};
      for (const [id, entry] of Object.entries(data.mainboard || {})) {
        bump(id, entry?.card, entry?.count || 0, src, printings[id]);
      }
      if (includeSideboard) {
        for (const [id, entry] of Object.entries(data.sideboard || {})) {
          bump(id, entry?.card, entry?.count || 0, src, printings[id]);
        }
      }
      // Ideas are an unbounded "would like to test" pool — they DO
      // contribute to the wishlist (the user wants to buy them) and
      // their source is tagged so the user sees which deck wanted it.
      for (const [id, entry] of Object.entries(data.ideas || {})) {
        bump(id, entry?.card, entry?.count || 0, `${src} (Ideen)`, printings[id]);
      }
      if (includeCommander && data.commander?.id) {
        bump(data.commander.id, data.commander, 1, src, printings[data.commander.id]);
      }
    }

    // 2. Take owned copies off, retain anything still missing.
    const auto = [];
    for (const [cardId, row] of need) {
      const copies = ownedCopiesOf(ownedIndex, cardId, row.card?.name);
      const remaining = allocateOwnedCopies(row.parts, copies);
      const missing = remaining.reduce((s, p) => s + p.count, 0);
      if (missing <= 0) continue;
      const chosen = remaining.filter(p => p.printing);
      const single = remaining.length === 1 && chosen.length === 1 ? chosen[0].printing : null;
      let missingEur = null;
      for (const p of remaining) {
        const eur = getCardPriceEur(applyPrinting(row.card, p.printing));
        if (eur != null) missingEur = (missingEur ?? 0) + eur * p.count;
      }
      auto.push({
        cardId,
        card: single ? applyPrinting(row.card, single) : row.card,
        neededTotal: row.count,
        owned: totalCopies(copies),
        missing,
        missingEur,
        printings: chosen,
        parts: remaining,
        sources: row.sources,
        kind: 'auto',
      });
    }
    auto.sort((a, b) =>
      b.missing - a.missing ||
      (a.card?.name || '').localeCompare(b.card?.name || '')
    );

    // 3. Append manual entries (deduped — auto wins if the same card)
    const autoIds = new Set(auto.map(a => a.cardId));
    const manual = manualRows
      .filter(m => !autoIds.has(m.cardId))
      .map(m => {
        const owned = totalCopies(ownedCopiesOf(ownedIndex, m.cardId, m.label));
        return {
          cardId: m.cardId,
          card: null,                    // manual entries store label-only by default
          label: m.label,
          neededTotal: m.quantity,
          owned,
          missing: Math.max(0, m.quantity - owned),
          sources: [],
          kind: 'manual',
        };
      });

    return [...auto, ...manual];
  }, [decks, ownedIndex, manualRows, includeSideboard, includeCommander]);

  /* ─── manual API ─── */
  const addManual = useCallback(async (card, quantity = 1) => {
    if (!user || !card?.id) return;
    updateManualRows(rows => {
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
        .eq('user_id', user.id).eq('kind', MANUAL_KIND).eq('item_id', card.id);
    } else {
      await supabase.from(TABLE).insert({
        user_id: user.id, kind: MANUAL_KIND, item_id: card.id,
        item_label: card.name || '', quantity,
      });
    }
  }, [user, manualRows, updateManualRows]);

  const removeManual = useCallback(async (cardId) => {
    if (!user) return;
    updateManualRows(rows => rows.filter(r => r.cardId !== cardId));
    await supabase.from(TABLE).delete()
      .eq('user_id', user.id).eq('kind', MANUAL_KIND).eq('item_id', cardId);
  }, [user, updateManualRows]);

  return {
    wishlist,
    autoCount: wishlist.filter(w => w.kind === 'auto').length,
    manualCount: wishlist.filter(w => w.kind === 'manual').length,
    totalMissing: wishlist.reduce((s, w) => s + w.missing, 0),
    loading: (user ? loadingDecks : false) || inv.loading,
    error: error || inv.error,
    decks,
    ownedIndex,
    addManual,
    removeManual,
  };
}
