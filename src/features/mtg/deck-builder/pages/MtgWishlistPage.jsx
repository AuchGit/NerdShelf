// src/features/mtg/deck-builder/pages/MtgWishlistPage.jsx
//
// Auto-computed wishlist view. Each row tells the user:
//   - which card is needed
//   - how many they're short
//   - which deck(s) it came from
//
// Clicking ⊕ moves the card straight into inventory at the needed
// quantity — the typical "I just bought the missing ones" workflow.

import { useEffect, useMemo, useState } from 'react';
import { Panel, Button } from '../../../../shared/ui';
import { SearchBar } from '../../../../shared/search';
import { useMtgWishlist } from '../hooks/useMtgWishlist';
import { useMtgInventory } from '../hooks/useMtgInventory';
import { useFavorites } from '../hooks/useFavorites';
import MtgSubNav from '../components/MtgSubNav';
import CardmarketExportModal from '../components/CardmarketExportModal';
import { getCardPriceEur, formatEur } from '../services/scryfall';

export default function MtgWishlistPage() {
  const w = useMtgWishlist();
  const inv = useMtgInventory();
  const favs = useFavorites();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'auto' | 'manual'
  const [selected, setSelected] = useState(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSource, setExportSource] = useState('everything');

  const toggleSelect = (cardId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return w.wishlist.filter(row => {
      if (filter === 'auto' && row.kind !== 'auto') return false;
      if (filter === 'manual' && row.kind !== 'manual') return false;
      if (!q) return true;
      const name = (row.card?.name || row.label || '').toLowerCase();
      return name.includes(q);
    });
  }, [w.wishlist, query, filter]);

  async function handleAcquire(row) {
    const id = row.cardId;
    const name = row.card?.name || row.label || '';
    // Add exactly the missing quantity. User can fine-tune from the
    // inventory page if they bought more / fewer.
    await inv.adjustQuantity(id, row.missing, name);
  }

  // Cardmarket trend price summed across the whole wishlist (the price
  // of buying everything that's still missing right now).
  const totalEur = useMemo(() => {
    let sum = 0;
    for (const row of w.wishlist) {
      const p = getCardPriceEur(row.card);
      if (p != null) sum += p * row.missing;
    }
    return sum;
  }, [w.wishlist]);

  if (w.error) {
    return <ErrorState message={w.error} />;
  }

  return (
    <>
      <MtgSubNav />
      <div style={containerStyle}>
        <div data-pwa-target="page-toolbar" style={toolbarStyle}>
          <div>
            <h1 style={titleStyle}>Wunschliste</h1>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
              Automatisch berechnet aus {w.decks.length} Deck(s).
              {w.totalMissing > 0 && <> Du brauchst noch <strong style={{ color: 'var(--color-text)' }}>{w.totalMissing}</strong> Kopien.</>}
              {totalEur > 0 && (
                <>
                  {' · '}
                  Gesamt{' '}
                  <strong style={{ color: 'var(--color-accent)' }} title="Cardmarket Trend (EUR via Scryfall) für alle fehlenden Karten">
                    ≈ {formatEur(totalEur)}
                  </strong>
                </>
              )}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <Button
            size="sm"
            onClick={() => { setExportSource(selected.size > 0 ? 'selected' : 'everything'); setExportOpen(true); }}
            disabled={w.wishlist.length === 0 && selected.size === 0}
            title="Erzeugt eine Cardmarket-kompatible Decklist"
          >
            🛒 Cardmarket-Liste{selected.size > 0 ? ` (${selected.size} ausgewählt)` : ''}
          </Button>
          <div style={filterGroupStyle}>
            {[['all', 'Alle'], ['auto', 'Aus Decks'], ['manual', 'Manuell']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                style={filterTabStyle(filter === k)}
              >{label}</button>
            ))}
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Wunschliste durchsuchen…" />
          </div>
        </div>

        {w.loading && filtered.length === 0 ? (
          <Panel style={emptyStyle}>
            <div style={{ color: 'var(--color-text-muted)' }}>Berechne…</div>
          </Panel>
        ) : filtered.length === 0 ? (
          <Panel style={emptyStyle}>
            <div style={{ fontSize: 40, marginBottom: 'var(--space-3)' }}>✓</div>
            <div style={{ fontSize: 'var(--fs-lg)' }}>
              {w.wishlist.length === 0
                ? 'Keine offenen Wünsche'
                : 'Keine Treffer für den Filter'}
            </div>
            <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
              {w.wishlist.length === 0
                ? 'Deine Sammlung deckt alle Decks ab.'
                : 'Passe den Suchbegriff oder die Filter an.'}
            </div>
          </Panel>
        ) : (
          <div style={listStyle}>
            {filtered.map(row => (
              <WishlistRow
                key={row.cardId}
                row={row}
                isFavorite={favs.isFavorite(row.cardId)}
                isSelected={selected.has(row.cardId)}
                onToggleSelect={() => toggleSelect(row.cardId)}
                onAcquire={() => handleAcquire(row)}
                onRemoveManual={row.kind === 'manual' ? () => w.removeManual(row.cardId) : null}
                onToggleFavorite={row.card ? () => favs.toggleFavorite(row.card) : null}
              />
            ))}
          </div>
        )}
      </div>

      <CardmarketExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        decks={w.decks}
        inventory={inv.quantities}
        initialSource={exportSource}
        preselectedRows={selected}
      />
    </>
  );
}

