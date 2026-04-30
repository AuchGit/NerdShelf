// src/features/mtg/deck-builder/MtgDashboard.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { Panel } from '../../../shared/ui';
import DashboardLayout from '../../../shared/dashboard/DashboardLayout';

const COLOR_STYLE = {
  W: '#e0b352', U: '#4a8fd9', B: '#8a7fa8',
  R: '#e06a5a', G: '#6ab06a', C: '#808080',
};
const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

// Subtle 1px ring around text — only applied when a cover image sits behind
// the card, so the text stays readable across light and dark artworks.
const TEXT_SHADOW = '0 0 2px var(--color-bg-elevated), 0 0 2px var(--color-bg-elevated)';

// Default category order for known formats; rest sort alphabetically after these
const FORMAT_ORDER = [
  'Standard', 'Modern', 'Pioneer', 'Pauper', 'Legacy', 'Vintage',
  'Commander', 'Brawl', 'Historic', 'Limited', 'Cube',
];

export default function MtgDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadDecks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('mtg_decks')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (err) setError(err.message);
    else setDecks(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadDecks(); }, [loadDecks]);

  async function handleDelete(deckId, deckName) {
    if (!window.confirm(`Deck "${deckName}" wirklich löschen?`)) return;
    const { error: err } = await supabase
      .from('mtg_decks')
      .delete()
      .eq('id', deckId)
      .eq('user_id', user.id);
    if (err) alert(`Löschen fehlgeschlagen: ${err.message}`);
    else loadDecks();
  }

  return (
    <>
      {error && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-3) var(--space-5)',
          color: 'var(--color-danger)',
        }}>
          Fehler beim Laden: {error}
        </div>
      )}
      <DashboardLayout
        title="Meine Decks"
        newButtonLabel="+ Neues Deck"
        onNew={() => navigate('/mtg/deck/new')}
        items={decks}
        loading={loading}
        getCategory={(deck) => deck.format || 'Kein Format'}
        categoryOrder={FORMAT_ORDER}
        storageKey="mtg-dashboard-collapsed"
        emptyIcon="✦"
        emptyTitle="Noch keine Decks"
        emptyDescription="Erstelle dein erstes Deck, um loszulegen."
        renderItem={(deck) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            onOpen={() => navigate(`/mtg/deck/${deck.id}`)}
            onDelete={() => handleDelete(deck.id, deck.name)}
          />
        )}
      />
    </>
  );
}

