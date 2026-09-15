// src/features/mtg/deck-builder/components/PrintingPickerModal.jsx
//
// Choose which printing (artwork / edition) a card uses in this deck.
// Lists every paper printing Scryfall knows, newest first. Picking one
// stores a slim summary in the deck's `printings` map (see
// services/deckPrintings.js); "Standard" removes the choice again.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../../../shared/ui';
import { fetchPrintings, printingSummary } from '../services/deckPrintings';
import { getCardPriceEur, formatEur } from '../services/scryfall';

const SORTS = [
  { id: 'new',   label: 'Neueste' },
  { id: 'old',   label: 'Älteste' },
  { id: 'cheap', label: 'Günstigste' },
];

function thumbFor(card) {
  return card.image_uris?.normal
    || card.card_faces?.[0]?.image_uris?.normal
    || card.image_uris?.small
    || card.card_faces?.[0]?.image_uris?.small
    || null;
}

export default function PrintingPickerModal({
  open, onClose, card, currentPrintingId, onPick,
}) {
  const [state, setState] = useState({ loading: true, error: null, cards: [], hasMore: false, loadMore: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('new');

  useEffect(() => {
    if (!open || !card) return;
    let cancelled = false;
    setState({ loading: true, error: null, cards: [], hasMore: false, loadMore: null });
    setFilter('');
    fetchPrintings(card)
      .then(res => { if (!cancelled) setState({ loading: false, error: null, ...res }); })
      .catch(err => { if (!cancelled) setState({ loading: false, error: err.message, cards: [], hasMore: false, loadMore: null }); });
    return () => { cancelled = true; };
  }, [open, card]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? state.cards.filter(c =>
          (c.set_name || '').toLowerCase().includes(q)
          || (c.set || '').toLowerCase() === q
          || (c.released_at || '').startsWith(q))
      : [...state.cards];
    if (sort === 'old') list.reverse();
    if (sort === 'cheap') {
      const price = (c) => getCardPriceEur(c) ?? Infinity;
      list.sort((a, b) => price(a) - price(b));
    }
    return list;
  }, [state.cards, filter, sort]);

  if (!open || !card) return null;

  const handleMore = async () => {
    if (!state.loadMore) return;
    setLoadingMore(true);
    try {
      const res = await state.loadMore();
      setState(s => ({ ...s, ...res }));
    } catch (err) {
      setState(s => ({ ...s, error: err.message }));
    } finally {
      setLoadingMore(false);
    }
  };

  const pick = (printing) => {
    onPick(printing ? printingSummary(printing) : null);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Artwork wählen · ${card.name}`} width={820}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
          Gilt für diese Karte in diesem Deck — im Mainboard, Sideboard und in den Ideen.
          Eine gewählte Edition wird beim Cardmarket-Export mitgeschickt.
        </div>

        <div style={S.toolbar}>
          <button
            type="button"
            onClick={() => pick(null)}
            style={{ ...S.pill, ...(currentPrintingId ? {} : S.pillActive) }}
            title="Keine feste Edition — Cardmarket darf jede anbieten"
          >Standard</button>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Edition, Set-Code oder Jahr…"
            style={S.search}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {SORTS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                style={{ ...S.pill, ...(sort === s.id ? S.pillActive : {}) }}
              >{s.label}</button>
            ))}
          </div>
        </div>

        {state.loading ? (
          <div style={S.empty}>Lade Editionen…</div>
        ) : state.error ? (
          <div style={{ ...S.empty, color: 'var(--color-danger)' }}>Scryfall: {state.error}</div>
        ) : shown.length === 0 ? (
          <div style={S.empty}>Keine Editionen gefunden.</div>
        ) : (
          <div style={S.grid}>
            {shown.map(p => {
              const img = thumbFor(p);
              const eur = getCardPriceEur(p);
              const active = p.id === currentPrintingId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p)}
                  title={`${p.set_name} (${(p.set || '').toUpperCase()}) #${p.collector_number}`}
                  style={{ ...S.tile, ...(active ? S.tileActive : {}) }}
                >
                  {img
                    ? <img src={img} alt={p.set_name} loading="lazy" style={S.img} />
                    : <div style={S.imgFallback}>{p.set_name}</div>}
                  <div style={S.meta}>
                    <div style={S.setName}>{p.set_name}</div>
                    <div style={S.sub}>
                      <span>{(p.set || '').toUpperCase()} #{p.collector_number}{p.released_at ? ` · ${p.released_at.slice(0, 4)}` : ''}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{eur != null ? formatEur(eur) : '—'}</span>
                    </div>
                    {p.id === card.id && <div style={S.tag}>Standardbild</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {state.hasMore && !state.loading && (
          <Button variant="secondary" onClick={handleMore} disabled={loadingMore}>
            {loadingMore ? 'Lade…' : 'Weitere Editionen laden'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

const S = {
  toolbar: {
    display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap',
  },
  search: {
    flex: '1 1 160px', minWidth: 0, padding: '6px 10px',
    fontSize: 'var(--fs-sm)', fontFamily: 'inherit',
    background: 'var(--color-surface)', color: 'var(--color-text)',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  },
  pill: {
    padding: '6px 12px', borderRadius: 999,
    background: 'transparent', color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--fs-sm)', fontFamily: 'inherit', cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  pillActive: {
    background: 'var(--color-accent)', color: 'var(--color-accent-contrast)',
    borderColor: 'var(--color-accent)', fontWeight: 'var(--fw-semibold)',
  },
  empty: {
    padding: 'var(--space-5)', textAlign: 'center', color: 'var(--color-text-muted)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 'var(--space-2)',
  },
  tile: {
    display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
    background: 'var(--color-bg-sunken)', color: 'var(--color-text)',
    border: '2px solid transparent', borderRadius: 'var(--radius-md)',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
  },
  tileActive: { borderColor: 'var(--color-accent)' },
  img: { width: '100%', aspectRatio: '63 / 88', objectFit: 'cover', display: 'block' },
  imgFallback: {
    width: '100%', aspectRatio: '63 / 88',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', padding: 8, textAlign: 'center',
  },
  meta: { padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 2 },
  setName: {
    fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  sub: {
    display: 'flex', justifyContent: 'space-between', gap: 4,
    fontSize: 10, color: 'var(--color-text-muted)',
  },
  tag: {
    alignSelf: 'flex-start', fontSize: 9, fontWeight: 'var(--fw-bold)',
    letterSpacing: 0.4, textTransform: 'uppercase',
    padding: '1px 6px', borderRadius: 999,
    color: 'var(--color-text-muted)', border: '1px solid var(--color-border)',
  },
};
