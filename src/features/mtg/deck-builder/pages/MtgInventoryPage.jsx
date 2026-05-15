// src/features/mtg/deck-builder/pages/MtgInventoryPage.jsx
//
// Browse / edit the user's MTG card collection. Mirrors the WH40k
// inventory page in layout philosophy but uses MTG-native primitives:
// each row is keyed by a Scryfall card id and the labels persisted into
// `nerdshelf_inventory` come from the inventory hook's own writes.
//
// Cards in the inventory table store only id+label+quantity. To show
// rich card detail (image, mana cost, set) we lazy-fetch from Scryfall in
// chunks, mirroring `useFavorites.loadFavoriteCards` so the cache is
// shared semantically and the offline experience stays clean.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel, Button } from '../../../../shared/ui';
import { SearchBar } from '../../../../shared/search';
import { useMtgInventory } from '../hooks/useMtgInventory';
import { useFavorites } from '../hooks/useFavorites';
import { fetchCardsByIds } from '../services/scryfallCollection';
import MtgSubNav from '../components/MtgSubNav';
import InventoryImportModal from '../components/InventoryImportModal';

export default function MtgInventoryPage() {
  const navigate = useNavigate();
  const inv = useMtgInventory();
  const favs = useFavorites();
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState(null); // id → card
  const [showImport, setShowImport] = useState(false);

  const ownedIds = useMemo(() => [...inv.quantities.keys()], [inv.quantities]);

  useEffect(() => {
    if (ownedIds.length === 0) { setCards({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const fetched = await fetchCardsByIds(ownedIds);
        if (cancelled) return;
        const byId = {};
        for (const c of fetched) byId[c.id] = c;
        setCards(byId);
      } catch (e) {
        if (!cancelled) console.warn('[mtg-inventory] scryfall fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [ownedIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ownedIds
      .map(id => ({ id, card: cards?.[id] || null, qty: inv.getQuantity(id) }))
      .filter(r => {
        if (!q) return true;
        const name = (r.card?.name || '').toLowerCase();
        return name.includes(q) || r.id.includes(q);
      })
      .sort((a, b) => (a.card?.name || a.id).localeCompare(b.card?.name || b.id));
  }, [ownedIds, cards, inv, query]);

  const totalOwned = useMemo(() => {
    let n = 0;
    for (const v of inv.quantities.values()) n += v;
    return n;
  }, [inv.quantities]);

  return (
    <>
      <MtgSubNav />
      <div style={containerStyle}>
        <div style={toolbarStyle}>
          <h1 style={titleStyle}>Sammlung</h1>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            {ownedIds.length} Karten · <strong style={{ color: 'var(--color-text)' }}>{totalOwned}</strong> Kopien
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Sammlung durchsuchen…" />
          </div>
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            Importieren
          </Button>
        </div>

        {inv.tableMissing && (
          <Panel style={{ borderColor: 'var(--color-warning)', marginBottom: 'var(--space-3)' }}>
            <div style={{ color: 'var(--color-warning)', fontSize: 'var(--fs-sm)' }}>
              Supabase-Tabelle <code>nerdshelf_inventory</code> noch nicht migriert — die Sammlung wird nur in dieser Session gespeichert.
              Migration: <code>scripts/wh40k-schema.sql</code>.
            </div>
          </Panel>
        )}

        {rows.length === 0 ? (
          <Panel style={emptyStyle}>
            <div style={{ fontSize: 40, marginBottom: 'var(--space-3)' }}>◧</div>
            <div style={{ fontSize: 'var(--fs-lg)' }}>Sammlung ist leer</div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
              Setze im Deckbuilder bei Karten "+ Sammlung" oder importiere eine vorhandene Liste.
            </div>
          </Panel>
        ) : (
          <div style={gridStyle}>
            {rows.map(r => (
              <InventoryRow
                key={r.id}
                cardId={r.id}
                card={r.card}
                qty={r.qty}
                isFavorite={favs.isFavorite(r.id)}
                onInc={() => inv.adjustQuantity(r.id, +1, r.card?.name || '')}
                onDec={() => inv.adjustQuantity(r.id, -1, r.card?.name || '')}
                onRemove={() => inv.setQuantity(r.id, 0)}
                onToggleFav={() => r.card && favs.toggleFavorite(r.card)}
                onOpenInDeckBuilder={() => navigate('/mtg/deck/new')}
              />
            ))}
          </div>
        )}
      </div>
      <InventoryImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => setShowImport(false)}
      />
    </>
  );
}

function InventoryRow({ cardId, card, qty, isFavorite, onInc, onDec, onRemove, onToggleFav }) {
  const img = card?.image_uris?.small
    || card?.card_faces?.[0]?.image_uris?.small
    || null;
  return (
    <Panel
      padding="sm"
      style={{
        display: 'grid',
        gridTemplateColumns: '54px 1fr auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 54, height: 76, borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-sunken)',
          backgroundImage: img ? `url(${img})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }}
        aria-hidden="true"
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {card?.name || cardId}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
          {card?.type_line || '—'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={onToggleFav}
          aria-label="Favorit"
          title={isFavorite ? 'Favorit entfernen' : 'Favorisieren'}
          style={iconBtnStyle}
        >
          <span style={{ color: isFavorite ? 'var(--color-warning)' : 'var(--color-text-dim)' }}>
            {isFavorite ? '★' : '☆'}
          </span>
        </button>
        <div style={qtyGroup}>
          <button type="button" onClick={onDec} disabled={qty <= 0} style={qtyBtn(qty <= 0)}>−</button>
          <span style={{ minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-semibold)' }}>{qty}</span>
          <button type="button" onClick={onInc} style={qtyBtn(false)}>+</button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Aus Sammlung entfernen"
          title="Aus Sammlung entfernen"
          style={iconBtnStyle}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
        >✕</button>
      </div>
    </Panel>
  );
}

const containerStyle = {
  padding: 'var(--space-5)',
  maxWidth: 1200,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
};
const toolbarStyle = {
  display: 'flex',
  gap: 'var(--space-3)',
  alignItems: 'center',
  flexWrap: 'wrap',
};
const titleStyle = { margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' };
const emptyStyle = { textAlign: 'center', padding: 'var(--space-7)' };
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 'var(--space-3)',
};
const iconBtnStyle = {
  background: 'transparent', border: 'none',
  width: 26, height: 26, padding: 0,
  color: 'var(--color-text-dim)', cursor: 'pointer',
  fontSize: 'var(--fs-md)',
};
const qtyGroup = {
  display: 'flex', alignItems: 'center', gap: 2,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 2,
  background: 'var(--color-surface)',
};
function qtyBtn(disabled) {
  return {
    width: 22, height: 22, padding: 0,
    background: 'transparent', border: 'none',
    color: disabled ? 'var(--color-text-dim)' : 'var(--color-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 'var(--fs-md)', lineHeight: 1,
  };
}