function DeckCard({ deck, onOpen, onDelete }) {
  const data = deck.data || {};
  const mainCount = Object.values(data.mainboard || {}).reduce((s, e) => s + (e.count || 0), 0);
  const sideCount = Object.values(data.sideboard || {}).reduce((s, e) => s + (e.count || 0), 0);

  // Aggregate colors
  const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, count } of Object.values(data.mainboard || {})) {
    if (!card?.colors || card.colors.length === 0) colorCounts.C += count;
    else for (const c of card.colors) if (colorCounts[c] !== undefined) colorCounts[c] += count;
  }
  // Sort: WUBRG entries by count desc, then colorless at the end (regardless of count)
  const colorEntries = Object.entries(colorCounts)
    .filter(([c, v]) => v > 0 && c !== 'C')
    .sort((a, b) => b[1] - a[1]);
  if (colorCounts.C > 0) colorEntries.push(['C', colorCounts.C]);
  const totalColored = colorEntries.reduce((s, [, v]) => s + v, 0);

  // Cover artwork: look up the chosen card in main/side, prefer art_crop image
  const coverId = data.coverCardId;
  let coverArt = null;
  if (coverId) {
    const entry = (data.mainboard?.[coverId] || data.sideboard?.[coverId]);
    const cardObj = entry?.card;
    if (cardObj) {
      coverArt =
        cardObj.image_uris?.art_crop ||
        cardObj.card_faces?.[0]?.image_uris?.art_crop ||
        cardObj.image_uris?.normal ||
        cardObj.card_faces?.[0]?.image_uris?.normal ||
        null;
    }
  }

  return (
    <Panel
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        isolation: 'isolate',
        transition: 'transform var(--transition), border-color var(--transition)',
      }}
      onClick={onOpen}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      {coverArt && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${coverArt})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.55,
              zIndex: -2,
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-bg-elevated) 25%, transparent) 0%, color-mix(in srgb, var(--color-bg-elevated) 55%, transparent) 100%)',
              zIndex: -1,
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
            marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: coverArt ? TEXT_SHADOW : undefined,
          }}>
            {deck.name || 'Unbenanntes Deck'}
          </div>
          {deck.format && (
            <div style={{
              display: 'inline-block', fontSize: 'var(--fs-xs)',
              color: 'var(--color-text-muted)', textTransform: 'uppercase',
              letterSpacing: 0.5,
              textShadow: coverArt ? TEXT_SHADOW : undefined,
            }}>
              {deck.format}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--color-text-dim)', cursor: 'pointer',
            padding: 4, borderRadius: 4, fontSize: 16,
          }}
          title="Deck löschen"
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
        >✕</button>
      </div>

      <div style={{
        display: 'flex', gap: 'var(--space-4)', color: 'var(--color-text-muted)',
        fontSize: 'var(--fs-sm)',
        textShadow: coverArt ? TEXT_SHADOW : undefined,
      }}>
        <div>
          <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-semibold)' }}>
            {mainCount}
          </span>
          {' '}Mainboard
        </div>
        {sideCount > 0 && (
          <div>
            <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-semibold)' }}>
              {sideCount}
            </span>
            {' '}Sideboard
          </div>
        )}
      </div>

      <ColorBar entries={colorEntries} total={totalColored} />

      <div style={{
        fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-2)',
        textShadow: coverArt ? TEXT_SHADOW : undefined,
      }}>
        Aktualisiert: {new Date(deck.updated_at).toLocaleDateString('de-DE')}
      </div>
    </Panel>
  );
}

function ColorBar({ entries, total }) {
  if (!entries.length || total === 0) {
    return (
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)', minHeight: 10 }}>
        Leeres Deck
      </div>
    );
  }

  // Cumulative start position (0..1) for each segment so we can place a count
  // label exactly where the colour begins on the bar.
  let acc = 0;
  const labels = entries.map(([c, n]) => {
    const startPct = (acc / total) * 100;
    acc += n;
    return { c, n, startPct };
  });

  return (
    <div
      role="img"
      aria-label={entries.map(([c, n]) => `${COLOR_LABEL[c]} ${n}`).join(', ')}
      style={{ position: 'relative', paddingTop: 14 }}
    >
      {/* Count labels anchored at each segment's left edge */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12, pointerEvents: 'none' }}>
        {labels.map(({ c, n, startPct }) => (
          <span
            key={c}
            title={`${COLOR_LABEL[c]}: ${n} (${Math.round((n / total) * 100)}%)`}
            style={{
              position: 'absolute',
              left: `${startPct}%`,
              transform: startPct > 92 ? 'translateX(-100%)' : 'translateX(-2px)',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              color: COLOR_STYLE[c],
              textShadow: '0 0 3px var(--color-bg-elevated), 0 0 3px var(--color-bg-elevated)',
              whiteSpace: 'nowrap',
            }}
          >
            {n}
          </span>
        ))}
      </div>

      {/* The bar itself */}
      <div
        style={{
          display: 'flex',
          height: 10,
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--color-bg-sunken)',
          border: '1px solid var(--color-border)',
        }}
      >
        {entries.map(([c, n]) => (
          <div
            key={c}
            title={`${COLOR_LABEL[c]}: ${n} (${Math.round((n / total) * 100)}%)`}
            style={{
              flex: n,
              background: COLOR_STYLE[c],
              minWidth: 4,
            }}
          />
        ))}
      </div>
    </div>
  );
}