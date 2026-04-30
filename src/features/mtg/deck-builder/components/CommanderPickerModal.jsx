// src/features/mtg/deck-builder/components/CommanderPickerModal.jsx
import { useEffect, useRef, useState } from 'react';

const BASE = 'https://api.scryfall.com';

/**
 * Searches Scryfall for cards eligible to be a Commander.
 * Restricted to legendary creatures (most common case). Backgrounds,
 * partners and "can be your commander" planeswalker exceptions are
 * deliberately not handled in this v1.
 */
export default function CommanderPickerModal({ open, onClose, currentCommander, onPick }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    clearTimeout(debRef.current);
    if (!q) { setResults([]); setError(null); return; }
    debRef.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const search = encodeURIComponent(`is:commander ${q}`);
        const r = await fetch(`${BASE}/cards/search?q=${search}&unique=cards&order=name`);
        if (!r.ok) {
          if (r.status === 404) { setResults([]); return; }
          const j = await r.json().catch(() => ({}));
          throw new Error(j.details || `Scryfall ${r.status}`);
        }
        const j = await r.json();
        setResults((j.data || []).slice(0, 60));
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(debRef.current);
  }, [query, open]);

  if (!open) return null;

  function imageFor(card) {
    return (
      card.image_uris?.small ||
      card.card_faces?.[0]?.image_uris?.small ||
      card.image_uris?.normal ||
      card.card_faces?.[0]?.image_uris?.normal ||
      null
    );
  }

  function colorIdentityStr(card) {
    const ci = card.color_identity || [];
    return ci.length ? ci.join('') : 'C';
  }

  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={(e) => e.stopPropagation()} style={S.modal}>
        <div style={S.header}>
          <div style={S.title}>Commander wählen</div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        <div style={S.toolbar}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Legendäre Kreatur suchen…"
            style={S.search}
            autoFocus
          />
          {currentCommander && (
            <button
              onClick={() => { onPick(null); onClose?.(); }}
              style={S.clearBtn}
              title="Commander entfernen"
            >
              Entfernen
            </button>
          )}
        </div>

        {currentCommander && (
          <div style={S.currentBox}>
            Aktuell: <strong>{currentCommander.name}</strong>{' '}
            <span style={{ color: 'var(--text-mid)' }}>· {colorIdentityStr(currentCommander)}</span>
          </div>
        )}

        <div style={S.body}>
          {loading && <div style={S.empty}>Suche…</div>}
          {error && <div style={{ ...S.empty, color: 'var(--color-danger, #cc3333)' }}>{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div style={S.empty}>
              {query ? 'Keine Treffer.' : 'Tippe einen Namen, um zu suchen.'}
            </div>
          )}
          {!loading && !error && results.length > 0 && (
            <div style={S.grid}>
              {results.map(card => {
                const isCurrent = card.id === currentCommander?.id;
                return (
                  <button
                    key={card.id}
                    onClick={() => { onPick(card); onClose?.(); }}
                    title={card.name}
                    style={{ ...S.tile, ...(isCurrent ? S.tileSel : {}) }}
                  >
                    {imageFor(card) ? (
                      <img src={imageFor(card)} alt={card.name} style={S.tileImg} loading="lazy" />
                    ) : (
                      <div style={S.tileFallback}>{card.name}</div>
                    )}
                    <div style={S.tileLabel}>
                      <span>{card.name}</span>
                      <span style={S.ciBadge}>{colorIdentityStr(card)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
    width: '100%', maxWidth: 760, maxHeight: '85vh',
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
    color: 'var(--color-danger, #cc3333)',
    border: '1px solid var(--color-danger, #cc3333)',
    borderRadius: 6, cursor: 'pointer',
  },
  currentBox: {
    padding: '8px 16px', fontSize: 12,
    color: 'var(--color-text, var(--text-hi))',
    background: 'var(--color-bg-sunken, var(--bg-deep))',
    borderBottom: '1px solid var(--color-border, var(--border))',
  },
  body: { overflow: 'auto', flex: 1 },
  empty: {
    padding: 32, textAlign: 'center', fontSize: 13,
    color: 'var(--color-text-muted, var(--text-mid))',
  },
  grid: {
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: 10,
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
    width: '100%', aspectRatio: '63 / 88',
    objectFit: 'cover', display: 'block',
  },
  tileFallback: {
    width: '100%', aspectRatio: '63 / 88',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, color: 'var(--color-text-muted, var(--text-mid))',
    background: 'var(--color-bg-elevated, var(--bg-panel))',
  },
  tileLabel: {
    fontSize: 11, padding: '4px 6px',
    color: 'var(--color-text, var(--text-hi))',
    display: 'flex', justifyContent: 'space-between', gap: 4,
    whiteSpace: 'nowrap', overflow: 'hidden',
  },
  ciBadge: {
    fontFamily: 'monospace', fontWeight: 700,
    color: 'var(--color-accent, var(--accent))',
    flexShrink: 0,
  },
};
