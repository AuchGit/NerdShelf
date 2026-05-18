// src/features/mtg/deck-builder/pages/DeckViewPage.jsx
//
// Read-only viewer for an imported (foreign) MTG deck. Loaded via
// share_token by the route /mtg/deck/view/:token. Renders the deck's
// mainboard / sideboard / commander as plain lists with prices — no
// edit affordances of any kind. The deck-builder app itself is left
// untouched.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../../core/supabase/client';
import { Panel } from '../../../../shared/ui';
import { ShareTokenBadge } from '../../../../shared/tokens';
import { getCardPriceEur, formatEur } from '../services/scryfall';

export default function DeckViewPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [ownerName, setOwnerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: r, error: err } = await supabase
        .from('mtg_decks')
        .select('*')
        .eq('share_token', token)
        .maybeSingle();
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      if (!r) { setError('Deck nicht gefunden — der Import wurde eventuell entfernt.'); setLoading(false); return; }
      setRow(r);
      const { data: prof } = await supabase
        .from('profiles').select('player_name').eq('id', r.user_id).maybeSingle();
      if (!cancelled) setOwnerName(prof?.player_name || '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const stats = useMemo(() => {
    if (!row) return null;
    const d = row.data || {};
    const sumEntry = (entries) =>
      Object.values(entries || {}).reduce((acc, e) => {
        const p = getCardPriceEur(e.card) ?? 0;
        return {
          count: acc.count + (e.count || 0),
          price: acc.price + p * (e.count || 0),
        };
      }, { count: 0, price: 0 });
    const main = sumEntry(d.mainboard);
    const side = sumEntry(d.sideboard);
    const cmdPrice = d.commander ? (getCardPriceEur(d.commander) ?? 0) : 0;
    return {
      main,
      side,
      commander: d.commander,
      mainEntries: Object.values(d.mainboard || {}),
      sideEntries: Object.values(d.sideboard || {}),
      totalEur: main.price + side.price + cmdPrice,
    };
  }, [row]);

  if (loading) return <Centered>Lade Deck…</Centered>;
  if (error) {
    return (
      <Centered>
        <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>{error}</div>
        <button onClick={() => navigate('/mtg')} style={backBtnStyle}>← Zurück</button>
      </Centered>
    );
  }
  if (!row || !stats) return null;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-5)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/mtg')} style={backBtnStyle}>← Dashboard</button>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' }}>
          {row.name || 'Unbenanntes Deck'}
        </h1>
        <span style={pillStyle}>👁 Nur lesen</span>
        {ownerName && (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            geteilt von <strong style={{ color: 'var(--color-text)' }}>{ownerName}</strong>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {row.share_token && <ShareTokenBadge token={row.share_token} label="Token" />}
      </header>

      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        {row.format && <div>Format: <strong style={{ color: 'var(--color-text)' }}>{row.format}</strong></div>}
        <div>Mainboard: <strong style={{ color: 'var(--color-text)' }}>{stats.main.count}</strong></div>
        {stats.side.count > 0 && <div>Sideboard: <strong style={{ color: 'var(--color-text)' }}>{stats.side.count}</strong></div>}
        <div>Wert: <strong style={{ color: 'var(--color-accent)' }}>≈ {formatEur(stats.totalEur)}</strong></div>
      </div>

      {stats.commander && (
        <Panel style={{ marginBottom: 'var(--space-3)' }}>
          <SectionLabel>Commander</SectionLabel>
          <CardRow entry={{ card: stats.commander, count: 1 }} />
        </Panel>
      )}

      <Panel style={{ padding: 0 }}>
        <SectionLabel padded>Mainboard ({stats.main.count})</SectionLabel>
        {stats.mainEntries.length === 0 ? (
          <Empty>Leer.</Empty>
        ) : (
          <div>
            {stats.mainEntries
              .sort((a, b) => (a.card?.name || '').localeCompare(b.card?.name || ''))
              .map(e => (
                <CardRow key={e.card?.id || Math.random()} entry={e} />
              ))}
          </div>
        )}
      </Panel>

      {stats.sideEntries.length > 0 && (
        <Panel style={{ marginTop: 'var(--space-3)', padding: 0 }}>
          <SectionLabel padded>Sideboard ({stats.side.count})</SectionLabel>
          <div>
            {stats.sideEntries
              .sort((a, b) => (a.card?.name || '').localeCompare(b.card?.name || ''))
              .map(e => (
                <CardRow key={e.card?.id || Math.random()} entry={e} />
              ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function SectionLabel({ children, padded = false }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: 'var(--color-text-muted)',
      fontWeight: 'var(--fw-semibold)',
      padding: padded ? 'var(--space-2) var(--space-3)' : 0,
      borderBottom: padded ? '1px solid var(--color-border)' : 'none',
      marginBottom: padded ? 0 : 6,
    }}>
      {children}
    </div>
  );
}

function CardRow({ entry }) {
  const { card, count } = entry;
  const img = card?.image_uris?.small || card?.card_faces?.[0]?.image_uris?.small;
  const eur = getCardPriceEur(card);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      borderBottom: '1px solid var(--color-border)',
    }}>
      <div
        aria-hidden="true"
        style={{
          width: 30, height: 42, borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-sunken)',
          backgroundImage: img ? `url(${img})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {card?.name || 'Unbekannte Karte'}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
          {card?.type_line || '—'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {eur != null && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {formatEur(eur)}
          </span>
        )}
        <span style={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 'var(--fw-semibold)',
          fontSize: 'var(--fs-sm)',
          minWidth: 28, textAlign: 'right',
        }}>
          {count}×
        </span>
      </div>
    </div>
  );
}

function Centered({ children }) {
  return <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>{children}</div>;
}
function Empty({ children }) {
  return <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>{children}</div>;
}

const backBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  padding: '4px 12px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const pillStyle = {
  padding: '2px 10px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
  color: 'var(--color-accent)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  border: '1px solid var(--color-accent)',
};
