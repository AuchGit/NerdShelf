// src/features/mtg/deck-builder/pages/MtgFavoritesPage.jsx
//
// Standalone favorites view. Re-uses `useFavorites.loadFavoriteCards`
// (which already does Scryfall bulk-fetching) so the page works the
// moment a user navigates to it without needing the deck builder to be
// open.

import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../../shared/ui';
import { SearchBar } from '../../../../shared/search';
import { useFavorites } from '../hooks/useFavorites';
import { useMtgInventory } from '../hooks/useMtgInventory';
import MtgSubNav from '../components/MtgSubNav';

export default function MtgFavoritesPage() {
  const favs = useFavorites();
  const inv = useMtgInventory();
  const [query, setQuery] = useState('');

  // Trigger card hydration once on mount
  useEffect(() => {
    if (favs.favoriteCards === null) favs.loadFavoriteCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = useMemo(() => {
    const list = favs.favoriteCards || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c => (c.name || '').toLowerCase().includes(q));
  }, [favs.favoriteCards, query]);

  return (
    <>
      <MtgSubNav />
      <div style={containerStyle}>
        <div data-pwa-target="page-toolbar" style={toolbarStyle}>
          <h1 style={titleStyle}>Favoriten</h1>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            {favs.favorites.size} markiert
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Favoriten durchsuchen…" />
          </div>
        </div>

        {favs.loading && cards.length === 0 ? (
          <Panel style={emptyStyle}>
            <div style={{ color: 'var(--color-text-muted)' }}>Lade Favoriten…</div>
          </Panel>
        ) : cards.length === 0 ? (
          <Panel style={emptyStyle}>
            <div style={{ fontSize: 40, marginBottom: 'var(--space-3)' }}>☆</div>
            <div style={{ fontSize: 'var(--fs-lg)' }}>Keine Favoriten</div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
              Markiere Karten im Deckbuilder mit ★, um sie hier zu sammeln.
            </div>
          </Panel>
        ) : (
          <div style={gridStyle}>
            {cards.map(c => (
              <FavoriteRow
                key={c.id}
                card={c}
                ownedQty={inv.getQuantity(c.id)}
                onRemove={() => favs.toggleFavorite(c)}
                onAddToInv={() => inv.adjustQuantity(c.id, +1, c.name)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function FavoriteRow({ card, ownedQty, onRemove, onAddToInv }) {
  const img = card.image_uris?.normal
    || card.card_faces?.[0]?.image_uris?.normal
    || null;
  return (
    <Panel padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div
        aria-hidden="true"
        style={{
          width: '100%',
          aspectRatio: '63 / 88',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-sunken)',
          backgroundImage: img ? `url(${img})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 'var(--fw-semibold)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {card.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-xs)' }}>
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 999,
            background: ownedQty > 0 ? 'color-mix(in srgb, var(--color-success) 18%, transparent)' : 'var(--color-bg-sunken)',
            color: ownedQty > 0 ? 'var(--color-success)' : 'var(--color-text-dim)',
            fontWeight: 'var(--fw-semibold)',
          }}
        >
          {ownedQty > 0 ? `◉ ${ownedQty}` : 'nicht in Sammlung'}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onAddToInv} style={smBtnStyle}>+ Sammlung</button>
        <button type="button" onClick={onRemove} style={{ ...smBtnStyle, color: 'var(--color-text-dim)' }}>★</button>
      </div>
    </Panel>
  );
}

const containerStyle = {
  padding: 'var(--space-5)', maxWidth: 1200, margin: '0 auto',
  display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
};
const toolbarStyle = { display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' };
const titleStyle = { margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' };
const emptyStyle = { textAlign: 'center', padding: 'var(--space-7)' };
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
  gap: 'var(--space-3)',
};
const smBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  padding: '4px 8px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-xs)',
  cursor: 'pointer',
};