function WishlistRow({ row, isFavorite, isSelected, onToggleSelect, onAcquire, onRemoveManual, onToggleFavorite }) {
  const img = row.card?.image_uris?.small
    || row.card?.card_faces?.[0]?.image_uris?.small
    || null;
  const eur = getCardPriceEur(row.card);
  const lineEur = eur != null ? eur * row.missing : null;
  return (
    <Panel padding="sm" style={{
      ...rowStyle,
      borderColor: isSelected ? 'var(--color-accent)' : undefined,
    }}>
      <input
        type="checkbox"
        checked={!!isSelected}
        onChange={onToggleSelect}
        title="Für Cardmarket-Export auswählen"
        style={{ flexShrink: 0 }}
      />
      <div
        aria-hidden="true"
        style={{
          width: 54, height: 76, borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-sunken)',
          backgroundImage: img ? `url(${img})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)' }}>
          {row.card?.name || row.label || row.cardId}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
          Brauchst {row.neededTotal} · besitzt {row.owned} · {' '}
          <span style={{ color: 'var(--color-warning)', fontWeight: 'var(--fw-semibold)' }}>
            fehlen {row.missing}
          </span>
          {lineEur != null && (
            <> · <strong style={{ color: 'var(--color-accent)' }}>{formatEur(lineEur)}</strong></>
          )}
        </div>
        {row.sources.length > 0 && (
          <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)' }}>
            Aus: {row.sources.join(', ')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {onToggleFavorite && (
          <button
            type="button"
            onClick={onToggleFavorite}
            title={isFavorite ? 'Favorit entfernen' : 'Favorisieren'}
            aria-label="Favorit"
            style={iconBtnStyle}
          >
            <span style={{ color: isFavorite ? 'var(--color-warning)' : 'var(--color-text-dim)' }}>
              {isFavorite ? '★' : '☆'}
            </span>
          </button>
        )}
        <Button size="sm" onClick={onAcquire}>+{row.missing} Sammlung</Button>
        {onRemoveManual && (
          <button
            type="button"
            onClick={onRemoveManual}
            title="Manuellen Eintrag entfernen"
            style={iconBtnStyle}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
          >✕</button>
        )}
      </div>
    </Panel>
  );
}

function ErrorState({ message }) {
  return (
    <>
      <MtgSubNav />
      <div style={containerStyle}>
        <Panel style={{ borderColor: 'var(--color-danger)' }}>
          <div style={{ color: 'var(--color-danger)' }}>
            Fehler beim Laden der Wunschliste: {message}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ─────────────────── styles ─────────────────── */

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
  alignItems: 'flex-end',
  flexWrap: 'wrap',
};
const titleStyle = { margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' };
const emptyStyle = { textAlign: 'center', padding: 'var(--space-7)' };
const listStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' };
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};
const iconBtnStyle = {
  background: 'transparent', border: 'none',
  width: 26, height: 26, padding: 0,
  color: 'var(--color-text-dim)', cursor: 'pointer',
  fontSize: 'var(--fs-md)',
};
const filterGroupStyle = {
  display: 'inline-flex',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};
function filterTabStyle(active) {
  return {
    padding: '6px 10px',
    minHeight: 28,
    background: active ? 'var(--color-accent)' : 'transparent',
    color: active ? 'var(--color-accent-contrast)' : 'var(--color-text-muted)',
    border: 'none',
    fontSize: 'var(--fs-sm)',
    fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
    cursor: 'pointer',
  };
}
