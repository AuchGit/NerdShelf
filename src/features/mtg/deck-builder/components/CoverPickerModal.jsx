// src/features/mtg/deck-builder/components/CoverPickerModal.jsx
import { useEffect, useMemo, useState } from 'react';

/**
 * Pick (or clear) a deck's cover artwork. Lists every unique card in mainboard
 * + sideboard as a small thumbnail grid. Clicking sets it; "Kein Cover" clears.
 */
export default function CoverPickerModal({
  open, onClose, mainboard, sideboard, currentCoverId, onPick,
}) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cards = useMemo(() => {
    if (!open) return [];
    const map = new Map();
    for (const e of Object.values(mainboard || {})) {
      if (e?.card?.id) map.set(e.card.id, e.card);
    }
    for (const e of Object.values(sideboard || {})) {
      if (e?.card?.id && !map.has(e.card.id)) map.set(e.card.id, e.card);
    }
    return Array.from(map.values());
  }, [open, mainboard, sideboard]);

  if (!open) return null;

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? cards.filter(c => (c.name || '').toLowerCase().includes(q))
    : cards;

  function artFor(card) {
    return (
      card.image_uris?.art_crop ||
      card.card_faces?.[0]?.image_uris?.art_crop ||
      card.image_uris?.small ||
      card.card_faces?.[0]?.image_uris?.small ||
      null
    );
  }

  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={(e) => e.stopPropagation()} style={S.modal}>
        <div style={S.header}>
          <div style={S.title}>Cover-Karte wählen</div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        <div style={S.toolbar}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Suchen…"
            style={S.search}
            autoFocus
          />
          <button
            onClick={() => { onPick(null); onClose?.(); }}
            style={{
              ...S.clearBtn,
              ...(currentCoverId ? {} : { opacity: 0.5, cursor: 'default' }),
            }}
            disabled={!currentCoverId}
          >
            Kein Cover
          </button>
        </div>

        {filtered.length === 0 ? (
          <div style={S.empty}>
            {cards.length === 0
              ? 'Füge erst Karten hinzu, dann kannst du eine als Cover wählen.'
              : 'Keine Treffer.'}
          </div>
        ) : (
          <div style={S.grid}>
            {filtered.map(card => {
              const art = artFor(card);
              const isCurrent = card.id === currentCoverId;
              return (
                <button
                  key={card.id}
                  onClick={() => { onPick(card.id); onClose?.(); }}
                  title={card.name}
                  style={{
                    ...S.tile,
                    ...(isCurrent ? S.tileSel : {}),
                  }}
                >
                  {art ? (
                    <img src={art} alt={card.name} style={S.tileImg} loading="lazy" />
                  ) : (
                    <div style={S.tileFallback}>{card.name}</div>
                  )}
                  <div style={S.tileLabel}>{card.name}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    width: '100%', maxWidth: 720, maxHeight: '85vh',
    background: 'var(--color-bg-elevated, var(--bg-panel))',
    border: '1px solid var(--color-border, var(--border))',
    borderRadius: 12,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border, var(--border))',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  title: { fontSize: 16, fontWeight: 600, color: 'var(--color-text, var(--text-hi))' },
  closeBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--color-text-muted, var(--text-mid))', fontSize: 18,
    width: 32, height: 32, borderRadius: 6,
  },
  toolbar: {
    padding: '12px 16px',
    display: 'flex', gap: 8, alignItems: 'center',
    borderBottom: '1px solid var(--color-border, var(--border))',
  },
  search: {
    flex: 1, padding: '6px 10px', fontSize: 13,
    background: 'var(--color-bg-sunken, var(--bg-deep))',
    color: 'var(--color-text, var(--text-hi))',
    border: '1px solid var(--color-border, var(--border))',
    borderRadius: 6,
  },
  clearBtn: {
    padding: '6px 12px', fontSize: 12,
    background: 'transparent',
    color: 'var(--color-text-muted, var(--text-mid))',
    border: '1px solid var(--color-border, var(--border))',
    borderRadius: 6, cursor: 'pointer',
  },
  empty: {
    padding: 32, textAlign: 'center', fontSize: 13,
    color: 'var(--color-text-muted, var(--text-mid))',
  },
  grid: {
    overflow: 'auto', padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 8,
  },
  tile: {
    background: 'var(--color-bg-sunken, var(--bg-deep))',
    border: '2px solid transparent',
    borderRadius: 8, padding: 0, cursor: 'pointer',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    transition: 'border-color 120ms, transform 120ms',
  },
  tileSel: {
    borderColor: 'var(--color-accent, var(--accent))',
    transform: 'translateY(-1px)',
  },
  tileImg: {
    width: '100%', aspectRatio: '16 / 9',
    objectFit: 'cover', display: 'block',
  },
  tileFallback: {
    width: '100%', aspectRatio: '16 / 9',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, color: 'var(--color-text-muted, var(--text-mid))',
    background: 'var(--color-bg-elevated, var(--bg-panel))',
  },
  tileLabel: {
    fontSize: 11, padding: '4px 6px',
    color: 'var(--color-text, var(--text-hi))',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
};
